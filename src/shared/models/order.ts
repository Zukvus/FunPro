import { z } from 'zod';
import { MoneySchema } from './money';

export const OrderStatusSchema = z.enum(['paid', 'closed', 'refunded', 'unknown']);
export type OrderStatus = z.infer<typeof OrderStatusSchema>;

export const OrderDirectionSchema = z.enum(['sale', 'purchase']);
export type OrderDirection = z.infer<typeof OrderDirectionSchema>;

export const OrderStatusChangeSchema = z.object({
  status: OrderStatusSchema,
  at: z.string(),
  source: z.enum(['observed', 'manual', 'import']).default('observed'),
});

export const OrderSchema = z.object({
  /** FunPay order id without the leading '#'. */
  id: z.string().min(1),
  direction: OrderDirectionSchema,
  status: OrderStatusSchema,
  /** Counterparty name (buyer for sales, seller for purchases). */
  counterpartyName: z.string(),
  counterpartyId: z.string().nullable().default(null),
  description: z.string().default(''),
  categoryName: z.string().default(''),
  listingId: z.string().nullable().default(null),
  price: MoneySchema,
  /** ISO time when the order was created, if it could be determined. */
  createdAt: z.string().nullable(),
  /** The raw date text shown by FunPay (kept for audit when parsing is ambiguous). */
  rawDate: z.string().default(''),
  firstSeenAt: z.string(),
  updatedAt: z.string(),
  history: z.array(OrderStatusChangeSchema).default([]),
});
export type Order = z.infer<typeof OrderSchema>;

/** Allowed status transitions. FunPay orders start as paid and end as closed or refunded. */
const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  unknown: ['paid', 'closed', 'refunded'],
  paid: ['closed', 'refunded'],
  closed: ['refunded'],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}
