import { getDb } from '@/core/db/db';
import { getSettings, updateSettings } from '@/core/settings/store';
import { newId } from '@/core/util/id';

/**
 * User background image. Stored as a Blob in IndexedDB (`assets`, kind `background`) — never
 * uploaded anywhere. Only real PNG/JPEG/WebP/GIF images up to 3 MB are accepted: the declared type
 * AND the file signature (magic bytes) must both be an allowed image type (no SVG, no HTML).
 */
export const BACKGROUND_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type BackgroundMime = (typeof BACKGROUND_MIME_TYPES)[number];
export const MAX_BACKGROUND_BYTES = 3 * 1024 * 1024;

/** The subset of Blob/File this module needs (keeps it testable outside a browser). */
export interface BlobLike {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  slice(start?: number, end?: number): BlobLike;
}

export type BackgroundImageError = 'empty' | 'too_large' | 'unsupported_type' | 'content_mismatch';

export class BackgroundImageValidationError extends Error {
  constructor(readonly code: BackgroundImageError) {
    super(`Background image rejected: ${code}`);
    this.name = 'BackgroundImageValidationError';
  }
}

export function isAllowedBackgroundMime(mime: string): mime is BackgroundMime {
  return (BACKGROUND_MIME_TYPES as readonly string[]).includes(mime);
}

/** Detect the image type from its first bytes. */
export function sniffImageMime(bytes: Uint8Array): BackgroundMime | null {
  const b = (i: number) => bytes[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return 'image/png';
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return 'image/jpeg';
  if (b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x38 && (b(4) === 0x37 || b(4) === 0x39) && b(5) === 0x61) return 'image/gif';
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return 'image/webp';
  return null;
}

export async function validateBackgroundImage(file: BlobLike): Promise<{ ok: true; mime: BackgroundMime } | { ok: false; error: BackgroundImageError }> {
  if (!file || file.size <= 0) return { ok: false, error: 'empty' };
  if (file.size > MAX_BACKGROUND_BYTES) return { ok: false, error: 'too_large' };
  if (!isAllowedBackgroundMime(file.type)) return { ok: false, error: 'unsupported_type' };
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageMime(head);
  if (!sniffed) return { ok: false, error: 'content_mismatch' };
  // A wrong extension (e.g. a PNG saved as .jpg) is harmless; the sniffed type is what we store.
  return { ok: true, mime: sniffed };
}

/**
 * Validate and store a new background, point settings at it and delete the previous one(s).
 * Order matters: the new asset exists before settings reference it, and old assets are deleted only
 * afterwards, so the UI never references a missing asset.
 */
export async function setBackgroundImage(file: BlobLike & { name?: string }, now = Date.now()): Promise<string> {
  const v = await validateBackgroundImage(file);
  if (!v.ok) throw new BackgroundImageValidationError(v.error);
  const db = getDb();
  const id = newId('bg');
  await db.assets.put({ id, kind: 'background', name: (file.name ?? 'background').slice(0, 120), mime: v.mime, blob: file as unknown as Blob, createdAt: now });
  await updateSettings({ appearance: { backgroundImageAssetId: id } });
  const stale = await db.assets.where('kind').equals('background').filter((a) => a.id !== id).primaryKeys();
  if (stale.length) await db.assets.bulkDelete(stale);
  return id;
}

export async function removeBackgroundImage(): Promise<void> {
  await updateSettings({ appearance: { backgroundImageAssetId: null } });
  const db = getDb();
  const ids = await db.assets.where('kind').equals('background').primaryKeys();
  if (ids.length) await db.assets.bulkDelete(ids);
}

export function bytesToBase64Chunked(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/**
 * Data URL of the current background for the funpay.com content script (which cannot read the
 * extension's IndexedDB). Returns null unless funpay.com theming is enabled and a valid image exists.
 */
export async function backgroundForFunPay(): Promise<{ dataUrl: string; opacity: number; assetId: string } | null> {
  const s = await getSettings();
  const id = s.appearance.backgroundImageAssetId;
  if (!s.appearance.themeFunPay || !id) return null;
  const asset = await getDb().assets.get(id);
  if (!asset || asset.kind !== 'background' || !isAllowedBackgroundMime(asset.mime)) return null;
  const blob = asset.blob as unknown as BlobLike;
  if (!blob || typeof blob.arrayBuffer !== 'function' || blob.size > MAX_BACKGROUND_BYTES) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const sniffed = sniffImageMime(bytes.subarray(0, 16));
  if (!sniffed) return null;
  return { dataUrl: `data:${sniffed};base64,${bytesToBase64Chunked(bytes)}`, opacity: s.appearance.backgroundOpacity, assetId: id };
}
