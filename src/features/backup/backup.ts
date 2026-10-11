import { getDb, USER_DATA_TABLES } from '@/core/db/db';
import { base64ToBytes, bytesToBase64, decryptText, deriveKeyFromPassphrase, sha256Hex } from '@/core/security/crypto';
import { getSettings } from '@/core/settings/store';
import type { InventoryItem } from '@/shared/models';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupError,
  headerAad,
  MIN_PASSPHRASE_LENGTH,
  PBKDF2_ITERATIONS,
  type BackupEnvelope,
  type BackupPayload,
  type EncryptedBackup,
  type ExportedInventoryItem,
  type UserDataTable,
} from './format';

export interface CreateBackupOptions {
  /** Encrypt the file with this passphrase (≥ 8 characters). */
  passphrase?: string;
  /** Include digital-goods inventory items (decrypted) — requires a passphrase. */
  includeInventoryItems?: boolean;
  appVersion: string;
  now?: Date;
}

export interface CreatedBackup {
  envelope: BackupEnvelope;
  /** Serialized file contents. */
  json: string;
  counts: Record<string, number>;
  /** Inventory items that could not be decrypted on this device and were left out. */
  skippedInventoryItems: number;
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(new ArrayBuffer(n)));
}

async function readTables(): Promise<Record<UserDataTable, unknown[]>> {
  const db = getDb();
  const tables = USER_DATA_TABLES.map((n) => db.table(n));
  // One read transaction gives a consistent snapshot across tables.
  return db.transaction('r', tables, async () => {
    const out = {} as Record<UserDataTable, unknown[]>;
    for (const name of USER_DATA_TABLES) out[name] = await db.table(name).toArray();
    return out;
  });
}

async function exportInventoryItems(): Promise<{ items: ExportedInventoryItem[]; skipped: number }> {
  const rows: InventoryItem[] = await getDb().inventoryItems.toArray();
  const items: ExportedInventoryItem[] = [];
  let skipped = 0;
  for (const r of rows) {
    try {
      const plaintext = await decryptText({ iv: r.iv, cipher: r.cipher });
      const { cipher: _c, iv: _iv, ...rest } = r;
      items.push({ ...rest, plaintext });
    } catch {
      skipped++;
    }
  }
  return { items, skipped };
}

export async function encryptPayload(
  payload: BackupPayload,
  passphrase: string,
  header: { createdAt: string; appVersion: string },
): Promise<EncryptedBackup> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKeyFromPassphrase(passphrase, salt);
  const head = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: header.createdAt,
    appVersion: header.appVersion,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: 'AES-GCM', iv: bytesToBase64(iv) },
  } as const;
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: headerAad(head) }, key, plain));
  return { ...head, encrypted: true, kdf: { ...head.kdf }, cipher: { ...head.cipher, data: bytesToBase64(data) } };
}

export async function decryptPayload(env: EncryptedBackup, passphrase: string): Promise<unknown> {
  let plain: ArrayBuffer;
  try {
    const key = await deriveKeyFromPassphrase(passphrase, base64ToBytes(env.kdf.salt));
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(env.cipher.iv), additionalData: headerAad(env) },
      key,
      base64ToBytes(env.cipher.data),
    );
  } catch {
    // AES-GCM cannot tell a wrong passphrase from modified data.
    throw new BackupError('decrypt_failed');
  }
  try {
    return JSON.parse(new TextDecoder().decode(plain)) as unknown;
  } catch {
    throw new BackupError('invalid_payload');
  }
}

export function payloadChecksum(payload: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(payload));
}

/** Build a backup of settings + every USER_DATA_TABLES table (never secrets, keys or assets). */
export async function createBackup(opts: CreateBackupOptions): Promise<CreatedBackup> {
  const passphrase = opts.passphrase ?? '';
  if (passphrase && passphrase.length < MIN_PASSPHRASE_LENGTH) throw new BackupError('weak_passphrase');
  if (opts.includeInventoryItems && !passphrase) throw new BackupError('inventory_requires_encryption');
  const createdAt = (opts.now ?? new Date()).toISOString();
  const [settings, tables] = await Promise.all([getSettings(), readTables()]);
  const payload: BackupPayload = { settings, tables };
  let skippedInventoryItems = 0;
  if (opts.includeInventoryItems) {
    const inv = await exportInventoryItems();
    payload.inventoryItems = inv.items;
    skippedInventoryItems = inv.skipped;
  }
  const counts: Record<string, number> = {};
  for (const [name, rows] of Object.entries(tables)) counts[name] = rows.length;
  if (payload.inventoryItems) counts['inventoryItems'] = payload.inventoryItems.length;

  let envelope: BackupEnvelope;
  if (passphrase) {
    envelope = await encryptPayload(payload, passphrase, { createdAt, appVersion: opts.appVersion });
  } else {
    envelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt,
      appVersion: opts.appVersion,
      encrypted: false,
      sha256: await payloadChecksum(payload),
      payload,
    };
  }
  return { envelope, json: JSON.stringify(envelope, null, passphrase ? undefined : 1), counts, skippedInventoryItems };
}

export function backupFileName(encrypted: boolean, now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `funpro-backup-${stamp}${encrypted ? '.encrypted' : ''}.json`;
}
