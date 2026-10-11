/**
 * Exportable analytics report: one sheet per table (multi-sheet XLSX, or any single sheet as CSV).
 * Money columns are decimal major units, one column/row per currency — never summed or converted.
 */
import type { Cell } from '@/features/export/csv';
import type { TableExport } from '@/features/export/table';
import type { Sheet } from '@/features/export/xlsx';
import type { Currency } from '@/shared/models';
import { listingUrl } from '@/features/orders/model';
import { sortCurrencies } from '@/features/orders/query';
import type { PeriodComparison, SalesAnalytics } from './aggregate';
import { minorToMajor } from './format';
import type { ProductRow } from './products';
import type { ProfitRow } from './profit';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pct = (v: number | null): Cell => (v === null ? '' : Math.round(v * 10000) / 100);

export function summarySheet(a: SalesAnalytics, cmp: PeriodComparison | null): Sheet {
  const rows: Cell[][] = [];
  const orders = a.totalOrders - a.statusCounts.refunded;
  rows.push([
    'orders_non_refunded',
    '',
    orders,
    cmp ? cmp.orders.previous : '',
    cmp ? pct(cmp.orders.pct) : '',
  ]);
  rows.push(['orders_all_statuses', '', a.totalOrders, '', '']);
  rows.push(['orders_refunded', '', a.statusCounts.refunded, '', '']);
  rows.push(['refund_rate_pct', '', pct(a.refundRate), cmp ? pct(cmp.refundRate.previous) : '', '']);
  rows.push(['cancellation_before_completion_pct', '', pct(a.cancellationRate), '', '']);
  rows.push(['orders_undated_excluded', '', a.undated, '', '']);
  for (const c of a.currencies) {
    const t = a.totals[c]!;
    const g = cmp?.gross[c];
    const v = cmp?.aov[c];
    rows.push([
      'gross_revenue',
      c,
      minorToMajor(t.gross),
      g ? minorToMajor(g.previous) : '',
      g ? pct(g.pct) : '',
    ]);
    rows.push(['completed_revenue', c, minorToMajor(t.completed), '', '']);
    rows.push(['pending_revenue', c, minorToMajor(t.pending), '', '']);
    rows.push(['refunded_amount', c, minorToMajor(t.refundedAmount), '', '']);
    rows.push([
      'average_order_value',
      c,
      t.aov === null ? '' : minorToMajor(t.aov),
      v ? minorToMajor(v.previous) : '',
      v ? pct(v.pct) : '',
    ]);
  }
  return { name: 'Summary', headers: ['metric', 'currency', 'value', 'previous_period', 'change_pct'], rows };
}

export function revenueSeriesSheet(a: SalesAnalytics): Sheet {
  const rows: Cell[][] = [];
  for (const c of a.currencies) {
    for (const p of a.series[c] ?? [])
      rows.push([
        p.key,
        c,
        minorToMajor(p.gross),
        p.orders,
        p.refundedOrders,
        minorToMajor(p.refundedAmount),
      ]);
  }
  return {
    name: 'Revenue by period',
    headers: [`period_${a.granularity}`, 'currency', 'gross', 'orders', 'refunded_orders', 'refunded_amount'],
    rows,
  };
}

export function ordersSeriesSheet(a: SalesAnalytics): Sheet {
  return {
    name: 'Orders by period',
    headers: [`period_${a.granularity}`, 'orders', 'refunded'],
    rows: a.countSeries.map((p) => [p.key, p.orders, p.refunded]),
  };
}

function currencyColumns(maps: Partial<Record<Currency, number>>[]): Currency[] {
  return sortCurrencies(maps.flatMap((m) => Object.keys(m) as Currency[]));
}

export function categoriesSheet(a: SalesAnalytics): Sheet {
  const curs = currencyColumns(a.byCategory.map((r) => r.grossByCurrency));
  return {
    name: 'Categories',
    headers: ['category', 'orders', 'refunded', ...curs.map((c) => `gross_${c}`)],
    rows: a.byCategory.map((r) => [
      r.key,
      r.orders,
      r.refunded,
      ...curs.map((c) => (r.grossByCurrency[c] === undefined ? '' : minorToMajor(r.grossByCurrency[c]!))),
    ]),
  };
}

export function statusesSheet(a: SalesAnalytics): Sheet {
  const curs = currencyColumns(a.byStatus.map((r) => r.amountByCurrency));
  return {
    name: 'Statuses',
    headers: ['status', 'orders', ...curs.map((c) => `amount_${c}`)],
    rows: a.byStatus.map((r) => [
      r.status,
      r.orders,
      ...curs.map((c) => (r.amountByCurrency[c] === undefined ? '' : minorToMajor(r.amountByCurrency[c]!))),
    ]),
  };
}

export function productsSheet(rows: readonly ProductRow[]): Sheet {
  const curs = currencyColumns(rows.map((r) => r.grossByCurrency));
  return {
    name: 'Products',
    headers: [
      'product',
      'category',
      'orders',
      'refunded',
      'units',
      ...curs.map((c) => `gross_${c}`),
      'listing_id',
      'listing_match',
      'listing_url',
    ],
    rows: rows.map((r) => [
      r.title,
      r.category,
      r.orders,
      r.refunded,
      r.units,
      ...curs.map((c) => (r.grossByCurrency[c] === undefined ? '' : minorToMajor(r.grossByCurrency[c]!))),
      r.listingId ?? '',
      r.listingMatch ?? '',
      listingUrl(r.listingId) ?? '',
    ]),
  };
}

export function profitSheet(rows: readonly ProfitRow[]): Sheet {
  return {
    name: 'Profit (estimate)',
    headers: [
      'product',
      'category',
      'currency',
      'orders',
      'units',
      'gross',
      'net_estimate',
      'net_actual_orders',
      'net_estimated_orders',
      'net_unknown_commission_orders',
      'commission_pct',
      'cost_of_goods',
      'cost_unknown_orders',
      'cost_currency_mismatch_orders',
      'profit_estimate',
      'complete',
    ],
    rows: rows.map((r) => [
      r.title,
      r.category,
      r.currency,
      r.orders,
      r.units,
      minorToMajor(r.gross),
      minorToMajor(r.net),
      r.netActualOrders,
      r.netEstimatedOrders,
      r.netGrossOrders,
      r.commissionPct ?? '',
      minorToMajor(r.cost),
      r.costUnknownOrders,
      r.costCurrencyMismatch,
      minorToMajor(r.profit),
      r.complete,
    ]),
  };
}

export function heatmapSheet(a: SalesAnalytics): Sheet {
  return {
    name: 'Weekday x hour (MSK)',
    headers: ['weekday', ...Array.from({ length: 24 }, (_, h) => `h${String(h).padStart(2, '0')}`)],
    rows: a.heatmap.map((row, i) => [WEEKDAYS[i]!, ...row]),
  };
}

export interface ReportInput {
  analytics: SalesAnalytics;
  comparison: PeriodComparison | null;
  products: readonly ProductRow[];
  profit: readonly ProfitRow[];
}

export function analyticsReportSheets(input: ReportInput): Sheet[] {
  const a = input.analytics;
  return [
    summarySheet(a, input.comparison),
    revenueSeriesSheet(a),
    ordersSeriesSheet(a),
    categoriesSheet(a),
    statusesSheet(a),
    productsSheet(input.products),
    profitSheet(input.profit),
    heatmapSheet(a),
  ];
}

/** One sheet as a CSV/JSON-exportable table. */
export function sheetToTable(sheet: Sheet, name: string): TableExport {
  return { name, headers: sheet.headers, rows: sheet.rows };
}
