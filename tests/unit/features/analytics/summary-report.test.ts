import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { comparePeriods, computeSalesAnalytics } from '@/features/analytics/aggregate';
import { formatByCurrencyPlain, formatDeltaPct, formatMinorPlain } from '@/features/analytics/format';
import { productPerformance } from '@/features/analytics/products';
import { profitByProduct } from '@/features/analytics/profit';
import { analyticsReportSheets, heatmapSheet, sheetToTable, summarySheet } from '@/features/analytics/report';
import { buildSummary, formatSummaryText, loadSummary, summaryRange } from '@/features/analytics/summary';
import { readXlsx, writeXlsx } from '@/features/export/xlsx';
import { CURRENT, DATASET, mkOp, NOW, PREVIOUS } from './dataset';

const T = (iso: string) => Date.parse(iso);

describe('plain-text money formatting', () => {
  it('uses ASCII spaces and explicit currencies', () => {
    expect(formatMinorPlain(125050, 'RUB', 'ru')).toBe('1 250,50 ₽');
    expect(formatMinorPlain(125050, 'RUB', 'en')).toBe('1,250.50 RUB');
    expect(formatMinorPlain(-4000, 'USD', 'uk')).toBe('-40,00 $');
    expect(formatByCurrencyPlain({ USD: 4000, RUB: 100 }, 'ru')).toBe('1,00 ₽ · 40,00 $');
    expect(formatDeltaPct(0.125)).toBe('+12.5%');
    expect(formatDeltaPct(null)).toBe('—');
  });
});

describe('summary ranges (Moscow time)', () => {
  it('day / week / month, current or last complete period', () => {
    expect(summaryRange('day', NOW)).toEqual({ from: T('2024-11-04T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(summaryRange('day', NOW, { complete: true })).toEqual({ from: T('2024-11-03T21:00:00.000Z'), to: T('2024-11-04T21:00:00.000Z') });
    expect(summaryRange('week', NOW)).toEqual({ from: T('2024-10-29T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(summaryRange('week', NOW, { complete: true })).toEqual({ from: T('2024-10-28T21:00:00.000Z'), to: T('2024-11-04T21:00:00.000Z') });
    expect(summaryRange('month', NOW)).toEqual({ from: T('2024-10-31T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(summaryRange('month', NOW, { complete: true })).toEqual({ from: T('2024-09-30T21:00:00.000Z'), to: T('2024-10-31T21:00:00.000Z') });
  });
});

describe('buildSummary', () => {
  const ops = [mkOp({ id: 'i1', kind: 'income', orderId: 'A2000002', amount: { amountMinor: 90000, currency: 'RUB' }, at: '2024-11-02T10:00:00.000Z' }), mkOp({ id: 'i2', kind: 'withdrawal', at: '2024-11-02T10:00:00.000Z' })];
  const s = buildSummary(CURRENT, { orders: DATASET, financeOps: ops, now: NOW });

  it('is pure and per currency', () => {
    expect(s.range).toEqual(CURRENT);
    expect(s.previousRange).toEqual(PREVIOUS);
    expect(s.orders).toBe(3);
    expect(s.refunded).toBe(3);
    expect(s.refundRate).toBe(0.5);
    expect(s.revenue).toEqual({ RUB: 125050, USD: 4000 });
    expect(s.previousRevenue).toEqual({ RUB: 51000, USD: 2000 });
    expect(s.revenueDeltaPct.USD).toBe(1);
    expect(s.ordersDeltaPct).toBe(0);
    expect(s.averageOrderValue).toEqual({ RUB: 62525, USD: 4000 });
    expect(s.netReceipts).toEqual({ RUB: 90000 });
    expect(s.undated).toBe(1);
    // Unconfirmed = paid sales right now, regardless of the period (A3 and the undated A8).
    expect(s.unconfirmed.total).toBe(2);
    expect(s.topProducts).toEqual([
      { title: 'Item', category: 'Game A, Accounts', orders: 2, revenue: { RUB: 100000, USD: 4000 } },
      { title: 'Item', category: 'Game B, Currency', orders: 1, revenue: { RUB: 25050 } },
    ]);
    expect(s.topCategories).toEqual([
      { category: 'Game A, Accounts', orders: 2 },
      { category: 'Game B, Currency', orders: 1 },
    ]);
  });

  it('formats a plain-text summary in Russian and English, optionally hiding amounts', () => {
    const ru = formatSummaryText(s, 'ru');
    expect(ru.split('\n')[0]).toBe('Сводка FunPro');
    expect(ru).toContain('Период: 01.11.2024 – 05.11.2024 (МСК)');
    expect(ru).toContain('Выручка (по ценам заказов): 1 250,50 ₽ · 40,00 $');
    expect(ru).toContain('Зачислено на баланс: 900,00 ₽');
    const en = formatSummaryText(s, 'en');
    expect(en).toContain('Revenue (order prices): 1,250.50 RUB · 40.00 USD');
    expect(en).toContain('Sales: 3 (0.0% vs previous period)');
    expect(en).toContain('  1. Item (Game A, Accounts) — 2');
    const hidden = formatSummaryText(s, 'en', { hideAmounts: true });
    expect(hidden).toContain('Revenue (order prices): •••');
    expect(hidden).not.toContain('1,250.50');
  });

  it('loadSummary reads Dexie and matches buildSummary', async () => {
    resetDbForTests();
    await getDb().orders.bulkAdd(DATASET);
    await getDb().financeOps.bulkAdd(ops);
    const loaded = await loadSummary(CURRENT, { now: NOW });
    expect(loaded).toEqual(s);
  });
});

describe('analytics report export', () => {
  beforeEach(() => resetDbForTests());
  const a = computeSalesAnalytics(DATASET, { range: CURRENT, granularity: 'day' });
  const cmp = comparePeriods(a, computeSalesAnalytics(DATASET, { range: PREVIOUS, granularity: 'day' }));

  it('summary sheet lists metrics per currency with the previous period and change', () => {
    const sheet = summarySheet(a, cmp);
    expect(sheet.headers).toEqual(['metric', 'currency', 'value', 'previous_period', 'change_pct']);
    expect(sheet.rows).toContainEqual(['gross_revenue', 'RUB', 1250.5, 510, 145.2]);
    expect(sheet.rows).toContainEqual(['gross_revenue', 'USD', 40, 20, 100]);
    expect(sheet.rows).toContainEqual(['refund_rate_pct', '', 50, 0, '']);
    expect(sheet.rows).toContainEqual(['orders_undated_excluded', '', 1, '', '']);
  });

  it('writes a multi-sheet XLSX that reads back', () => {
    const products = productPerformance(DATASET, [], { range: CURRENT });
    const profit = profitByProduct(DATASET, [], [], { range: CURRENT, fees: { categoryCommissionPct: {}, defaultCommissionPct: null } });
    const sheets = analyticsReportSheets({ analytics: a, comparison: cmp, products, profit });
    expect(sheets.map((s) => s.name)).toEqual(['Summary', 'Revenue by period', 'Orders by period', 'Categories', 'Statuses', 'Products', 'Profit (estimate)', 'Weekday x hour (MSK)']);
    const bytes = writeXlsx(sheets);
    const revenue = readXlsx(bytes, 1);
    expect(revenue[0]).toEqual(['period_day', 'currency', 'gross', 'orders', 'refunded_orders', 'refunded_amount']);
    expect(revenue[1]).toEqual(['2024-11-01', 'RUB', 1000, 1, 0, 0]);
    const categories = readXlsx(bytes, 3);
    expect(categories[0]).toEqual(['category', 'orders', 'refunded', 'gross_RUB', 'gross_USD']);
    expect(categories[1]).toEqual(['Game A, Accounts', 2, 1, 1000, 40]);
    expect(heatmapSheet(a).rows[4]![1]).toBe(1); // Friday 00h
    expect(sheetToTable(sheets[0]!, 'x').headers).toEqual(sheets[0]!.headers);
  });
});
