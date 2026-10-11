import { lazy } from 'react';

/**
 * Lazily loaded chart components: Recharts is fetched only when a chart is actually rendered.
 * Wrap them in <ChartFrame> (which provides the Suspense boundary and the table view).
 */
const kit = () => import('./RechartsKit');
export const ColumnSeriesChart = lazy(() => kit().then((m) => ({ default: m.ColumnSeriesChart })));
export const HBarChart = lazy(() => kit().then((m) => ({ default: m.HBarChart })));
export const DivergingColumnChart = lazy(() => kit().then((m) => ({ default: m.DivergingColumnChart })));
export const TimeLineChart = lazy(() => kit().then((m) => ({ default: m.TimeLineChart })));

export type { SeriesDatum, TimePoint } from './RechartsKit';
export { ChartFrame, DataGridTable, type ChartTable } from './ChartFrame';
export { Heatmap } from './Heatmap';
export { RangeFilter, defaultRangeState, type RangeState } from './RangeFilter';
export { Amount, MoneyList } from './Money';
export { StatTile } from './StatTile';
export { SignLegend } from './SignLegend';
export * from './format';
