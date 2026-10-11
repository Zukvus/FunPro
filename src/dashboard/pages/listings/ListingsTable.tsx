import {
  ArrowDown,
  ArrowUp,
  Columns3,
  Copy,
  Eye,
  Languages,
  Package,
  Pencil,
  Power,
  PowerOff,
  RefreshCw,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { listingEconomics, parsePriceInput, formatPriceField } from '@/features/listings/commission';
import {
  EMPTY_FILTER,
  filterListings,
  isFilterActive,
  listingCategories,
  listingCurrencies,
  sortListings,
  type ListingFilter,
  type ListingSortKey,
  type SortDir,
} from '@/features/listings/filters';
import { canCompare } from '@/features/listings/compare';
import { listingsToCsv, listingsToJson, listingsToXlsx } from '@/features/listings/import-export';
import { downloadBlob, MIME, timestampedName } from '@/features/export/download';
import type { Listing } from '@/shared/models';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Select,
  toast,
  type Column,
} from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { EstimateMark, errorText, truncate, useFormat, usePageApi } from './shared';

type Economics = ReturnType<typeof listingEconomics>;

export function ListingsTable({ listings }: { listings: Listing[] }) {
  const t = useT();
  const fmt = useFormat();
  const api = usePageApi();
  const [settings] = useSettings();
  const [filter, setFilter] = useState<ListingFilter>(EMPTY_FILTER);
  const [sortKey, setSortKey] = useState<ListingSortKey>('order');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [syncing, setSyncing] = useState(false);

  const economics = useMemo(() => {
    const m = new Map<string, Economics>();
    for (const l of listings) m.set(l.id, listingEconomics(l, settings.fees));
    return m;
  }, [listings, settings.fees]);
  const categories = useMemo(() => listingCategories(listings), [listings]);
  const currencies = useMemo(() => listingCurrencies(listings), [listings]);
  const rows = useMemo(
    () => sortListings(filterListings(listings, filter), sortKey, sortDir, economics),
    [listings, filter, sortKey, sortDir, economics],
  );

  // Drop selections of listings that disappeared (e.g. deleted).
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(listings.map((l) => l.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [listings]);

  const selectedListings = useMemo(() => listings.filter((l) => selected.has(l.id)), [listings, selected]);

  const sortBy = (key: ListingSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'title' || key === 'category' || key === 'order' ? 'asc' : 'desc');
    }
  };

  const header = (key: ListingSortKey, label: string) => (
    <button
      type="button"
      className="inline-flex items-center gap-1 uppercase hover:text-fg"
      onClick={() => sortBy(key)}
      aria-label={t('listings.table.sortBy', { column: label })}
    >
      {label}
      {sortKey === key &&
        (sortDir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
    </button>
  );

  const privacy = settings.privacy.privacyMode || settings.privacy.hideBalances;

  const columns: Column<Listing>[] = [
    {
      key: 'title',
      header: header('title', t('listings.col.title')),
      width: 'minmax(0,2.4fr)',
      render: (l) => (
        <span className="flex min-w-0 items-center gap-1.5">
          {l.autoDelivery && (
            <Zap size={12} className="shrink-0 text-accent" aria-label={t('listings.autoDelivery')} />
          )}
          <span className="truncate" title={l.title}>
            {l.title || `#${l.id}`}
          </span>
          {l.promoted && (
            <Badge tone="accent" className="shrink-0">
              {t('listings.promo')}
            </Badge>
          )}
          {l.titleEn && (
            <Badge className="shrink-0" title={l.titleEn}>
              EN
            </Badge>
          )}
        </span>
      ),
    },
    {
      key: 'category',
      header: header('category', t('listings.col.category')),
      width: 'minmax(0,1.2fr)',
      render: (l) => (
        <span className="truncate text-xs text-muted" title={l.categoryName}>
          {l.categoryName || '—'}
        </span>
      ),
    },
    {
      key: 'price',
      header: header('price', t('listings.col.price')),
      width: '104px',
      align: 'right',
      render: (l) => fmt.money(l.price.amountMinor, l.price.currency),
    },
    {
      key: 'net',
      header: header('net', t('listings.col.net')),
      width: '128px',
      align: 'right',
      render: (l) => {
        const e = economics.get(l.id);
        if (!e || e.netMinor === null)
          return (
            <span className="text-xs text-muted" title={t('listings.net.unknownHint')}>
              —
            </span>
          );
        return (
          <span title={t('listings.net.pctHint', { pct: fmt.pct(e.commission!.pct) })}>
            {fmt.money(e.netMinor, l.price.currency)}
            <EstimateMark estimate={e.estimate} />
          </span>
        );
      },
    },
    {
      key: 'cost',
      header: t('listings.col.cost'),
      width: '112px',
      align: 'right',
      render: (l) => <CostCell listing={l} />,
    },
    {
      key: 'profit',
      header: header('profit', t('listings.col.profit')),
      width: '104px',
      align: 'right',
      className: privacy ? 'fp-sensitive' : undefined,
      render: (l) => {
        const p = economics.get(l.id)?.profitMinor;
        if (p === null || p === undefined) return <span className="text-xs text-muted">—</span>;
        return (
          <span className={cn(p < 0 ? 'text-danger' : 'text-success')}>{fmt.money(p, l.price.currency)}</span>
        );
      },
    },
    {
      key: 'stock',
      header: header('stock', t('listings.col.stock')),
      width: '68px',
      align: 'right',
      render: (l) => (l.amount === null ? '∞' : fmt.num(l.amount)),
    },
    {
      key: 'active',
      header: t('listings.col.status'),
      width: '92px',
      render: (l) => (
        <Badge tone={l.active ? 'success' : 'neutral'}>
          {l.active ? t('listings.active') : t('listings.inactive')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: <span className="sr-only">{t('listings.col.actions')}</span>,
      width: '72px',
      render: (l) => (
        <span className="flex justify-end">
          <IconButton
            label={t('listings.clone.open')}
            onClick={(e) => {
              e.stopPropagation();
              api.openClone(l);
            }}
          >
            <Copy size={14} />
          </IconButton>
          <IconButton
            label={t('listings.details')}
            onClick={(e) => {
              e.stopPropagation();
              api.openDetail(l);
            }}
          >
            <Eye size={14} />
          </IconButton>
        </span>
      ),
    },
  ];

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await rpc<Record<string, string>>('ui.syncNow', { what: ['listings'] });
      if (res['listings'] && res['listings'] !== 'ok') toast.error(res['listings']);
      else toast.success(t('listings.sync.done'));
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setSyncing(false);
    }
  };

  const exportSelected = (format: 'json' | 'xlsx' | 'csv') => {
    const name = timestampedName('funpro-listings-selected', format);
    if (format === 'json') downloadBlob(listingsToJson(selectedListings), name, MIME.json);
    else if (format === 'csv') downloadBlob(listingsToCsv(selectedListings), name, MIME.csv);
    else downloadBlob(listingsToXlsx(selectedListings).slice().buffer, name, MIME.xlsx);
  };

  if (listings.length === 0) {
    return (
      <EmptyState
        icon={<Package size={28} aria-hidden />}
        title={t('listings.empty.title')}
        action={
          <Button
            size="sm"
            variant="primary"
            icon={<RefreshCw size={14} aria-hidden />}
            loading={syncing}
            onClick={() => void sync()}
          >
            {t('common.syncNow')}
          </Button>
        }
      >
        <p>{t('listings.empty.body')}</p>
        <p className="mt-1">{t('listings.empty.body2')}</p>
      </EmptyState>
    );
  }

  return (
    <div>
      <FilterBar
        filter={filter}
        onChange={setFilter}
        categories={categories.map((c) => c.name)}
        currencies={currencies}
      />
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span aria-live="polite">
          {t('listings.table.count', { shown: fmt.num(rows.length), total: fmt.num(listings.length) })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCw size={14} aria-hidden />}
          loading={syncing}
          onClick={() => void sync()}
        >
          {t('listings.sync')}
        </Button>
      </div>

      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label={t('listings.bulk.toolbar')}
          className="sticky top-14 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2"
        >
          <span className="text-sm font-medium text-fg">
            {t('listings.bulk.selected', { count: selected.size })}
          </span>
          <Button
            size="sm"
            icon={<Power size={14} aria-hidden />}
            onClick={() => api.openBulk('enable', selectedListings)}
          >
            {t('listings.bulk.enable')}
          </Button>
          <Button
            size="sm"
            icon={<PowerOff size={14} aria-hidden />}
            onClick={() => api.openBulk('disable', selectedListings)}
          >
            {t('listings.bulk.disable')}
          </Button>
          <Button
            size="sm"
            icon={<Pencil size={14} aria-hidden />}
            onClick={() => api.openBulk('adjust_pct', selectedListings)}
          >
            {t('listings.bulk.price')}
          </Button>
          <Button
            size="sm"
            icon={<Package size={14} aria-hidden />}
            onClick={() => api.openBulk('set_stock', selectedListings)}
          >
            {t('listings.bulk.stock')}
          </Button>
          <Button
            size="sm"
            icon={<Columns3 size={14} aria-hidden />}
            disabled={!canCompare(selected.size)}
            title={t('listings.bulk.compareHint')}
            onClick={() => api.openCompare(selectedListings)}
          >
            {t('listings.bulk.compare')}
          </Button>
          <Button
            size="sm"
            icon={<Languages size={14} aria-hidden />}
            onClick={() => api.openFillEnglish(selectedListings)}
          >
            {t('listings.bulk.fillEn')}
          </Button>
          <Button
            size="sm"
            variant="danger"
            icon={<Trash2 size={14} aria-hidden />}
            onClick={() => api.openBulk('delete', selectedListings)}
          >
            {t('listings.bulk.delete')}
          </Button>
          <Select
            aria-label={t('listings.bulk.export')}
            className="h-8 w-auto text-xs"
            value=""
            onChange={(e) => e.target.value && exportSelected(e.target.value as 'json' | 'xlsx' | 'csv')}
          >
            <option value="">{t('listings.bulk.export')}…</option>
            <option value="xlsx">XLSX</option>
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
          <IconButton label={t('listings.bulk.clear')} onClick={() => setSelected(new Set())}>
            <X size={14} />
          </IconButton>
        </div>
      )}

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(l) => l.id}
        height={620}
        selected={selected}
        onToggle={(id) =>
          setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })
        }
        onToggleAll={(checked) => setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set())}
        onRowClick={(l) => api.openDetail(l)}
        empty={
          <EmptyState
            title={t('listings.table.noMatch')}
            action={
              <Button size="sm" onClick={() => setFilter(EMPTY_FILTER)}>
                {t('listings.filter.clear')}
              </Button>
            }
          >
            {t('listings.table.noMatchBody')}
          </EmptyState>
        }
      />
    </div>
  );
}

function FilterBar({
  filter,
  onChange,
  categories,
  currencies,
}: {
  filter: ListingFilter;
  onChange: (f: ListingFilter) => void;
  categories: string[];
  currencies: string[];
}) {
  const t = useT();
  const [minText, setMinText] = useState('');
  const [maxText, setMaxText] = useState('');
  const set = (patch: Partial<ListingFilter>) => onChange({ ...filter, ...patch });
  useEffect(() => {
    if (filter.priceMinMinor === null) setMinText('');
    if (filter.priceMaxMinor === null) setMaxText('');
  }, [filter.priceMinMinor, filter.priceMaxMinor]);
  return (
    <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8" role="search">
      <Input
        className="sm:col-span-2"
        type="search"
        placeholder={t('listings.filter.search')}
        aria-label={t('listings.filter.search')}
        value={filter.query}
        onChange={(e) => set({ query: e.target.value })}
      />
      <Select
        aria-label={t('listings.filter.category')}
        value={filter.category === null ? '' : `c:${filter.category}`}
        onChange={(e) => set({ category: e.target.value === '' ? null : e.target.value.slice(2) })}
      >
        <option value="">{t('listings.filter.allCategories')}</option>
        {categories.map((c) => (
          <option key={c} value={`c:${c}`}>
            {c || t('listings.filter.noCategory')}
          </option>
        ))}
      </Select>
      <Select
        aria-label={t('listings.filter.status')}
        value={filter.status}
        onChange={(e) => set({ status: e.target.value as ListingFilter['status'] })}
      >
        <option value="all">{t('listings.filter.anyStatus')}</option>
        <option value="active">{t('listings.active')}</option>
        <option value="inactive">{t('listings.inactive')}</option>
      </Select>
      <Select
        aria-label={t('listings.filter.promoted')}
        value={filter.promoted}
        onChange={(e) => set({ promoted: e.target.value as ListingFilter['promoted'] })}
      >
        <option value="all">
          {t('listings.filter.promoted')}: {t('common.all')}
        </option>
        <option value="yes">
          {t('listings.filter.promoted')}: {t('listings.filter.yes')}
        </option>
        <option value="no">
          {t('listings.filter.promoted')}: {t('listings.filter.no')}
        </option>
      </Select>
      <Select
        aria-label={t('listings.autoDelivery')}
        value={filter.autoDelivery}
        onChange={(e) => set({ autoDelivery: e.target.value as ListingFilter['autoDelivery'] })}
      >
        <option value="all">
          {t('listings.autoDelivery')}: {t('common.all')}
        </option>
        <option value="yes">
          {t('listings.autoDelivery')}: {t('listings.filter.yes')}
        </option>
        <option value="no">
          {t('listings.autoDelivery')}: {t('listings.filter.no')}
        </option>
      </Select>
      <div className="flex gap-1">
        <Input
          inputMode="decimal"
          placeholder={t('listings.filter.priceMin')}
          aria-label={t('listings.filter.priceMin')}
          value={minText}
          onChange={(e) => {
            setMinText(e.target.value);
            set({ priceMinMinor: parsePriceInput(e.target.value) });
          }}
        />
        <Input
          inputMode="decimal"
          placeholder={t('listings.filter.priceMax')}
          aria-label={t('listings.filter.priceMax')}
          value={maxText}
          onChange={(e) => {
            setMaxText(e.target.value);
            set({ priceMaxMinor: parsePriceInput(e.target.value) });
          }}
        />
      </div>
      <div className="flex gap-1">
        {currencies.length > 1 && (
          <Select
            aria-label={t('listings.filter.currency')}
            value={filter.currency}
            onChange={(e) => set({ currency: e.target.value as ListingFilter['currency'] })}
          >
            <option value="all">{t('listings.filter.anyCurrency')}</option>
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        )}
        {isFilterActive(filter) && (
          <Button size="sm" variant="ghost" className="h-9" onClick={() => onChange(EMPTY_FILTER)}>
            {t('listings.filter.clear')}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Inline cost-of-goods editor (local field `costMinor`). Enter/blur saves, Escape reverts. */
export function CostCell({ listing }: { listing: Listing }) {
  const t = useT();
  const initial = listing.costMinor === null ? '' : formatPriceField(listing.costMinor);
  const [text, setText] = useState(initial);
  const [error, setError] = useState(false);
  useEffect(() => setText(initial), [initial]);
  const commit = async () => {
    const trimmed = text.trim();
    const minor = trimmed === '' ? null : parsePriceInput(trimmed);
    if (trimmed !== '' && (minor === null || minor < 0)) {
      setError(true);
      return;
    }
    setError(false);
    if (minor === listing.costMinor) return;
    await getDb().listings.update(listing.id, { costMinor: minor });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setText(initial);
      setError(false);
    }
  };
  return (
    <Input
      className={cn('h-7 w-full px-2 text-right text-xs', error && 'border-danger')}
      inputMode="decimal"
      placeholder="—"
      aria-label={t('listings.cost.aria', { title: truncate(listing.title, 40) })}
      aria-invalid={error || undefined}
      value={text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={onKey}
    />
  );
}
