import type { Currency } from '@/shared/models/money';
import { sortCurrencies } from '@/features/orders/query';
import { useLang } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { fmtMoney } from './format';

/**
 * Per-currency amounts, one entry per currency (never summed across currencies).
 * `privacy`: 'balance' → hidden by "Hide balances"; 'sensitive' → blurred in privacy mode.
 */
export function MoneyList({
  amounts,
  privacy = 'sensitive',
  empty = '—',
  className,
  separator = ' · ',
}: {
  amounts: Partial<Record<Currency, number>>;
  privacy?: 'balance' | 'sensitive' | 'none';
  empty?: string;
  className?: string;
  separator?: string;
}) {
  const lang = useLang();
  const entries = sortCurrencies(Object.keys(amounts) as Currency[]).filter((c) => (amounts[c] ?? 0) !== 0);
  const cls = privacy === 'balance' ? 'fp-balance' : privacy === 'sensitive' ? 'fp-sensitive' : undefined;
  if (entries.length === 0) return <span className={cn('text-muted', className)}>{empty}</span>;
  return (
    <span className={cn(cls, className)}>
      {entries.map((c, i) => (
        <span key={c} className="whitespace-nowrap">
          {i > 0 && <span className="text-muted">{separator}</span>}
          {fmtMoney(amounts[c] ?? 0, c, lang)}
        </span>
      ))}
    </span>
  );
}

export function Amount({
  minor,
  currency,
  privacy = 'sensitive',
  className,
  signed,
}: {
  minor: number;
  currency: Currency;
  privacy?: 'balance' | 'sensitive' | 'none';
  className?: string;
  signed?: '+' | '−';
}) {
  const lang = useLang();
  const cls = privacy === 'balance' ? 'fp-balance' : privacy === 'sensitive' ? 'fp-sensitive' : undefined;
  return (
    <span className={cn('whitespace-nowrap tabular-nums', cls, className)}>
      {signed ? `${signed} ` : ''}
      {fmtMoney(minor, currency, lang)}
    </span>
  );
}
