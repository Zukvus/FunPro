import { describe, expect, it } from 'vitest';
import {
  listingsWithoutSales,
  productPerformance,
  rankProducts,
  uniqueTitleIndex,
} from '@/features/analytics/products';
import {
  commissionFor,
  creditsByOrder,
  netFromBuyerPrice,
  orderNet,
  profitByProduct,
  profitTotals,
  type FeeSettings,
} from '@/features/analytics/profit';
import type { Listing } from '@/shared/models';
import { mkOp, mkOrder, money } from './dataset';

const RANGE = { from: Date.parse('2024-10-31T21:00:00.000Z'), to: Date.parse('2024-11-05T21:00:00.000Z') };
const AT = '2024-11-02T10:00:00.000Z';

function listing(p: Partial<Listing> & { id: string; title: string }): Listing {
  return {
    nodeId: null,
    gameId: null,
    categoryName: '',
    price: money(10000),
    amount: null,
    active: true,
    promoted: false,
    autoDelivery: false,
    costMinor: null,
    sortIndex: 0,
    seenAt: AT,
    updatedAt: AT,
    ...p,
  };
}

const ORDERS = [
  mkOrder({
    id: 'B1000001',
    description: 'Steam key X, 2 шт.',
    categoryName: 'Game A, Keys',
    price: money(20000),
    status: 'closed',
    createdAt: AT,
  }),
  mkOrder({
    id: 'B2000002',
    description: 'Steam key X',
    categoryName: 'Game A, Keys',
    price: money(10000),
    status: 'paid',
    createdAt: AT,
  }),
  mkOrder({
    id: 'B3000003',
    description: 'Steam key X',
    categoryName: 'Game A, Keys',
    price: money(10000),
    status: 'refunded',
    createdAt: AT,
  }),
  mkOrder({
    id: 'B4000004',
    description: 'Boost',
    categoryName: 'Game B, Service',
    price: money(5000, 'USD'),
    status: 'closed',
    createdAt: AT,
  }),
  mkOrder({
    id: 'B5000005',
    description: 'Mystery',
    categoryName: 'Game C, Misc',
    price: money(1000, 'EUR'),
    status: 'closed',
    createdAt: AT,
  }),
  // Outside the range and a purchase: ignored everywhere.
  mkOrder({
    id: 'B6000006',
    description: 'Steam key X',
    categoryName: 'Game A, Keys',
    price: money(10000),
    createdAt: '2024-10-01T10:00:00.000Z',
  }),
  mkOrder({
    id: 'B7000007',
    direction: 'purchase',
    description: 'Steam key X',
    categoryName: 'Game A, Keys',
    price: money(10000),
    createdAt: AT,
  }),
];

const LISTINGS = [
  listing({ id: '9001', title: 'Steam key X', costMinor: 5000, categoryName: 'Game A Keys' }),
  listing({ id: '9002', title: 'Boost', costMinor: 1000, price: money(300) }), // RUB cost, sold in USD
  listing({ id: '9003', title: 'Unsold thing' }),
  listing({ id: '9004', title: 'Duplicate' }),
  listing({ id: '9005', title: 'duplicate ' }),
  listing({ id: '9006', title: 'Inactive', active: false }),
];

const OPS = [
  mkOp({
    id: 'op1',
    kind: 'income',
    orderId: 'B1000001',
    amount: money(18000),
    at: '2024-11-03T10:00:00.000Z',
  }),
];

describe('product performance', () => {
  const rows = productPerformance(ORDERS, LISTINGS, { range: RANGE });

  it('groups by description without the quantity suffix and links unique titles', () => {
    const key = rows.find((r) => r.title === 'Steam key X')!;
    expect(key).toMatchObject({
      category: 'Game A, Keys',
      orders: 2,
      refunded: 1,
      units: 3,
      grossByCurrency: { RUB: 30000 },
      listingId: '9001',
      listingMatch: 'title',
    });
    expect(rows.find((r) => r.title === 'Mystery')!.listingId).toBeNull();
    expect(uniqueTitleIndex(LISTINGS).has('duplicate')).toBe(false);
    expect(rows).toHaveLength(3);
  });

  it('ranks best/worst by count, and by revenue only within one currency', () => {
    expect(rankProducts(rows, { by: 'orders', order: 'best', limit: 1 }).map((r) => r.title)).toEqual([
      'Steam key X',
    ]);
    expect(rankProducts(rows, { by: 'orders', order: 'worst', limit: 3 }).map((r) => r.title)).toEqual([
      'Boost',
      'Mystery',
      'Steam key X',
    ]);
    expect(
      rankProducts(rows, { by: 'revenue', currency: 'USD', order: 'best', limit: 5 }).map((r) => r.title),
    ).toEqual(['Boost']);
    expect(rankProducts(rows, { by: 'revenue', order: 'best', limit: 5 })).toEqual([]);
  });

  it('lists active listings without sales', () => {
    expect(listingsWithoutSales(LISTINGS, rows).map((l) => l.id)).toEqual(['9003', '9004', '9005']);
  });
});

describe('profit estimate', () => {
  const fees: FeeSettings = { categoryCommissionPct: { 'Game A, Keys': 10 }, defaultCommissionPct: null };

  it('uses credited amounts, then commission %, then gross — and listing costs per unit', () => {
    const rows = profitByProduct(ORDERS, LISTINGS, OPS, { range: RANGE, fees });
    const key = rows.find((r) => r.title === 'Steam key X')!;
    expect(key).toMatchObject({
      currency: 'RUB',
      orders: 2,
      units: 3,
      gross: 30000,
      net: 18000 + 9091, // B1 credited; B2 = 10000 / 1.10
      netActualOrders: 1,
      netEstimatedOrders: 1,
      netGrossOrders: 0,
      commissionPct: 10,
      cost: 15000, // 3 units × 50 ₽
      costKnownOrders: 2,
      profit: 27091 - 15000,
      complete: true,
    });
    const boost = rows.find((r) => r.title === 'Boost')!;
    expect(boost).toMatchObject({
      currency: 'USD',
      net: 5000,
      netGrossOrders: 1,
      cost: 0,
      costCurrencyMismatch: 1,
      profit: 5000,
      complete: false,
    });
    const mystery = rows.find((r) => r.title === 'Mystery')!;
    expect(mystery).toMatchObject({ currency: 'EUR', costUnknownOrders: 1, profit: 1000, complete: false });
    expect(profitTotals(rows).find((t) => t.currency === 'RUB')).toEqual({
      currency: 'RUB',
      orders: 2,
      gross: 30000,
      net: 27091,
      cost: 15000,
      profit: 12091,
      complete: true,
    });
  });

  it('without any commission or cost information profit equals gross (flagged incomplete)', () => {
    const rows = profitByProduct(ORDERS, [], [], {
      range: RANGE,
      fees: { categoryCommissionPct: {}, defaultCommissionPct: null },
    });
    for (const r of rows) {
      expect(r.profit).toBe(r.gross);
      expect(r.complete).toBe(false);
    }
  });

  it('applies the default commission when a category has none', () => {
    const rows = profitByProduct(ORDERS, LISTINGS, [], {
      range: RANGE,
      fees: { categoryCommissionPct: {}, defaultCommissionPct: 5 },
    });
    expect(rows.find((r) => r.title === 'Boost')!.net).toBe(4762); // 5000 / 1.05
  });

  it('commission lookup order: order category, listing category, game, default', () => {
    const f: FeeSettings = {
      categoryCommissionPct: { 'Game A, Keys': 1, 'Game A Keys': 2, 'Game B': 3 },
      defaultCommissionPct: 9,
    };
    expect(commissionFor(f, 'Game A, Keys', 'Game A Keys')).toBe(1);
    expect(commissionFor(f, 'Game A, Other', 'Game A Keys')).toBe(2);
    expect(commissionFor(f, 'Game B, Anything')).toBe(3);
    expect(commissionFor(f, 'Game Z, X')).toBe(9);
    expect(netFromBuyerPrice(11000, 10)).toBe(10000);
  });

  it('ignores cancelled credits and credits in another currency', () => {
    const credits = creditsByOrder([
      mkOp({ id: 'c1', orderId: 'B1000001', amount: money(18000), status: 'cancel' }),
      mkOp({ id: 'c2', orderId: 'B1000001', amount: money(200, 'USD') }),
    ]);
    const n = orderNet(ORDERS[0]!, credits, { categoryCommissionPct: {}, defaultCommissionPct: null });
    expect(n).toEqual({ net: 20000, basis: 'gross', commissionPct: null });
  });
});
