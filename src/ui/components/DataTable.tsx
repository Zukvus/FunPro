import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  width?: string;
  align?: 'left' | 'right' | 'center';
  render: (row: T) => ReactNode;
  className?: string;
  /** Blur this column in privacy mode (buyer names, order ids, message previews). */
  sensitive?: boolean;
  /** Blur this column when balances are hidden (amounts). */
  balance?: boolean;
}

/**
 * Virtualised table for large datasets (thousands of listings/orders). Only visible rows are
 * rendered; uses CSS grid so header and rows share column widths.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  height = 520,
  rowHeight = 44,
  selected,
  onToggle,
  onToggleAll,
  empty,
  onRowClick,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (r: T) => string;
  height?: number;
  rowHeight?: number;
  selected?: ReadonlySet<string>;
  onToggle?: (key: string) => void;
  onToggleAll?: (checked: boolean) => void;
  empty?: ReactNode;
  onRowClick?: (r: T) => void;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => rowHeight, overscan: 12 });
  const selectable = !!selected && !!onToggle;
  const template = [selectable ? '36px' : null, ...columns.map((c) => c.width ?? 'minmax(0,1fr)')].filter(Boolean).join(' ');
  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected!.has(rowKey(r)));

  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface" role="table" aria-rowcount={rows.length}>
      <div role="row" className="grid items-center gap-2 border-b border-border bg-surface-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted" style={{ gridTemplateColumns: template }}>
        {selectable && (
          <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={(e) => onToggleAll?.(e.target.checked)} />
        )}
        {columns.map((c) => (
          <div role="columnheader" key={c.key} className={cn(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center')}>
            {c.header}
          </div>
        ))}
      </div>
      <div ref={parentRef} style={{ height: Math.min(height, rows.length * rowHeight + 2) }} className="overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            const key = rowKey(row);
            return (
              <div
                role="row"
                key={key}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'absolute left-0 grid w-full items-center gap-2 border-b border-border/60 px-3 text-sm',
                  onRowClick && 'cursor-pointer hover:bg-surface-2',
                  selected?.has(key) && 'bg-accent-soft/60',
                )}
                style={{ gridTemplateColumns: template, height: vi.size, transform: `translateY(${vi.start}px)` }}
              >
                {selectable && (
                  <input
                    type="checkbox"
                    aria-label="Select row"
                    checked={selected!.has(key)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle!(key)}
                  />
                )}
                {columns.map((c) => (
                  <div
                    role="cell"
                    key={c.key}
                    className={cn(
                      'min-w-0 truncate',
                      c.align === 'right' && 'text-right tabular-nums',
                      c.align === 'center' && 'text-center',
                      c.sensitive && 'fp-sensitive',
                      c.balance && 'fp-balance',
                      c.className,
                    )}
                  >
                    {c.render(row)}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
