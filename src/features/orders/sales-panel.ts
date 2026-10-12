/**
 * Statistics for the panel FunPro adds to FunPay's own sales page (/orders/trade). Computed in the
 * background from the sales FunPro has stored — pages the seller opened, background syncs and
 * history imports — and nothing else. The content script only receives these aggregates.
 *
 * Definitions follow the dashboard analytics (features/analytics/aggregate.ts):
 *  - an order belongs to a period by its FunPay creation date (Moscow time); orders without a
 *    parseable date are only counted in `coverage.undated`;
 *  - "earned" is the sum of closed (buyer-confirmed) orders; averages and the biggest sale are over
 *    closed orders too. Everything money-related is per currency — currencies are never added up.
 */
import type { Currency, Order } from '@/shared/models';
import type { SalesPanelPeriod } from '@/core/settings/schema';
import { computeSalesAnalytics } from '@/features/analytics/aggregate';
import { productPerformance, rankProducts } from '@/features/analytics/products';
import {
  autoGranularity,
  DAY_MS,
  MSK_OFFSET_MINUTES,
  resolveRange,
  startOfZonedDay,
  type DateRange,
} from '@/features/analytics/time';
import { createdTs } from './model';
import { sortCurrencies, topCounterparties } from './query';
import type { PanelMoney, SalesPanelCurrency, SalesPanelData, SalesPanelTopRow } from './sales-panel-schema';

const TOP_N = 5;

function amountsOf(byCurrency: Partial<Record<Currency, number>>): PanelMoney[] {
  return sortCurrencies(Object.keys(byCurrency) as Currency[])
    .filter((c) => (byCurrency[c] ?? 0) !== 0)
    .map((c) => ({ currency: c, amountMinor: byCurrency[c]! }));
}

/** The period as a half-open Moscow-time range ending with today. `all` starts at the oldest sale. */
export function salesPanelRange(
  period: SalesPanelPeriod,
  now: number,
  sales: readonly Order[],
  offsetMinutes = MSK_OFFSET_MINUTES,
): DateRange {
  const today = startOfZonedDay(now, offsetMinutes);
  switch (period) {
    case 'today':
      return { from: today, to: today + DAY_MS };
    case 'all': {
      let oldest: number | null = null;
      for (const o of sales) {
        const ts = createdTs(o);
        if (ts !== null && (oldest === null || ts < oldest)) oldest = ts;
      }
      const from = oldest === null ? today : startOfZonedDay(Math.min(oldest, now), offsetMinutes);
      return { from, to: today + DAY_MS };
    }
    default:
      return resolveRange(period, now, null, offsetMinutes);
  }
}

export function computeSalesPanel(
  orders: readonly Order[],
  period: SalesPanelPeriod,
  now: number,
  offsetMinutes = MSK_OFFSET_MINUTES,
): SalesPanelData {
  const sales = orders.filter((o) => o.direction === 'sale');
  const range = salesPanelRange(period, now, sales, offsetMinutes);
  const granularity = autoGranularity(range);
  const analytics = computeSalesAnalytics(sales, { range, granularity, direction: 'sale', offsetMinutes });

  const inPeriod: Order[] = [];
  let oldest: number | null = null;
  let undated = 0;
  for (const o of sales) {
    const ts = createdTs(o);
    if (ts === null) {
      undated++;
      continue;
    }
    if (oldest === null || ts < oldest) oldest = ts;
    if (ts >= range.from && ts < range.to) inPeriod.push(o);
  }

  const perCurrency = new Map<Currency, SalesPanelCurrency>();
  const row = (currency: Currency) => {
    let r = perCurrency.get(currency);
    if (!r) {
      r = {
        currency,
        earned: 0,
        closedOrders: 0,
        pending: 0,
        pendingOrders: 0,
        refunded: 0,
        refundedOrders: 0,
        average: null,
        biggest: null,
      };
      perCurrency.set(currency, r);
    }
    return r;
  };
  const buyers = new Set<string>();
  for (const o of inPeriod) {
    buyers.add(o.counterpartyId ?? `name:${o.counterpartyName.trim().toLowerCase()}`);
    const r = row(o.price.currency);
    const amount = o.price.amountMinor;
    if (o.status === 'closed') {
      r.earned += amount;
      r.closedOrders++;
      r.biggest = r.biggest === null ? amount : Math.max(r.biggest, amount);
    } else if (o.status === 'paid') {
      r.pending += amount;
      r.pendingOrders++;
    } else if (o.status === 'refunded') {
      r.refunded += amount;
      r.refundedOrders++;
    }
  }
  const currencies = sortCurrencies(perCurrency.keys()).map((c) => {
    const r = perCurrency.get(c)!;
    return { ...r, average: r.closedOrders > 0 ? Math.round(r.earned / r.closedOrders) : null };
  });

  const topBuyers: SalesPanelTopRow[] = topCounterparties(inPeriod, TOP_N + 5)
    .filter((b) => b.orders > 0)
    .slice(0, TOP_N)
    .map((b) => ({ name: b.name, orders: b.orders, amounts: amountsOf(b.amountByCurrency) }));

  const topProducts: SalesPanelTopRow[] = rankProducts(
    productPerformance(sales, [], { range, direction: 'sale' }),
    { by: 'orders', order: 'best', limit: TOP_N + 5 },
  )
    .filter((p) => p.orders > 0)
    .slice(0, TOP_N)
    .map((p) => ({ name: p.title, orders: p.orders, amounts: amountsOf(p.grossByCurrency) }));

  const topCategories: SalesPanelTopRow[] = [...analytics.byCategory]
    .filter((c) => c.orders > 0 && c.key.trim() !== '')
    .sort((a, b) => b.orders - a.orders || a.key.localeCompare(b.key))
    .slice(0, TOP_N)
    .map((c) => ({ name: c.key, orders: c.orders, amounts: amountsOf(c.grossByCurrency) }));

  return {
    period,
    from: range.from,
    to: range.to,
    granularity,
    orders: analytics.totalOrders,
    closed: analytics.statusCounts.closed,
    pending: analytics.statusCounts.paid,
    refunded: analytics.statusCounts.refunded,
    unknownStatus: analytics.statusCounts.unknown,
    uniqueBuyers: buyers.size,
    currencies,
    topBuyers,
    topProducts,
    topCategories,
    series: analytics.countSeries.map((p) => ({ key: p.key, start: p.start, orders: p.orders + p.refunded })),
    coverage: { stored: sales.length, oldest, undated },
  };
}
