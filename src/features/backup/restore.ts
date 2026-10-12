import { getDb, USER_DATA_TABLES } from '@/core/db/db';
import { encryptText, getDeviceKey } from '@/core/security/crypto';
import { defaultSettings, parseSettings, type Settings } from '@/core/settings/schema';
import { getSettings, replaceSettings } from '@/core/settings/store';
import type { InventoryItem } from '@/shared/models';
import { decryptPayload, payloadChecksum } from './backup';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupEnvelopeSchema,
  BackupError,
  BackupPayloadSchema,
  ExportedInventoryItemSchema,
  TABLE_ROW_SCHEMAS,
  type BackupEnvelope,
  type BackupHeader,
  type ExportedInventoryItem,
  type UserDataTable,
} from './format';

export interface TableReport {
  valid: number;
  invalid: number;
}

/** A decoded, validated backup ready to be previewed and restored. */
export interface RestorePlan {
  header: BackupHeader & { encrypted: boolean };
  settings: Settings | null;
  tables: Partial<Record<UserDataTable, Record<string, unknown>[]>>;
  inventoryItems: ExportedInventoryItem[] | null;
  report: Record<string, TableReport>;
  /** Tables present in the file that this version does not know (ignored). */
  unknownTables: string[];
}

export type RestoreMode = 'merge' | 'replace';

export interface RestoreOptions {
  mode: RestoreMode;
  /** Also restore settings (automation is always left paused and must be re-confirmed). */
  restoreSettings: boolean;
}

export interface RestoreResult {
  restored: Record<string, number>;
  skipped: Record<string, number>;
  settingsRestored: boolean;
}

const KNOWN = new Set<string>(USER_DATA_TABLES);

/** Parse and validate the outer envelope of a backup file (no decryption yet). */
export function parseBackupText(text: string): BackupEnvelope {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BackupError('not_json');
  }
  if (!raw || typeof raw !== 'object' || (raw as { format?: unknown }).format !== BACKUP_FORMAT)
    throw new BackupError('not_a_backup');
  if ((raw as { version?: unknown }).version !== BACKUP_VERSION) throw new BackupError('unsupported_version');
  const parsed = BackupEnvelopeSchema.safeParse(raw);
  if (!parsed.success) throw new BackupError('invalid_format');
  return parsed.data;
}

/** Validate rows; unknown extra fields are kept, defaults of the current model are applied. */
function validateRows(
  table: UserDataTable,
  rows: unknown[],
): { rows: Record<string, unknown>[]; invalid: number } {
  const schema = TABLE_ROW_SCHEMAS[table];
  const out: Record<string, unknown>[] = [];
  let invalid = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      invalid++;
      continue;
    }
    const r = schema.safeParse(row);
    if (r.success) out.push({ ...(row as Record<string, unknown>), ...(r.data as Record<string, unknown>) });
    else invalid++;
  }
  return { rows: out, invalid };
}

/**
 * Verify integrity (checksum or AES-GCM tag), validate the payload and every row.
 * Throws BackupError: `tampered`, `passphrase_required`, `decrypt_failed`, `invalid_payload`.
 */
export async function openBackup(env: BackupEnvelope, passphrase?: string): Promise<RestorePlan> {
  let payloadRaw: unknown;
  if (env.encrypted) {
    if (!passphrase) throw new BackupError('passphrase_required');
    payloadRaw = await decryptPayload(env, passphrase);
  } else {
    if ((await payloadChecksum(env.payload)) !== env.sha256) throw new BackupError('tampered');
    payloadRaw = env.payload;
  }
  const payload = BackupPayloadSchema.safeParse(payloadRaw);
  if (!payload.success) throw new BackupError('invalid_payload');

  const report: Record<string, TableReport> = {};
  const tables: RestorePlan['tables'] = {};
  const unknownTables: string[] = [];
  for (const [name, rows] of Object.entries(payload.data.tables)) {
    if (!KNOWN.has(name)) {
      unknownTables.push(name);
      continue;
    }
    const t = name as UserDataTable;
    const v = validateRows(t, rows);
    tables[t] = v.rows;
    report[t] = { valid: v.rows.length, invalid: v.invalid };
  }

  let inventoryItems: ExportedInventoryItem[] | null = null;
  if (payload.data.inventoryItems) {
    inventoryItems = [];
    let invalid = 0;
    for (const raw of payload.data.inventoryItems) {
      const r = ExportedInventoryItemSchema.safeParse(raw);
      if (r.success) inventoryItems.push(r.data);
      else invalid++;
    }
    report['inventoryItems'] = { valid: inventoryItems.length, invalid };
  }

  const settingsOk = payload.data.settings && typeof payload.data.settings === 'object';
  return {
    header: {
      format: env.format,
      version: env.version,
      createdAt: env.createdAt,
      appVersion: env.appVersion,
      encrypted: env.encrypted,
    },
    settings: settingsOk ? parseSettings(payload.data.settings) : null,
    tables,
    inventoryItems,
    report,
    unknownTables,
  };
}

/**
 * Settings from a backup never start automation on this device: automation stays paused, the live
 * actions acknowledgement and integration consents must be given again, and device-local state (onboarding, versions,
 * references to uploaded files that are not part of backups) is kept from the current device.
 */
export async function sanitizeRestoredSettings(imported: Settings, current: Settings): Promise<Settings> {
  const db = getDb();
  const assetExists = async (id: string | null) => (id ? (await db.assets.get(id)) !== undefined : false);
  const defaults = defaultSettings();
  const out: Settings = structuredClone(imported);
  out.automation.state = 'paused';
  out.automation.stoppedAt = null;
  out.automation.liveActionsAcknowledged = false;
  // Consent to external integrations is given per device and per recipient: a backup never
  // re-enables sending data to an AI provider or a Telegram chat without the seller confirming again.
  out.ai.consentAt = null;
  out.ai.consentScope = '';
  out.ai.autoDraftReviews = false;
  out.ai.autoPostReviewReplies = false;
  out.telegram.consentAt = null;
  out.telegram.remoteCommands = false;
  out.telegram.includePreviews = false;
  out.general.onboardingCompleted = current.general.onboardingCompleted;
  out.general.lastSeenVersion = current.general.lastSeenVersion;
  out.general.changelogSeenVersion = current.general.changelogSeenVersion;
  if (!(await assetExists(out.appearance.backgroundImageAssetId)))
    out.appearance.backgroundImageAssetId = current.appearance.backgroundImageAssetId;
  for (const key of ['messageSound', 'orderSound'] as const) {
    const v = out.notifications[key];
    if (v.startsWith('custom:') && !(await assetExists(v.slice('custom:'.length))))
      out.notifications[key] = defaults.notifications[key];
  }
  return parseSettings(out);
}

async function prepareInventory(items: ExportedInventoryItem[]): Promise<InventoryItem[]> {
  // Re-encrypt with this device's key BEFORE opening the IndexedDB transaction (WebCrypto awaits
  // inside a Dexie transaction would let it auto-commit).
  const key = await getDeviceKey();
  const out: InventoryItem[] = [];
  for (const it of items) {
    const { plaintext, ...rest } = it;
    const enc = await encryptText(plaintext, key);
    out.push({ ...rest, iv: enc.iv, cipher: enc.cipher });
  }
  return out;
}

/**
 * Restore in ONE IndexedDB transaction: either every table is written or nothing changes.
 *  - replace: the tables contained in the backup are cleared first;
 *  - merge:   rows are upserted by primary key, other local rows are kept.
 * Settings are written only after the data transaction committed.
 */
export async function restoreBackup(plan: RestorePlan, opts: RestoreOptions): Promise<RestoreResult> {
  const db = getDb();
  const inventory = plan.inventoryItems ? await prepareInventory(plan.inventoryItems) : null;
  const names = Object.keys(plan.tables) as UserDataTable[];
  const txTables = [...names.map((n) => db.table(n)), ...(inventory ? [db.inventoryItems] : [])];
  const restored: Record<string, number> = {};
  const skipped: Record<string, number> = {};

  if (txTables.length > 0) {
    await db.transaction('rw', txTables, async () => {
      for (const name of names) {
        const table = db.table(name);
        const rows = plan.tables[name] ?? [];
        if (opts.mode === 'replace') await table.clear();
        if (name === 'balances' && opts.mode === 'merge') {
          // Auto-increment keys differ between devices: add snapshots whose timestamp is new.
          const have = new Set((await db.balances.toArray()).map((b) => b.at));
          const fresh = rows.filter((r) => !have.has(String(r['at']))).map(({ id: _id, ...rest }) => rest);
          await db.balances.bulkAdd(fresh as never[]);
          restored[name] = fresh.length;
          skipped[name] = rows.length - fresh.length;
          continue;
        }
        await table.bulkPut(rows);
        restored[name] = rows.length;
      }
      if (inventory) {
        if (opts.mode === 'replace') await db.inventoryItems.clear();
        // `fingerprint` is unique: never import a second copy of an item that exists under another id.
        const existing = new Map((await db.inventoryItems.toArray()).map((i) => [i.fingerprint, i.id]));
        const accepted = inventory.filter((i) => {
          const owner = existing.get(i.fingerprint);
          return owner === undefined || owner === i.id;
        });
        await db.inventoryItems.bulkPut(accepted);
        restored['inventoryItems'] = accepted.length;
        skipped['inventoryItems'] = inventory.length - accepted.length;
      }
    });
  }

  let settingsRestored = false;
  if (opts.restoreSettings && plan.settings) {
    await replaceSettings(await sanitizeRestoredSettings(plan.settings, await getSettings()));
    settingsRestored = true;
  }
  return { restored, skipped, settingsRestored };
}
