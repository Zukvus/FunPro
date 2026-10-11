import { BarChart3, Table2 } from 'lucide-react';
import { Suspense, useId, useState, type ReactNode } from 'react';
import { Spinner } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';

export interface ChartTable {
  headers: ReactNode[];
  rows: ReactNode[][];
  /** Column indexes to right-align (numbers). */
  numeric?: number[];
}

/**
 * Accessible chart container: a <figure> with a visible title, a text summary for screen readers,
 * and a "Table" view that shows exactly the plotted values (the WCAG-friendly twin of the chart).
 * Charts never gate data: everything a tooltip shows is in the table too.
 */
export function ChartFrame({
  title,
  description,
  summary,
  table,
  children,
  height = 220,
  privacy,
  actions,
  className,
  empty,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** One-sentence text alternative of what the chart shows. */
  summary: string;
  table: ChartTable;
  children: ReactNode;
  height?: number;
  /** `balance` → hidden with "Hide balances"; `sensitive` → blurred in privacy mode. */
  privacy?: 'balance' | 'sensitive';
  actions?: ReactNode;
  className?: string;
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: ReactNode;
}) {
  const t = useT();
  const id = useId();
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const privacyClass = privacy === 'balance' ? 'fp-balance' : privacy === 'sensitive' ? 'fp-sensitive' : undefined;
  return (
    <figure aria-labelledby={`${id}-title`} aria-describedby={`${id}-summary`} className={cn('m-0 rounded-[var(--radius-card)] border border-border bg-surface fp-pad', className)}>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <figcaption id={`${id}-title`} className="text-sm font-semibold text-fg">
            {title}
          </figcaption>
          {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
        </div>
        <div className="flex items-center gap-1">
          {actions}
          {!empty && (
            <div role="group" aria-label={t('orders.chart.view')} className="inline-flex rounded-lg bg-surface-2 p-0.5">
              <button
                type="button"
                aria-pressed={view === 'chart'}
                onClick={() => setView('chart')}
                className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px]', view === 'chart' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
              >
                <BarChart3 size={12} aria-hidden /> {t('orders.chart.chart')}
              </button>
              <button
                type="button"
                aria-pressed={view === 'table'}
                onClick={() => setView('table')}
                className={cn('inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px]', view === 'table' ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
              >
                <Table2 size={12} aria-hidden /> {t('orders.chart.table')}
              </button>
            </div>
          )}
        </div>
      </div>
      <p id={`${id}-summary`} className="sr-only">
        {summary}
      </p>
      {empty ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-xs text-muted" style={{ minHeight: Math.min(height, 140) }}>
          {empty}
        </div>
      ) : view === 'chart' ? (
        <div className={privacyClass} style={{ height }}>
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            {children}
          </Suspense>
        </div>
      ) : (
        <div className={cn('overflow-auto rounded-lg border border-border', privacyClass)} style={{ maxHeight: Math.max(height, 260) }}>
          <DataGridTable table={table} />
        </div>
      )}
    </figure>
  );
}

export function DataGridTable({ table, caption }: { table: ChartTable; caption?: string }) {
  const numeric = new Set(table.numeric ?? []);
  return (
    <table className="w-full border-collapse text-xs">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead className="sticky top-0 bg-surface-2">
        <tr>
          {table.headers.map((h, i) => (
            <th key={i} scope="col" className={cn('px-2 py-1.5 text-left font-semibold text-muted', numeric.has(i) && 'text-right')}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((r, ri) => (
          <tr key={ri} className="border-t border-border/60">
            {r.map((c, ci) =>
              ci === 0 ? (
                <th key={ci} scope="row" className="px-2 py-1 text-left font-normal text-fg">
                  {c}
                </th>
              ) : (
                <td key={ci} className={cn('px-2 py-1 text-fg', numeric.has(ci) && 'text-right tabular-nums')}>
                  {c}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
