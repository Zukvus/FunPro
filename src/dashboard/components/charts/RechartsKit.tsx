/**
 * Recharts-based charts. This module is only ever loaded lazily (see ./index.ts) so Recharts stays
 * out of the popup and out of pages that do not plot anything.
 *
 * Visual rules (dataviz method): thin marks (bars ≤ 24px with a 4px rounded data end, 2px lines),
 * hairline solid grid in the theme border colour, muted axis text, text never in series colour,
 * one series per chart (one chart per currency — never two y-scales). Colours are theme CSS
 * variables, so every FunPro theme (light, dark, high-contrast …) restyles the charts.
 */
import type { ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const AXIS_TICK = { fill: 'var(--fp-muted)', fontSize: 11 } as const;
const GRID = 'var(--fp-border)';
export const SERIES_COLOR = 'var(--fp-accent)';
/**
 * Negative values: the theme's danger hue mixed 55% into the surface. Validated against every theme
 * (incl. sunset/forest, where accent and danger alone collide under CVD or even normal vision): the
 * lightness difference keeps the two signs apart. The sign is primarily carried by position
 * relative to the zero line, and the table view holds every value.
 */
export const NEGATIVE_COLOR = 'color-mix(in oklab, var(--fp-danger) 55%, var(--fp-surface))';

export interface SeriesDatum {
  label: string;
  value: number;
  /** Extra tooltip lines (already formatted). */
  extra?: string[];
}

interface TooltipEntryLike {
  value?: unknown;
  color?: string;
  payload?: unknown;
}

function TooltipBox({
  active,
  payload,
  label,
  format,
  seriesName,
}: {
  active?: boolean;
  payload?: ReadonlyArray<TooltipEntryLike>;
  label?: string | number;
  format: (v: number) => string;
  seriesName: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0]!;
  const datum = entry.payload as SeriesDatum | undefined;
  const value = typeof entry.value === 'number' ? entry.value : Number(entry.value);
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-fg shadow-lg">
      <p className="text-muted">{datum?.label ?? label}</p>
      <p className="mt-0.5 flex items-center gap-2">
        <span
          aria-hidden
          className="inline-block h-0.5 w-3 rounded"
          style={{ background: entry.color ?? SERIES_COLOR }}
        />
        <span className="font-semibold tabular-nums">{format(value)}</span>
        <span className="text-muted">{seriesName}</span>
      </p>
      {datum?.extra?.map((x, i) => (
        <p key={i} className="mt-0.5 text-muted">
          {x}
        </p>
      ))}
    </div>
  );
}

/** Single-series column chart over time buckets (e.g. revenue per day for ONE currency). */
export function ColumnSeriesChart({
  data,
  seriesName,
  format,
  tickFormat,
  color = SERIES_COLOR,
}: {
  data: SeriesDatum[];
  seriesName: string;
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  color?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tick={AXIS_TICK}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis
          tickFormatter={tickFormat}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          width={52}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--fp-surface-2)' }}
          content={(p) => (
            <TooltipBox
              active={p.active}
              payload={p.payload}
              label={p.label}
              format={format}
              seriesName={seriesName}
            />
          )}
          isAnimationActive={false}
        />
        <Bar
          dataKey="value"
          name={seriesName}
          fill={color}
          radius={[4, 4, 0, 0]}
          maxBarSize={24}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bars for nominal categories (one hue for every bar — the length carries the value). */
export function HBarChart({
  data,
  seriesName,
  format,
  tickFormat,
  labelWidth = 150,
}: {
  data: SeriesDatum[];
  seriesName: string;
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  labelWidth?: number;
}) {
  const truncate = (s: string) => (s.length > 26 ? `${s.slice(0, 25)}…` : s);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
        barCategoryGap="22%"
      >
        <CartesianGrid horizontal={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          type="number"
          tickFormatter={tickFormat}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tick={AXIS_TICK}
          allowDecimals={false}
        />
        <YAxis
          type="category"
          dataKey="label"
          tickFormatter={truncate}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          width={labelWidth}
        />
        <Tooltip
          cursor={{ fill: 'var(--fp-surface-2)' }}
          content={(p) => (
            <TooltipBox
              active={p.active}
              payload={p.payload}
              label={p.label}
              format={format}
              seriesName={seriesName}
            />
          )}
          isAnimationActive={false}
        />
        <Bar
          dataKey="value"
          name={seriesName}
          fill={SERIES_COLOR}
          radius={[0, 4, 4, 0]}
          maxBarSize={18}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  payload?: SeriesDatum;
}

/** Bar with a 4px rounded DATA end (top for positive, bottom for negative values), square at zero. */
function SignedBar({ x = 0, y = 0, width = 0, height = 0, fill, payload }: BarShapeProps): ReactNode {
  const top = Math.min(y, y + height);
  const h = Math.abs(height);
  if (h <= 0 || width <= 0) return null;
  const r = Math.min(4, h, width / 2);
  const negative = (payload?.value ?? 0) < 0;
  const d = negative
    ? `M${x},${top} H${x + width} V${top + h - r} Q${x + width},${top + h} ${x + width - r},${top + h} H${x + r} Q${x},${top + h} ${x},${top + h - r} Z`
    : `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + width - r} Q${x + width},${top} ${x + width},${top + r} V${top + h} Z`;
  // Inline style (not the attribute) so var()/color-mix() resolve in every browser.
  return <path d={d} style={{ fill }} />;
}

/**
 * Diverging columns around zero (e.g. net cash flow per period): positive in the accent colour,
 * negative in the danger colour, neutral zero line. Sign is also readable from the axis/table.
 */
export function DivergingColumnChart({
  data,
  seriesName,
  format,
  tickFormat,
}: {
  data: SeriesDatum[];
  seriesName: string;
  format: (v: number) => string;
  tickFormat: (v: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          interval="preserveStartEnd"
          minTickGap={18}
        />
        <YAxis tickFormatter={tickFormat} tickLine={false} axisLine={false} tick={AXIS_TICK} width={52} />
        <ReferenceLine y={0} stroke="var(--fp-muted)" strokeWidth={1} />
        <Tooltip
          cursor={{ fill: 'var(--fp-surface-2)' }}
          content={(p) => (
            <TooltipBox
              active={p.active}
              payload={p.payload}
              label={p.label}
              format={format}
              seriesName={seriesName}
            />
          )}
          isAnimationActive={false}
        />
        <Bar
          dataKey="value"
          name={seriesName}
          maxBarSize={24}
          isAnimationActive={false}
          shape={(props: unknown) => <SignedBar {...(props as BarShapeProps)} />}
        >
          {data.map((d, i) => (
            <Cell key={i} fill={d.value < 0 ? NEGATIVE_COLOR : SERIES_COLOR} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface TimePoint {
  at: number;
  value: number;
}

/** Single-series line over continuous time (e.g. balance history for ONE currency). */
export function TimeLineChart({
  data,
  seriesName,
  format,
  tickFormat,
  dateFormat,
}: {
  data: TimePoint[];
  seriesName: string;
  format: (v: number) => string;
  tickFormat: (v: number) => string;
  dateFormat: (ts: number) => string;
}) {
  const rows = data.map((d) => ({ ...d, label: dateFormat(d.at) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
        <XAxis
          dataKey="at"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(v: number) => dateFormat(v)}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          tick={AXIS_TICK}
          minTickGap={24}
        />
        <YAxis
          tickFormatter={tickFormat}
          tickLine={false}
          axisLine={false}
          tick={AXIS_TICK}
          width={52}
          domain={['auto', 'auto']}
        />
        <Tooltip
          cursor={{ stroke: 'var(--fp-muted)', strokeWidth: 1 }}
          content={(p) => (
            <TooltipBox
              active={p.active}
              payload={p.payload}
              label={p.payload?.[0] ? (p.payload[0].payload as { label: string }).label : undefined}
              format={format}
              seriesName={seriesName}
            />
          )}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="value"
          name={seriesName}
          stroke={SERIES_COLOR}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, stroke: 'var(--fp-surface)', strokeWidth: 2, fill: SERIES_COLOR }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
