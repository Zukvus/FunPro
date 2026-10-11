import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { getDb } from '@/core/db/db';
import { comparePeriods, computeSalesAnalytics, type PeriodComparison, type SalesAnalytics } from '@/features/analytics/aggregate';
import { listingsWithoutSales, productPerformance, type ProductRow } from '@/features/analytics/products';
import { profitByProduct, profitTotals, type FeeSettings, type ProfitRow, type ProfitTotals } from '@/features/analytics/profit';
import { iso, type DateRange, type Granularity } from '@/features/analytics/time';
import { agingSummary, unconfirmedOrders, type AgingSummary } from '@/features/orders/unconfirmed';
import type { Listing, OrderDirection } from '@/shared/models';

export interface AnalyticsData {
  loading: boolean;
  /** Orders FunPro holds at all (any direction) — for empty states. */
  totalStored: number;
  /** Orders without a parseable FunPay date (any direction) — excluded from analytics. */
  undatedStored: number;
  current: SalesAnalytics | null;
  previous: SalesAnalytics | null;
  comparison: PeriodComparison | null;
  products: ProductRow[];
  profit: ProfitRow[];
  profitTotals: ProfitTotals[];
  unsold: Listing[];
  aging: AgingSummary | null;
}

export function useAnalyticsData(p: {
  range: DateRange;
  prev: DateRange;
  direction: OrderDirection;
  granularity: Granularity;
  categoryLevel: 'section' | 'game';
  fees: FeeSettings;
  unconfirmedAfterHours: number;
  now: number;
}): AnalyticsData {
  const { range, prev, direction, granularity, categoryLevel, fees } = p;
  const orders = useLiveQuery(() => getDb().orders.where('createdAt').between(iso(Math.min(prev.from, range.from)), iso(range.to), true, false).toArray(), [prev.from, range.from, range.to]);
  const listings = useLiveQuery(() => getDb().listings.toArray(), [], []);
  // Credits for orders in the period can arrive later (on confirmation): no upper bound.
  const financeOps = useLiveQuery(() => getDb().financeOps.where('at').aboveOrEqual(iso(range.from)).toArray(), [range.from], []);
  const paidSales = useLiveQuery(() => getDb().orders.where('[direction+status]').equals(['sale', 'paid']).toArray(), [], []);
  const counts = useLiveQuery(
    async () => {
      const db = getDb();
      const [total, dated] = await Promise.all([db.orders.count(), db.orders.where('createdAt').aboveOrEqual('').count()]);
      return { total, undated: Math.max(0, total - dated) };
    },
    [],
    { total: 0, undated: 0 },
  );

  const current = useMemo(() => (orders ? computeSalesAnalytics(orders, { range, granularity, direction, categoryLevel }) : null), [orders, range, granularity, direction, categoryLevel]);
  const previous = useMemo(() => (orders ? computeSalesAnalytics(orders, { range: prev, granularity, direction, categoryLevel }) : null), [orders, prev, granularity, direction, categoryLevel]);
  const comparison = useMemo(() => (current && previous ? comparePeriods(current, previous) : null), [current, previous]);
  const products = useMemo(() => (orders ? productPerformance(orders, listings, { range, direction }) : []), [orders, listings, range, direction]);
  const profit = useMemo(() => (orders && direction === 'sale' ? profitByProduct(orders, listings, financeOps, { range, fees }) : []), [orders, listings, financeOps, range, fees, direction]);
  const totals = useMemo(() => profitTotals(profit), [profit]);
  const unsold = useMemo(() => (direction === 'sale' ? listingsWithoutSales(listings, products) : []), [listings, products, direction]);
  const aging = useMemo(() => agingSummary(unconfirmedOrders(paidSales, { now: p.now, minAgeHours: p.unconfirmedAfterHours })), [paidSales, p.now, p.unconfirmedAfterHours]);

  return {
    loading: orders === undefined,
    totalStored: counts.total,
    undatedStored: counts.undated,
    current,
    previous,
    comparison,
    products,
    profit,
    profitTotals: totals,
    unsold,
    aging,
  };
}
