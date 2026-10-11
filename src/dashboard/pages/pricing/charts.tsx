/**
 * Pricing charts (Recharts). Palette: the validated reference categorical slots 1–3
 * (blue / orange / aqua), stepped separately for light and dark surfaces; competitors in the
 * "context" gray when the seller's own offer is the point (emphasis form). Light-mode aqua is below
 * 3:1 on white, so every chart has a table view (toggle) and a legend.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Currency } from '@/shared/models/money';
import { useT } from '@/ui/i18n';
import { dateTime, money } from '../inventory/common';

const LIGHT_SERIES = ['#2a78d6', '#eb6834', '#1baf7a'] as const;
const DARK_SERIES = ['#3987e5', '#d95926', '#199e70'] as const;
const CONTEXT_GRAY = '#898781';

export interface ChartTheme {
  dark: boolean;
  series: readonly [string, string, string];
  context: string;
  grid: string;
  axis: string;
  surface: string;
}

function readTheme(): ChartTheme {
  const cs = getComputedStyle(document.documentElement);
  const dark = cs.colorScheme.includes('dark');
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    dark,
    series: dark ? DARK_SERIES : LIGHT_SERIES,
    context: CONTEXT_GRAY,
    grid: v('--fp-border', dark ? '#2c2c2a' : '#e1e0d9'),
    axis: v('--fp-muted', '#898781'),
    surface: v('--fp-surface', dark ? '#1a1a19' : '#fcfcfb'),
  };
}

/** Theme-aware chart colours; re-read when the dashboard theme changes. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(readTheme);
  useEffect(() => {
    const mo = new MutationObserver(() => setTheme(readTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contrast', 'style'] });
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onMq = () => setTheme(readTheme());
    mq?.addEventListener?.('change', onMq);
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', onMq);
    };
  }, []);
  return theme;
}

function compact(minor: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(minor / 100);
}

export function LegendKey({ items }: { items: { label: string; color: string; shape?: 'line' | 'rect' }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted" aria-hidden>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.shape === 'rect' ? <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} /> : <span className="inline-block h-0.5 w-4 rounded" style={{ background: i.color }} />}
          <span className="text-fg/80">{i.label}</span>
        </li>
      ))}
    </ul>
  );
}

function TooltipBox({ title, rows }: { title: string; rows: { label: string; value: string; color: string }[] }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="flex items-center gap-2">
          <span className="inline-block h-0.5 w-3 rounded" style={{ background: r.color }} />
          <span className="font-semibold tabular-nums text-fg">{r.value}</span>
          <span className="text-muted">{r.label}</span>
        </p>
      ))}
    </div>
  );
}

/** Figure wrapper with a table-view toggle (the accessible twin of every chart). */
export function ChartFigure({ title, caption, legend, chart, table }: { title: string; caption?: string; legend?: ReactNode; chart: ReactNode; table: ReactNode }) {
  const t = useT();
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="text-sm font-semibold text-fg">{title}</span>
          {caption && <span className="block text-xs text-muted">{caption}</span>}
        </span>
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
          {showTable ? t('ops.price.chart.showChart') : t('ops.price.chart.showTable')}
        </button>
      </figcaption>
      {legend}
      {showTable ? <div className="max-h-72 overflow-auto rounded-lg border border-border">{table}</div> : chart}
    </figure>
  );
}

// ---------------------------------------------------------------------------------------------

export interface PositionRow {
  id: string;
  seller: string;
  priceMinor: number;
  mine: boolean;
}

export function PositionChart({ rows, currency, locale }: { rows: PositionRow[]; currency: Currency; locale: string }) {
  const t = useT();
  const theme = useChartTheme();
  const data = rows.map((r, i) => ({ ...r, rank: i + 1 }));
  return (
    <ChartFigure
      title={t('ops.price.chart.position')}
      caption={t('ops.price.chart.positionCaption')}
      legend={<LegendKey items={[{ label: t('ops.price.chart.you'), color: theme.series[0], shape: 'rect' }, { label: t('ops.price.chart.competitors'), color: theme.context, shape: 'rect' }]} />}
      chart={
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
              <XAxis dataKey="rank" tick={{ fill: theme.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: theme.grid }} interval="preserveStartEnd" />
              <YAxis tickFormatter={(v: number) => compact(v, locale)} tick={{ fill: theme.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} />
              <Tooltip
                cursor={{ fill: theme.grid, opacity: 0.4 }}
                content={({ active, payload }) => {
                  const p = active && payload?.[0] ? (payload[0].payload as (typeof data)[number]) : null;
                  if (!p) return null;
                  return <TooltipBox title={`#${p.rank} · ${p.mine ? t('ops.price.chart.you') : p.seller}`} rows={[{ label: t('ops.price.chart.price'), value: money(p.priceMinor, currency, locale), color: p.mine ? theme.series[0] : theme.context }]} />;
                }}
              />
              <Bar dataKey="priceMinor" maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.id} fill={d.mine ? theme.series[0] : theme.context} fillOpacity={d.mine ? 1 : 0.55} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-1 text-left">#</th>
              <th className="px-2 py-1 text-left">{t('ops.price.table.seller')}</th>
              <th className="px-2 py-1 text-right">{t('ops.price.chart.price')}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.id} className={d.mine ? 'font-semibold' : ''}>
                <td className="px-2 py-1 tabular-nums">{d.rank}</td>
                <td className="px-2 py-1">{d.mine ? t('ops.price.chart.you') : d.seller}</td>
                <td className="px-2 py-1 text-right tabular-nums">{money(d.priceMinor, currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}

export interface SeriesDef {
  key: string;
  label: string;
}

/**
 * Step-line chart over time with up to three series (slots 1–3, fixed order so colours follow the
 * series, never their rank). One y-axis (price).
 */
export function TimeLines({ title, caption, data, series, currency, locale }: { title: string; caption?: string; data: Record<string, number | null>[]; series: [SeriesDef, SeriesDef, SeriesDef]; currency: Currency; locale: string }) {
  const t = useT();
  const theme = useChartTheme();
  const colors = theme.series;
  return (
    <ChartFigure
      title={title}
      caption={caption}
      legend={<LegendKey items={series.map((s, i) => ({ label: s.label, color: colors[i]! }))} />}
      chart={
        <div className="h-60 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke={theme.grid} strokeWidth={1} />
              <XAxis dataKey="at" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => new Date(v).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} tick={{ fill: theme.axis, fontSize: 11 }} tickLine={false} axisLine={{ stroke: theme.grid }} minTickGap={24} />
              <YAxis tickFormatter={(v: number) => compact(v, locale)} tick={{ fill: theme.axis, fontSize: 11 }} tickLine={false} axisLine={false} width={48} domain={['auto', 'auto']} />
              <Tooltip
                cursor={{ stroke: theme.axis, strokeWidth: 1 }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]!.payload as Record<string, number | null>;
                  return (
                    <TooltipBox
                      title={dateTime(Number(label), locale)}
                      rows={series.map((s, i) => ({ label: s.label, value: row[s.key] === null || row[s.key] === undefined ? '—' : money(row[s.key]!, currency, locale), color: colors[i]! }))}
                    />
                  );
                }}
              />
              {series.map((s, i) => (
                <Line key={s.key} type="stepAfter" dataKey={s.key} stroke={colors[i]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: theme.surface, strokeWidth: 2 }} connectNulls isAnimationActive={false} name={s.label} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-2 py-1 text-left">{t('ops.price.table.time')}</th>
              {series.map((s) => (
                <th key={s.key} className="px-2 py-1 text-right">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i}>
                <td className="px-2 py-1">{dateTime(row['at'] ?? null, locale)}</td>
                {series.map((s) => (
                  <td key={s.key} className="px-2 py-1 text-right tabular-nums">
                    {row[s.key] === null || row[s.key] === undefined ? '—' : money(row[s.key]!, currency, locale)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      }
    />
  );
}
