import { describe, expect, it } from 'vitest';
import { funpayParser } from '@/adapters/funpay';
import { balanceSeries, latestBalances } from '@/features/finance/balances';
import { cashFlowSeries, financeBreakdown, opState } from '@/features/finance/breakdown';
import { combineAmounts, findRate, validateRate } from '@/features/finance/exchange';
import { financeExport, FINANCE_EXPORT_HEADERS } from '@/features/finance/export';
import { financeKpis } from '@/features/finance/kpis';
import type { ExchangeRate, FinanceOperation, Listing } from '@/shared/models';
import { fixtureDoc } from '../../../fixtures';
import { mkOp, mkOrder, money } from '../analytics/dataset';

const NOW = new Date('2024-11-05T12:00:00Z');
const RANGE = { from: Date.parse('2024-09-30T21:00:00.000Z'), to: Date.parse('2024-11-05T21:00:00.000Z') }; // 1 Oct – 5 Nov MSK

function fixtureOps(): FinanceOperation[] {
  return funpayParser.parseFinance(fixtureDoc('balance.html'), NOW).map((o) => ({ ...o, firstSeenAt: NOW.toISOString() }));
}

const EXTRA: FinanceOperation[] = [
  mkOp({ id: 'x-cancelled', kind: 'withdrawal', amount: money(10000), status: 'cancel', at: '2024-10-20T10:00:00.000Z' }),
  mkOp({ id: 'x-refund', kind: 'refund', amount: money(3000), at: '2024-10-21T10:00:00.000Z' }),
  mkOp({ id: 'x-usd', kind: 'income', amount: money(1500, 'USD'), at: '2024-10-22T10:00:00.000Z' }),
  mkOp({ id: 'x-old', kind: 'income', amount: money(99999), at: '2024-09-01T10:00:00.000Z' }),
  mkOp({ id: 'x-undated', kind: 'income', amount: money(1), at: null }),
];

describe('finance breakdown', () => {
  const b = financeBreakdown([...fixtureOps(), ...EXTRA], RANGE);

  it('sums each kind per currency, keeps pending visible and excludes cancelled', () => {
    const rub = b.byCurrency.RUB!;
    expect(rub.amounts).toEqual({ income: 112000, expense: 6852, withdrawal: 50000, deposit: 5720, refund: 3000, other: 0 });
    expect(rub.pending.withdrawal).toBe(50000);
    expect(rub.cancelledCount).toBe(1);
    expect(rub.counts.income).toBe(1);
    expect(b.byCurrency.USD!.amounts.income).toBe(1500);
    expect(b.currencies).toEqual(['RUB', 'USD']);
    expect(b.undated).toBe(1);
  });

  it('cash flow = income − expenses − withdrawals (deposits and refunds excluded)', () => {
    expect(b.byCurrency.RUB!.cashFlow).toBe(112000 - 6852 - 50000);
    expect(b.byCurrency.USD!.cashFlow).toBe(1500);
  });

  it('classifies operation states', () => {
    expect(opState({ status: 'complete' })).toBe('complete');
    expect(opState({ status: 'waiting' })).toBe('pending');
    expect(opState({ status: 'cancel' })).toBe('cancelled');
    expect(opState({ status: 'Отменено' })).toBe('cancelled');
  });

  it('builds a gap-filled cash-flow series per currency (Moscow days)', () => {
    const week = { from: Date.parse('2024-10-26T21:00:00.000Z'), to: Date.parse('2024-10-31T21:00:00.000Z') }; // 27–31 Oct
    const s = cashFlowSeries(fixtureOps(), week, 'day').RUB!;
    expect(s.map((p) => [p.key, p.income, p.expense, p.withdrawal, p.net])).toEqual([
      ['2024-10-27', 0, 0, 0, 0],
      ['2024-10-28', 0, 0, 50000, -50000],
      ['2024-10-29', 0, 6852, 0, -6852],
      ['2024-10-30', 112000, 0, 0, 112000],
      ['2024-10-31', 0, 0, 0, 0],
    ]);
  });
});

describe('finance KPIs keep gross, net, cash flow and profit apart', () => {
  it('matches credits to orders and listing costs', () => {
    const orders = [
      mkOrder({ id: 'AAAA1111', description: 'Test item alpha, 1 шт.', price: money(125050), status: 'closed', createdAt: '2024-10-30T07:15:00.000Z' }),
      mkOrder({ id: 'ZZZZ0001', price: money(5000), status: 'refunded', createdAt: '2024-10-30T07:15:00.000Z' }),
      mkOrder({ id: 'ZZZZ0002', direction: 'purchase', price: money(6852), status: 'closed', createdAt: '2024-10-29T07:15:00.000Z' }),
    ];
    const listings = [{ id: '1', title: 'Test item alpha', costMinor: 50000, price: money(125050) }] as Pick<Listing, 'id' | 'title' | 'costMinor' | 'price'>[];
    const k = financeKpis({ orders, ops: fixtureOps(), listings, range: RANGE });
    expect(k.currencies).toEqual(['RUB']);
    const rub = k.byCurrency.RUB!;
    expect(rub.grossRevenue).toBe(125050); // refunded sale and purchase excluded
    expect(rub.grossOrders).toBe(1);
    expect(rub.netReceipts).toBe(112000);
    expect(rub.cashFlow).toBe(112000 - 6852 - 50000);
    expect(rub.cogs).toBe(50000);
    expect(rub.cogsKnownOps).toBe(1);
    expect(rub.estimatedProfit).toBe(112000 - 50000);
    expect(rub.observedFee.pct).toBeCloseTo(1 - 112000 / 125050, 10);
  });

  it('has no profit estimate without receipts', () => {
    const k = financeKpis({ orders: [mkOrder({ id: 'Q1', price: money(100), createdAt: '2024-10-10T10:00:00.000Z' })], ops: [], listings: [], range: RANGE });
    expect(k.byCurrency.RUB!.estimatedProfit).toBeNull();
    expect(k.byCurrency.RUB!.grossRevenue).toBe(100);
  });
});

describe('balance history', () => {
  const recs = [
    { balances: [money(100000)], at: '2024-10-01T10:00:00.000Z' },
    { balances: [money(150000)], at: '2024-10-10T10:00:00.000Z' },
    { balances: [money(2000, 'USD')], at: '2024-10-05T10:00:00.000Z' },
    { balances: [money(1)], at: 'not a date' },
  ];
  it('splits points per currency, sorted by time', () => {
    const s = balanceSeries(recs, null);
    expect(s.RUB!.map((p) => p.amount)).toEqual([100000, 150000]);
    expect(s.USD!.map((p) => p.amount)).toEqual([2000]);
    expect(balanceSeries(recs, { from: Date.parse('2024-10-05T00:00:00Z'), to: Date.parse('2024-11-01T00:00:00Z') }).RUB!.map((p) => p.amount)).toEqual([150000]);
  });
  it('returns the latest balance per currency', () => {
    expect(latestBalances(recs).map((b) => [b.currency, b.amount.amountMinor])).toEqual([
      ['RUB', 150000],
      ['USD', 2000],
    ]);
  });
});

describe('manual exchange rates (never silent conversion)', () => {
  const rates: ExchangeRate[] = [
    { from: 'USD', to: 'RUB', rate: 90, source: 'old note', at: '2024-10-01T00:00:00.000Z' },
    { from: 'USD', to: 'RUB', rate: 92.5, source: 'FunPay withdrawal page', at: '2024-11-01T00:00:00.000Z' },
  ];

  it('uses the newest direct rate, or the inverse of a stored rate', () => {
    expect(findRate(rates, 'USD', 'RUB')).toMatchObject({ factor: 92.5, inverse: false, rate: { source: 'FunPay withdrawal page' } });
    expect(findRate(rates, 'RUB', 'USD')).toMatchObject({ factor: 1 / 92.5, inverse: true });
    expect(findRate(rates, 'EUR', 'RUB')).toBeNull();
  });

  it('combines only currencies with a rate and reports the rest as missing', () => {
    const c = combineAmounts({ RUB: 10000, USD: 200, EUR: 100 }, 'RUB', rates);
    expect(c.total).toBe(10000 + 18500);
    expect(c.missing).toEqual(['EUR']);
    expect(c.parts.find((p) => p.currency === 'USD')!.rate!.rate.source).toBe('FunPay withdrawal page');
    expect(combineAmounts({ RUB: 9250, USD: 200 }, 'USD', rates).total).toBe(300);
    expect(combineAmounts({ UNKNOWN: 5 }, 'RUB', rates).missing).toEqual(['UNKNOWN']);
  });

  it('requires a source, a timestamp, a positive rate and two currencies', () => {
    expect(validateRate({ from: 'USD', to: 'RUB', rate: 92, source: 'bank', at: '2024-11-01T00:00:00.000Z' }).ok).toBe(true);
    expect(validateRate({ from: 'USD', to: 'USD', rate: 1, source: 'x', at: '2024-11-01T00:00:00.000Z' })).toEqual({ ok: false, error: 'same_currency' });
    expect(validateRate({ from: 'USD', to: 'RUB', rate: 92, source: '  ', at: '2024-11-01T00:00:00.000Z' })).toEqual({ ok: false, error: 'invalid' });
    expect(validateRate({ from: 'USD', to: 'RUB', rate: -1, source: 'x', at: '2024-11-01T00:00:00.000Z' })).toEqual({ ok: false, error: 'invalid' });
    expect(validateRate({ from: 'USD', to: 'RUB', rate: 92, source: 'x', at: 'yesterday' })).toEqual({ ok: false, error: 'invalid' });
  });
});

describe('finance export', () => {
  it('exports one row per operation with explicit currency', () => {
    const t = financeExport(fixtureOps());
    expect(t.headers).toEqual([...FINANCE_EXPORT_HEADERS]);
    expect(t.rows[0]).toEqual(['50000001', '2024-10-30T11:12:00.000Z', '30.10.2024 14:12', 'income', 'complete', 'complete', 1120, 'RUB', 'Заказ #AAAA1111', 'AAAA1111', 'https://funpay.com/orders/AAAA1111/']);
    expect(t.rows[2]![4]).toBe('pending');
  });
});
