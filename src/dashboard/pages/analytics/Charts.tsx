import { FileDown } from 'lucide-react';
import { useMemo } from 'react';
import type { SalesAnalytics } from '@/features/analytics/aggregate';
import { categoriesSheet, ordersSeriesSheet, revenueSeriesSheet, sheetToTable } from '@/features/analytics/report';
import { bucketLabel } from '@/features/analytics/time';
import { exportTable } from '@/features/export/table';
import type { Currency, OrderStatus } from '@/shared/models';
import { Button } from '@/ui/components';
import { useLang, useT, type Lang } from '@/ui/i18n';
import { ChartFrame, ColumnSeriesChart, fmtCompact, fmtCompactMajor, fmtInt, fmtMoney, fmtRatio, Heatmap, HBarChart, localeOf, MoneyList, type SeriesDatum } from '@/dashboard/components/charts';
import { OrderStatusBadge } from '../orders/shared';

export function CsvButton({ onClick, label }: { onClick: () => void; label?: string }) {
  const t = useT();
  return (
    <Button size="sm" variant="ghost" icon={<FileDown size={12} />} onClick={onClick} aria-label={label ?? t('analytics.export.csv')}>
      CSV
    </Button>
  );
}

/** One revenue chart per currency (small multiples) — currencies are never summed or put on one axis. */
export function RevenueCharts({ a }: { a: SalesAnalytics }) {
  const t = useT();
  const lang = useLang();
  const dirKey = a.direction === 'sale' ? 'sales' : 'purchases';
  if (a.currencies.length === 0) {
    return (
      <ChartFrame title={t(`analytics.revenue.title.${dirKey}`)} summary={t('analytics.empty.period')} table={{ headers: [], rows: [] }} empty={t('analytics.empty.period')}>
        {null}
      </ChartFrame>
    );
  }
  return (
    <div className={a.currencies.length > 1 ? 'grid gap-3 lg:grid-cols-2' : 'grid gap-3'}>
      {a.currencies.map((c) => (
        <CurrencyRevenueChart key={c} a={a} currency={c} lang={lang} />
      ))}
    </div>
  );
}

function CurrencyRevenueChart({ a, currency, lang }: { a: SalesAnalytics; currency: Currency; lang: Lang }) {
  const t = useT();
  const series = useMemo(() => a.series[currency] ?? [], [a, currency]);
  const data: SeriesDatum[] = useMemo(
    () =>
      series.map((p) => ({
        label: bucketLabel(p.key, a.granularity),
        value: p.gross,
        extra: [t('analytics.tooltip.orders', { count: p.orders }), ...(p.refundedOrders ? [t('analytics.tooltip.refunded', { count: p.refundedOrders, amount: fmtMoney(p.refundedAmount, currency, lang) })] : [])],
      })),
    [series, a.granularity, t, currency, lang],
  );
  const total = a.totals[currency]?.gross ?? 0;
  const peak = series.reduce((m, p) => (p.gross > m.gross ? p : m), series[0] ?? { gross: 0, key: '' });
  const dirKey = a.direction === 'sale' ? 'sales' : 'purchases';
  const cur = currency === 'UNKNOWN' ? t('orders.currency.unknown') : currency;
  return (
    <ChartFrame
      title={t(`analytics.revenue.titleCurrency.${dirKey}`, { currency: cur })}
      description={t(`analytics.revenue.description.${dirKey}`)}
      summary={t('analytics.revenue.summary', { currency: cur, total: fmtMoney(total, currency, lang), peak: peak.key ? bucketLabel(peak.key, a.granularity) : '—' })}
      privacy="sensitive"
      actions={<CsvButton onClick={() => exportTable(sheetToTable(revenueSeriesSheet(a), `funpro-revenue-${a.granularity}`), 'csv')} />}
      table={{
        headers: [t(`analytics.granularity.${a.granularity}`), t('analytics.col.revenue'), t('analytics.col.orders'), t('analytics.col.refunded')],
        rows: series.map((p) => [bucketLabel(p.key, a.granularity), fmtMoney(p.gross, currency, lang), fmtInt(p.orders, lang), p.refundedOrders ? `${p.refundedOrders} · ${fmtMoney(p.refundedAmount, currency, lang)}` : '0']),
        numeric: [1, 2, 3],
      }}
    >
      <ColumnSeriesChart data={data} seriesName={cur} format={(v) => fmtMoney(v, currency, lang)} tickFormat={(v) => fmtCompactMajor(v, lang)} />
    </ChartFrame>
  );
}

export function OrdersCountChart({ a }: { a: SalesAnalytics }) {
  const t = useT();
  const lang = useLang();
  const data: SeriesDatum[] = a.countSeries.map((p) => ({ label: bucketLabel(p.key, a.granularity), value: p.orders, extra: p.refunded ? [t('analytics.tooltip.refundedCount', { count: p.refunded })] : [] }));
  const total = a.countSeries.reduce((s, p) => s + p.orders, 0);
  return (
    <ChartFrame
      title={t('analytics.orders.title')}
      description={t('analytics.orders.description')}
      summary={t('analytics.orders.summary', { total })}
      actions={<CsvButton onClick={() => exportTable(sheetToTable(ordersSeriesSheet(a), `funpro-orders-${a.granularity}`), 'csv')} />}
      empty={a.totalOrders === 0 ? t('analytics.empty.period') : undefined}
      table={{
        headers: [t(`analytics.granularity.${a.granularity}`), t('analytics.col.orders'), t('analytics.col.refunded')],
        rows: a.countSeries.map((p) => [bucketLabel(p.key, a.granularity), fmtInt(p.orders, lang), fmtInt(p.refunded, lang)]),
        numeric: [1, 2],
      }}
    >
      <ColumnSeriesChart data={data} seriesName={t('analytics.col.orders')} format={(v) => fmtInt(v, lang)} tickFormat={(v) => fmtCompact(v, lang)} />
    </ChartFrame>
  );
}

export function CategoryChart({ a, level }: { a: SalesAnalytics; level: 'section' | 'game' }) {
  const t = useT();
  const lang = useLang();
  const top = a.byCategory.slice(0, 10);
  const name = (k: string) => k || t('analytics.category.none');
  const data: SeriesDatum[] = top.map((r) => ({ label: name(r.key), value: r.orders, extra: r.refunded ? [t('analytics.tooltip.refundedCount', { count: r.refunded })] : [] }));
  return (
    <ChartFrame
      title={t(`analytics.category.title.${level}`)}
      description={t('analytics.category.description', { shown: top.length, total: a.byCategory.length })}
      summary={top[0] ? t('analytics.category.summary', { name: name(top[0].key), count: top[0].orders }) : t('analytics.empty.period')}
      height={Math.max(160, top.length * 30 + 30)}
      empty={top.length === 0 ? t('analytics.empty.period') : undefined}
      actions={<CsvButton onClick={() => exportTable(sheetToTable(categoriesSheet(a), 'funpro-categories'), 'csv')} />}
      table={{
        headers: [t('analytics.col.category'), t('analytics.col.orders'), t('analytics.col.refunded'), t('analytics.col.revenue')],
        rows: a.byCategory.map((r) => [name(r.key), fmtInt(r.orders, lang), fmtInt(r.refunded, lang), <MoneyList key="m" amounts={r.grossByCurrency} />]),
        numeric: [1, 2, 3],
      }}
    >
      <HBarChart data={data} seriesName={t('analytics.col.orders')} format={(v) => fmtInt(v, lang)} tickFormat={(v) => fmtCompact(v, lang)} />
    </ChartFrame>
  );
}

/** Orders by status as a compact table with proportion bars (status = badge + icon + text). */
export function StatusBreakdown({ a }: { a: SalesAnalytics }) {
  const t = useT();
  const lang = useLang();
  const total = Math.max(1, a.totalOrders);
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface fp-pad">
      <h2 className="text-sm font-semibold text-fg">{t('analytics.status.title')}</h2>
      <p className="mt-0.5 text-xs text-muted">{t(`analytics.status.description.${a.direction}`)}</p>
      <table className="mt-3 w-full text-xs">
        <caption className="sr-only">{t('analytics.status.title')}</caption>
        <thead>
          <tr className="text-left text-muted">
            <th scope="col" className="pb-1 font-medium">
              {t('orders.col.status')}
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              {t('analytics.col.orders')}
            </th>
            <th scope="col" className="w-1/3 pb-1 font-medium">
              <span className="sr-only">{t('analytics.col.share')}</span>
            </th>
            <th scope="col" className="pb-1 text-right font-medium">
              {t('analytics.col.amount')}
            </th>
          </tr>
        </thead>
        <tbody>
          {a.byStatus.map((s) => (
            <tr key={s.status} className="border-t border-border/60">
              <th scope="row" className="py-1.5 text-left font-normal">
                <OrderStatusBadge status={s.status as OrderStatus} direction={a.direction} />
              </th>
              <td className="py-1.5 text-right tabular-nums">{fmtInt(s.orders, lang)}</td>
              <td className="px-2 py-1.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(s.orders / total) * 100}%` }} />
                </div>
              </td>
              <td className="py-1.5 text-right">
                <MoneyList amounts={s.amountByCurrency} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div>
          <dt className="text-muted">{t('analytics.status.refundRate')}</dt>
          <dd className="text-sm font-semibold">{fmtRatio(a.refundRate, lang)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t('analytics.status.cancellationRate')}</dt>
          <dd className="text-sm font-semibold">{fmtRatio(a.cancellationRate, lang)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[11px] text-muted">
        {t('analytics.status.timing', { before: a.cancellation.beforeCompletion, after: a.cancellation.afterCompletion, unknown: a.cancellation.unknownTiming })}
      </p>
    </section>
  );
}

function weekdayNames(lang: Lang): string[] {
  const f = new Intl.DateTimeFormat(localeOf(lang), { weekday: 'short', timeZone: 'UTC' });
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) => f.format(Date.UTC(2024, 0, 1 + i)));
}

export function HeatmapCard({ a }: { a: SalesAnalytics }) {
  const t = useT();
  const lang = useLang();
  const days = useMemo(() => weekdayNames(lang), [lang]);
  let best = { d: 0, h: 0, v: 0 };
  for (let d = 0; d < a.heatmap.length; d++) {
    const row = a.heatmap[d]!;
    for (let h = 0; h < row.length; h++) if (row[h]! > best.v) best = { d, h, v: row[h]! };
  }
  const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
  return (
    <ChartFrame
      title={t('analytics.heatmap.title')}
      description={t('analytics.heatmap.description')}
      summary={best.v > 0 ? t('analytics.heatmap.summary', { day: days[best.d]!, hour: hh(best.h), count: best.v }) : t('analytics.empty.period')}
      height={232}
      empty={a.totalOrders === 0 ? t('analytics.empty.period') : undefined}
      table={{
        headers: [t('analytics.heatmap.weekday'), ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))],
        rows: a.heatmap.map((row, d) => [days[d]!, ...row.map((v) => (v ? String(v) : ''))]),
        numeric: Array.from({ length: 24 }, (_, i) => i + 1),
      }}
    >
      <Heatmap
        data={a.heatmap}
        rowLabels={days}
        formatCell={(d, h, v) => t('analytics.heatmap.cell', { day: days[d]!, from: hh(h), to: hh((h + 1) % 24), count: v })}
        legendLow={t('analytics.heatmap.less')}
        legendHigh={t('analytics.heatmap.more')}
      />
    </ChartFrame>
  );
}
