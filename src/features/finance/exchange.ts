/**
 * Optional combined-currency view. FunPro NEVER converts currencies on its own: a combined total is
 * only computed with exchange rates the seller entered manually (with a source and a timestamp),
 * and every rate used is returned so the UI can display it next to the total. Currencies without a
 * rate are left out and listed as missing — never guessed.
 */
import { ExchangeRateSchema, type Currency, type ExchangeRate } from '@/shared/models';
import { sortCurrencies } from '@/features/orders/query';

export interface RateLookup {
  /** Multiply an amount in `from` by this to get `to`. */
  factor: number;
  rate: ExchangeRate;
  /** True when the stored rate is to→from and was inverted. */
  inverse: boolean;
}

/** Most recent direct rate, else the most recent inverse rate. */
export function findRate(rates: readonly ExchangeRate[], from: Currency, to: Currency): RateLookup | null {
  if (from === to) return null;
  const newest = (list: ExchangeRate[]) => list.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
  const direct = newest(rates.filter((r) => r.from === from && r.to === to && r.rate > 0));
  if (direct) return { factor: direct.rate, rate: direct, inverse: false };
  const inv = newest(rates.filter((r) => r.from === to && r.to === from && r.rate > 0));
  if (inv) return { factor: 1 / inv.rate, rate: inv, inverse: true };
  return null;
}

export interface CombinedPart {
  currency: Currency;
  amount: number;
  /** Amount in the target currency, null when no rate is known. */
  converted: number | null;
  rate: RateLookup | null;
}

export interface CombinedTotal {
  target: Currency;
  /** Sum of the target-currency amount and every converted part. */
  total: number;
  parts: CombinedPart[];
  /** Currencies left out because no manual rate exists. */
  missing: Currency[];
}

export function combineAmounts(
  amounts: Partial<Record<Currency, number>>,
  target: Currency,
  rates: readonly ExchangeRate[],
): CombinedTotal {
  const parts: CombinedPart[] = [];
  const missing: Currency[] = [];
  let total = 0;
  for (const c of sortCurrencies(Object.keys(amounts) as Currency[])) {
    const amount = amounts[c] ?? 0;
    if (c === target) {
      parts.push({ currency: c, amount, converted: amount, rate: null });
      total += amount;
      continue;
    }
    const rate = c === 'UNKNOWN' || target === 'UNKNOWN' ? null : findRate(rates, c, target);
    if (!rate) {
      parts.push({ currency: c, amount, converted: null, rate: null });
      if (amount !== 0) missing.push(c);
      continue;
    }
    const converted = Math.round(amount * rate.factor);
    parts.push({ currency: c, amount, converted, rate });
    total += converted;
  }
  return { target, total, parts, missing };
}

/** Validate a user-entered rate (source and timestamp are mandatory). */
export function validateRate(input: {
  from: string;
  to: string;
  rate: number;
  source: string;
  at: string;
}): { ok: true; rate: ExchangeRate } | { ok: false; error: 'same_currency' | 'invalid' } {
  if (input.from === input.to) return { ok: false, error: 'same_currency' };
  const parsed = ExchangeRateSchema.safeParse({ ...input, source: input.source.trim() });
  if (
    !parsed.success ||
    !Number.isFinite(Date.parse(parsed.data.at)) ||
    parsed.data.from === 'UNKNOWN' ||
    parsed.data.to === 'UNKNOWN'
  )
    return { ok: false, error: 'invalid' };
  return { ok: true, rate: parsed.data };
}
