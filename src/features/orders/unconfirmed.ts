/**
 * Unconfirmed sales: orders the buyer paid for but has not confirmed yet (FunPay status "paid").
 * FunPay credits the seller only after confirmation, so old unconfirmed orders are worth chasing.
 */
import type { Currency, Order } from '@/shared/models';
import { DAY_MS, HOUR_MS } from '@/features/analytics/time';
import { orderTime } from './model';

export type AgingBucket = 'lt24h' | 'd1to3' | 'd3to7' | 'gt7d';
export const AGING_BUCKETS: readonly AgingBucket[] = ['lt24h', 'd1to3', 'd3to7', 'gt7d'];

/** [0, 24h) → lt24h · [24h, 72h) → d1to3 · [72h, 7d) → d3to7 · [7d, ∞) → gt7d. */
export function agingBucket(ageMs: number): AgingBucket {
  if (ageMs < DAY_MS) return 'lt24h';
  if (ageMs < 3 * DAY_MS) return 'd1to3';
  if (ageMs < 7 * DAY_MS) return 'd3to7';
  return 'gt7d';
}

export interface UnconfirmedOrder {
  order: Order;
  ageMs: number;
  bucket: AgingBucket;
  /** True when FunPay's date was unknown and the age is measured from when FunPro first saw it. */
  approximate: boolean;
}

export interface UnconfirmedOptions {
  now: number;
  /** Only orders at least this old are listed (settings.analytics.unconfirmedAfterHours). */
  minAgeHours: number;
}

/** Paid, not yet confirmed SALES at least `minAgeHours` old — oldest first. */
export function unconfirmedOrders(orders: readonly Order[], opts: UnconfirmedOptions): UnconfirmedOrder[] {
  const minAge = Math.max(0, opts.minAgeHours) * HOUR_MS;
  const out: UnconfirmedOrder[] = [];
  for (const o of orders) {
    if (o.direction !== 'sale' || o.status !== 'paid') continue;
    const { ts, approximate } = orderTime(o);
    const ageMs = Math.max(0, opts.now - ts);
    if (ageMs < minAge) continue;
    out.push({ order: o, ageMs, bucket: agingBucket(ageMs), approximate });
  }
  return out.sort((a, b) => b.ageMs - a.ageMs || a.order.id.localeCompare(b.order.id));
}

export interface AgingBucketSummary {
  count: number;
  amountByCurrency: Partial<Record<Currency, number>>;
}

export interface AgingSummary {
  total: number;
  buckets: Record<AgingBucket, AgingBucketSummary>;
  amountByCurrency: Partial<Record<Currency, number>>;
  oldest: UnconfirmedOrder | null;
}

export function agingSummary(list: readonly UnconfirmedOrder[]): AgingSummary {
  const buckets = Object.fromEntries(
    AGING_BUCKETS.map((b) => [b, { count: 0, amountByCurrency: {} }]),
  ) as Record<AgingBucket, AgingBucketSummary>;
  const amountByCurrency: Partial<Record<Currency, number>> = {};
  let oldest: UnconfirmedOrder | null = null;
  for (const u of list) {
    const b = buckets[u.bucket];
    const c = u.order.price.currency;
    b.count++;
    b.amountByCurrency[c] = (b.amountByCurrency[c] ?? 0) + u.order.price.amountMinor;
    amountByCurrency[c] = (amountByCurrency[c] ?? 0) + u.order.price.amountMinor;
    if (!oldest || u.ageMs > oldest.ageMs) oldest = u;
  }
  return { total: list.length, buckets, amountByCurrency, oldest };
}

/** Human age such as "5 h", "2 d 3 h" — language-neutral units are provided by the caller. */
export function splitAge(ageMs: number): { days: number; hours: number; minutes: number } {
  const totalMinutes = Math.floor(ageMs / 60_000);
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  };
}
