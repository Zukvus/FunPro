import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  ExternalLink,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { computeSalesAnalytics } from '@/features/analytics/aggregate';
import { DAY_MS, iso, resolveRange, startOfZonedDay } from '@/features/analytics/time';
import { userUrl } from '@/features/orders/model';
import { syncStatusKey, type SyncStatusRecord } from '@/features/orders/status';
import { AGING_BUCKETS, agingSummary, unconfirmedOrders } from '@/features/orders/unconfirmed';
import type { Currency } from '@/shared/models';
import { Button, Card, EmptyState, PageHeader, StatusPill, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { hasTranslation, useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { Amount, fmtDateTime, fmtInt, MoneyList, StatTile } from '@/dashboard/components/charts';
import { useDashboard } from '@/dashboard/context';
import { OrderStatusBadge } from './orders/shared';
import { SyncStatusBar } from './orders/SyncStatus';
import { useMinuteClock } from './orders/UnconfirmedTab';

function moneyValue(amounts: Partial<Record<Currency, number>>, empty: string) {
  return Object.keys(amounts).length ? (
    <MoneyList amounts={amounts} />
  ) : (
    <span className="text-muted">{empty}</span>
  );
}

export default function OverviewPage() {
  const t = useT();
  const lang = useLang();
  const now = useMinuteClock();
  const [settings] = useSettings();
  const { status, refreshStatus } = useDashboard();

  const today = startOfZonedDay(now);
  const weekResolved = resolveRange('7d', now);
  const week = useMemo(
    () => ({ from: weekResolved.from, to: weekResolved.to }),
    [weekResolved.from, weekResolved.to],
  );
  const weekOrders = useLiveQuery(
    () =>
      getDb()
        .orders.where('createdAt')
        .between(iso(week.from - 7 * DAY_MS), iso(week.to), true, false)
        .toArray(),
    [week.from, week.to],
  );
  const paidSales = useLiveQuery(
    () => getDb().orders.where('[direction+status]').equals(['sale', 'paid']).toArray(),
    [],
    [],
  );
  const recent = useLiveQuery(
    () =>
      getDb()
        .orders.orderBy('createdAt')
        .reverse()
        .filter((o) => o.direction === 'sale')
        .limit(8)
        .toArray(),
    [],
    [],
  );
  const counts = useLiveQuery(
    async () => {
      const db = getDb();
      const [sales, listings, salesSync] = await Promise.all([
        db.orders.where('direction').equals('sale').count(),
        db.listings.count(),
        db.kv.get(syncStatusKey('sales')),
      ]);
      return { sales, listings, synced: !!(salesSync?.value as SyncStatusRecord | undefined)?.lastSuccessAt };
    },
    [],
    undefined,
  );

  const todayStats = useMemo(
    () =>
      weekOrders
        ? computeSalesAnalytics(weekOrders, {
            range: { from: today, to: today + DAY_MS },
            granularity: 'day',
          })
        : null,
    [weekOrders, today],
  );
  const weekStats = useMemo(
    () => (weekOrders ? computeSalesAnalytics(weekOrders, { range: week, granularity: 'day' }) : null),
    [weekOrders, week],
  );
  const prevWeekStats = useMemo(
    () =>
      weekOrders
        ? computeSalesAnalytics(weekOrders, {
            range: { from: week.from - 7 * DAY_MS, to: week.from },
            granularity: 'day',
          })
        : null,
    [weekOrders, week],
  );
  const aging = useMemo(
    () =>
      agingSummary(
        unconfirmedOrders(paidSales, { now, minAgeHours: settings.analytics.unconfirmedAfterHours }),
      ),
    [paidSales, now, settings.analytics.unconfirmedAfterHours],
  );

  const gross = (a: typeof weekStats) => {
    const out: Partial<Record<Currency, number>> = {};
    for (const c of a?.currencies ?? []) if (a!.totals[c]!.gross) out[c] = a!.totals[c]!.gross;
    return out;
  };
  const weekOrdersCount = weekStats ? weekStats.totalOrders - weekStats.statusCounts.refunded : 0;
  const prevWeekOrdersCount = prevWeekStats
    ? prevWeekStats.totalOrders - prevWeekStats.statusCounts.refunded
    : 0;

  const session = status?.session ?? null;
  const loggedIn = !!status && status.openTabs > 0 && session?.status === 'logged_in';
  const noData = counts !== undefined && counts.sales === 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('nav.overview')} description={t('overview.description')} />

      {noData && (
        <GettingStarted
          openTabs={status?.openTabs ?? 0}
          loggedIn={loggedIn}
          hasSales={false}
          hasListings={(counts?.listings ?? 0) > 0}
          synced={counts?.synced ?? false}
          userId={session?.userId ?? null}
          onSynced={refreshStatus}
        />
      )}

      <section
        aria-label={t('overview.kpi.label')}
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
      >
        <StatTile
          label={t('overview.kpi.today')}
          value={moneyValue(gross(todayStats), t('overview.kpi.none'))}
          privacy="sensitive"
          hint={t('overview.kpi.ordersN', {
            count: todayStats ? todayStats.totalOrders - todayStats.statusCounts.refunded : 0,
          })}
        />
        <StatTile
          label={t('overview.kpi.week')}
          value={moneyValue(gross(weekStats), t('overview.kpi.none'))}
          privacy="sensitive"
          deltaPct={
            prevWeekOrdersCount > 0 ? (weekOrdersCount - prevWeekOrdersCount) / prevWeekOrdersCount : null
          }
          deltaText={prevWeekOrdersCount > 0 ? undefined : t('analytics.delta.noBase')}
          hint={t('overview.kpi.weekHint', { count: weekOrdersCount })}
        />
        <StatTile
          label={t('overview.kpi.active')}
          value={status ? fmtInt(status.counts.activeSales, lang) : '—'}
          hint={t('overview.kpi.activeHint')}
        />
        <StatTile
          label={t('overview.kpi.unread')}
          value={status ? fmtInt(status.counts.unreadChats, lang) : '—'}
          hint={
            <a href="#/messages" className="text-accent hover:underline">
              {t('overview.kpi.openMessages')}
            </a>
          }
        />
        <StatTile
          label={t('overview.kpi.drafts')}
          value={status ? fmtInt(status.counts.pendingDrafts, lang) : '—'}
          hint={
            <a href="#/messages" className="text-accent hover:underline">
              {t('overview.kpi.review')}
            </a>
          }
        />
        <StatTile
          label={t('overview.kpi.failed')}
          value={
            <span className={cn(status && status.counts.failedTasks > 0 && 'text-danger')}>
              {status ? fmtInt(status.counts.failedTasks, lang) : '—'}
            </span>
          }
          hint={
            <a href="#/logs" className="text-accent hover:underline">
              {t('overview.kpi.openLogs')}
            </a>
          }
        />
      </section>
      <p className="-mt-2 text-[11px] text-muted">{t('overview.kpi.note')}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title={t('overview.automation.title')}
          description={status ? t(`automation.state.${status.automationState}`) : undefined}
          actions={
            <a
              href="#/automation"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {t('overview.automation.manage')} <ArrowRight size={12} aria-hidden />
            </a>
          }
        >
          {!status ? (
            <p className="text-xs text-muted">{t('common.loading')}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {status.statuses.map((s) => (
                <li key={s.feature} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0">
                    <span className="block text-sm text-fg">
                      {hasTranslation(lang, `overview.feature.${s.feature}`)
                        ? t(`overview.feature.${s.feature}`)
                        : s.feature}
                    </span>
                    <span className="block truncate text-[11px] text-muted">{s.reason}</span>
                  </span>
                  <StatusPill status={s.status} reason={s.reason} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title={t('overview.unconfirmed.title')}
          description={t('overview.unconfirmed.description', {
            hours: settings.analytics.unconfirmedAfterHours,
          })}
          actions={
            <a
              href="#/orders?tab=unconfirmed"
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              {t('overview.unconfirmed.open')} <ArrowRight size={12} aria-hidden />
            </a>
          }
        >
          {aging.total === 0 ? (
            <p className="text-xs text-muted">{t('overview.unconfirmed.none')}</p>
          ) : (
            <>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {AGING_BUCKETS.map((b) => (
                  <li
                    key={b}
                    className={cn(
                      'rounded-lg px-3 py-2',
                      b === 'gt7d' && aging.buckets[b].count > 0 ? 'bg-danger/10' : 'bg-surface-2',
                    )}
                  >
                    <p className="text-[11px] text-muted">{t(`orders.aging.${b}`)}</p>
                    <p className="text-lg font-semibold">{aging.buckets[b].count}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-muted">
                {t('overview.unconfirmed.total', { count: aging.total })}{' '}
                <MoneyList amounts={aging.amountByCurrency} />
              </p>
              {aging.buckets.gt7d.count > 0 && (
                <p className="mt-1 flex items-center gap-1 text-xs text-danger">
                  <AlertTriangle size={12} aria-hidden />{' '}
                  {t('overview.unconfirmed.old', { count: aging.buckets.gt7d.count })}
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      <Card
        title={t('overview.recent.title')}
        actions={
          <a
            href="#/orders"
            className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            {t('overview.recent.all')} <ArrowRight size={12} aria-hidden />
          </a>
        }
      >
        {recent.length === 0 ? (
          <EmptyState icon={<ShoppingBag size={20} />} title={t('overview.recent.emptyTitle')}>
            {t('overview.recent.emptyBody')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border/60">
            {recent.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <a href={`#/orders`} className="font-mono text-xs text-muted hover:text-fg fp-sensitive">
                    #{o.id}
                  </a>
                  <span className="truncate" title={o.description}>
                    {o.description || o.categoryName || '—'}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-muted fp-sensitive">{o.counterpartyName}</span>
                  <OrderStatusBadge status={o.status} />
                  <Amount minor={o.price.amountMinor} currency={o.price.currency} />
                  <span className="hidden text-xs text-muted sm:inline">
                    {fmtDateTime(o.createdAt, lang)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('overview.freshness.title')} description={t('overview.freshness.description')}>
        <SyncStatusBar
          areas={['sales', 'purchases', 'finance', 'profile']}
          rpcAreas={['orders', 'finance', 'reviews']}
        />
      </Card>
    </div>
  );
}

function GettingStarted({
  openTabs,
  loggedIn,
  hasSales,
  hasListings,
  synced,
  userId,
  onSynced,
}: {
  openTabs: number;
  loggedIn: boolean;
  hasSales: boolean;
  hasListings: boolean;
  synced: boolean;
  userId: string | null;
  onSynced: () => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const res = await rpc<Record<string, string>>('ui.syncNow', { what: ['orders', 'finance', 'reviews'] });
      const failed = Object.entries(res ?? {}).filter(([, v]) => v !== 'ok');
      if (failed.length) toast.error(failed.map(([k, v]) => `${k}: ${v}`).join('\n'));
      else toast.success(t('orders.sync.done'));
      onSynced();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const profile = userUrl(userId) ?? 'https://funpay.com/';
  const steps: { key: string; done: boolean; action: ReactNode }[] = [
    {
      key: 'open',
      done: openTabs > 0,
      action: (
        <a
          href="https://funpay.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          funpay.com <ExternalLink size={11} aria-hidden />
        </a>
      ),
    },
    { key: 'login', done: loggedIn, action: null },
    {
      key: 'sales',
      done: hasSales,
      action: (
        <a
          href="https://funpay.com/orders/trade"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          {t('overview.start.salesLink')} <ExternalLink size={11} aria-hidden />
        </a>
      ),
    },
    {
      key: 'profile',
      done: hasListings,
      action: (
        <a
          href={profile}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          {t('overview.start.profileLink')} <ExternalLink size={11} aria-hidden />
        </a>
      ),
    },
    {
      key: 'sync',
      done: synced,
      action: (
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw size={12} />}
          loading={busy}
          disabled={!loggedIn}
          onClick={() => void sync()}
        >
          {t('common.syncNow')}
        </Button>
      ),
    },
  ];
  return (
    <Card title={t('overview.start.title')} description={t('overview.start.description')}>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.key} className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-start gap-2 text-sm">
              {s.done ? (
                <CheckCircle2 size={16} className="mt-0.5 text-success" aria-hidden />
              ) : (
                <Circle size={16} className="mt-0.5 text-muted" aria-hidden />
              )}
              <span>
                <span className={cn('font-medium', s.done ? 'text-muted line-through' : 'text-fg')}>
                  {i + 1}. {t(`overview.start.${s.key}`)}
                </span>
                <span className="sr-only">
                  {s.done ? t('overview.start.done') : t('overview.start.todo')}
                </span>
                <span className="block text-xs text-muted">{t(`overview.start.${s.key}Hint`)}</span>
              </span>
            </span>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-[11px] text-muted">{t('overview.start.privacy')}</p>
    </Card>
  );
}
