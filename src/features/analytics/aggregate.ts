/**
 * Sales / purchase analytics over locally stored orders.
 *
 * Definitions (shown in the UI next to every number):
 *  - An order belongs to a period by its FunPay creation date (Moscow time). Orders whose date could
 *    not be parsed are excluded from time-based analytics and reported as `undated`.
 *  - Gross revenue = sum of order prices (buyer-facing amounts as listed by FunPay) of orders that
 *    were NOT refunded. Per currency — currencies are never added together.
 *  - Completed = status closed (buyer confirmed); pending = status paid (awaiting confirmation).
 *  - Refund rate = refunded orders / all orders in the period.
 *  - Cancellation (refunded before the buyer confirmed) vs refund after completion is derived from
 *    the status history FunPro observed; orders first seen already refunded have unknown timing.
 */
import type { Currency, Order, OrderDirection, OrderStatus } from '@/shared/models';
import { sortCurrencies } from '@/features/orders/query';
import { createdTs, gameOf } from '@/features/orders/model';
import {
  DAY_MS,
  enumerateBuckets,
  HOUR_MS,
  MSK_OFFSET_MINUTES,
  type Bucket,
  type DateRange,
  type Granularity,
} from './time';

export interface AnalyticsOptions {
  range: DateRange;
  granularity: Granularity;
  /** Default 'sale'. */
  direction?: OrderDirection;
  offsetMinutes?: number;
  /** Category grouping: full "Game, Section" (default) or game only. */
  categoryLevel?: 'section' | 'game';
}

export interface CurrencyTotals {
  currency: Currency;
  /** Non-refunded orders. */
  orders: number;
  /** Gross revenue (minor units), non-refunded orders. */
  gross: number;
  /** Closed (confirmed) part of gross. */
  completed: number;
  /** Paid, awaiting confirmation part of gross. */
  pending: number;
  /** Orders whose status FunPro could not determine (part of gross). */
  unknownStatus: number;
  refundedOrders: number;
  refundedAmount: number;
  /** Average order value (minor units), null without orders. */
  aov: number | null;
}

export interface SeriesPoint {
  key: string;
  start: number;
  end: number;
  gross: number;
  orders: number;
  refundedOrders: number;
  refundedAmount: number;
}

export interface CountPoint {
  key: string;
  start: number;
  end: number;
  /** Non-refunded orders (all currencies — counts are currency-neutral). */
  orders: number;
  refunded: number;
}

export interface CategoryRow {
  key: string;
  orders: number;
  refunded: number;
  grossByCurrency: Partial<Record<Currency, number>>;
}

export interface CancellationStats {
  /** Refunded before the buyer confirmed (seen paid → refunded). */
  beforeCompletion: number;
  /** Refunded after the order had been closed. */
  afterCompletion: number;
  /** First seen already refunded — timing unknown. */
  unknownTiming: number;
}

export interface SalesAnalytics {
  range: DateRange;
  granularity: Granularity;
  direction: OrderDirection;
  /** All orders in the period, any status. */
  totalOrders: number;
  statusCounts: Record<OrderStatus, number>;
  currencies: Currency[];
  totals: Partial<Record<Currency, CurrencyTotals>>;
  /** Gap-filled series per currency (one series per currency; never summed across currencies). */
  series: Partial<Record<Currency, SeriesPoint[]>>;
  countSeries: CountPoint[];
  byCategory: CategoryRow[];
  byStatus: { status: OrderStatus; orders: number; amountByCurrency: Partial<Record<Currency, number>> }[];
  /** heatmap[weekday 0=Mon..6=Sun][hour 0..23] = orders (all statuses). */
  heatmap: number[][];
  refundRate: number | null;
  cancellation: CancellationStats;
  /** Orders in the period that were cancelled before completion / all orders. */
  cancellationRate: number | null;
  /** Matching-direction orders without a parseable FunPay date (excluded everywhere above). */
  undated: number;
}

function emptyTotals(currency: Currency): CurrencyTotals {
  return {
    currency,
    orders: 0,
    gross: 0,
    completed: 0,
    pending: 0,
    unknownStatus: 0,
    refundedOrders: 0,
    refundedAmount: 0,
    aov: null,
  };
}

/** Index of the bucket containing ts (buckets sorted, contiguous), or -1. */
function findBucket(starts: readonly number[], ends: readonly number[], ts: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (ts < starts[mid]!) hi = mid - 1;
    else if (ts >= ends[mid]!) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export function refundTiming(o: Pick<Order, 'history' | 'status'>): keyof CancellationStats | null {
  if (o.status !== 'refunded') return null;
  let sawPaid = false;
  let sawClosed = false;
  for (const h of o.history) {
    if (h.status === 'refunded') break;
    if (h.status === 'paid') sawPaid = true;
    if (h.status === 'closed') sawClosed = true;
  }
  if (sawClosed) return 'afterCompletion';
  if (sawPaid) return 'beforeCompletion';
  return 'unknownTiming';
}

export function computeSalesAnalytics(orders: readonly Order[], opts: AnalyticsOptions): SalesAnalytics {
  const direction = opts.direction ?? 'sale';
  const offsetMs = (opts.offsetMinutes ?? MSK_OFFSET_MINUTES) * 60_000;
  const { from, to } = opts.range;
  const buckets: Bucket[] = enumerateBuckets(
    opts.range,
    opts.granularity,
    opts.offsetMinutes ?? MSK_OFFSET_MINUTES,
  );
  const starts = buckets.map((b) => b.start);
  const ends = buckets.map((b) => b.end);

  const totals: Partial<Record<Currency, CurrencyTotals>> = {};
  const seriesArrays: Partial<Record<Currency, SeriesPoint[]>> = {};
  const countSeries: CountPoint[] = buckets.map((b) => ({
    key: b.key,
    start: b.start,
    end: b.end,
    orders: 0,
    refunded: 0,
  }));
  const categories = new Map<string, CategoryRow>();
  const statusCounts: Record<OrderStatus, number> = { paid: 0, closed: 0, refunded: 0, unknown: 0 };
  const statusAmounts: Record<OrderStatus, Partial<Record<Currency, number>>> = {
    paid: {},
    closed: {},
    refunded: {},
    unknown: {},
  };
  const heatmap: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const cancellation: CancellationStats = { beforeCompletion: 0, afterCompletion: 0, unknownTiming: 0 };
  let totalOrders = 0;
  let undated = 0;
  const byGame = opts.categoryLevel === 'game';

  for (const o of orders) {
    if (o.direction !== direction) continue;
    const ts = createdTs(o);
    if (ts === null) {
      undated++;
      continue;
    }
    if (ts < from || ts >= to) continue;
    totalOrders++;
    const cur = o.price.currency;
    const amount = o.price.amountMinor;
    const refunded = o.status === 'refunded';
    statusCounts[o.status]++;
    statusAmounts[o.status][cur] = (statusAmounts[o.status][cur] ?? 0) + amount;

    const t = (totals[cur] ??= emptyTotals(cur));
    if (refunded) {
      t.refundedOrders++;
      t.refundedAmount += amount;
      const timing = refundTiming(o);
      if (timing) cancellation[timing]++;
    } else {
      t.orders++;
      t.gross += amount;
      if (o.status === 'closed') t.completed += amount;
      else if (o.status === 'paid') t.pending += amount;
      else t.unknownStatus += amount;
    }

    const bi = findBucket(starts, ends, ts);
    if (bi >= 0) {
      let series = seriesArrays[cur];
      if (!series) {
        series = buckets.map((b) => ({
          key: b.key,
          start: b.start,
          end: b.end,
          gross: 0,
          orders: 0,
          refundedOrders: 0,
          refundedAmount: 0,
        }));
        seriesArrays[cur] = series;
      }
      const p = series[bi]!;
      const c = countSeries[bi]!;
      if (refunded) {
        p.refundedOrders++;
        p.refundedAmount += amount;
        c.refunded++;
      } else {
        p.orders++;
        p.gross += amount;
        c.orders++;
      }
    }

    const catKey = byGame ? gameOf(o.categoryName) : o.categoryName.trim();
    let cat = categories.get(catKey);
    if (!cat) {
      cat = { key: catKey, orders: 0, refunded: 0, grossByCurrency: {} };
      categories.set(catKey, cat);
    }
    if (refunded) cat.refunded++;
    else {
      cat.orders++;
      cat.grossByCurrency[cur] = (cat.grossByCurrency[cur] ?? 0) + amount;
    }

    const local = ts + offsetMs;
    const dayIndex = Math.floor(local / DAY_MS);
    // 1970-01-01 was a Thursday (index 3 with Monday = 0).
    const weekday = (((dayIndex + 3) % 7) + 7) % 7;
    const hour = Math.floor((local - dayIndex * DAY_MS) / HOUR_MS);
    heatmap[weekday]![hour]!++;
  }

  for (const t of Object.values(totals)) {
    if (t) t.aov = t.orders > 0 ? Math.round(t.gross / t.orders) : null;
  }
  const currencies = sortCurrencies(Object.keys(totals) as Currency[]);
  const byCategory = [...categories.values()].sort(
    (a, b) => b.orders - a.orders || b.refunded - a.refunded || a.key.localeCompare(b.key),
  );
  const byStatus = (['paid', 'closed', 'refunded', 'unknown'] as const)
    .map((status) => ({ status, orders: statusCounts[status], amountByCurrency: statusAmounts[status] }))
    .filter((s) => s.orders > 0 || s.status !== 'unknown');

  return {
    range: opts.range,
    granularity: opts.granularity,
    direction,
    totalOrders,
    statusCounts,
    currencies,
    totals,
    series: seriesArrays,
    countSeries,
    byCategory,
    byStatus,
    heatmap,
    refundRate: totalOrders > 0 ? statusCounts.refunded / totalOrders : null,
    cancellation,
    cancellationRate: totalOrders > 0 ? cancellation.beforeCompletion / totalOrders : null,
    undated,
  };
}

// ------------------------------------------------------------------------------------------------
// Period-over-period comparison
// ------------------------------------------------------------------------------------------------

export interface Delta {
  current: number;
  previous: number;
  /** Relative change (0.25 = +25%). Null when the previous value is 0 (no meaningful base). */
  pct: number | null;
}

export function delta(current: number, previous: number): Delta {
  return { current, previous, pct: previous === 0 ? null : (current - previous) / Math.abs(previous) };
}

export interface PeriodComparison {
  orders: Delta;
  refundRate: { current: number | null; previous: number | null; diff: number | null };
  /** Per currency present in either period. */
  gross: Partial<Record<Currency, Delta>>;
  aov: Partial<Record<Currency, Delta>>;
}

export function comparePeriods(current: SalesAnalytics, previous: SalesAnalytics): PeriodComparison {
  const gross: Partial<Record<Currency, Delta>> = {};
  const aov: Partial<Record<Currency, Delta>> = {};
  const all = sortCurrencies([...current.currencies, ...previous.currencies]);
  for (const c of all) {
    const a = current.totals[c];
    const b = previous.totals[c];
    gross[c] = delta(a?.gross ?? 0, b?.gross ?? 0);
    aov[c] = delta(a?.aov ?? 0, b?.aov ?? 0);
  }
  const ordersNow = current.totalOrders - current.statusCounts.refunded;
  const ordersPrev = previous.totalOrders - previous.statusCounts.refunded;
  const rr = current.refundRate;
  const rp = previous.refundRate;
  return {
    orders: delta(ordersNow, ordersPrev),
    refundRate: { current: rr, previous: rp, diff: rr !== null && rp !== null ? rr - rp : null },
    gross,
    aov,
  };
}
