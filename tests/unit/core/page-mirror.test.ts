import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { mergeSettings, defaultSettings } from '@/core/settings/schema';
import {
  DEFAULT_REQUEST_GAP_MS,
  mirrorMinGap,
  mirrorPrivacy,
  PAGE_MIRROR_KEY,
  pageMirrorFromSettings,
  readPageMirror,
  restrictStorageAccess,
  watchPageMirror,
  writePageMirror,
} from '@/core/settings/page-mirror';

type Area = { setAccessLevel?: unknown };
const local = () => fakeBrowser.storage.local as unknown as Area;
const session = () => fakeBrowser.storage.session as unknown as Area;

beforeEach(() => {
  fakeBrowser.reset();
  delete local().setAccessLevel;
  delete session().setAccessLevel;
});

function withAccessLevels(failSession = false) {
  const calls: string[] = [];
  local().setAccessLevel = vi.fn(async (o: { accessLevel: string }) => {
    calls.push(`local:${o.accessLevel}`);
  });
  session().setAccessLevel = vi.fn(async (o: { accessLevel: string }) => {
    calls.push(`session:${o.accessLevel}`);
    if (failSession) throw new Error('not supported');
  });
  return calls;
}

describe('page mirror (settings visible to funpay.com content scripts)', () => {
  it('carries presentation settings and the request gap only', () => {
    const s = mergeSettings(defaultSettings(), {
      privacy: { privacyMode: true },
      sync: { minRequestGapMs: 4000 },
      telegram: { chatId: '123456789' },
    });
    const m = pageMirrorFromSettings(s);
    expect(Object.keys(m).sort()).toEqual(['appearance', 'privacy', 'sync', 'v']);
    expect(Object.keys(m.privacy).sort()).toEqual(['hideBalances', 'privacyMode']);
    expect(Object.keys(m.sync)).toEqual(['minRequestGapMs']);
    expect(JSON.stringify(m)).not.toContain('123456789');
    expect(mirrorPrivacy(m as unknown as Record<string, unknown>)).toEqual({ privacy: true, balances: true });
    expect(mirrorMinGap(m as unknown as Record<string, unknown>)).toBe(4000);
  });

  it('is written to both areas; readers prefer storage.session and fall back to storage.local', async () => {
    await writePageMirror(mergeSettings(defaultSettings(), { privacy: { hideBalances: true } }));
    expect((await fakeBrowser.storage.session.get(PAGE_MIRROR_KEY))[PAGE_MIRROR_KEY]).toBeTruthy();
    expect(mirrorPrivacy(await readPageMirror())).toEqual({ privacy: false, balances: true });

    // A Chrome content script cannot read storage.local; one that cannot read the session area
    // (Firefox) uses the local copy.
    vi.spyOn(fakeBrowser.storage.session, 'get').mockRejectedValue(
      new Error('Access to storage is not allowed'),
    );
    expect(mirrorPrivacy(await readPageMirror())).toEqual({ privacy: false, balances: true });
    vi.spyOn(fakeBrowser.storage.local, 'get').mockRejectedValue(
      new Error('Access to storage is not allowed'),
    );
    expect(await readPageMirror()).toBeNull();
  });

  it('readers treat missing or malformed values as defaults', () => {
    expect(mirrorPrivacy(null)).toEqual({ privacy: false, balances: false });
    expect(mirrorPrivacy({ privacy: { privacyMode: 'yes' } })).toEqual({ privacy: false, balances: false });
    expect(mirrorMinGap(null)).toBe(DEFAULT_REQUEST_GAP_MS);
    expect(mirrorMinGap({ sync: { minRequestGapMs: 10 } })).toBe(DEFAULT_REQUEST_GAP_MS);
    expect(mirrorMinGap({ sync: { minRequestGapMs: 1500.5 } })).toBe(DEFAULT_REQUEST_GAP_MS);
  });

  it('notifies content scripts of mirror changes only', async () => {
    const seen: unknown[] = [];
    const stop = watchPageMirror((raw) => seen.push(raw));
    await fakeBrowser.storage.local.set({ settings: { privacy: { privacyMode: true } } });
    await writePageMirror(mergeSettings(defaultSettings(), { privacy: { privacyMode: true } }));
    stop();
    await writePageMirror(defaultSettings());
    expect(seen.length).toBeGreaterThan(0);
    for (const raw of seen) expect(mirrorPrivacy(raw as Record<string, unknown>).privacy).toBe(true);
  });
});

describe('storage access levels (Chrome)', () => {
  it('reports unsupported where setAccessLevel does not exist (Firefox)', async () => {
    expect(await restrictStorageAccess()).toBe('unsupported');
  });

  it('restricts storage.local before opening storage.session to content scripts', async () => {
    const calls = withAccessLevels();
    expect(await restrictStorageAccess()).toBe('restricted');
    expect(calls).toEqual(['local:TRUSTED_CONTEXTS', 'session:TRUSTED_AND_UNTRUSTED_CONTEXTS']);
  });

  it('re-opens storage.local when the session area cannot be opened (privacy blur keeps working)', async () => {
    const calls = withAccessLevels(true);
    expect(await restrictStorageAccess()).toBe('failed');
    expect(calls).toEqual([
      'local:TRUSTED_CONTEXTS',
      'session:TRUSTED_AND_UNTRUSTED_CONTEXTS',
      'local:TRUSTED_AND_UNTRUSTED_CONTEXTS',
    ]);
  });
});

describe('storage.session contents', () => {
  it('holds only non-sensitive keys: on Chrome, content scripts can read it', () => {
    const keys = new Set<string>();
    const directWriters: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.tsx?$/.test(name)) {
          const src = readFileSync(path, 'utf8');
          for (const m of src.matchAll(/['"`]session:(\w+)['"`]/g)) keys.add(m[1]!);
          if (/storage\.session\??\.set\(/.test(src)) directWriters.push(path);
        }
      }
    };
    walk('src');
    // Tab ids with FunPay URLs and the public session badge; FunPay URLs for notification clicks.
    expect([...keys].sort()).toEqual(['funpayTabs', 'notificationTargets']);
    expect(directWriters).toEqual([join('src', 'core', 'settings', 'page-mirror.ts')]);
  });
});
