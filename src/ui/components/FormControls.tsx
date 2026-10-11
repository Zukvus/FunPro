import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn';

/** Labelled native checkbox (keyboard and screen-reader friendly by construction). */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
  className,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const autoId = useId();
  const cid = id ?? autoId;
  const descId = description ? `${cid}-desc` : undefined;
  return (
    <div className={cn('flex items-start gap-2.5 py-1.5', className)}>
      <input
        id={cid}
        type="checkbox"
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        aria-describedby={descId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <div className="min-w-0">
        <label htmlFor={cid} className={cn('text-sm text-fg', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
          {label}
        </label>
        {description && (
          <p id={descId} className="mt-0.5 text-xs text-muted">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

/** Native range input with a visible label and value (announced via aria-valuetext). */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format = (v) => String(v),
  description,
  disabled,
  id,
}: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const autoId = useId();
  const sid = id ?? autoId;
  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={sid} className="text-sm font-medium text-fg">
          {label}
        </label>
        <output htmlFor={sid} className="text-xs tabular-nums text-muted">
          {format(value)}
        </output>
      </div>
      <input
        id={sid}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={format(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer disabled:cursor-not-allowed"
      />
      {description && <p className="text-xs text-muted">{description}</p>}
    </div>
  );
}

/**
 * Single-choice segmented control implemented as an ARIA radio group: one tab stop, arrow keys
 * move the selection (WAI-ARIA radio group pattern).
 */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; description?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + options.length) % options.length;
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex flex-wrap gap-1 rounded-lg bg-surface-2 p-1', className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.description}
          onKeyDown={onKey}
          onClick={() => onChange(o.value)}
          className={cn('rounded-md px-3 py-1.5 text-xs font-medium', o.value === value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
