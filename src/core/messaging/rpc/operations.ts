import { z } from 'zod';

const orderId = z
  .string()
  .min(1)
  .max(16)
  .regex(/^[A-Za-z0-9]+$/);
const localId = z.string().min(1).max(80);
const offerId = z.string().regex(/^\d{1,12}$/);

/**
 * RPC methods owned by the inventory / pricing / workflow area.
 * Everything that sends to a buyer or edits seller data requires `confirm: true` from the UI.
 */
export const OPERATIONS_RPC = {
  /**
   * Deliver an order's reserved goods. `draft` prepares a draft for review; `send` queues the
   * message now (explicit seller action). From `uncertain`, `send` needs `confirmUncertain`.
   * Reserves stock first (pool matching) when nothing is reserved yet.
   */
  'ui.deliverOrder': {
    from: 'extension',
    params: z.object({ orderId, mode: z.enum(['send', 'draft']), confirmUncertain: z.boolean().optional() }),
  },
  /** Read the public category page of one of the seller's own nodes (rate-limited). */
  'ui.fetchCompetitors': { from: 'extension', params: z.object({ nodeId: z.string().regex(/^\d{1,10}$/) }) },
  /** Reserve stock for an order (explicit; `refill` re-tries an out-of-stock delivery). */
  'ui.inventory.reserve': {
    from: 'extension',
    params: z.object({ orderId, poolId: localId.optional(), refill: z.boolean().optional() }),
  },
  /** Seller confirms the goods reached the buyer. */
  'ui.inventory.markDelivered': {
    from: 'extension',
    params: z.object({ orderId, confirm: z.literal(true) }),
  },
  /** Cancel a delivery and return its items to stock. */
  'ui.inventory.release': {
    from: 'extension',
    params: z.object({ orderId, confirm: z.literal(true), confirmUncertain: z.boolean().optional() }),
  },
  /** Inspect a linked offer's native auto-delivery list (counts only — goods never leave FunPay). */
  'ui.inventory.pushPreview': { from: 'extension', params: z.object({ poolId: localId, offerId }) },
  /** Write items into the offer's FunPay auto-delivery list and enable auto-delivery. */
  'ui.inventory.push': {
    from: 'extension',
    params: z.object({
      poolId: localId,
      offerId,
      count: z.number().int().min(1).max(5000),
      confirm: z.literal(true),
    }),
  },
  /** Return the items of an uncertain push to stock (after checking the offer on FunPay). */
  'ui.inventory.restorePush': {
    from: 'extension',
    params: z.object({ pushId: localId, confirm: z.literal(true) }),
  },
  /** Apply a buyer-facing price to an own offer (single saveOffer + backup). */
  'ui.pricing.apply': {
    from: 'extension',
    params: z.object({
      listingId: offerId,
      targetMinor: z.number().int().positive().max(10_000_000_000),
      confirm: z.literal(true),
    }),
  },
} as const;
