import { z } from 'zod';
import type { USER_DATA_TABLES } from '@/core/db/db';
import {
  AutoReplyRuleSchema,
  BalanceSchema,
  ChatMessageSchema,
  ChatSummarySchema,
  CompetitorSnapshotSchema,
  CustomerSchema,
  DeliverySchema,
  FinanceOperationSchema,
  InventoryItemSchema,
  InventoryPoolSchema,
  ListingSchema,
  MessageTemplateSchema,
  NotificationItemSchema,
  OrderSchema,
  PriceRuleSchema,
  ReviewSchema,
  ReviewTemplateSchema,
  WorkflowRuleSchema,
} from '@/shared/models';

/**
 * FunPro backup file format, version 1.
 *
 * Plain:      { format, version, createdAt, appVersion, encrypted: false, sha256, payload }
 * Encrypted:  { format, version, createdAt, appVersion, encrypted: true, kdf, cipher }
 *
 * `payload` = { settings, tables: { <USER_DATA_TABLES>: rows[] }, inventoryItems? }.
 * Encrypted files use AES-GCM-256 with a key derived from the passphrase (PBKDF2-SHA256,
 * 310 000 iterations, random 16-byte salt, random 12-byte IV). The header is bound to the
 * ciphertext as AES-GCM additional data, so editing any header field makes decryption fail.
 * Plain files carry a SHA-256 of the payload to detect accidental or deliberate modification.
 *
 * Never included: secrets (API keys, bot tokens), encryption keys, uploaded assets, logs, task
 * queue, events. Inventory items (digital goods) only when the user explicitly opts in AND the
 * file is encrypted.
 */
export const BACKUP_FORMAT = 'funpro-backup';
export const BACKUP_VERSION = 1;
/** Must match `deriveKeyFromPassphrase` in core/security/crypto.ts. */
export const PBKDF2_ITERATIONS = 310_000;
export const MIN_PASSPHRASE_LENGTH = 8;
/** Upper bound for files accepted by the importer. */
export const MAX_BACKUP_BYTES = 200 * 1024 * 1024;

export type UserDataTable = (typeof USER_DATA_TABLES)[number];

const base64 = z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'base64');

export const BackupHeaderSchema = z.object({
  format: z.literal(BACKUP_FORMAT),
  version: z.literal(BACKUP_VERSION),
  createdAt: z.string().max(40),
  appVersion: z.string().max(40),
});
export type BackupHeader = z.infer<typeof BackupHeaderSchema>;

export const PlainBackupSchema = BackupHeaderSchema.extend({
  encrypted: z.literal(false),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  payload: z.unknown(),
});

export const KdfSchema = z.object({
  name: z.literal('PBKDF2'),
  hash: z.literal('SHA-256'),
  iterations: z.literal(PBKDF2_ITERATIONS),
  salt: base64.min(20).max(64),
});

export const EncryptedBackupSchema = BackupHeaderSchema.extend({
  encrypted: z.literal(true),
  kdf: KdfSchema,
  cipher: z.object({ name: z.literal('AES-GCM'), iv: base64.min(16).max(24), data: base64.min(1) }),
});

export const BackupEnvelopeSchema = z.discriminatedUnion('encrypted', [PlainBackupSchema, EncryptedBackupSchema]);
export type BackupEnvelope = z.infer<typeof BackupEnvelopeSchema>;
export type EncryptedBackup = z.infer<typeof EncryptedBackupSchema>;
export type PlainBackup = z.infer<typeof PlainBackupSchema>;

/** Inventory item as exported (plaintext — only ever inside an encrypted file). */
export const ExportedInventoryItemSchema = InventoryItemSchema.omit({ cipher: true, iv: true }).extend({
  plaintext: z.string().max(100_000),
});
export type ExportedInventoryItem = z.infer<typeof ExportedInventoryItemSchema>;

export const BackupPayloadSchema = z.object({
  settings: z.unknown(),
  tables: z.record(z.string(), z.array(z.unknown())),
  inventoryItems: z.array(z.unknown()).optional(),
});
export type BackupPayload = z.infer<typeof BackupPayloadSchema>;

/** Tables whose rows are DB-internal records without a shared model: validate the key + shape only. */
const DraftRowSchema = z.looseObject({
  id: z.string().min(1).max(200),
  chatId: z.string().max(200),
  text: z.string().max(20_000),
  status: z.string().max(40),
});
const BumpStateRowSchema = z.looseObject({
  gameId: z.string().min(1).max(64),
  nodeIds: z.array(z.string().max(64)).max(1000),
  status: z.string().max(40),
});

/** Per-table row validation used on import. Every USER_DATA_TABLES entry must be listed. */
export const TABLE_ROW_SCHEMAS: Record<UserDataTable, z.ZodType> = {
  listings: ListingSchema,
  orders: OrderSchema,
  chats: ChatSummarySchema,
  messages: ChatMessageSchema,
  reviews: ReviewSchema,
  financeOps: FinanceOperationSchema,
  balances: BalanceSchema.extend({ id: z.number().int().positive().optional() }),
  customers: CustomerSchema,
  inventoryPools: InventoryPoolSchema,
  deliveries: DeliverySchema,
  competitorSnapshots: CompetitorSnapshotSchema,
  priceRules: PriceRuleSchema,
  templates: MessageTemplateSchema,
  autoReplyRules: AutoReplyRuleSchema,
  reviewTemplates: ReviewTemplateSchema,
  workflowRules: WorkflowRuleSchema,
  notifications: NotificationItemSchema,
  drafts: DraftRowSchema,
  bumpState: BumpStateRowSchema,
};

export type BackupErrorCode =
  | 'not_json'
  | 'not_a_backup'
  | 'unsupported_version'
  | 'invalid_format'
  | 'tampered'
  | 'passphrase_required'
  | 'decrypt_failed'
  | 'invalid_payload'
  | 'weak_passphrase'
  | 'inventory_requires_encryption'
  | 'too_large';

export class BackupError extends Error {
  constructor(
    readonly code: BackupErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'BackupError';
  }
}

/** Header fields bound to the ciphertext (AES-GCM additional authenticated data). */
export function headerAad(h: BackupHeader & { kdf: z.infer<typeof KdfSchema>; cipher: { name: 'AES-GCM'; iv: string } }): Uint8Array<ArrayBuffer> {
  const canonical = JSON.stringify([h.format, h.version, h.createdAt, h.appVersion, h.kdf.name, h.kdf.hash, h.kdf.iterations, h.kdf.salt, h.cipher.name, h.cipher.iv]);
  const bytes = new TextEncoder().encode(canonical);
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}
