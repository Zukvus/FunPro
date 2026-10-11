import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { fmtDelta } from './format';

/**
 * Stat tile: label · value · optional delta vs the previous period. The delta carries an arrow and
 * a sign (never colour alone); colour reflects whether the direction is good for the seller.
 */
export function StatTile({
  label,
  value,
  hint,
  deltaPct,
  goodWhenUp = true,
  deltaText,
  privacy,
  badge,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** Relative change (0.1 = +10%); null = no base to compare with; undefined = no delta shown. */
  deltaPct?: number | null;
  goodWhenUp?: boolean;
  /** Overrides the formatted delta (e.g. percentage points). */
  deltaText?: string;
  privacy?: 'balance' | 'sensitive';
  badge?: ReactNode;
}) {
  const t = useT();
  const lang = useLang();
  const showDelta = deltaPct !== undefined;
  const dir = deltaPct === null || deltaPct === undefined || Math.abs(deltaPct) < 1e-9 ? 0 : deltaPct > 0 ? 1 : -1;
  const good = dir === 0 ? null : (dir > 0) === goodWhenUp;
  const Icon = dir > 0 ? ArrowUpRight : dir < 0 ? ArrowDownRight : Minus;
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-muted">{label}</p>
        {badge}
      </div>
      <p className={cn('mt-1 text-xl font-semibold text-fg', privacy === 'balance' ? 'fp-balance' : privacy === 'sensitive' ? 'fp-sensitive' : undefined)}>{value}</p>
      {showDelta && (
        <p className="mt-1 flex items-center gap-1 text-[11px]">
          <span className={cn('inline-flex items-center gap-0.5 font-medium', good === null ? 'text-muted' : good ? 'text-success' : 'text-danger')}>
            <Icon size={12} aria-hidden />
            {deltaText ?? (deltaPct === null ? t('analytics.delta.noBase') : fmtDelta(deltaPct ?? null, lang))}
          </span>
          <span className="text-muted">{t('analytics.delta.vsPrevious')}</span>
        </p>
      )}
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
