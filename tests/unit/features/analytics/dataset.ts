import type { Currency, FinanceOperation, Order, OrderStatus } from '@/shared/models';

/** Build a complete Order with sensible defaults (tests only). */
export function mkOrder(p: Partial<Order> & { id: string }): Order {
  const status: OrderStatus = p.status ?? 'closed';
  return {
    direction: 'sale',
    status,
    counterpartyName: 'Buyer',
    counterpartyId: '2000001',
    description: 'Item',
    categoryName: 'Game A, Accounts',
    listingId: null,
    price: { amountMinor: 1000, currency: 'RUB' },
    createdAt: '2024-11-01T10:00:00.000Z',
    rawDate: '',
    firstSeenAt: '2024-11-05T00:00:00.000Z',
    updatedAt: '2024-11-05T00:00:00.000Z',
    history: [{ status, at: '2024-11-05T00:00:00.000Z', source: 'observed' }],
    ...p,
  };
}

export const money = (amountMinor: number, currency: Currency = 'RUB') => ({ amountMinor, currency });

export function mkOp(p: Partial<FinanceOperation> & { id: string }): FinanceOperation {
  return {
    kind: 'income',
    amount: money(1000),
    at: '2024-11-01T10:00:00.000Z',
    rawDate: '',
    description: '',
    status: 'complete',
    orderId: null,
    firstSeenAt: '2024-11-05T00:00:00.000Z',
    ...p,
  };
}

const h = (status: OrderStatus) => ({ status, at: '2024-11-05T00:00:00.000Z', source: 'observed' as const });

/**
 * Hand-computed dataset. Moscow time = UTC+3. Current period: 1–5 Nov 2024 (MSK) =
 * [2024-10-31T21:00Z, 2024-11-05T21:00Z). Previous period (same length): 27–31 Oct (MSK).
 */
export const DATASET: Order[] = [
  // Previous period
  mkOrder({ id: 'PREV0001', createdAt: '2024-10-28T10:00:00.000Z', price: money(50000), status: 'closed' }),
  mkOrder({
    id: 'PREV0002',
    createdAt: '2024-10-29T10:00:00.000Z',
    price: money(2000, 'USD'),
    status: 'closed',
  }),
  // 31 Oct 23:59 MSK → previous period (one minute before the boundary)
  mkOrder({ id: 'A1000001', createdAt: '2024-10-31T20:59:00.000Z', price: money(1000), status: 'closed' }),
  // 1 Nov 00:00 MSK exactly → current period, day 2024-11-01 (Friday, hour 0)
  mkOrder({
    id: 'A2000002',
    createdAt: '2024-10-31T21:00:00.000Z',
    price: money(100000),
    status: 'closed',
    history: [h('paid'), h('closed')],
  }),
  // 1 Nov 23:59:59 MSK → still 1 Nov (Friday, hour 23)
  mkOrder({
    id: 'A3000003',
    createdAt: '2024-11-01T20:59:59.000Z',
    price: money(4000, 'USD'),
    status: 'paid',
    history: [h('paid')],
  }),
  // 2 Nov 00:00 MSK (Saturday, hour 0) — refunded before confirmation
  mkOrder({
    id: 'A4000004',
    createdAt: '2024-11-01T21:00:00.000Z',
    price: money(50000),
    status: 'refunded',
    categoryName: 'Game B, Currency',
    history: [h('paid'), h('refunded')],
  }),
  // 3 Nov 12:30 MSK (Sunday, hour 12)
  mkOrder({
    id: 'A5000005',
    createdAt: '2024-11-03T09:30:00.000Z',
    price: money(25050),
    status: 'closed',
    categoryName: 'Game B, Currency',
  }),
  // 4 Nov 14:00 MSK (Monday, hour 14) — first seen already refunded (unknown timing)
  mkOrder({
    id: 'A6000006',
    createdAt: '2024-11-04T11:00:00.000Z',
    price: money(1550, 'EUR'),
    status: 'refunded',
    categoryName: 'Game C, Items',
    history: [h('refunded')],
  }),
  // 5 Nov 23:59 MSK (Tuesday, hour 23) — refunded after completion
  mkOrder({
    id: 'A7000007',
    createdAt: '2024-11-05T20:59:00.000Z',
    price: money(1000, 'USD'),
    status: 'refunded',
    history: [h('closed'), h('refunded')],
  }),
  // 6 Nov 00:00 MSK → outside the current period
  mkOrder({ id: 'A9000009', createdAt: '2024-11-05T21:00:00.000Z', price: money(99900), status: 'closed' }),
  // Undated sale
  mkOrder({ id: 'A8000008', createdAt: null, price: money(777), status: 'paid' }),
  // A purchase inside the period (must never count as a sale)
  mkOrder({
    id: 'P1000001',
    direction: 'purchase',
    createdAt: '2024-11-02T10:00:00.000Z',
    price: money(30000),
    status: 'closed',
    counterpartyName: 'SellerX',
  }),
];

export const CURRENT = {
  from: Date.parse('2024-10-31T21:00:00.000Z'),
  to: Date.parse('2024-11-05T21:00:00.000Z'),
};
export const PREVIOUS = {
  from: Date.parse('2024-10-26T21:00:00.000Z'),
  to: Date.parse('2024-10-31T21:00:00.000Z'),
};
export const NOW = Date.parse('2024-11-05T12:00:00.000Z');
