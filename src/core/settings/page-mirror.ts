import { browser } from 'wxt/browser';
import type { Settings } from './schema';

/**
 * Page mirror: the few settings a funpay.com content script needs, kept where content scripts may
 * read them.
 *
 * On Chrome the background restricts `storage.local` (all settings, the last FunPay session) to
 * trusted contexts — extension pages and the service worker — and opens `storage.session` to
 * content scripts for this mirror. Firefox has no `setAccessLevel`: content scripts there can still
 * read `storage.local`, where the mirror is written as well. Content scripts never read `settings`.
 *
 * Only presentation settings and the request spacing belong in the mirror — never templates,
 * rules, Telegram/AI configuration, consent records or anything else from Settings. For the same
 * reason `storage.session` must hold nothing sensitive: on Chrome content scripts can read it.
 *
 * Deliberately free of zod so the document_start privacy script stays tiny; readers validate.
 */
export const PAGE_MIRROR_KEY = 'pageMirror';

export interface PageMirror {
  v: 1;
  privacy: { privacyMode: boolean; hideBalances: boolean };
  appearance: Settings['appearance'];
  sync: { minRequestGapMs: number };
}

export function pageMirrorFromSettings(s: Settings): PageMirror {
  return {
    v: 1,
    privacy: { privacyMode: s.privacy.privacyMode, hideBalances: s.privacy.hideBalances },
    appearance: s.appearance,
    sync: { minRequestGapMs: s.sync.minRequestGapMs },
  };
}

/** Background only: write the mirror to both areas; content scripts read whichever they may access. */
export async function writePageMirror(s: Settings): Promise<void> {
  const value = { [PAGE_MIRROR_KEY]: pageMirrorFromSettings(s) };
  await Promise.allSettled([
    browser.storage.session?.set(value) ?? Promise.resolve(),
    browser.storage.local.set(value),
  ]);
}

interface AccessLevelArea {
  setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
}

export type StorageAccess = 'restricted' | 'unsupported' | 'failed';

let lastAccess: StorageAccess | 'pending' = 'pending';

/** Outcome of the last `restrictStorageAccess()` in this worker (diagnostics). */
export function storageAccessState(): StorageAccess | 'pending' {
  return lastAccess;
}

/**
 * Background only, on every service-worker start: limit `storage.local` to trusted contexts, then
 * open `storage.session` (the mirror, the FunPay tab registry, notification click targets) to
 * content scripts. If the session area cannot be opened, `storage.local` is opened again so the
 * privacy blur keeps working — the previous, weaker state.
 */
export async function restrictStorageAccess(): Promise<StorageAccess> {
  lastAccess = await applyAccessLevels();
  return lastAccess;
}

async function applyAccessLevels(): Promise<StorageAccess> {
  const local = browser.storage.local as unknown as AccessLevelArea;
  const session = browser.storage.session as unknown as AccessLevelArea | undefined;
  if (typeof local.setAccessLevel !== 'function' || typeof session?.setAccessLevel !== 'function')
    return 'unsupported';
  try {
    await local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    return 'failed';
  }
  try {
    await session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    return 'restricted';
  } catch {
    await local.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }).catch(() => undefined);
    return 'failed';
  }
}

type RawMirror = Record<string, unknown>;

/** Content scripts: the stored mirror (unvalidated), from `storage.session`, else `storage.local`. */
export async function readPageMirror(): Promise<RawMirror | null> {
  for (const area of [browser.storage.session, browser.storage.local]) {
    if (!area) continue;
    try {
      const raw: unknown = (await area.get(PAGE_MIRROR_KEY))[PAGE_MIRROR_KEY];
      if (raw && typeof raw === 'object') return raw as RawMirror;
    } catch {
      // Not readable from this context (storage.local in a Chrome content script).
    }
  }
  return null;
}

/** Content scripts: live mirror updates (unvalidated). */
export function watchPageMirror(cb: (raw: RawMirror) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>) => {
    const raw = changes[PAGE_MIRROR_KEY]?.newValue;
    if (raw && typeof raw === 'object') cb(raw as RawMirror);
  };
  browser.storage.onChanged.addListener(listener);
  return () => browser.storage.onChanged.removeListener(listener);
}

/** Privacy flags from a raw mirror; anything that is not literally `true` counts as off. */
export function mirrorPrivacy(raw: RawMirror | null): { privacy: boolean; balances: boolean } {
  const p = raw?.['privacy'] as { privacyMode?: unknown; hideBalances?: unknown } | undefined;
  const privacy = p?.privacyMode === true;
  return { privacy, balances: privacy || p?.hideBalances === true };
}

export const DEFAULT_REQUEST_GAP_MS = 2500;

/** Request spacing from a raw mirror, within the settings schema bounds (1–60 s). */
export function mirrorMinGap(raw: RawMirror | null): number {
  const v = (raw?.['sync'] as { minRequestGapMs?: unknown } | undefined)?.minRequestGapMs;
  return typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 60_000
    ? v
    : DEFAULT_REQUEST_GAP_MS;
}
