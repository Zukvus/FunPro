/**
 * Small local aggregation of sales into the numeric summary `explainSalesTrend` accepts.
 * Self-contained on purpose (no dependency on the analytics module): last N days vs the N days
 * before, in the currency with the most sales. Currencies are never mixed.
 */
import type { Order } from '@/shared/models';
import type { Currency } from '@/shared/models/money';
import { dayKey } from '@/core/util/time';
import type { SalesTrendSummary } from './copilot';

function orderTime(o: Order): number {
  const t = Date.parse(o.createdAt ?? o.firstSeenAt);
  return Number.isFinite(t) ? t : 0;
}

export function computeSalesTrendSummary(orders: readonly Order[], now: number, days = 7, periodLabel?: string): SalesTrendSummary | null {
  const span = days * 86400_000;
  const sales = orders.filter((o) => o.direction === 'sale' && o.price.currency !== 'UNKNOWN');
  const inCurrent = sales.filter((o) => orderTime(o) > now - span && orderTime(o) <= now);
  const inPrevious = sales.filter((o) => orderTime(o) > now - 2 * span && orderTime(o) <= now - span);
  if (inCurrent.length === 0 && inPrevious.length === 0) return null;

  const counts = new Map<Currency, number>();
  for (const o of [...inCurrent, ...inPrevious]) counts.set(o.price.currency, (counts.get(o.price.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  const totals = (list: Order[]) => {
    const same = list.filter((o) => o.price.currency === currency);
    const ok = same.filter((o) => o.status !== 'refunded');
    return { orders: ok.length, revenueMinor: ok.reduce((sum, o) => sum + o.price.amountMinor, 0), refunds: same.length - ok.length };
  };
  const current = totals(inCurrent);
  const previous = totals(inPrevious);

  const byCategory = new Map<string, { orders: number; revenueMinor: number }>();
  const byDay = new Map<string, number>();
  for (const o of inCurrent) {
    if (o.price.currency !== currency || o.status === 'refunded') continue;
    const name = o.categoryName || '—';
    const c = byCategory.get(name) ?? { orders: 0, revenueMinor: 0 };
    c.orders++;
    c.revenueMinor += o.price.amountMinor;
    byCategory.set(name, c);
    const day = dayKey(new Date(orderTime(o)).toISOString());
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const topCategories = [...byCategory.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor)
    .slice(0, 5);
  const best = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    periodLabel: periodLabel ?? `${days} days`,
    currency,
    current,
    previous: inPrevious.length > 0 ? previous : null,
    topCategories,
    bestDay: best ? { date: best[0], orders: best[1] } : null,
  };
}
