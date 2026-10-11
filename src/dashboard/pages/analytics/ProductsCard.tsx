import { ExternalLink } from 'lucide-react';
import { useMemo, useState } from 'react';
import { productsSheet, sheetToTable } from '@/features/analytics/report';
import { rankProducts, type ProductRow, type RankBy } from '@/features/analytics/products';
import { exportTable } from '@/features/export/table';
import { listingUrl } from '@/features/orders/model';
import { sortCurrencies } from '@/features/orders/query';
import type { Currency, Listing } from '@/shared/models';
import { Badge, Card, Select } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { fmtInt, MoneyList } from '@/dashboard/components/charts';
import { CsvButton } from './Charts';

export function ProductsCard({ rows, unsold, direction }: { rows: ProductRow[]; unsold: Listing[]; direction: 'sale' | 'purchase' }) {
  const t = useT();
  const lang = useLang();
  const currencies = useMemo(() => sortCurrencies(rows.flatMap((r) => Object.keys(r.grossByCurrency) as Currency[])), [rows]);
  const [by, setBy] = useState<RankBy>('orders');
  const [order, setOrder] = useState<'best' | 'worst'>('best');
  const [currency, setCurrency] = useState<Currency | ''>('');
  const cur: Currency | undefined = currency || currencies[0];
  const ranked = useMemo(() => rankProducts(rows, { by, currency: cur, order, limit: 10 }), [rows, by, cur, order]);

  return (
    <Card
      title={t(`analytics.products.title.${direction}`)}
      description={t('analytics.products.description')}
      actions={<CsvButton onClick={() => exportTable(sheetToTable(productsSheet(rows), 'funpro-products'), 'csv')} />}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-lg bg-surface-2 p-1" role="group" aria-label={t('analytics.products.order')}>
          {(['best', 'worst'] as const).map((o) => (
            <button key={o} type="button" aria-pressed={order === o} onClick={() => setOrder(o)} className={cn('rounded-md px-2.5 py-1 text-xs font-medium', order === o ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}>
              {t(`analytics.products.${o}`)}
            </button>
          ))}
        </div>
        <Select value={by} onChange={(e) => setBy(e.target.value as RankBy)} aria-label={t('analytics.products.rankBy')} className="w-auto">
          <option value="orders">{t('analytics.products.byOrders')}</option>
          <option value="revenue">{t('analytics.products.byRevenue')}</option>
        </Select>
        {by === 'revenue' && (
          <Select value={cur ?? ''} onChange={(e) => setCurrency(e.target.value as Currency)} aria-label={t('analytics.products.currency')} className="w-auto">
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c === 'UNKNOWN' ? t('orders.currency.unknown') : c}
              </option>
            ))}
          </Select>
        )}
        {by === 'revenue' && <span className="text-[11px] text-muted">{t('analytics.products.revenueNote')}</span>}
      </div>
      {ranked.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted">{t('analytics.empty.period')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">{t(`analytics.products.title.${direction}`)}</caption>
            <thead>
              <tr className="text-left text-muted">
                <th scope="col" className="pb-1 font-medium">
                  #
                </th>
                <th scope="col" className="pb-1 font-medium">
                  {t('analytics.col.product')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.orders')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.units')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.refunded')}
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  {t('analytics.col.revenue')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r, i) => {
                const url = listingUrl(r.listingId);
                return (
                  <tr key={r.key} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-2 tabular-nums text-muted">{i + 1}</td>
                    <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                      <span className="block max-w-[28rem] truncate text-fg" title={r.title}>
                        {r.title || '—'}
                      </span>
                      <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted">
                        {r.category}
                        {url && (
                          <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
                            <ExternalLink size={10} aria-hidden /> {t('analytics.products.listing')}
                          </a>
                        )}
                        {r.listingMatch === 'title' && <Badge tone="neutral" title={t('analytics.products.matchedByTitleHint')}>{t('analytics.products.matchedByTitle')}</Badge>}
                      </span>
                    </th>
                    <td className="py-1.5 text-right tabular-nums">{fmtInt(r.orders, lang)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtInt(r.units, lang)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmtInt(r.refunded, lang)}</td>
                    <td className="py-1.5 text-right">
                      <MoneyList amounts={r.grossByCurrency} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {direction === 'sale' && unsold.length > 0 && (
        <details className="mt-3 rounded-lg border border-border px-3 py-2 text-xs">
          <summary className="cursor-pointer text-muted">{t('analytics.products.unsold', { count: unsold.length })}</summary>
          <ul className="mt-2 max-h-48 space-y-0.5 overflow-auto">
            {unsold.map((l) => (
              <li key={l.id} className="flex justify-between gap-2">
                <span className="truncate">{l.title}</span>
                {listingUrl(l.id) && (
                  <a href={listingUrl(l.id)!} target="_blank" rel="noopener noreferrer" className="shrink-0 text-accent hover:underline">
                    {t('analytics.products.listing')}
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted">{t('analytics.products.unsoldNote')}</p>
        </details>
      )}
    </Card>
  );
}
