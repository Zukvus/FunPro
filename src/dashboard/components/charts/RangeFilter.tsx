import { CalendarRange } from 'lucide-react';
import { useId } from 'react';
import { RANGE_PRESETS, toDayInput, type CustomRangeInput, type DateRange, type RangePreset } from '@/features/analytics/time';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';

export interface RangeState {
  preset: RangePreset;
  custom: CustomRangeInput;
}

export function defaultRangeState(now = Date.now(), preset: RangePreset = '30d'): RangeState {
  return { preset, custom: { from: toDayInput(now - 29 * 86_400_000), to: toDayInput(now) } };
}

/** Date-range presets (7/30/90 days, this/last month) plus a custom range — always first in a filter row. */
export function RangeFilter({ value, onChange, resolved }: { value: RangeState; onChange: (v: RangeState) => void; resolved: DateRange }) {
  const t = useT();
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="radiogroup" aria-label={t('analytics.range.label')} className="inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1">
        {RANGE_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={value.preset === p}
            onClick={() => onChange(p === 'custom' ? { preset: p, custom: value.preset === 'custom' ? value.custom : { from: toDayInput(resolved.from), to: toDayInput(resolved.to - 1) } } : { ...value, preset: p })}
            className={cn('rounded-md px-2.5 py-1 text-xs font-medium', value.preset === p ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
          >
            {p === 'custom' && <CalendarRange size={12} className="mr-1 inline" aria-hidden />}
            {t(`analytics.range.${p}`)}
          </button>
        ))}
      </div>
      {value.preset === 'custom' && (
        <div className="flex items-center gap-1 text-xs text-muted">
          <label htmlFor={`${id}-from`} className="sr-only">
            {t('analytics.range.from')}
          </label>
          <input
            id={`${id}-from`}
            type="date"
            value={value.custom.from}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, from: e.target.value } })}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
          />
          <span aria-hidden>–</span>
          <label htmlFor={`${id}-to`} className="sr-only">
            {t('analytics.range.to')}
          </label>
          <input
            id={`${id}-to`}
            type="date"
            value={value.custom.to}
            onChange={(e) => onChange({ ...value, custom: { ...value.custom, to: e.target.value } })}
            className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-fg"
          />
        </div>
      )}
    </div>
  );
}
