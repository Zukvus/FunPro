import { File as NodeFile } from 'node:buffer';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { getSettings, updateSettings } from '@/core/settings/store';
import {
  backgroundForFunPay,
  BackgroundImageValidationError,
  MAX_BACKGROUND_BYTES,
  removeBackgroundImage,
  setBackgroundImage,
  sniffImageMime,
  validateBackgroundImage,
  type BlobLike,
} from '@/features/appearance/background';
import { isSafeImageDataUrl } from '@/features/appearance/funpay-css';

const SIG = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  jpeg: [0xff, 0xd8, 0xff, 0xe0],
  gif: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  webp: [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
};

function file(bytes: number[] | Uint8Array, type: string, name = 'bg'): BlobLike & { name: string } {
  // Node's File survives fake-indexeddb's structured clone (happy-dom's Blob does not).
  return new NodeFile([bytes instanceof Uint8Array ? bytes : new Uint8Array([...bytes, 1, 2, 3, 4])], name, { type }) as unknown as BlobLike & { name: string };
}

beforeEach(() => {
  resetDbForTests();
});

describe('background image validation', () => {
  it('detects real image signatures', () => {
    expect(sniffImageMime(new Uint8Array(SIG.png))).toBe('image/png');
    expect(sniffImageMime(new Uint8Array(SIG.jpeg))).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array(SIG.gif))).toBe('image/gif');
    expect(sniffImageMime(new Uint8Array(SIG.webp))).toBe('image/webp');
    expect(sniffImageMime(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('accepts png, jpeg, webp and gif', async () => {
    for (const [kind, sig] of Object.entries(SIG)) {
      const r = await validateBackgroundImage(file(sig, `image/${kind}`));
      expect(r).toEqual({ ok: true, mime: `image/${kind}` });
    }
  });

  it('rejects unsupported types, oversized and disguised files', async () => {
    expect(await validateBackgroundImage(file(SIG.png, 'image/svg+xml'))).toEqual({ ok: false, error: 'unsupported_type' });
    expect(await validateBackgroundImage(file(SIG.png, 'text/html'))).toEqual({ ok: false, error: 'unsupported_type' });
    // HTML pretending to be a PNG.
    expect(await validateBackgroundImage(file([...new TextEncoder().encode('<html><script>')], 'image/png'))).toEqual({ ok: false, error: 'content_mismatch' });
    expect(await validateBackgroundImage(file(new Uint8Array(0), 'image/png'))).toEqual({ ok: false, error: 'empty' });
    const big = new Uint8Array(MAX_BACKGROUND_BYTES + 1);
    big.set(SIG.png);
    expect(await validateBackgroundImage(file(big, 'image/png'))).toEqual({ ok: false, error: 'too_large' });
  });

  it('accepts exactly 3 MB and stores the sniffed type when the extension lies', async () => {
    const max = new Uint8Array(MAX_BACKGROUND_BYTES);
    max.set(SIG.png);
    expect(await validateBackgroundImage(file(max, 'image/png'))).toEqual({ ok: true, mime: 'image/png' });
    expect(await validateBackgroundImage(file(SIG.png, 'image/jpeg'))).toEqual({ ok: true, mime: 'image/png' });
  });
});

describe('background image storage', () => {
  it('stores the blob, points settings at it and removes the previous image', async () => {
    const first = await setBackgroundImage(file(SIG.png, 'image/png', 'one.png'), 1);
    expect((await getSettings()).appearance.backgroundImageAssetId).toBe(first);
    const second = await setBackgroundImage(file(SIG.jpeg, 'image/jpeg', 'two.jpg'), 2);
    const assets = await getDb().assets.toArray();
    expect(assets.map((a) => a.id)).toEqual([second]);
    expect(assets[0]).toMatchObject({ kind: 'background', mime: 'image/jpeg', name: 'two.jpg' });
    expect((await getSettings()).appearance.backgroundImageAssetId).toBe(second);
  });

  it('leaves settings and assets untouched when validation fails', async () => {
    await expect(setBackgroundImage(file(SIG.png, 'image/svg+xml'))).rejects.toBeInstanceOf(BackgroundImageValidationError);
    expect(await getDb().assets.count()).toBe(0);
    expect((await getSettings()).appearance.backgroundImageAssetId).toBeNull();
  });

  it('remove clears the setting and every background asset but keeps other assets', async () => {
    await setBackgroundImage(file(SIG.png, 'image/png'));
    await getDb().assets.put({ id: 'snd', kind: 'sound', name: 's', mime: 'audio/mpeg', blob: file([1, 2], 'audio/mpeg') as unknown as Blob, createdAt: 1 });
    await removeBackgroundImage();
    expect((await getSettings()).appearance.backgroundImageAssetId).toBeNull();
    expect((await getDb().assets.toArray()).map((a) => a.id)).toEqual(['snd']);
  });
});

describe('cs.getBackgroundImage payload', () => {
  it('is null unless funpay.com theming is on', async () => {
    await setBackgroundImage(file(SIG.png, 'image/png'));
    expect(await backgroundForFunPay()).toBeNull();
  });

  it('returns a safe data URL with the configured opacity', async () => {
    const id = await setBackgroundImage(file(SIG.gif, 'image/gif'));
    await updateSettings({ appearance: { themeFunPay: true, backgroundOpacity: 0.3 } });
    const bg = await backgroundForFunPay();
    expect(bg).not.toBeNull();
    expect(bg!.assetId).toBe(id);
    expect(bg!.opacity).toBe(0.3);
    expect(bg!.dataUrl.startsWith('data:image/gif;base64,R0lGODlh')).toBe(true);
    expect(isSafeImageDataUrl(bg!.dataUrl)).toBe(true);
  });

  it('refuses assets whose bytes are not an allowed image', async () => {
    await getDb().assets.put({ id: 'evil', kind: 'background', name: 'x', mime: 'image/png', blob: file([...new TextEncoder().encode('<svg>')], 'image/png') as unknown as Blob, createdAt: 1 });
    await updateSettings({ appearance: { themeFunPay: true, backgroundImageAssetId: 'evil' } });
    expect(await backgroundForFunPay()).toBeNull();
  });
});
