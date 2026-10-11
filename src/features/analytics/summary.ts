/**
 * Daily / weekly / monthly sales summaries — shared by the dashboard and the Telegram integration.
 *
 * Public API (stable; imported by the Telegram feature):
 *   - `summaryRange(period, now?, opts?)`  → the DateRange of a day/week/month summary (Moscow time)
 *   - `buildSummary(range, input, opts?)`  → PURE: computes the summary from the given orders/finance ops
 *   - `loadSummary(range, opts?)`          → reads Dexie and calls `buildSummary`
 *   - `formatSummaryText(summary, lang, opts?)` → plain text (no HTML, no invisible characters)
 *
 * All money is per currency; nothing is converted.
 */
import { getDb } from '@/core/db/db';
import type { Currency, FinanceOperation, Order } from '@/shared/models';
import { sortCurrencies } from '@/features/orders/query';
import { agingSummary, unconfirmedOrders, type AgingBucket } from '@/features/orders/unconfirmed';
import { opState, opTime } from '@/features/finance/breakdown';
import { comparePeriods, computeSalesAnalytics, type SalesAnalytics } from './aggregate';
import { formatByCurrencyPlain, formatDeltaPct, formatPct, type TextLang } from './format';
import { productPerformance, rankProducts } from './products';
import { DAY_MS, formatZoned, iso, MSK_OFFSET_MINUTES, previousRange, startOfZonedDay, startOfZonedMonth, type DateRange, type Granularity } from './time';

export type SummaryPeriod = 'day' | 'week' | 'month';

/**
 * - day:   today so far (or yesterday with `complete`)
 * - week:  the last 7 days including today (or the previous 7 full days with `complete`)
 * - month: the current calendar month so far (or the previous calendar month with `complete`)
 */
export function summaryRange(period: SummaryPeriod, now = Date.now(), opts: { complete?: boolean; offsetMinutes?: number } = {}): DateRange {
  const off = opts.offsetMinutes ?? MSK_OFFSET_MINUTES;
  const today = startOfZonedDay(now, off);
  const complete = opts.complete ?? false;
  if (period === 'day') return complete ? { from: today - DAY_MS, to: today } : { from: today, to: today + DAY_MS };
  if (period === 'week') return complete ? { from: today - 7 * DAY_MS, to: today } : { from: today - 6 * DAY_MS, to: today + DAY_MS };
  const month = startOfZonedMonth(now, off);
  if (complete) return { from: startOfZonedMonth(month - 1, off), to: month };
  return { from: month, to: today + DAY_MS };
}

export interface SummaryProduct {
  title: string;
  category: string;
  orders: number;
  revenue: Partial<Record<Currency, number>>;
}

export interface AnalyticsSummary {
  range: DateRange;
  previousRange: DateRange;
  generatedAt: number;
  /** Non-refunded sales in the period. */
  orders: number;
  refunded: number;
  refundRate: number | null;
  revenue: Partial<Record<Currency, number>>;
  previousRevenue: Partial<Record<Currency, number>>;
  revenueDeltaPct: Partial<Record<Currency, number | null>>;
  ordersDeltaPct: number | null;
  averageOrderValue: Partial<Record<Currency, number>>;
  topProducts: SummaryProduct[];
  topCategories: { category: string; orders: number }[];
  /** Paid sales awaiting buyer confirmation right now (not limited to the period). */
  unconfirmed: { total: number; buckets: Record<AgingBucket, number> };
  /** Income operations credited in the period, when finance data was provided. */
  netReceipts: Partial<Record<Currency, number>> | null;
  /** Sales without a parseable date (excluded). */
  undated: number;
}

export interface SummaryInput {
  orders: readonly Order[];
  financeOps?: readonly FinanceOperation[];
  /** "Now" for unconfirmed-order aging (defaults to Date.now()). */
  now?: number;
}

export interface SummaryOptions {
  offsetMinutes?: number;
  topN?: number;
  /** Minimum age (hours) for unconfirmed orders; default 0. */
  unconfirmedAfterHours?: number;
}

function granularityFor(range: DateRange): Granularity {
  return range.to - range.from <= 62 * DAY_MS ? 'day' : 'week';
}

/** PURE: no database access, deterministic for a given input. */
export function buildSummary(range: DateRange, input: SummaryInput, opts: SummaryOptions = {}): AnalyticsSummary {
  const now = input.now ?? Date.now();
  const offsetMinutes = opts.offsetMinutes ?? MSK_OFFSET_MINUTES;
  const prevRange = previousRange(range, 'custom', offsetMinutes);
  const granularity = granularityFor(range);
  const cur: SalesAnalytics = computeSalesAnalytics(input.orders, { range, granularity, offsetMinutes });
  const prev: SalesAnalytics = computeSalesAnalytics(input.orders, { range: prevRange, granularity, offsetMinutes });
  const cmp = comparePeriods(cur, prev);

  const revenue: Partial<Record<Currency, number>> = {};
  const previousRevenue: Partial<Record<Currency, number>> = {};
  const revenueDeltaPct: Partial<Record<Currency, number | null>> = {};
  const averageOrderValue: Partial<Record<Currency, number>> = {};
  for (const c of sortCurrencies([...cur.currencies, ...prev.currencies])) {
    const a = cur.totals[c];
    const b = prev.totals[c];
    if (a && a.gross > 0) revenue[c] = a.gross;
    if (b && b.gross > 0) previousRevenue[c] = b.gross;
    if (a && a.aov !== null) averageOrderValue[c] = a.aov;
    revenueDeltaPct[c] = cmp.gross[c]?.pct ?? null;
  }

  const topN = opts.topN ?? 3;
  const products = productPerformance(input.orders, [], { range });
  const topProducts = rankProducts(products.filter((p) => p.orders > 0), { by: 'orders', order: 'best', limit: topN }).map((p) => ({ title: p.title, category: p.category, orders: p.orders, revenue: p.grossByCurrency }));
  const topCategories = cur.byCategory.filter((c) => c.orders > 0).slice(0, topN).map((c) => ({ category: c.key, orders: c.orders }));

  const aging = agingSummary(unconfirmedOrders(input.orders, { now, minAgeHours: opts.unconfirmedAfterHours ?? 0 }));
  const buckets = Object.fromEntries(Object.entries(aging.buckets).map(([k, v]) => [k, v.count])) as Record<AgingBucket, number>;

  let netReceipts: Partial<Record<Currency, number>> | null = null;
  if (input.financeOps) {
    netReceipts = {};
    for (const op of input.financeOps) {
      if (op.kind !== 'income' || opState(op) === 'cancelled') continue;
      const t = opTime(op);
      if (t === null || t < range.from || t >= range.to) continue;
      netReceipts[op.amount.currency] = (netReceipts[op.amount.currency] ?? 0) + op.amount.amountMinor;
    }
  }

  return {
    range,
    previousRange: prevRange,
    generatedAt: now,
    orders: cur.totalOrders - cur.statusCounts.refunded,
    refunded: cur.statusCounts.refunded,
    refundRate: cur.refundRate,
    revenue,
    previousRevenue,
    revenueDeltaPct,
    ordersDeltaPct: cmp.orders.pct,
    averageOrderValue,
    topProducts,
    topCategories,
    unconfirmed: { total: aging.total, buckets },
    netReceipts,
    undated: cur.undated,
  };
}

/** Reads orders (current + previous period) and finance operations from Dexie, then builds the summary. */
export async function loadSummary(range: DateRange, opts: SummaryOptions & { now?: number } = {}): Promise<AnalyticsSummary> {
  const db = getDb();
  const prev = previousRange(range, 'custom', opts.offsetMinutes ?? MSK_OFFSET_MINUTES);
  const [inRange, paid, financeOps] = await Promise.all([
    db.orders.where('createdAt').between(iso(prev.from), iso(range.to), true, false).toArray(),
    db.orders.where('[direction+status]').equals(['sale', 'paid']).toArray(),
    db.financeOps.where('at').between(iso(range.from), iso(range.to), true, false).toArray(),
  ]);
  const byId = new Map<string, Order>();
  for (const o of [...inRange, ...paid]) byId.set(o.id, o);
  return buildSummary(range, { orders: [...byId.values()], financeOps, now: opts.now }, opts);
}

const LABELS = {
  ru: { title: 'Сводка FunPro', period: 'Период', orders: 'Продажи', refunds: 'Возвраты', revenue: 'Выручка (по ценам заказов)', vsPrev: 'к прошлому периоду', aov: 'Средний чек', receipts: 'Зачислено на баланс', top: 'Топ товаров', unconfirmed: 'Ждут подтверждения', none: 'нет', undated: 'Без даты (не учтены)', msk: 'МСК' },
  uk: { title: 'Зведення FunPro', period: 'Період', orders: 'Продажі', refunds: 'Повернення', revenue: 'Виручка (за цінами замовлень)', vsPrev: 'до попереднього періоду', aov: 'Середній чек', receipts: 'Зараховано на баланс', top: 'Топ товарів', unconfirmed: 'Очікують підтвердження', none: 'немає', undated: 'Без дати (не враховано)', msk: 'МСК' },
  en: { title: 'FunPro summary', period: 'Period', orders: 'Sales', refunds: 'Refunds', revenue: 'Revenue (order prices)', vsPrev: 'vs previous period', aov: 'Average order', receipts: 'Credited to balance', top: 'Top products', unconfirmed: 'Awaiting confirmation', none: 'none', undated: 'Undated (excluded)', msk: 'MSK' },
} as const;

export interface FormatOptions {
  /** Replace every amount with "•••" (privacy). */
  hideAmounts?: boolean;
  offsetMinutes?: number;
}

/**
 * Plain-text rendering: no markup and no invisible characters. Product titles are seller/FunPay
 * text, so send the result WITHOUT a Telegram parse_mode (or escape it first).
 */
export function formatSummaryText(s: AnalyticsSummary, lang: TextLang, opts: FormatOptions = {}): string {
  const L = LABELS[lang];
  const off = opts.offsetMinutes ?? MSK_OFFSET_MINUTES;
  const money = (m: Partial<Record<Currency, number>>) => (opts.hideAmounts ? '•••' : Object.keys(m).length ? formatByCurrencyPlain(m, lang) : L.none);
  const lastDay = s.range.to - 1;
  const lines: string[] = [
    L.title,
    `${L.period}: ${formatZoned(s.range.from, off, false)} – ${formatZoned(lastDay, off, false)} (${L.msk})`,
    `${L.orders}: ${s.orders} (${formatDeltaPct(s.ordersDeltaPct)} ${L.vsPrev})`,
    `${L.refunds}: ${s.refunded}${s.refundRate !== null ? ` (${formatPct(s.refundRate)})` : ''}`,
    `${L.revenue}: ${money(s.revenue)}`,
  ];
  const deltas = (Object.entries(s.revenueDeltaPct) as [Currency, number | null][]).filter(([c]) => s.revenue[c] !== undefined || s.previousRevenue[c] !== undefined);
  if (deltas.length && !opts.hideAmounts) lines.push(`  ${deltas.map(([c, d]) => `${c} ${formatDeltaPct(d)}`).join(', ')} ${L.vsPrev}`);
  if (Object.keys(s.averageOrderValue).length) lines.push(`${L.aov}: ${money(s.averageOrderValue)}`);
  if (s.netReceipts) lines.push(`${L.receipts}: ${money(s.netReceipts)}`);
  if (s.topProducts.length) {
    lines.push(`${L.top}:`);
    s.topProducts.forEach((p, i) => lines.push(`  ${i + 1}. ${p.title}${p.category ? ` (${p.category})` : ''} — ${p.orders}`));
  }
  lines.push(`${L.unconfirmed}: ${s.unconfirmed.total}`);
  if (s.undated > 0) lines.push(`${L.undated}: ${s.undated}`);
  return lines.join('\n');
}
