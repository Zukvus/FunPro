import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, ExternalLink, FileDown, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { exportTable, type ExportFormat } from '@/features/export/table';
import { rangeFromDayInputs } from '@/features/analytics/time';
import { ordersExport } from '@/features/orders/export';
import { orderTime, orderUrl } from '@/features/orders/model';
import {
  distinctCategories,
  distinctCurrencies,
  filterOrders,
  totalsOf,
  type OrderFilter,
} from '@/features/orders/query';
import type { Currency, Order, OrderDirection, OrderStatus } from '@/shared/models';
import { Button, DataTable, EmptyState, IconButton, Input, Select, type Column } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { Amount, fmtDateTime, fmtInt, MoneyList } from '@/dashboard/components/charts';
import { OrderStatusBadge, useCopy } from './shared';
import { PurchaseStats } from './PurchaseStats';

const STATUSES: OrderStatus[] = ['paid', 'closed', 'refunded'];

interface UiFilter {
  statuses: OrderStatus[];
  category: string;
  currency: string;
  from: string;
  to: string;
  text: string;
}

const EMPTY: UiFilter = { statuses: [], category: '', currency: '', from: '', to: '', text: '' };

export function toOrderFilter(direction: OrderDirection, f: UiFilter): OrderFilter {
  const range = f.from || f.to ? rangeFromDayInputs(f.from || '1970-01-01', f.to || '2999-12-31') : null;
  return {
    direction,
    statuses: f.statuses,
    category: f.category || null,
    currency: (f.currency || null) as Currency | null,
    range,
    text: f.text,
  };
}

export function OrdersTab({ direction, onOpen }: { direction: OrderDirection; onOpen: (o: Order) => void }) {
  const t = useT();
  const lang = useLang();
  const copy = useCopy();
  const orders = useLiveQuery(
    () => getDb().orders.where('direction').equals(direction).toArray(),
    [direction],
  );
  const [ui, setUi] = useState<UiFilter>(EMPTY);
  const filter = useMemo(() => toOrderFilter(direction, ui), [direction, ui]);
  const filtered = useMemo(() => (orders ? filterOrders(orders, filter) : []), [orders, filter]);
  const totals = useMemo(() => totalsOf(filtered), [filtered]);
  const categories = useMemo(
    () => (orders ? distinctCategories(orders, direction) : []),
    [orders, direction],
  );
  const currencies = useMemo(
    () => (orders ? distinctCurrencies(orders, direction) : []),
    [orders, direction],
  );
  const isSale = direction === 'sale';
  const hasFilter = JSON.stringify(ui) !== JSON.stringify(EMPTY);

  const doExport = (format: ExportFormat) => exportTable(ordersExport(filtered, direction), format);

  const columns: Column<Order>[] = [
    {
      key: 'date',
      header: t('orders.col.date'),
      width: '8.5rem',
      render: (o) => {
        const ot = orderTime(o);
        return (
          <span
            className={cn('text-xs tabular-nums', ot.approximate && 'text-muted')}
            title={ot.approximate ? t('orders.col.dateApprox') : o.rawDate}
          >
            {ot.approximate ? '≈ ' : ''}
            {fmtDateTime(ot.ts, lang)}
          </span>
        );
      },
    },
    {
      key: 'id',
      header: t('orders.col.order'),
      width: '8.5rem',
      render: (o) => (
        <span className="inline-flex items-center gap-0.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(o);
            }}
            aria-label={t('orders.action.detailsOf', { id: o.id })}
            className="rounded font-mono text-xs text-fg hover:underline fp-sensitive"
          >
            #{o.id}
          </button>
          <IconButton
            label={t('orders.action.copyIdOf', { id: o.id })}
            className="h-6 w-6"
            onClick={(e) => {
              e.stopPropagation();
              void copy(o.id, t('orders.copy.idCopied', { id: o.id }));
            }}
          >
            <Copy size={12} />
          </IconButton>
        </span>
      ),
    },
    {
      key: 'counterparty',
      header: isSale ? t('orders.col.buyer') : t('orders.col.seller'),
      width: 'minmax(6rem,0.7fr)',
      render: (o) => <span className="fp-sensitive">{o.counterpartyName || '—'}</span>,
    },
    {
      key: 'desc',
      header: t('orders.col.description'),
      width: 'minmax(10rem,2fr)',
      render: (o) => (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate" title={o.description}>
            {o.description || '—'}
          </span>
          <span className="truncate text-[11px] text-muted">{o.categoryName}</span>
        </span>
      ),
    },
    {
      key: 'status',
      header: t('orders.col.status'),
      width: '7.5rem',
      render: (o) => <OrderStatusBadge status={o.status} direction={direction} />,
    },
    {
      key: 'amount',
      header: t('orders.col.amount'),
      width: '7.5rem',
      align: 'right',
      render: (o) => <Amount minor={o.price.amountMinor} currency={o.price.currency} />,
    },
    {
      key: 'link',
      header: <span className="sr-only">{t('orders.action.openOrder')}</span>,
      width: '2.25rem',
      render: (o) => {
        const url = orderUrl(o.id);
        return url ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            aria-label={t('orders.action.openOrderOf', { id: o.id })}
            title={t('orders.action.openOrder')}
            className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-surface-2 hover:text-fg"
          >
            <ExternalLink size={13} />
          </a>
        ) : null;
      },
    },
  ];

  const toggleStatus = (s: OrderStatus) =>
    setUi((u) => ({
      ...u,
      statuses: u.statuses.includes(s) ? u.statuses.filter((x) => x !== s) : [...u.statuses, s],
    }));

  return (
    <div className="flex flex-col gap-3">
      {!isSale && orders && orders.length > 0 && <PurchaseStats orders={filtered} />}

      <div className="flex flex-wrap items-end gap-2" role="search" aria-label={t('orders.filter.label')}>
        <div className="relative w-full sm:w-64">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-2.5 text-muted"
            aria-hidden
          />
          <Input
            value={ui.text}
            onChange={(e) => setUi({ ...ui, text: e.target.value })}
            placeholder={isSale ? t('orders.filter.searchSales') : t('orders.filter.searchPurchases')}
            aria-label={t('orders.filter.search')}
            className="pl-8"
          />
        </div>
        <div
          className="inline-flex gap-1 rounded-lg bg-surface-2 p-1"
          role="group"
          aria-label={t('orders.filter.status')}
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={ui.statuses.includes(s)}
              onClick={() => toggleStatus(s)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium',
                ui.statuses.includes(s) ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {t(`orders.status.${s}`)}
            </button>
          ))}
        </div>
        <Select
          value={ui.category}
          onChange={(e) => setUi({ ...ui, category: e.target.value })}
          aria-label={t('orders.filter.category')}
          className="w-auto max-w-[14rem]"
        >
          <option value="">{t('orders.filter.allCategories')}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Select
          value={ui.currency}
          onChange={(e) => setUi({ ...ui, currency: e.target.value })}
          aria-label={t('orders.filter.currency')}
          className="w-auto"
        >
          <option value="">{t('orders.filter.allCurrencies')}</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c === 'UNKNOWN' ? t('orders.currency.unknown') : c}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('orders.filter.from')}
          <input
            type="date"
            value={ui.from}
            onChange={(e) => setUi({ ...ui, from: e.target.value })}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
          />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted">
          {t('orders.filter.to')}
          <input
            type="date"
            value={ui.to}
            onChange={(e) => setUi({ ...ui, to: e.target.value })}
            className="h-9 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
          />
        </label>
        {hasFilter && (
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => setUi(EMPTY)}>
            {t('orders.filter.reset')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span aria-live="polite">
          {t('orders.totals.count', { count: fmtInt(totals.count, lang) })} ·{' '}
          <MoneyList amounts={totals.amountByCurrency} />
          {totals.byStatus.refunded > 0 && (
            <>
              {' · '}
              {t('orders.totals.refunded', { count: totals.byStatus.refunded })}{' '}
              <MoneyList amounts={totals.refundedByCurrency} />
            </>
          )}
        </span>
        <span className="flex items-center gap-1">
          <FileDown size={14} aria-hidden />
          {t('orders.export.filtered')}
          {(['csv', 'xlsx', 'json'] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant="ghost"
              disabled={filtered.length === 0}
              onClick={() => doExport(f)}
            >
              {f.toUpperCase()}
            </Button>
          ))}
        </span>
      </div>

      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(o) => o.id}
        rowHeight={52}
        height={560}
        onRowClick={onOpen}
        empty={
          <EmptyState
            title={
              orders === undefined
                ? t('common.loading')
                : orders.length === 0
                  ? t(`orders.empty.${direction}.title`)
                  : t('orders.empty.filtered')
            }
          >
            {orders !== undefined && orders.length === 0 ? t(`orders.empty.${direction}.body`) : null}
          </EmptyState>
        }
      />
    </div>
  );
}
