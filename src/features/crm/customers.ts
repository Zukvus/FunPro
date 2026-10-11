/**
 * CRM Lite: customers are created by order ingestion (one per buyer of a sale). This module adds
 * the seller's private notes, tags, pins and follow-ups, and derives purchase statistics from the
 * orders FunPro has seen. Everything is local; nothing is sent to FunPay.
 */
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import type { Currency, Customer, Order } from '@/shared/models';
import { customerKey } from '@/features/sync/ingest';
import { privateChatId } from '@/features/messages/context';

export const MAX_TAGS = 20;

export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 30);
}

const PatchSchema = z.object({
  notes: z.string().max(5000).optional(),
  tags: z.array(z.string()).max(MAX_TAGS).optional(),
  pinned: z.boolean().optional(),
  followUpAt: z
    .string()
    .max(40)
    .refine((s) => Number.isFinite(Date.parse(s)))
    .nullable()
    .optional(),
  followUpNote: z.string().max(500).optional(),
});
export type CustomerPatch = z.input<typeof PatchSchema>;

export class CustomerError extends Error {
  constructor(readonly code: 'not_found' | 'invalid') {
    super(code);
    this.name = 'CustomerError';
  }
}

export async function updateCustomer(id: string, patch: CustomerPatch): Promise<Customer> {
  const parsed = PatchSchema.safeParse(patch);
  if (!parsed.success) throw new CustomerError('invalid');
  const db = getDb();
  return db.transaction('rw', db.customers, async () => {
    const c = await db.customers.get(id);
    if (!c) throw new CustomerError('not_found');
    const p = parsed.data;
    const next: Customer = {
      ...c,
      ...(p.notes !== undefined ? { notes: p.notes } : {}),
      ...(p.tags !== undefined ? { tags: [...new Set(p.tags.map(normalizeTag).filter(Boolean))] } : {}),
      ...(p.pinned !== undefined ? { pinned: p.pinned } : {}),
      // Stored as UTC ISO so the `followUpAt` index orders correctly.
      ...(p.followUpAt !== undefined ? { followUpAt: p.followUpAt === null ? null : new Date(p.followUpAt).toISOString() } : {}),
      ...(p.followUpNote !== undefined ? { followUpNote: p.followUpNote } : {}),
    };
    await db.customers.put(next);
    return next;
  });
}

/** The customer record key an order belongs to (same rule as ingestion). */
export function orderCustomerKey(o: Pick<Order, 'counterpartyId' | 'counterpartyName'>): string {
  return customerKey(o.counterpartyId, o.counterpartyName);
}

export interface CustomerStats {
  orderCount: number;
  /** Orders that were not refunded (paid or closed). */
  activeCount: number;
  refundedCount: number;
  /** Two or more non-refunded orders. */
  repeatBuyer: boolean;
  /** Sum of non-refunded order prices in minor units, per currency (never converted). */
  totalSpent: Partial<Record<Currency, number>>;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

const orderTime = (o: Order) => o.createdAt ?? o.firstSeenAt;

export function computeCustomerStats(orders: readonly Order[]): CustomerStats {
  const sales = orders.filter((o) => o.direction === 'sale');
  const active = sales.filter((o) => o.status !== 'refunded');
  const totalSpent: Partial<Record<Currency, number>> = {};
  for (const o of active) {
    if (o.price.currency === 'UNKNOWN') continue;
    totalSpent[o.price.currency] = (totalSpent[o.price.currency] ?? 0) + o.price.amountMinor;
  }
  const times = sales.map(orderTime).sort();
  return {
    orderCount: sales.length,
    activeCount: active.length,
    refundedCount: sales.length - active.length,
    repeatBuyer: active.length >= 2,
    totalSpent,
    firstOrderAt: times[0] ?? null,
    lastOrderAt: times.at(-1) ?? null,
  };
}

/** Group sale orders by customer key (one pass over the orders). */
export function groupOrdersByCustomer(orders: readonly Order[]): Map<string, Order[]> {
  const out = new Map<string, Order[]>();
  for (const o of orders) {
    if (o.direction !== 'sale' || !o.counterpartyName) continue;
    const key = orderCustomerKey(o);
    const list = out.get(key);
    if (list) list.push(o);
    else out.set(key, [o]);
  }
  for (const list of out.values()) list.sort((a, b) => orderTime(b).localeCompare(orderTime(a)));
  return out;
}

/** Purchase history of one customer, newest first. */
export async function customerOrders(c: Customer): Promise<Order[]> {
  const db = getDb();
  const byId = /^\d+$/.test(c.id) ? await db.orders.where('counterpartyId').equals(c.id).toArray() : [];
  const byName = await db.orders.where('counterpartyName').equalsIgnoreCase(c.name).toArray();
  const seen = new Set<string>();
  const out: Order[] = [];
  for (const o of [...byId, ...byName]) {
    if (o.direction !== 'sale' || seen.has(o.id)) continue;
    // Name matches only count when the order has no id or the same id (names can be reused).
    if (o.counterpartyId && /^\d+$/.test(c.id) && o.counterpartyId !== c.id) continue;
    seen.add(o.id);
    out.push(o);
  }
  return out.sort((a, b) => orderTime(b).localeCompare(orderTime(a)));
}

/** The FunPay chat with a customer, if it can be determined from local data. */
export async function chatIdForCustomer(c: Customer, selfUserId: string | null): Promise<string | null> {
  const direct = /^\d+$/.test(c.id) ? privateChatId(selfUserId, c.id) : null;
  if (direct) return direct;
  const chat = await getDb().chats.where('partnerName').equalsIgnoreCase(c.name).first();
  return chat?.id ?? null;
}

/** Customers whose follow-up time has come (oldest first). */
export async function dueFollowUps(now: number): Promise<Customer[]> {
  const iso = new Date(now).toISOString();
  return getDb().customers.where('followUpAt').belowOrEqual(iso).sortBy('followUpAt');
}
