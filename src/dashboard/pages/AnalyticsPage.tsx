import { CircleSlash, FileSpreadsheet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { analyticsReportSheets } from '@/features/analytics/report';
import { autoGranularity, formatZoned, previousRange, resolveRange, type Granularity } from '@/features/analytics/time';
import { downloadBlob, MIME, timestampedName } from '@/features/export/download';
import { writeXlsx } from '@/features/export/xlsx';
import { AGING_BUCKETS } from '@/features/orders/unconfirmed';
import type { OrderDirection } from '@/shared/models';
import { Badge, Button, Callout, Card, EmptyState, PageHeader, Select } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { defaultRangeState, fmtInt, fmtMoney, fmtPp, fmtRatio, MoneyList, RangeFilter, StatTile, type RangeState } from '@/dashboard/components/charts';
import { CategoryChart, HeatmapCard, OrdersCountChart, RevenueCharts, StatusBreakdown } from './analytics/Charts';
import { ProductsCard } from './analytics/ProductsCard';
import { ProfitCard } from './analytics/ProfitCard';
import { useAnalyticsData } from './analytics/useAnalyticsData';
import { useMinuteClock } from './orders/UnconfirmedTab';

export default function AnalyticsPage() {
  const t = useT();
  const lang = useLang();
  const [settings] = useSettings();
  const now = useMinuteClock();
  const [rangeState, setRangeState] = useState<RangeState>(() => defaultRangeState());
  const [direction, setDirection] = useState<OrderDirection>('sale');
  const [granularityChoice, setGranularityChoice] = useState<Granularity | 'auto'>('auto');
  const [categoryLevel, setCategoryLevel] = useState<'section' | 'game'>('section');

  // Ranges are recomputed once a minute at most, so "today" rolls over without reloading the page.
  const resolved = resolveRange(rangeState.preset, now, rangeState.custom);
  const range = useMemo(() => ({ from: resolved.from, to: resolved.to }), [resolved.from, resolved.to]);
  const prevResolved = previousRange(range, rangeState.preset);
  const prev = useMemo(() => ({ from: prevResolved.from, to: prevResolved.to }), [prevResolved.from, prevResolved.to]);
  const granularity = granularityChoice === 'auto' ? autoGranularity(range) : granularityChoice;

  const data = useAnalyticsData({
    range,
    prev,
    direction,
    granularity,
    categoryLevel,
    fees: settings.fees,
    unconfirmedAfterHours: settings.analytics.unconfirmedAfterHours,
    now,
  });
  const a = data.current;
  const cmp = data.comparison;

  const exportReport = () => {
    if (!a) return;
    const bytes = writeXlsx(analyticsReportSheets({ analytics: a, comparison: cmp, products: data.products, profit: data.profit }));
    downloadBlob(bytes.slice().buffer, timestampedName(`funpro-analytics-${direction === 'sale' ? 'sales' : 'purchases'}`, 'xlsx'), MIME.xlsx);
  };

  const periodText = `${formatZoned(range.from, undefined, false)} – ${formatZoned(range.to - 1, undefined, false)}`;
  const prevText = `${formatZoned(prev.from, undefined, false)} – ${formatZoned(prev.to - 1, undefined, false)}`;

  return (
    <div>
      <PageHeader
        title={t('nav.analytics')}
        description={t('analytics.page.description')}
        actions={
          <Button variant="outline" size="sm" icon={<FileSpreadsheet size={14} />} disabled={!a || a.totalOrders === 0} onClick={exportReport}>
            {t('analytics.export.report')}
          </Button>
        }
      />

      {/* One filter row scoping everything below it. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangeFilter value={rangeState} onChange={setRangeState} resolved={range} />
        <div className="inline-flex gap-1 rounded-lg bg-surface-2 p-1" role="radiogroup" aria-label={t('analytics.direction.label')}>
          {(['sale', 'purchase'] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={direction === d} onClick={() => setDirection(d)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', direction === d ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
              {t(`analytics.direction.${d}`)}
            </button>
          ))}
        </div>
        <Select value={granularityChoice} onChange={(e) => setGranularityChoice(e.target.value as Granularity | 'auto')} aria-label={t('analytics.granularity.label')} className="w-auto">
          <option value="auto">{t('analytics.granularity.auto', { value: t(`analytics.granularity.${autoGranularity(range)}`) })}</option>
          <option value="day">{t('analytics.granularity.day')}</option>
          <option value="week">{t('analytics.granularity.week')}</option>
          <option value="month">{t('analytics.granularity.month')}</option>
        </Select>
        <Select value={categoryLevel} onChange={(e) => setCategoryLevel(e.target.value as 'section' | 'game')} aria-label={t('analytics.category.level')} className="w-auto">
          <option value="section">{t('analytics.category.bySection')}</option>
          <option value="game">{t('analytics.category.byGame')}</option>
        </Select>
      </div>
      <p className="-mt-2 mb-4 text-xs text-muted">
        {t('analytics.period', { period: periodText, previous: prevText })}
        {data.undatedStored > 0 && <> · {t('analytics.undated', { count: data.undatedStored })}</>}
      </p>

      {data.loading || !a ? (
        <EmptyState title={t('common.loading')} />
      ) : data.totalStored === 0 ? (
        <EmptyState title={t('analytics.empty.noDataTitle')}>{t('analytics.empty.noDataBody')}</EmptyState>
      ) : (
        <div className={cn('flex flex-col gap-4')}>
          <section aria-label={t('analytics.kpi.label')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label={t(`analytics.kpi.orders.${direction}`)} value={fmtInt(a.totalOrders - a.statusCounts.refunded, lang)} deltaPct={cmp?.orders.pct ?? null} hint={t('analytics.kpi.ordersHint', { all: a.totalOrders })} />
            {a.currencies.slice(0, 4).map((c) => {
              const tt = a.totals[c]!;
              return (
                <StatTile
                  key={c}
                  label={t(`analytics.kpi.gross.${direction}`, { currency: c === 'UNKNOWN' ? t('orders.currency.unknown') : c })}
                  value={fmtMoney(tt.gross, c, lang)}
                  privacy="sensitive"
                  deltaPct={cmp?.gross[c]?.pct ?? null}
                  goodWhenUp={direction === 'sale'}
                  hint={tt.aov !== null ? t('analytics.kpi.aov', { value: fmtMoney(tt.aov, c, lang) }) : undefined}
                />
              );
            })}
            <StatTile
              label={t('analytics.kpi.refundRate')}
              value={fmtRatio(a.refundRate, lang)}
              deltaPct={cmp?.refundRate.diff === null || cmp?.refundRate.diff === undefined ? null : cmp.refundRate.diff}
              deltaText={cmp && cmp.refundRate.diff !== null ? fmtPp(cmp.refundRate.diff, lang, t('analytics.pp')) : undefined}
              goodWhenUp={false}
              hint={t('analytics.kpi.refundHint', { count: a.statusCounts.refunded })}
            />
          </section>
          {a.currencies.length > 4 && <Callout tone="info">{t('analytics.kpi.moreCurrencies')}</Callout>}

          <RevenueCharts a={a} />
          <div className="grid gap-4 lg:grid-cols-2">
            <OrdersCountChart a={a} />
            <StatusBreakdown a={a} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <CategoryChart a={a} level={categoryLevel} />
            <HeatmapCard a={a} />
          </div>
          <ProductsCard rows={data.products} unsold={data.unsold} direction={direction} />
          {direction === 'sale' && <ProfitCard rows={data.profit} totals={data.profitTotals} />}

          <div className="grid gap-4 lg:grid-cols-2">
            {direction === 'sale' && data.aging && (
              <Card
                title={t('analytics.aging.title')}
                description={t('analytics.aging.description', { hours: settings.analytics.unconfirmedAfterHours })}
                actions={
                  <a href="#/orders?tab=unconfirmed" className="text-xs font-medium text-accent hover:underline">
                    {t('analytics.aging.open')}
                  </a>
                }
              >
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {AGING_BUCKETS.map((b) => (
                    <li key={b} className="rounded-lg bg-surface-2 px-3 py-2">
                      <p className="text-[11px] text-muted">{t(`orders.aging.${b}`)}</p>
                      <p className="text-lg font-semibold">{data.aging!.buckets[b].count}</p>
                      <p className="text-[11px] text-muted">
                        <MoneyList amounts={data.aging!.buckets[b].amountByCurrency} />
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card
              title={
                <span className="flex items-center gap-2">
                  {t('analytics.conversion.title')} <Badge tone="neutral">{t('analytics.conversion.unavailable')}</Badge>
                </span>
              }
            >
              <p className="flex items-start gap-2 text-xs text-muted">
                <CircleSlash size={14} className="mt-0.5 shrink-0" aria-hidden />
                {t('analytics.conversion.body')}
              </p>
            </Card>
          </div>
          <p className="text-[11px] text-muted">{t('analytics.footnote')}</p>
        </div>
      )}
    </div>
  );
}
