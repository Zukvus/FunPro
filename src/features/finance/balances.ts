/**
 * Balance history. Points come from the balance badge in FunPay's header, recorded whenever it
 * changes (and at most hourly otherwise) while a FunPay tab is open — so the history has gaps
 * whenever FunPay was not open. One series per currency.
 */
import type { Balance, Currency, Money } from '@/shared/models';
import { sortCurrencies } from '@/features/orders/query';
import type { DateRange } from '@/features/analytics/time';

export interface BalancePoint {
  at: number;
  amount: number;
}

export function balanceSeries(records: readonly Balance[], range: DateRange | null): Partial<Record<Currency, BalancePoint[]>> {
  const out: Partial<Record<Currency, BalancePoint[]>> = {};
  for (const r of records) {
    const at = Date.parse(r.at);
    if (!Number.isFinite(at)) continue;
    if (range && (at < range.from || at >= range.to)) continue;
    for (const m of r.balances) (out[m.currency] ??= []).push({ at, amount: m.amountMinor });
  }
  for (const list of Object.values(out)) list?.sort((a, b) => a.at - b.at);
  return out;
}

/** Most recent known balance per currency. */
export function latestBalances(records: readonly Balance[]): { currency: Currency; amount: Money; at: string }[] {
  const latest = new Map<Currency, { amount: Money; at: string; ts: number }>();
  for (const r of records) {
    const ts = Date.parse(r.at);
    if (!Number.isFinite(ts)) continue;
    for (const m of r.balances) {
      const prev = latest.get(m.currency);
      if (!prev || ts >= prev.ts) latest.set(m.currency, { amount: m, at: r.at, ts });
    }
  }
  return sortCurrencies(latest.keys()).map((c) => {
    const v = latest.get(c)!;
    return { currency: c, amount: v.amount, at: v.at };
  });
}
