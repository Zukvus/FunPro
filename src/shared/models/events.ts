import { z } from 'zod';

export const EventTypeSchema = z.enum([
  'ORDER_DETECTED',
  'ORDER_PAID',
  'ORDER_COMPLETED',
  'ORDER_CANCELLED',
  'MESSAGE_RECEIVED',
  'REVIEW_RECEIVED',
  'LISTING_UPDATED',
  'LISTING_BUMP_AVAILABLE',
  'PRICE_CHANGE_DETECTED',
  'INVENTORY_LOW',
  'AUTOMATION_FAILED',
  'SESSION_CHANGED',
]);
export type EventType = z.infer<typeof EventTypeSchema>;

export const DomainEventSchema = z.object({
  /** Deterministic dedupe key, e.g. `ORDER_PAID:ABC123`. Same key ⇒ same event. */
  id: z.string().min(1),
  type: EventTypeSchema,
  at: z.string(),
  payload: z.record(z.string(), z.unknown()),
  /** Rule ids that already processed this event (idempotency for workflow actions). */
  handledBy: z.array(z.string()).default([]),
});
export type DomainEvent = z.infer<typeof DomainEventSchema>;
