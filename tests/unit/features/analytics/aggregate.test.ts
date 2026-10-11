import { describe, expect, it } from 'vitest';
import { comparePeriods, computeSalesAnalytics, delta, refundTiming } from '@/features/analytics/aggregate';
import { CURRENT, DATASET, PREVIOUS } from './dataset';

describe('sales analytics on a hand-computed dataset', () => {
  const a = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'day' });

  it('respects Moscow day boundaries and ignores purchases and undated orders', () => {
    // A1 (31 Oct 23:59 MSK) and A9 (6 Nov 00:00 MSK) are outside; A2 (1 Nov 00:00) and A7 (5 Nov 23:59) inside.
    expect(a.totalOrders).toBe(6);
    expect(a.undated).toBe(1);
    expect(a.statusCounts).toEqual({ paid: 1, closed: 2, refunded: 3, unknown: 0 });
  });

  it('keeps every currency separate', () => {
    expect(a.currencies).toEqual(['RUB', 'USD', 'EUR']);
    expect(a.totals.RUB).toEqual({ currency: 'RUB', orders: 2, gross: 125050, completed: 125050, pending: 0, unknownStatus: 0, refundedOrders: 1, refundedAmount: 50000, aov: 62525 });
    expect(a.totals.USD).toEqual({ currency: 'USD', orders: 1, gross: 4000, completed: 0, pending: 4000, unknownStatus: 0, refundedOrders: 1, refundedAmount: 1000, aov: 4000 });
    expect(a.totals.EUR).toEqual({ currency: 'EUR', orders: 0, gross: 0, completed: 0, pending: 0, unknownStatus: 0, refundedOrders: 1, refundedAmount: 1550, aov: null });
  });

  it('computes refund and cancellation rates from observed history', () => {
    expect(a.refundRate).toBe(0.5);
    expect(a.cancellation).toEqual({ beforeCompletion: 1, afterCompletion: 1, unknownTiming: 1 });
    expect(a.cancellationRate).toBeCloseTo(1 / 6, 10);
    expect(refundTiming({ status: 'closed', history: [] })).toBeNull();
  });

  it('builds gap-filled daily series per currency', () => {
    expect(a.series.RUB!.map((p) => [p.key, p.gross, p.orders, p.refundedOrders, p.refundedAmount])).toEqual([
      ['2024-11-01', 100000, 1, 0, 0],
      ['2024-11-02', 0, 0, 1, 50000],
      ['2024-11-03', 25050, 1, 0, 0],
      ['2024-11-04', 0, 0, 0, 0],
      ['2024-11-05', 0, 0, 0, 0],
    ]);
    expect(a.series.USD!.map((p) => [p.key, p.gross, p.refundedOrders])).toEqual([
      ['2024-11-01', 4000, 0],
      ['2024-11-02', 0, 0],
      ['2024-11-03', 0, 0],
      ['2024-11-04', 0, 0],
      ['2024-11-05', 0, 1],
    ]);
    expect(a.countSeries.map((p) => [p.key, p.orders, p.refunded])).toEqual([
      ['2024-11-01', 2, 0],
      ['2024-11-02', 0, 1],
      ['2024-11-03', 1, 0],
      ['2024-11-04', 0, 1],
      ['2024-11-05', 0, 1],
    ]);
  });

  it('groups by week and month', () => {
    const w = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'week' });
    expect(w.countSeries.map((p) => [p.key, p.orders, p.refunded])).toEqual([
      ['2024-10-28', 3, 1],
      ['2024-11-04', 0, 2],
    ]);
    const m = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'month' });
    expect(m.series.RUB!.map((p) => [p.key, p.gross])).toEqual([['2024-11', 125050]]);
  });

  it('groups by category (section or game) and status', () => {
    expect(a.byCategory).toEqual([
      { key: 'Game A, Accounts', orders: 2, refunded: 1, grossByCurrency: { RUB: 100000, USD: 4000 } },
      { key: 'Game B, Currency', orders: 1, refunded: 1, grossByCurrency: { RUB: 25050 } },
      { key: 'Game C, Items', orders: 0, refunded: 1, grossByCurrency: {} },
    ]);
    const games = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'day', categoryLevel: 'game' });
    expect(games.byCategory.map((c) => c.key)).toEqual(['Game A', 'Game B', 'Game C']);
    expect(a.byStatus).toEqual([
      { status: 'paid', orders: 1, amountByCurrency: { USD: 4000 } },
      { status: 'closed', orders: 2, amountByCurrency: { RUB: 125050 } },
      { status: 'refunded', orders: 3, amountByCurrency: { RUB: 50000, EUR: 1550, USD: 1000 } },
    ]);
  });

  it('fills the weekday × hour heatmap in Moscow time', () => {
    const cells: [number, number, number][] = [];
    a.heatmap.forEach((row, d) => row.forEach((v, hr) => v && cells.push([d, hr, v])));
    // Fri 00h, Fri 23h, Sat 00h, Sun 12h, Mon 14h, Tue 23h
    expect(cells).toEqual([
      [0, 14, 1],
      [1, 23, 1],
      [4, 0, 1],
      [4, 23, 1],
      [5, 0, 1],
      [6, 12, 1],
    ]);
  });

  it('analyses purchases separately', () => {
    const p = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'day', direction: 'purchase' });
    expect(p.totalOrders).toBe(1);
    expect(p.totals.RUB!.gross).toBe(30000);
    expect(p.undated).toBe(0);
  });
});

describe('period-over-period comparison', () => {
  it('computes Δ% per currency and handles empty bases', () => {
    const cur = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'day' });
    const prev = computeSalesAnalytics(DATASET, { range: PREVIOUS, granularity: 'day' });
    expect(prev.totals.RUB!.gross).toBe(51000);
    const cmp = comparePeriods(cur, prev);
    expect(cmp.gross.RUB!.pct).toBeCloseTo((125050 - 51000) / 51000, 10);
    expect(cmp.gross.USD).toEqual({ current: 4000, previous: 2000, pct: 1 });
    expect(cmp.gross.EUR).toEqual({ current: 0, previous: 0, pct: null });
    expect(cmp.orders).toEqual({ current: 3, previous: 3, pct: 0 });
    expect(cmp.refundRate).toEqual({ current: 0.5, previous: 0, diff: 0.5 });
    expect(cmp.aov.RUB!.pct).toBeCloseTo(62525 / 25500 - 1, 10);
  });

  it('delta() has no percentage without a base', () => {
    expect(delta(5, 0).pct).toBeNull();
    expect(delta(0, 4).pct).toBe(-1);
    expect(delta(6, 4).pct).toBe(0.5);
  });
});
