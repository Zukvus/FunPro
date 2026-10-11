import { useLiveQuery } from 'dexie-react-hooks';
import { Pin, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { computeCustomerStats, groupOrdersByCustomer, updateCustomer, type CustomerStats } from '@/features/crm/customers';
import type { Customer } from '@/shared/models';
import { Badge, Card, DataTable, EmptyState, IconButton, Input, PageHeader, Select, StatCard, type Column } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { CustomerDetail, formatTotals } from './customers/CustomerDetail';
import { ServiceMetricsCard } from './customers/ServiceMetricsCard';
import { fmtDateTime, useHashParams, useLocale } from './messages/shared';

type Filter = 'all' | 'pinned' | 'repeat' | 'followUp';

interface Row {
  c: Customer;
  stats: CustomerStats;
}

/**
 * CRM Lite. Customers come from sales FunPro has seen (order ingestion); notes, tags, pins and
 * follow-ups are private and stored only in this browser. Deep link: #/customers?id=<customerId>.
 */
export default function CustomersPage() {
  const t = useT();
  const locale = useLocale();
  const [params, setParams] = useHashParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const customers = useLiveQuery(() => getDb().customers.toArray(), []);
  const sales = useLiveQuery(() => getDb().orders.where('direction').equals('sale').toArray(), []);
  // Fixed per visit: "due" follow-ups are evaluated when the page opens.
  const [now] = useState(() => Date.now());

  const rows = useMemo<Row[]>(() => {
    const groups = groupOrdersByCustomer(sales ?? []);
    return (customers ?? []).map((c) => ({ c, stats: computeCustomerStats(groups.get(c.id) ?? []) }));
  }, [customers, sales]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter(({ c, stats }) => {
        if (filter === 'pinned' && !c.pinned) return false;
        if (filter === 'repeat' && !stats.repeatBuyer) return false;
        if (filter === 'followUp' && !c.followUpAt) return false;
        if (!q) return true;
        return c.name.toLowerCase().includes(q) || c.tags.some((tag) => tag.toLowerCase().includes(q)) || c.notes.toLowerCase().includes(q);
      })
      .sort((a, b) => Number(b.c.pinned) - Number(a.c.pinned) || (b.stats.lastOrderAt ?? b.c.lastSeenAt).localeCompare(a.stats.lastOrderAt ?? a.c.lastSeenAt));
  }, [rows, query, filter]);

  const counts = useMemo(
    () => ({
      total: rows.length,
      repeat: rows.filter((r) => r.stats.repeatBuyer).length,
      pinned: rows.filter((r) => r.c.pinned).length,
      due: rows.filter((r) => r.c.followUpAt && Date.parse(r.c.followUpAt) <= now).length,
    }),
    [rows, now],
  );

  const selected = params['id'] ? customers?.find((c) => c.id === params['id']) : undefined;

  const columns: Column<Row>[] = [
    {
      key: 'pin',
      header: <span className="sr-only">{t('crm.pinned')}</span>,
      width: '40px',
      render: ({ c }) => (
        <IconButton
          label={c.pinned ? t('crm.unpin') : t('crm.pin')}
          onClick={(e) => {
            e.stopPropagation();
            void updateCustomer(c.id, { pinned: !c.pinned });
          }}
          className={c.pinned ? 'text-accent' : 'opacity-40 hover:opacity-100'}
        >
          <Pin size={14} />
        </IconButton>
      ),
    },
    {
      key: 'name',
      header: t('crm.col.name'),
      width: 'minmax(160px,1.4fr)',
      render: ({ c, stats }) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="fp-sensitive truncate font-medium text-fg">{c.name}</span>
          {stats.repeatBuyer && <Badge tone="success">{t('crm.repeat')}</Badge>}
        </span>
      ),
    },
    {
      key: 'tags',
      header: t('crm.col.tags'),
      width: 'minmax(120px,1fr)',
      render: ({ c }) => (c.tags.length ? <span className="truncate text-xs text-muted">{c.tags.join(', ')}</span> : <span className="text-xs text-muted">—</span>),
    },
    { key: 'orders', header: t('crm.col.orders'), width: '80px', align: 'right', render: ({ stats }) => stats.orderCount },
    { key: 'spent', header: t('crm.col.spent'), width: 'minmax(120px,1fr)', align: 'right', className: 'fp-sensitive', render: ({ stats }) => formatTotals(stats.totalSpent, locale) },
    { key: 'last', header: t('crm.col.lastOrder'), width: '140px', render: ({ c, stats }) => <span className="text-xs text-muted">{fmtDateTime(stats.lastOrderAt ?? c.lastSeenAt, locale)}</span> },
    {
      key: 'follow',
      header: t('crm.col.followUp'),
      width: '140px',
      render: ({ c }) =>
        c.followUpAt ? (
          <Badge tone={Date.parse(c.followUpAt) <= now ? 'warning' : 'info'}>{fmtDateTime(c.followUpAt, locale)}</Badge>
        ) : (
          <span className="text-xs text-muted">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('crm.title')} description={t('crm.description')} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('crm.stat.customers')} value={counts.total} />
        <StatCard label={t('crm.stat.repeat')} value={counts.repeat} hint={counts.total ? t('crm.stat.repeatShare', { pct: Math.round((counts.repeat / counts.total) * 100) }) : undefined} />
        <StatCard label={t('crm.stat.pinned')} value={counts.pinned} />
        <StatCard label={t('crm.stat.due')} value={counts.due} tone={counts.due ? 'warning' : undefined} />
      </div>

      <ServiceMetricsCard />

      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('crm.search')} aria-label={t('crm.search')} className="pl-8" />
          </div>
          <Select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} aria-label={t('crm.filter')} className="w-48">
            <option value="all">{t('crm.filter.all')}</option>
            <option value="pinned">{t('crm.filter.pinned')}</option>
            <option value="repeat">{t('crm.filter.repeat')}</option>
            <option value="followUp">{t('crm.filter.followUp')}</option>
          </Select>
        </div>
        {customers === undefined ? (
          <p className="text-xs text-muted">{t('common.loading')}</p>
        ) : (
          <DataTable
            rows={visible}
            columns={columns}
            rowKey={(r) => r.c.id}
            onRowClick={(r) => setParams({ id: r.c.id })}
            empty={
              <EmptyState icon={<Users size={22} />} title={rows.length ? t('crm.noMatches') : t('crm.emptyTitle')}>
                {rows.length ? t('crm.noMatchesHelp') : t('crm.emptyHelp')}
              </EmptyState>
            }
          />
        )}
        <p className="mt-2 text-[11px] text-muted">{t('crm.localNote')}</p>
      </Card>

      {selected && <CustomerDetail customer={selected} onClose={() => setParams({ id: null })} />}
    </div>
  );
}
