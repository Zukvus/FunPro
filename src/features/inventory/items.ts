/**
 * Encrypted inventory items.
 *
 * - Every item is encrypted with the per-installation device key (AES-GCM) before it is written.
 *   Plaintext is never persisted, logged or sent over runtime messaging by this module; it exists
 *   only in memory while importing, delivering, or when the seller explicitly reveals/exports.
 * - `fingerprint` = SHA-256 of the normalised plaintext. The table has a UNIQUE index on it, so the
 *   same goods can never be stored twice (across all pools).
 */
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import { base64ToBytes, bytesToBase64, decryptText, deriveKeyFromPassphrase, encryptText, sha256Hex } from '@/core/security/crypto';
import type { InventoryItem, InventoryItemStatus } from '@/shared/models';
import { parseCsv } from '@/features/export/csv';

/** Maximum accepted import file size. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
/** Maximum items accepted in one import (encryption is per item). */
export const MAX_ITEMS_PER_IMPORT = 20_000;
/** A single item longer than this is rejected (a delivery message is limited to 2000 chars). */
export const MAX_ITEM_LENGTH = 1000;

// Control, bidi and zero-width characters are stripped from goods (they are invisible and break
// copy/paste for buyers). Written as escapes on purpose.
// eslint-disable-next-line no-control-regex -- intentional
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g;

/** Clean an item for storage/delivery: strip invisible characters and surrounding whitespace. */
export function cleanItem(raw: string): string {
  return raw.replace(INVISIBLE, '').replace(/[\r\n]+/g, ' ').trim();
}

/** Normalised form used only for duplicate detection (whitespace runs collapsed, NFC). */
export function normalizeItem(raw: string): string {
  return cleanItem(raw).normalize('NFC').replace(/[ \t]+/g, ' ');
}

export async function fingerprintItem(raw: string): Promise<string> {
  return sha256Hex(normalizeItem(raw));
}

/** Split pasted text / a .txt file into candidate items (one per line). */
export function splitLines(text: string): string[] {
  return text.replace(/^\ufeff/, '').split(/\r\n|\n|\r/);
}

/**
 * Items from a CSV file: the first column of every row. Quoted cells may contain separators.
 * A header row is not detected automatically — the preview shows what will be imported.
 */
export function itemsFromCsv(text: string): string[] {
  const delimiter = detectDelimiter(text);
  return parseCsv(text, delimiter).map((row) => row[0] ?? '');
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const semis = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

let idSeq = 0;
/** Time-sortable ids: the [poolId+status] index then yields items in FIFO order. */
export function newItemId(now = Date.now()): string {
  idSeq = (idSeq + 1) % 1_679_616; // 36^4
  const rand = Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  return `itm_${now.toString(36).padStart(9, '0')}${idSeq.toString(36).padStart(4, '0')}_${rand}`;
}

export interface ImportResult {
  added: number;
  duplicatesInBatch: number;
  duplicatesExisting: number;
  empty: number;
  tooLong: number;
  /** Lines over MAX_ITEMS_PER_IMPORT that were not processed. */
  skippedOverLimit: number;
}

/**
 * Encrypt and store new items. Duplicates (inside the batch, or already stored in any pool) are
 * rejected and reported. Never throws for duplicates; throws only for infrastructure failures.
 */
export async function importItems(poolId: string, rawItems: readonly string[], now = Date.now()): Promise<ImportResult> {
  const db = getDb();
  if (!(await db.inventoryPools.get(poolId))) throw new Error('Pool not found');
  const res: ImportResult = { added: 0, duplicatesInBatch: 0, duplicatesExisting: 0, empty: 0, tooLong: 0, skippedOverLimit: 0 };
  const candidates: { text: string; fp: string }[] = [];
  const seen = new Set<string>();
  let considered = 0;
  for (const raw of rawItems) {
    const text = cleanItem(raw);
    if (!text) {
      res.empty++;
      continue;
    }
    if (considered >= MAX_ITEMS_PER_IMPORT) {
      res.skippedOverLimit++;
      continue;
    }
    considered++;
    if (text.length > MAX_ITEM_LENGTH) {
      res.tooLong++;
      continue;
    }
    const fp = await fingerprintItem(text);
    if (seen.has(fp)) {
      res.duplicatesInBatch++;
      continue;
    }
    seen.add(fp);
    candidates.push({ text, fp });
  }
  if (candidates.length === 0) return res;

  const existing = new Set<string>();
  for (let i = 0; i < candidates.length; i += 500) {
    const slice = candidates.slice(i, i + 500).map((c) => c.fp);
    const found = await db.inventoryItems.where('fingerprint').anyOf(slice).toArray();
    for (const f of found) existing.add(f.fingerprint);
  }
  const fresh = candidates.filter((c) => !existing.has(c.fp));
  res.duplicatesExisting += candidates.length - fresh.length;

  // Encrypt outside of any IndexedDB transaction (WebCrypto promises would let it auto-commit).
  const at = new Date(now).toISOString();
  const records: InventoryItem[] = [];
  for (const c of fresh) {
    const enc = await encryptText(c.text);
    records.push({ id: newItemId(now), poolId, cipher: enc.cipher, iv: enc.iv, fingerprint: c.fp, status: 'available', orderId: null, reservedAt: null, deliveredAt: null, createdAt: at });
  }
  // Add one by one inside a transaction: a concurrent import of the same goods hits the unique
  // index; that single add fails (caught) and is reported as a duplicate.
  await db.transaction('rw', db.inventoryItems, async () => {
    for (const r of records) {
      try {
        await db.inventoryItems.add(r);
        res.added++;
      } catch {
        res.duplicatesExisting++;
      }
    }
  });
  await db.inventoryPools.update(poolId, { updatedAt: at });
  await log.info({ source: 'inventory', message: `Imported ${res.added} item(s) into a pool; ${res.duplicatesInBatch + res.duplicatesExisting} duplicate(s) rejected`, details: { poolId } });
  return res;
}

export async function decryptItem(item: Pick<InventoryItem, 'iv' | 'cipher'>): Promise<string> {
  return decryptText({ iv: item.iv, cipher: item.cipher });
}

/** Explicit reveal by the seller (dashboard). The content is returned, never stored or logged. */
export async function revealItem(itemId: string): Promise<string> {
  const item = await getDb().inventoryItems.get(itemId);
  if (!item) throw new Error('Item not found');
  const plain = await decryptItem(item);
  await log.info({ source: 'inventory', message: 'An inventory item was revealed by the seller', details: { poolId: item.poolId } });
  return plain;
}

/** Delete items that are not tied to an order (available / void). Returns the number deleted. */
export async function deleteItems(itemIds: readonly string[]): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.inventoryItems, async () => {
    let n = 0;
    for (const id of itemIds) {
      const it = await db.inventoryItems.get(id);
      if (!it || it.status === 'reserved' || it.status === 'delivered') continue;
      await db.inventoryItems.delete(id);
      n++;
    }
    return n;
  });
}

export async function countByStatus(poolId: string): Promise<Record<InventoryItemStatus, number>> {
  const db = getDb();
  const out: Record<InventoryItemStatus, number> = { available: 0, reserved: 0, delivered: 0, void: 0 };
  for (const s of Object.keys(out) as InventoryItemStatus[]) {
    out[s] = await db.inventoryItems.where('[poolId+status]').equals([poolId, s]).count();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Export (explicit, confirmed by the seller in the UI)
// ---------------------------------------------------------------------------------------------

export const EXPORT_FORMAT = 'funpro-inventory-export';

export interface EncryptedExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: 310000;
  cipher: 'AES-GCM-256';
  salt: string;
  iv: string;
  data: string;
  count: number;
  createdAt: string;
}

/** Decrypt the remaining (available) items of a pool, in FIFO order. */
export async function decryptAvailable(poolId: string): Promise<string[]> {
  const items = await getDb().inventoryItems.where('[poolId+status]').equals([poolId, 'available']).toArray();
  const out: string[] = [];
  for (const it of items) out.push(await decryptItem(it));
  return out;
}

/** Plain-text export (one item per line). Caller must have obtained explicit confirmation. */
export async function exportPlain(poolId: string): Promise<{ text: string; count: number }> {
  const items = await decryptAvailable(poolId);
  await log.info({ source: 'inventory', message: `Exported ${items.length} remaining item(s) as plain text`, details: { poolId } });
  return { text: items.join('\n'), count: items.length };
}

export const MIN_PASSPHRASE_LENGTH = 8;

export async function exportEncrypted(poolId: string, passphrase: string, now = new Date()): Promise<EncryptedExport> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new Error(`Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  const items = await decryptAvailable(poolId);
  const salt = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(16)));
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const enc = await encryptText(JSON.stringify(items), key);
  await log.info({ source: 'inventory', message: `Exported ${items.length} remaining item(s) (passphrase-encrypted)`, details: { poolId } });
  return {
    format: EXPORT_FORMAT,
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations: 310000,
    cipher: 'AES-GCM-256',
    salt: bytesToBase64(salt),
    iv: enc.iv,
    data: enc.cipher,
    count: items.length,
    createdAt: now.toISOString(),
  };
}

export function isEncryptedExport(value: unknown): value is EncryptedExport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v['format'] === EXPORT_FORMAT && v['version'] === 1 && typeof v['salt'] === 'string' && typeof v['iv'] === 'string' && typeof v['data'] === 'string';
}

/** Decrypt a passphrase-encrypted export (for re-import). Throws on a wrong passphrase. */
export async function decryptExport(file: EncryptedExport, passphrase: string): Promise<string[]> {
  const key = await deriveKeyFromPassphrase(passphrase, base64ToBytes(file.salt));
  let json: string;
  try {
    json = await decryptText({ iv: file.iv, cipher: file.data }, key);
  } catch {
    throw new Error('Wrong passphrase or damaged file');
  }
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) throw new Error('Unexpected file content');
  return parsed as string[];
}
