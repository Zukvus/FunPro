import { describe, expect, it } from 'vitest';
import { comparePeriods, computeSalesAnalytics } from '@/features/analytics/aggregate';
import { productPerformance, rankProducts } from '@/features/analytics/products';
import { profitByProduct } from '@/features/analytics/profit';
import { buildSummary } from '@/features/analytics/summary';
import { DAY_MS, previousRange } from '@/features/analytics/time';
import { agingSummary, unconfirmedOrders } from '@/features/orders/unconfirmed';
import type { Currency, Listing, Order, OrderStatus } from '@/shared/models';

/** Deterministic pseudo-random generator (LCG) so the benchmark data is identical on every run. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function generate(n: number, to: number): { orders: Order[]; listings: Listing[] } {
  const rnd = lcg(42);
  const currencies: Currency[] = ['RUB', 'RUB', 'RUB', 'USD', 'EUR'];
  const statuses: OrderStatus[] = ['closed', 'closed', 'closed', 'paid', 'refunded'];
  const listings: Listing[] = Array.from({ length: 500 }, (_, i) => ({
    id: String(100000 + i),
    nodeId: null,
    gameId: null,
    categoryName: `Game ${i % 40}`,
    title: `Product ${i}`,
    price: { amountMinor: 1000 + i, currency: 'RUB' },
    amount: null,
    active: true,
    promoted: false,
    autoDelivery: false,
    costMinor: i % 2 ? 300 : null,
    sortIndex: i,
    seenAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }));
  const orders: Order[] = [];
  for (let i = 0; i < n; i++) {
    const created = new Date(to - Math.floor(rnd() * 365 * DAY_MS)).toISOString();
    const p = Math.floor(rnd() * 500);
    const status = statuses[Math.floor(rnd() * statuses.length)]!;
    orders.push({
      id: `P${String(i).padStart(7, '0')}`,
      direction: rnd() < 0.9 ? 'sale' : 'purchase',
      status,
      counterpartyName: `Buyer${Math.floor(rnd() * 5000)}`,
      counterpartyId: String(3_000_000 + Math.floor(rnd() * 5000)),
      description: `Product ${p}, ${1 + Math.floor(rnd() * 3)} шт.`,
      categoryName: `Game ${p % 40}, Section ${p % 7}`,
      listingId: null,
      price: {
        amountMinor: 100 + Math.floor(rnd() * 500_000),
        currency: currencies[Math.floor(rnd() * currencies.length)]!,
      },
      createdAt: created,
      rawDate: '',
      firstSeenAt: created,
      updatedAt: created,
      history:
        status === 'refunded'
          ? [
              { status: 'paid', at: created, source: 'observed' },
              { status: 'refunded', at: created, source: 'observed' },
            ]
          : [{ status, at: created, source: 'observed' }],
    });
  }
  return { orders, listings };
}

describe('analytics performance', () => {
  it('aggregates 50 000 orders (series, categories, heatmap, comparison, products, profit) in under 1.5 s', () => {
    const to = Date.parse('2024-11-05T21:00:00.000Z');
    const { orders, listings } = generate(50_000, to);
    const range = { from: to - 365 * DAY_MS, to };
    const fees = { categoryCommissionPct: { 'Game 1, Section 1': 7.5 }, defaultCommissionPct: 10 };

    const started = performance.now();
    const daily = computeSalesAnalytics(orders, { range, granularity: 'day' });
    const previous = computeSalesAnalytics(orders, { range: previousRange(range), granularity: 'day' });
    comparePeriods(daily, previous);
    computeSalesAnalytics(orders, { range, granularity: 'week', categoryLevel: 'game' });
    const products = productPerformance(orders, listings, { range });
    rankProducts(products, { by: 'revenue', currency: 'RUB', order: 'best', limit: 10 });
    const profit = profitByProduct(orders, listings, [], { range, fees });
    agingSummary(unconfirmedOrders(orders, { now: to, minAgeHours: 2 }));
    const elapsed = performance.now() - started;

    // Sanity: the work was real.
    expect(daily.totalOrders + daily.undated).toBeGreaterThan(40_000);
    expect(daily.series.RUB!.length).toBe(365);
    expect(products.length).toBeGreaterThan(400);
    expect(profit.length).toBeGreaterThan(400);
    expect(elapsed).toBeLessThan(1500);
  });

  it('builds a 30-day summary over 50 000 stored orders quickly', () => {
    const to = Date.parse('2024-11-05T21:00:00.000Z');
    const { orders } = generate(50_000, to);
    const started = performance.now();
    const s = buildSummary({ from: to - 30 * DAY_MS, to }, { orders, now: to });
    expect(performance.now() - started).toBeLessThan(1500);
    expect(s.orders).toBeGreaterThan(0);
  });
});
