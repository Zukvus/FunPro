import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, FileDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { autoGranularity, bucketLabel, formatZoned, iso, resolveRange } from '@/features/analytics/time';
import { exportTable } from '@/features/export/table';
import { latestBalances, balanceSeries } from '@/features/finance/balances';
import {
  cashFlowSeries,
  FINANCE_KINDS,
  financeBreakdown,
  opState,
  opTime,
} from '@/features/finance/breakdown';
import { financeExport } from '@/features/finance/export';
import { financeKpis } from '@/features/finance/kpis';
import { orderUrl } from '@/features/orders/model';
import type { Currency, FinanceKind, FinanceOperation } from '@/shared/models';
import {
  Badge,
  Button,
  Callout,
  DataTable,
  EmptyState,
  PageHeader,
  Select,
  Switch,
  type Column,
} from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT } from '@/ui/i18n';
import {
  Amount,
  ChartFrame,
  DivergingColumnChart,
  defaultRangeState,
  fmtCompactMajor,
  fmtDateTime,
  fmtInt,
  fmtMoney,
  fmtRatio,
  RangeFilter,
  SignLegend,
  StatTile,
  TimeLineChart,
  type RangeState,
} from '@/dashboard/components/charts';
import { CombinedView, type CombinedMetric } from './finance/CombinedView';
import { SyncStatusBar } from './orders/SyncStatus';
import { useMinuteClock } from './orders/UnconfirmedTab';

const OUTFLOW: ReadonlySet<FinanceKind> = new Set(['expense', 'withdrawal']);

export default function FinancePage() {
  const t = useT();
  const lang = useLang();
  const [settings, update] = useSettings();
  const now = useMinuteClock();
  const [rangeState, setRangeState] = useState<RangeState>(() => defaultRangeState());
  const [kind, setKind] = useState<FinanceKind | ''>('');
  const [currency, setCurrency] = useState<Currency | ''>('');

  const resolved = resolveRange(rangeState.preset, now, rangeState.custom);
  const range = useMemo(() => ({ from: resolved.from, to: resolved.to }), [resolved.from, resolved.to]);
  const granularity = autoGranularity(range);

  const ops = useLiveQuery(() => getDb().financeOps.toArray(), []);
  const balances = useLiveQuery(() => getDb().balances.toArray(), [], []);
  const orders = useLiveQuery(
    () => getDb().orders.where('createdAt').between(iso(range.from), iso(range.to), true, false).toArray(),
    [range.from, range.to],
    [],
  );
  const listings = useLiveQuery(() => getDb().listings.toArray(), [], []);

  const breakdown = useMemo(() => financeBreakdown(ops ?? [], range), [ops, range]);
  const kpis = useMemo(
    () => financeKpis({ orders, ops: ops ?? [], listings, range }),
    [orders, ops, listings, range],
  );
  const flows = useMemo(() => cashFlowSeries(ops ?? [], range, granularity), [ops, range, granularity]);
  const balanceHistory = useMemo(() => balanceSeries(balances, range), [balances, range]);
  const latest = useMemo(() => latestBalances(balances), [balances]);

  const listOps = useMemo(() => {
    const list = (ops ?? []).filter((op) => {
      const ts = opTime(op);
      if (ts === null || ts < range.from || ts >= range.to) return false;
      if (kind && op.kind !== kind) return false;
      if (currency && op.amount.currency !== currency) return false;
      return true;
    });
    return list.sort((a, b) => (opTime(b) ?? 0) - (opTime(a) ?? 0) || b.id.localeCompare(a.id));
  }, [ops, range, kind, currency]);

  const combinedMetrics: CombinedMetric[] = useMemo(() => {
    const pick = (f: (c: Currency) => number | null | undefined) => {
      const out: Partial<Record<Currency, number>> = {};
      for (const c of kpis.currencies) {
        const v = f(c);
        if (typeof v === 'number' && v !== 0) out[c] = v;
      }
      return out;
    };
    const bal: Partial<Record<Currency, number>> = {};
    for (const b of latest) bal[b.currency] = b.amount.amountMinor;
    return [
      { key: 'balance', label: t('finance.kpi.balance'), amounts: bal },
      { key: 'gross', label: t('finance.kpi.gross'), amounts: pick((c) => kpis.byCurrency[c]?.grossRevenue) },
      { key: 'net', label: t('finance.kpi.net'), amounts: pick((c) => kpis.byCurrency[c]?.netReceipts) },
      { key: 'cash', label: t('finance.kpi.cashFlow'), amounts: pick((c) => kpis.byCurrency[c]?.cashFlow) },
    ];
  }, [kpis, latest, t]);

  const columns: Column<FinanceOperation>[] = [
    {
      key: 'at',
      header: t('finance.col.date'),
      width: '8.5rem',
      render: (op) => (
        <span className="text-xs tabular-nums">{op.at ? fmtDateTime(op.at, lang) : op.rawDate}</span>
      ),
    },
    {
      key: 'kind',
      header: t('finance.col.kind'),
      width: '7rem',
      render: (op) => (
        <Badge tone={op.kind === 'income' ? 'success' : OUTFLOW.has(op.kind) ? 'warning' : 'neutral'}>
          {t(`finance.kind.${op.kind}`)}
        </Badge>
      ),
    },
    {
      key: 'desc',
      header: t('finance.col.description'),
      width: 'minmax(10rem,2fr)',
      render: (op) => {
        const url = op.orderId ? orderUrl(op.orderId) : null;
        return (
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate fp-sensitive" title={op.description}>
              {op.description || '—'}
            </span>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('orders.action.openOrderOf', { id: op.orderId! })}
                className="shrink-0 text-muted hover:text-fg"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </span>
        );
      },
    },
    {
      key: 'state',
      header: t('finance.col.state'),
      width: '7rem',
      render: (op) => <span className="text-xs text-muted">{t(`finance.state.${opState(op)}`)}</span>,
    },
    {
      key: 'amount',
      header: t('finance.col.amount'),
      width: '8rem',
      align: 'right',
      render: (op) => (
        <Amount
          minor={op.amount.amountMinor}
          currency={op.amount.currency}
          privacy="balance"
          signed={
            op.kind === 'income' || op.kind === 'deposit' ? '+' : OUTFLOW.has(op.kind) ? '−' : undefined
          }
          className={opState(op) === 'cancelled' ? 'line-through text-muted' : undefined}
        />
      ),
    },
  ];

  const hasData = (ops?.length ?? 0) > 0 || balances.length > 0;

  return (
    <div>
      <PageHeader
        title={t('nav.finance')}
        description={t('finance.page.description')}
        actions={
          <div className="flex items-center gap-3">
            <Switch
              checked={settings.privacy.hideBalances}
              onChange={(v) => void update({ privacy: { hideBalances: v } })}
              label={t('finance.hideBalances')}
            />
          </div>
        }
      />
      <div className="mb-3">
        <SyncStatusBar areas={['finance']} rpcAreas={['finance']} />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RangeFilter value={rangeState} onChange={setRangeState} resolved={range} />
      </div>

      {ops === undefined ? (
        <EmptyState title={t('common.loading')} />
      ) : !hasData ? (
        <EmptyState title={t('finance.empty.title')}>{t('finance.empty.body')}</EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <details className="rounded-xl border border-border bg-surface px-4 py-3 text-xs">
            <summary className="cursor-pointer font-medium text-fg">{t('finance.definitions.title')}</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
              <li>{t('finance.definitions.gross')}</li>
              <li>{t('finance.definitions.net')}</li>
              <li>{t('finance.definitions.cashFlow')}</li>
              <li>{t('finance.definitions.profit')}</li>
              <li>{t('finance.definitions.currencies')}</li>
            </ul>
          </details>

          {latest.length > 0 && (
            <section
              aria-label={t('finance.kpi.balance')}
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
            >
              {latest.map((b) => (
                <StatTile
                  key={b.currency}
                  label={t('finance.kpi.balanceIn', { currency: b.currency })}
                  value={fmtMoney(b.amount.amountMinor, b.currency, lang)}
                  privacy="balance"
                  hint={t('finance.kpi.balanceAt', { at: fmtDateTime(b.at, lang) })}
                />
              ))}
            </section>
          )}

          {kpis.currencies.length === 0 ? (
            <Callout tone="info">{t('finance.empty.period')}</Callout>
          ) : (
            kpis.currencies.map((c) => {
              const k = kpis.byCurrency[c]!;
              return (
                <section
                  key={c}
                  aria-label={t('finance.kpi.groupLabel', { currency: c })}
                  className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                >
                  <StatTile
                    label={t('finance.kpi.grossIn', { currency: c })}
                    value={fmtMoney(k.grossRevenue, c, lang)}
                    privacy="balance"
                    hint={t('finance.kpi.grossHint', { count: k.grossOrders })}
                  />
                  <StatTile
                    label={t('finance.kpi.netIn', { currency: c })}
                    value={fmtMoney(k.netReceipts, c, lang)}
                    privacy="balance"
                    hint={
                      k.observedFee.pct !== null
                        ? t('finance.kpi.observedFee', {
                            pct: fmtRatio(k.observedFee.pct, lang),
                            count: k.observedFee.orders,
                          })
                        : t('finance.kpi.netHint', { count: k.receiptOps })
                    }
                  />
                  <StatTile
                    label={t('finance.kpi.cashFlowIn', { currency: c })}
                    value={fmtMoney(k.cashFlow, c, lang)}
                    privacy="balance"
                    hint={t('finance.kpi.cashFlowHint')}
                  />
                  <StatTile
                    label={t('finance.kpi.profitIn', { currency: c })}
                    value={k.estimatedProfit === null ? '—' : fmtMoney(k.estimatedProfit, c, lang)}
                    privacy="balance"
                    badge={<Badge tone="warning">{t('common.estimate')}</Badge>}
                    hint={
                      k.receiptOps === 0
                        ? t('finance.kpi.profitNoReceipts')
                        : t('finance.kpi.profitHint', { known: k.cogsKnownOps, unknown: k.cogsUnknownOps })
                    }
                  />
                </section>
              );
            })
          )}

          {breakdown.currencies.length > 0 && (
            <section className="rounded-[var(--radius-card)] border border-border bg-surface fp-pad">
              <h2 className="text-sm font-semibold text-fg">{t('finance.breakdown.title')}</h2>
              <p className="mt-0.5 text-xs text-muted">{t('finance.breakdown.description')}</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <caption className="sr-only">{t('finance.breakdown.title')}</caption>
                  <thead>
                    <tr className="text-left text-muted">
                      <th scope="col" className="pb-1 font-medium">
                        {t('finance.col.kind')}
                      </th>
                      {breakdown.currencies.map((c) => (
                        <th key={c} scope="col" className="pb-1 text-right font-medium">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {FINANCE_KINDS.map((k) => (
                      <tr key={k} className="border-t border-border/60">
                        <th scope="row" className="py-1.5 text-left font-normal">
                          {t(`finance.kind.${k}`)}
                        </th>
                        {breakdown.currencies.map((c) => {
                          const rec = breakdown.byCurrency[c]!;
                          return (
                            <td key={c} className="py-1.5 text-right">
                              <Amount minor={rec.amounts[k]} currency={c} privacy="balance" />
                              <span className="block text-[10px] text-muted">
                                {t('finance.breakdown.ops', { count: rec.counts[k] })}
                                {rec.pending[k] > 0 &&
                                  ` · ${t('finance.breakdown.pending', { amount: fmtMoney(rec.pending[k], c, lang) })}`}
                              </span>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr className="border-t-2 border-border font-semibold">
                      <th scope="row" className="py-1.5 text-left">
                        {t('finance.kpi.cashFlow')}
                      </th>
                      {breakdown.currencies.map((c) => (
                        <td key={c} className="py-1.5 text-right">
                          <Amount minor={breakdown.byCurrency[c]!.cashFlow} currency={c} privacy="balance" />
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                {t('finance.breakdown.footnote', {
                  cancelled: breakdown.currencies.reduce(
                    (s, c) => s + breakdown.byCurrency[c]!.cancelledCount,
                    0,
                  ),
                  undated: breakdown.undated,
                })}
              </p>
            </section>
          )}

          <div className={Object.keys(flows).length > 1 ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}>
            {(Object.keys(flows) as Currency[]).map((c) => {
              const series = flows[c]!;
              const net = series.reduce((s, p) => s + p.net, 0);
              return (
                <ChartFrame
                  key={c}
                  title={t('finance.cashFlow.title', { currency: c })}
                  description={
                    <>
                      {t('finance.cashFlow.description')}
                      <SignLegend
                        positive={t('finance.cashFlow.legendIn')}
                        negative={t('finance.cashFlow.legendOut')}
                      />
                    </>
                  }
                  summary={t('finance.cashFlow.summary', { currency: c, net: fmtMoney(net, c, lang) })}
                  privacy="balance"
                  table={{
                    headers: [
                      t(`analytics.granularity.${granularity}`),
                      t('finance.kind.income'),
                      t('finance.kind.expense'),
                      t('finance.kind.withdrawal'),
                      t('finance.cashFlow.net'),
                    ],
                    rows: series.map((p) => [
                      bucketLabel(p.key, granularity),
                      fmtMoney(p.income, c, lang),
                      fmtMoney(p.expense, c, lang),
                      fmtMoney(p.withdrawal, c, lang),
                      fmtMoney(p.net, c, lang),
                    ]),
                    numeric: [1, 2, 3, 4],
                  }}
                >
                  <DivergingColumnChart
                    data={series.map((p) => ({
                      label: bucketLabel(p.key, granularity),
                      value: p.net,
                      extra: [
                        `${t('finance.kind.income')}: ${fmtMoney(p.income, c, lang)}`,
                        `${t('finance.cashFlow.outflow')}: ${fmtMoney(p.expense + p.withdrawal, c, lang)}`,
                      ],
                    }))}
                    seriesName={t('finance.cashFlow.net')}
                    format={(v) => fmtMoney(v, c, lang)}
                    tickFormat={(v) => fmtCompactMajor(v, lang)}
                  />
                </ChartFrame>
              );
            })}
          </div>

          <div
            className={Object.keys(balanceHistory).length > 1 ? 'grid gap-4 lg:grid-cols-2' : 'grid gap-4'}
          >
            {(Object.keys(balanceHistory) as Currency[]).map((c) => {
              const points = balanceHistory[c]!;
              return (
                <ChartFrame
                  key={c}
                  title={t('finance.balance.title', { currency: c })}
                  description={t('finance.balance.description')}
                  summary={t('finance.balance.summary', { currency: c, count: points.length })}
                  privacy="balance"
                  empty={points.length < 2 ? t('finance.balance.tooFew') : undefined}
                  table={{
                    headers: [t('finance.col.date'), t('finance.balance.amount')],
                    rows: points.map((p) => [fmtDateTime(p.at, lang), fmtMoney(p.amount, c, lang)]),
                    numeric: [1],
                  }}
                >
                  <TimeLineChart
                    data={points.map((p) => ({ at: p.at, value: p.amount }))}
                    seriesName={c}
                    format={(v) => fmtMoney(v, c, lang)}
                    tickFormat={(v) => fmtCompactMajor(v, lang)}
                    dateFormat={(ts) => formatZoned(ts, undefined, false).slice(0, 5)}
                  />
                </ChartFrame>
              );
            })}
          </div>

          <section className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-fg">{t('finance.ops.title')}</h2>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as FinanceKind | '')}
                  aria-label={t('finance.col.kind')}
                  className="w-auto"
                >
                  <option value="">{t('finance.ops.allKinds')}</option>
                  {FINANCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`finance.kind.${k}`)}
                    </option>
                  ))}
                </Select>
                <Select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as Currency | '')}
                  aria-label={t('orders.filter.currency')}
                  className="w-auto"
                >
                  <option value="">{t('orders.filter.allCurrencies')}</option>
                  {breakdown.currencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <span className="flex items-center gap-1 text-xs text-muted">
                  <FileDown size={14} aria-hidden />
                  {(['csv', 'xlsx', 'json'] as const).map((f) => (
                    <Button
                      key={f}
                      size="sm"
                      variant="ghost"
                      disabled={listOps.length === 0}
                      onClick={() => exportTable(financeExport(listOps), f)}
                    >
                      {f.toUpperCase()}
                    </Button>
                  ))}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted">
              {t('finance.ops.count', { count: fmtInt(listOps.length, lang) })}
            </p>
            <DataTable
              rows={listOps}
              columns={columns}
              rowKey={(op) => op.id}
              height={420}
              empty={<EmptyState title={t('finance.ops.empty')} />}
            />
          </section>

          <CombinedView metrics={combinedMetrics} />
        </div>
      )}
    </div>
  );
}
