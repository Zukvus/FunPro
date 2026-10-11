import { z } from 'zod';

export const InventoryPoolSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Listing ids this pool fulfils. */
  listingIds: z.array(z.string()).default([]),
  lowStockThreshold: z.number().int().nonnegative().default(3),
  /** Delivery message template; `{item}` is replaced with the decrypted item. */
  deliveryTemplate: z.string().default('Спасибо за покупку! Ваш товар: {item}'),
  /** Units per order quantity (most digital goods: 1). */
  itemsPerUnit: z.number().int().positive().default(1),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InventoryPool = z.infer<typeof InventoryPoolSchema>;

export const InventoryItemStatusSchema = z.enum(['available', 'reserved', 'delivered', 'void']);
export type InventoryItemStatus = z.infer<typeof InventoryItemStatusSchema>;

export const InventoryItemSchema = z.object({
  id: z.string().min(1),
  poolId: z.string().min(1),
  /** AES-GCM ciphertext (base64) of the item payload. Plaintext is never persisted. */
  cipher: z.string(),
  iv: z.string(),
  /** SHA-256 of the plaintext; used to reject duplicate imports without decrypting. */
  fingerprint: z.string(),
  status: InventoryItemStatusSchema,
  orderId: z.string().nullable().default(null),
  reservedAt: z.string().nullable().default(null),
  deliveredAt: z.string().nullable().default(null),
  createdAt: z.string(),
});
export type InventoryItem = z.infer<typeof InventoryItemSchema>;

/**
 * Delivery lifecycle. `uncertain` is used when a send was attempted but the outcome could not be
 * confirmed (e.g. network error after the request left the browser); it requires manual review
 * and is never retried automatically to avoid double delivery.
 */
export const DeliveryStatusSchema = z.enum([
  'reserved',
  'sending',
  'sent',
  'uncertain',
  'failed',
  'manual',
  'cancelled',
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const DeliverySchema = z.object({
  /** Equal to the order id — one delivery record per order guarantees idempotency. */
  orderId: z.string().min(1),
  poolId: z.string(),
  itemIds: z.array(z.string()),
  status: DeliveryStatusSchema,
  attempts: z.number().int().nonnegative().default(0),
  lastError: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Delivery = z.infer<typeof DeliverySchema>;
