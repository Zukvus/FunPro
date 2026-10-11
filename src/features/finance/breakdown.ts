/**
 * Finance operations (/account/balance) → per-currency breakdown and cash-flow series.
 *
 * Definitions:
 *  - Amounts are positive; the direction comes from the operation kind.
 *  - Cancelled operations are excluded; "waiting" operations are included and also reported as
 *    pending (they already affect the balance on FunPay).
 *  - Net cash flow = income − expenses − withdrawals. Deposits (top-ups) and refunds are shown
 *    separately and are NOT part of cash flow: deposits are owner transfers, and the balance list
 *    does not reliably show a refund's direction.
 */
import type { Currency, FinanceKind, FinanceOperation } from '@/shared/models';
import { sortCurrencies } from '@/features/orders/query';
import { enumerateBuckets, MSK_OFFSET_MINUTES, type DateRange, type Granularity } from '@/features/analytics/time';

export const FINANCE_KINDS: readonly FinanceKind[] = ['income', 'expense', 'withdrawal', 'deposit', 'refund', 'other'];

export type OpState = 'complete' | 'pending' | 'cancelled';

export function opState(op: Pick<FinanceOperation, 'status'>): OpState {
  const s = op.status.toLowerCase();
  if (/cancel|отмен|скасов/.test(s)) return 'cancelled';
  if (/wait|pending|ожида|очіку|processing|обработ/.test(s)) return 'pending';
  return 'complete';
}

export function opTime(op: Pick<FinanceOperation, 'at'>): number | null {
  if (!op.at) return null;
  const t = Date.parse(op.at);
  return Number.isFinite(t) ? t : null;
}

function zeroKinds(): Record<FinanceKind, number> {
  return { income: 0, expense: 0, withdrawal: 0, deposit: 0, refund: 0, other: 0 };
}

export interface CurrencyFinance {
  currency: Currency;
  /** Settled + pending amounts per kind (cancelled excluded). */
  amounts: Record<FinanceKind, number>;
  counts: Record<FinanceKind, number>;
  /** The pending ("waiting") part of `amounts`. */
  pending: Record<FinanceKind, number>;
  /** income − expense − withdrawal */
  cashFlow: number;
  cancelledCount: number;
}

export interface FinanceBreakdown {
  currencies: Currency[];
  byCurrency: Partial<Record<Currency, CurrencyFinance>>;
  /** Operations considered (in range, any state). */
  total: number;
  /** Operations without a parseable date (excluded when a range is applied). */
  undated: number;
}

export function cashFlowOf(a: Record<FinanceKind, number>): number {
  return a.income - a.expense - a.withdrawal;
}

export function financeBreakdown(ops: readonly FinanceOperation[], range: DateRange | null): FinanceBreakdown {
  const byCurrency: Partial<Record<Currency, CurrencyFinance>> = {};
  let total = 0;
  let undated = 0;
  for (const op of ops) {
    if (range) {
      const t = opTime(op);
      if (t === null) {
        undated++;
        continue;
      }
      if (t < range.from || t >= range.to) continue;
    }
    total++;
    const c = op.amount.currency;
    const rec = (byCurrency[c] ??= { currency: c, amounts: zeroKinds(), counts: zeroKinds(), pending: zeroKinds(), cashFlow: 0, cancelledCount: 0 });
    const state = opState(op);
    if (state === 'cancelled') {
      rec.cancelledCount++;
      continue;
    }
    rec.amounts[op.kind] += op.amount.amountMinor;
    rec.counts[op.kind]++;
    if (state === 'pending') rec.pending[op.kind] += op.amount.amountMinor;
  }
  for (const rec of Object.values(byCurrency)) if (rec) rec.cashFlow = cashFlowOf(rec.amounts);
  return { currencies: sortCurrencies(Object.keys(byCurrency) as Currency[]), byCurrency, total, undated };
}

export interface CashFlowPoint {
  key: string;
  start: number;
  end: number;
  income: number;
  expense: number;
  withdrawal: number;
  /** income − expense − withdrawal */
  net: number;
}

/** Gap-filled cash-flow series per currency. */
export function cashFlowSeries(
  ops: readonly FinanceOperation[],
  range: DateRange,
  granularity: Granularity,
  offsetMinutes = MSK_OFFSET_MINUTES,
): Partial<Record<Currency, CashFlowPoint[]>> {
  const buckets = enumerateBuckets(range, granularity, offsetMinutes);
  const out: Partial<Record<Currency, CashFlowPoint[]>> = {};
  for (const op of ops) {
    if (op.kind !== 'income' && op.kind !== 'expense' && op.kind !== 'withdrawal') continue;
    if (opState(op) === 'cancelled') continue;
    const t = opTime(op);
    if (t === null || t < range.from || t >= range.to) continue;
    const idx = buckets.findIndex((b) => t >= b.start && t < b.end);
    if (idx < 0) continue;
    const series = (out[op.amount.currency] ??= buckets.map((b) => ({ key: b.key, start: b.start, end: b.end, income: 0, expense: 0, withdrawal: 0, net: 0 })));
    const p = series[idx]!;
    p[op.kind] += op.amount.amountMinor;
    p.net = p.income - p.expense - p.withdrawal;
  }
  return out;
}
