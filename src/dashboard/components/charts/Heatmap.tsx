import { useState } from 'react';

/**
 * Weekday × hour heatmap (plain HTML, no chart library). Sequential single-hue ramp built from the
 * theme accent mixed into the surface, so it adapts to every theme; empty cells use surface-2.
 * The grid itself is decorative for assistive tech — the surrounding ChartFrame provides the
 * summary and the full table view; the hover readout is an enhancement only.
 */
const STEPS = [18, 34, 52, 72, 92];

export function heatLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.min(STEPS.length, Math.max(1, Math.ceil((value / max) * STEPS.length)));
}

function cellColor(level: number): string {
  if (level === 0) return 'var(--fp-surface-2)';
  return `color-mix(in oklab, var(--fp-accent) ${STEPS[level - 1]}%, var(--fp-surface))`;
}

export function Heatmap({
  data,
  rowLabels,
  formatCell,
  legendLow,
  legendHigh,
}: {
  /** data[row][col] */
  data: number[][];
  rowLabels: string[];
  /** Readout text for a hovered cell. */
  formatCell: (row: number, col: number, value: number) => string;
  legendLow: string;
  legendHigh: string;
}) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null);
  const max = Math.max(0, ...data.flat());
  const cols = data[0]?.length ?? 0;
  return (
    <div>
      <div className="overflow-x-auto">
        <div
          aria-hidden
          className="grid min-w-[560px] gap-[2px]"
          style={{ gridTemplateColumns: `2.5rem repeat(${cols}, minmax(0, 1fr))` }}
          onPointerLeave={() => setHover(null)}
        >
          <div />
          {Array.from({ length: cols }, (_, c) => (
            <div key={c} className="text-center text-[9px] tabular-nums text-muted">
              {c % 3 === 0 ? String(c).padStart(2, '0') : ''}
            </div>
          ))}
          {data.map((row, r) => (
            <div key={r} className="contents">
              <div className="flex items-center text-[10px] text-muted">{rowLabels[r]}</div>
              {row.map((v, c) => (
                <div
                  key={c}
                  onPointerEnter={() => setHover({ r, c })}
                  className="h-5 rounded-[3px]"
                  style={{
                    background: cellColor(heatLevel(v, max)),
                    outline: hover && hover.r === r && hover.c === c ? '2px solid var(--fp-fg)' : undefined,
                    outlineOffset: -1,
                  }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
        <span className="inline-block min-h-4 tabular-nums">
          {hover ? formatCell(hover.r, hover.c, data[hover.r]?.[hover.c] ?? 0) : ''}
        </span>
        <span className="flex items-center gap-1" aria-hidden>
          {legendLow}
          {[0, 1, 2, 3, 4, 5].map((l) => (
            <span
              key={l}
              className="inline-block h-3 w-4 rounded-[2px]"
              style={{ background: cellColor(l) }}
            />
          ))}
          {legendHigh}
        </span>
      </div>
    </div>
  );
}
