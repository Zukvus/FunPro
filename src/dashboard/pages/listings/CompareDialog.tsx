import { useEffect, useState, type ReactNode } from 'react';
import { loadComparison, type ComparisonColumn } from '@/features/listings/compare';
import type { Currency, Listing } from '@/shared/models';
import { Badge, Callout, Modal, Spinner } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { EstimateMark, useFormat } from './shared';

type Better = 'higher' | 'lower' | null;

interface Row {
  key: string;
  label: string;
  cells: ReactNode[];
  /** Numeric values used to highlight the best column (same currency only). */
  values?: (number | null)[];
  better?: Better;
}

/** Index of the best numeric value, or -1 when it cannot be decided (ties, mixed currencies, gaps). */
export function bestIndex(
  values: readonly (number | null)[],
  better: Better,
  currencies?: readonly Currency[],
): number {
  if (!better || values.length < 2) return -1;
  if (currencies && new Set(currencies).size > 1) return -1;
  const known = values.map((v, i) => ({ v, i })).filter((x): x is { v: number; i: number } => x.v !== null);
  if (known.length < 2) return -1;
  const target =
    better === 'higher' ? Math.max(...known.map((k) => k.v)) : Math.min(...known.map((k) => k.v));
  const winners = known.filter((k) => k.v === target);
  return winners.length === 1 ? winners[0]!.i : -1;
}

export function CompareDialog({ listings, onClose }: { listings: Listing[]; onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const [settings] = useSettings();
  const [columns, setColumns] = useState<ComparisonColumn[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadComparison(
      listings.map((l) => l.id),
      settings,
    )
      .then((c) => !cancelled && setColumns(c))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
    // Settings changes (commission) re-run the comparison.
  }, [listings, settings]);

  const money = (minor: number | null, currency: Currency) =>
    minor === null ? '—' : fmt.money(minor, currency);
  const rows: Row[] = columns
    ? (() => {
        const currencies = columns.map((c) => c.listing.price.currency);
        return [
          {
            key: 'category',
            label: t('listings.compare.category'),
            cells: columns.map((c) => c.listing.categoryName || '—'),
          },
          {
            key: 'status',
            label: t('listings.compare.status'),
            cells: columns.map((c) => (
              <span className="flex flex-wrap gap-1">
                <Badge tone={c.listing.active ? 'success' : 'neutral'}>
                  {c.listing.active ? t('listings.compare.active') : t('listings.compare.inactive')}
                </Badge>
                {c.listing.promoted && <Badge tone="accent">{t('listings.compare.promo')}</Badge>}
                {c.listing.autoDelivery && <Badge tone="info">{t('listings.compare.autoDelivery')}</Badge>}
              </span>
            )),
          },
          {
            key: 'price',
            label: t('listings.compare.price'),
            cells: columns.map((c) => money(c.listing.price.amountMinor, c.listing.price.currency)),
            values: columns.map((c) => c.listing.price.amountMinor),
            better: null,
          },
          {
            key: 'net',
            label: t('listings.compare.net'),
            cells: columns.map((c) =>
              c.economics.netMinor === null ? (
                <span className="text-muted">{t('listings.compare.unknownCommission')}</span>
              ) : (
                <>
                  {money(c.economics.netMinor, c.listing.price.currency)}
                  <EstimateMark estimate={c.economics.estimate} />
                </>
              ),
            ),
          },
          {
            key: 'cost',
            label: t('listings.compare.cost'),
            cells: columns.map((c) => money(c.listing.costMinor, c.listing.price.currency)),
          },
          {
            key: 'profit',
            label: t('listings.compare.profit'),
            cells: columns.map((c) =>
              c.economics.profitMinor === null
                ? '—'
                : money(c.economics.profitMinor, c.listing.price.currency),
            ),
            values: columns.map((c) => c.economics.profitMinor),
            better: 'higher',
          },
          {
            key: 'stock',
            label: t('listings.compare.stock'),
            cells: columns.map((c) => (c.listing.amount === null ? '∞' : fmt.num(c.listing.amount))),
          },
          {
            key: 'rank',
            label: t('listings.compare.rank'),
            cells: columns.map((c) =>
              c.market ? (
                t('listings.compare.rankValue', { rank: c.market.rank, total: c.market.total })
              ) : (
                <span className="text-muted">{t('listings.compare.noMarket')}</span>
              ),
            ),
            values: columns.map((c) =>
              c.market && c.market.count > 0 ? c.market.rank / c.market.total : null,
            ),
            better: 'lower',
          },
          {
            key: 'lowest',
            label: t('listings.compare.lowest'),
            cells: columns.map((c) =>
              c.market ? money(c.market.lowestMinor, c.listing.price.currency) : '—',
            ),
          },
          {
            key: 'median',
            label: t('listings.compare.median'),
            cells: columns.map((c) =>
              c.market ? money(c.market.medianMinor, c.listing.price.currency) : '—',
            ),
          },
          {
            key: 'sales',
            label: t('listings.compare.sales30'),
            cells: columns.map((c) =>
              c.sales === null ? (
                <span className="text-muted" title={t('listings.compare.salesUnknownHint')}>
                  {t('listings.compare.salesUnknown')}
                </span>
              ) : (
                t('listings.compare.salesValue', { orders: c.sales.orders, refunded: c.sales.refunded })
              ),
            ),
            values: columns.map((c) => c.sales?.orders ?? null),
            better: 'higher',
          },
          {
            key: 'revenue',
            label: t('listings.compare.revenue30'),
            cells: columns.map((c) => {
              if (!c.sales) return '—';
              const entries = Object.entries(c.sales.grossByCurrency) as [Currency, number][];
              return entries.length
                ? entries.map(([cur, v]) => money(v, cur)).join(' · ')
                : money(0, c.listing.price.currency);
            }),
          },
        ].map((r) => ({ ...r, currencies })) as (Row & { currencies: Currency[] })[];
      })()
    : [];

  return (
    <Modal open onClose={onClose} title={t('listings.compare.title', { count: listings.length })} wide>
      {error && <Callout tone="danger">{error}</Callout>}
      {!columns && !error && (
        <div className="flex justify-center py-10">
          <Spinner size={22} />
        </div>
      )}
      {columns && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
              <caption className="sr-only">{t('listings.compare.caption')}</caption>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="w-40 border-b border-border p-2 text-left text-xs font-medium text-muted"
                  >
                    {t('listings.compare.field')}
                  </th>
                  {columns.map((c) => (
                    <th
                      key={c.listing.id}
                      scope="col"
                      className="border-b border-border p-2 text-left align-bottom"
                    >
                      <span className="block font-semibold text-fg">
                        {c.listing.title || `#${c.listing.id}`}
                      </span>
                      <span className="block font-mono text-[10px] font-normal text-muted">
                        #{c.listing.id}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const best = r.values
                    ? bestIndex(
                        r.values,
                        r.better ?? null,
                        (r as Row & { currencies?: Currency[] }).currencies,
                      )
                    : -1;
                  return (
                    <tr key={r.key}>
                      <th
                        scope="row"
                        className="border-b border-border/60 p-2 text-left text-xs font-medium text-muted"
                      >
                        {r.label}
                      </th>
                      {r.cells.map((cell, i) => (
                        <td
                          key={i}
                          className={cn(
                            'border-b border-border/60 p-2 tabular-nums',
                            best === i && 'bg-success/10 font-semibold',
                          )}
                        >
                          {cell}
                          {best === i && <span className="sr-only"> ({t('listings.compare.best')})</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-muted">{t('listings.compare.note')}</p>
        </>
      )}
    </Modal>
  );
}
