import { describe, expect, it } from 'vitest';
import { computeSalesPanel, salesPanelRange } from '@/features/orders/sales-panel';
import { SalesPanelDataSchema } from '@/features/orders/sales-panel-schema';
import { mkOrder, money } from '../analytics/dataset';

/** 5 Nov 2024, 15:00 Moscow time. */
const NOW = Date.parse('2024-11-05T12:00:00.000Z');
const DAY = 86_400_000;
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const ORDERS = [
  // today
  mkOrder({
    id: 'T0000001',
    createdAt: at(0),
    status: 'paid',
    price: money(50000),
    counterpartyId: '1',
    counterpartyName: 'Alpha',
    description: 'Steam key, 2 шт.',
  }),
  mkOrder({
    id: 'T0000002',
    createdAt: at(0),
    status: 'closed',
    price: money(1000, 'USD'),
    counterpartyId: '2',
    counterpartyName: 'Beta',
    description: 'Gold 100',
  }),
  // this week
  mkOrder({
    id: 'W0000001',
    createdAt: at(2),
    status: 'closed',
    price: money(30000),
    counterpartyId: '1',
    counterpartyName: 'Alpha',
    description: 'Steam key',
  }),
  mkOrder({
    id: 'W0000002',
    createdAt: at(3),
    status: 'closed',
    price: money(10000),
    counterpartyId: '3',
    counterpartyName: 'Gamma',
    description: 'Steam key, 3 шт.',
    categoryName: 'Game B, Keys',
  }),
  mkOrder({
    id: 'W0000003',
    createdAt: at(4),
    status: 'refunded',
    price: money(7000),
    counterpartyId: '4',
    counterpartyName: 'Delta',
    description: 'Gold 100',
  }),
  mkOrder({
    id: 'W0000004',
    createdAt: at(5),
    status: 'closed',
    price: money(4000, 'USD'),
    counterpartyId: '1',
    counterpartyName: 'Alpha',
    description: 'Gold 100',
  }),
  // older than 30 days
  mkOrder({
    id: 'OLD00001',
    createdAt: at(45),
    status: 'closed',
    price: money(99900),
    counterpartyId: '5',
    counterpartyName: 'Epsilon',
  }),
  // undated sale and a purchase: never counted in a period
  mkOrder({ id: 'NODATE01', createdAt: null, status: 'closed', price: money(12345) }),
  mkOrder({ id: 'BUY00001', direction: 'purchase', createdAt: at(1), status: 'closed', price: money(77700) }),
];

describe('sales statistics for the FunPay sales page panel', () => {
  it('summarises a period per currency without ever mixing currencies', () => {
    const d = computeSalesPanel(ORDERS, '30d', NOW);
    expect(SalesPanelDataSchema.parse(d)).toEqual(d);
    expect(d).toMatchObject({
      orders: 6,
      closed: 4,
      pending: 1,
      refunded: 1,
      unknownStatus: 0,
      uniqueBuyers: 4,
    });
    expect(d.currencies).toEqual([
      {
        currency: 'RUB',
        earned: 40000,
        closedOrders: 2,
        pending: 50000,
        pendingOrders: 1,
        refunded: 7000,
        refundedOrders: 1,
        average: 20000,
        biggest: 30000,
      },
      {
        currency: 'USD',
        earned: 5000,
        closedOrders: 2,
        pending: 0,
        pendingOrders: 0,
        refunded: 0,
        refundedOrders: 0,
        // Per currency: 5000 / 2 USD orders — not divided by every closed order of every currency.
        average: 2500,
        biggest: 4000,
      },
    ]);
  });

  it('ranks buyers, products (quantity suffix ignored) and categories', () => {
    const d = computeSalesPanel(ORDERS, '30d', NOW);
    expect(d.topBuyers[0]).toEqual({
      name: 'Alpha',
      orders: 3,
      amounts: [
        { currency: 'RUB', amountMinor: 80000 },
        { currency: 'USD', amountMinor: 4000 },
      ],
    });
    // Refunded-only buyers are not "top buyers".
    expect(d.topBuyers.map((b) => b.name)).not.toContain('Delta');
    // Ties go to the product with fewer refunds ("Gold 100" had one), as in the dashboard ranking.
    expect(d.topProducts.map((p) => [p.name, p.orders])).toEqual([
      ['Steam key', 2],
      ['Gold 100', 2],
      ['Steam key', 1],
    ]);
    expect(d.topCategories.map((c) => [c.name, c.orders])).toEqual([
      ['Game A, Accounts', 4],
      ['Game B, Keys', 1],
    ]);
  });

  it('builds a gap-filled daily series and reports what FunPro has stored', () => {
    const d = computeSalesPanel(ORDERS, '30d', NOW);
    expect(d.granularity).toBe('day');
    expect(d.series).toHaveLength(30);
    expect(d.series.reduce((n, p) => n + p.orders, 0)).toBe(6);
    expect(d.series.at(-1)!.orders).toBe(2);
    expect(d.coverage).toEqual({ stored: 8, oldest: NOW - 45 * DAY, undated: 1 });
  });

  it('supports today, 7 days and all time (Moscow calendar days)', () => {
    expect(computeSalesPanel(ORDERS, 'today', NOW)).toMatchObject({ orders: 2, closed: 1, pending: 1 });
    expect(computeSalesPanel(ORDERS, '7d', NOW).orders).toBe(6);
    const all = computeSalesPanel(ORDERS, 'all', NOW);
    expect(all.orders).toBe(7);
    expect(all.granularity).toBe('day');
    // Today in Moscow starts at 21:00 UTC the day before.
    expect(salesPanelRange('today', NOW, [])).toEqual({
      from: Date.parse('2024-11-04T21:00:00.000Z'),
      to: Date.parse('2024-11-05T21:00:00.000Z'),
    });
  });

  it('is empty, not invented, when nothing was stored', () => {
    const d = computeSalesPanel([], 'all', NOW);
    expect(d).toMatchObject({ orders: 0, uniqueBuyers: 0, currencies: [], topBuyers: [] });
    expect(d.coverage).toEqual({ stored: 0, oldest: null, undated: 0 });
  });
});
