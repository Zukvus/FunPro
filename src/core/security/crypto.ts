/**
 * Small WebCrypto helpers. A per-installation, non-extractable AES-GCM key is generated on first use
 * and stored as a CryptoKey object in IndexedDB (extension origin). It cannot be exported by script,
 * which protects against casual exfiltration of exported data/backups but NOT against a compromised
 * device or browser profile. This limitation is documented in docs/SECURITY.md.
 */
import { getDb } from '../db/db';

const DEVICE_KEY = 'device-aes-gcm-v1';
let cachedKey: CryptoKey | null = null;

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function getDeviceKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const db = getDb();
  const existing = await db.keys.get(DEVICE_KEY);
  if (existing) {
    cachedKey = existing.key;
    return existing.key;
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  // Use add() so that two contexts racing to create a key cannot overwrite each other.
  try {
    await db.keys.add({ name: DEVICE_KEY, key });
    cachedKey = key;
    return key;
  } catch {
    const winner = await db.keys.get(DEVICE_KEY);
    if (!winner) throw new Error('Failed to initialise encryption key');
    cachedKey = winner.key;
    return winner.key;
  }
}

/** Drop the in-memory key cache (after wiping data, so a fresh key is created on next use). */
export function resetCryptoCache(): void {
  cachedKey = null;
}

/** @deprecated alias kept for tests — use resetCryptoCache. */
export const resetCryptoCacheForTests = resetCryptoCache;

export async function encryptText(plain: string, key?: CryptoKey): Promise<{ iv: string; cipher: string }> {
  const k = key ?? (await getDeviceKey());
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plain);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, data));
  return { iv: bytesToBase64(iv), cipher: bytesToBase64(cipher) };
}

export async function decryptText(payload: { iv: string; cipher: string }, key?: CryptoKey): Promise<string> {
  const k = key ?? (await getDeviceKey());
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(payload.iv) },
    k,
    base64ToBytes(payload.cipher),
  );
  return new TextDecoder().decode(plain);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Passphrase-based key for encrypted export files (PBKDF2-SHA256, 310k iterations). */
export async function deriveKeyFromPassphrase(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}
