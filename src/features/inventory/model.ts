/**
 * Inventory-area extensions of the shared models. Dexie stores whole objects, so the extra fields
 * live on the same records (atomic with the base fields); readers that only know the shared schema
 * simply ignore them. Always read records through `toPool` / `toDelivery` so older records get the
 * defaults below.
 */
import { z } from 'zod';
import {
  DeliverySchema,
  DeliveryStatusSchema,
  InventoryPoolSchema,
  type DeliveryStatus,
} from '@/shared/models';

export const PoolSchema = InventoryPoolSchema.extend({
  /**
   * Phrases matched (case-insensitively) against the order description and category when the
   * order's listing id is unknown. Any phrase may match; the longest match wins.
   */
  matchText: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  /** Reserve items automatically for new paid orders. Manual reservation is always possible. */
  autoReserve: z.boolean().default(true),
});
export type Pool = z.infer<typeof PoolSchema>;

export const DeliveryChannelSchema = z.enum(['none', 'draft', 'auto', 'manual_send']);
export type DeliveryChannel = z.infer<typeof DeliveryChannelSchema>;

export const DeliveryRecordSchema = DeliverySchema.extend({
  buyerId: z.string().nullable().default(null),
  buyerName: z.string().default(''),
  /** FunPay private chat id (`users-<min>-<max>`), null while unknown. */
  chatId: z.string().nullable().default(null),
  /** Order quantity (units); items reserved = quantity × pool.itemsPerUnit. */
  quantity: z.number().int().positive().default(1),
  /** Outbox task carrying the message (for `sending`). */
  taskId: z.string().nullable().default(null),
  /** Draft prepared for the seller's review (manual-assisted delivery). */
  draftId: z.string().nullable().default(null),
  channel: DeliveryChannelSchema.default('none'),
  /** Message with every item masked. Never contains goods. */
  messagePreview: z.string().default(''),
  deliveredAt: z.string().nullable().default(null),
  /** Set when FunPay reported a refund while the delivery could not be cancelled cleanly. */
  refundedAt: z.string().nullable().default(null),
  /** Machine-readable reason for `manual` / `failed` / `uncertain` states (UI translates it). */
  reason: z.string().nullable().default(null),
});
export type DeliveryRecord = z.infer<typeof DeliveryRecordSchema>;

export function toPool(raw: unknown): Pool {
  return PoolSchema.parse(raw);
}

export function toDelivery(raw: unknown): DeliveryRecord {
  return DeliveryRecordSchema.parse(raw);
}

/** Reasons a delivery needs the seller (stable codes; the dashboard translates them). */
export type DeliveryReason =
  | 'chat_unknown'
  | 'out_of_stock'
  | 'message_too_long'
  | 'items_missing'
  | 'draft_dismissed'
  | 'draft_deleted'
  | 'auto_not_running'
  | 'send_failed'
  | 'outcome_uncertain'
  | 'task_missing'
  | 'cancelled_by_stop'
  | 'refunded'
  | 'released_by_user';

/**
 * Allowed delivery transitions. `uncertain` is deliberately sticky: only an explicit seller action
 * (mark as sent / re-send with confirmation / release) leaves it — never an automatic retry.
 */
const TRANSITIONS: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  reserved: ['sending', 'manual', 'sent', 'cancelled', 'failed', 'uncertain'],
  sending: ['sent', 'uncertain', 'failed', 'cancelled'],
  failed: ['sending', 'sent', 'cancelled', 'manual', 'reserved', 'uncertain'],
  uncertain: ['sent', 'sending', 'cancelled', 'reserved'],
  manual: ['sending', 'sent', 'cancelled', 'reserved'],
  sent: [],
  cancelled: [],
};

export function canDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const ACTIVE_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'reserved',
  'sending',
  'manual',
  'failed',
  'uncertain',
];

export const ALL_DELIVERY_STATUSES = DeliveryStatusSchema.options;
