import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings, mergeSettings } from '@/core/settings/schema';
import {
  canCompare,
  isTitleUnique,
  loadComparison,
  marketPositionFor,
  salesFor,
} from '@/features/listings/compare';
import { bestIndex } from '@/dashboard/pages/listings/CompareDialog';
import type { CompetitorSnapshot, Listing, Order } from '@/shared/models';

const NOW = Date.parse('2024-11-05T12:00:00Z');

function listing(id: string, over: Partial<Listing> = {}): Listing {
  return {
    id,
    nodeId: '501',
    gameId: '41',
    categoryName: 'Game A',
    title: `Offer ${id}`,
    price: { amountMinor: 20000, currency: 'RUB' },
    amount: 5,
    active: true,
    promoted: false,
    autoDelivery: false,
    costMinor: null,
    sortIndex: 0,
    seenAt: '',
    updatedAt: '',
    ...over,
  };
}

function order(id: string, description: string, status: Order['status'], minor: number, daysAgo = 1): Order {
  const at = new Date(NOW - daysAgo * 86400_000).toISOString();
  return {
    id,
    direction: 'sale',
    status,
    counterpartyName: 'b',
    counterpartyId: null,
    description,
    categoryName: 'Game A',
    listingId: null,
    price: { amountMinor: minor, currency: 'RUB' },
    createdAt: at,
    rawDate: '',
    firstSeenAt: at,
    updatedAt: at,
    history: [],
  };
}

function snap(offerId: string, priceMinor: number, seller: string, minutesAgo = 10): CompetitorSnapshot {
  const at = new Date(NOW - minutesAgo * 60_000).toISOString();
  return {
    id: `501:${offerId}:${at}`,
    at,
    offerId,
    nodeId: '501',
    sellerName: seller,
    sellerId: null,
    title: 'Offer 1 similar',
    price: { amountMinor: priceMinor, currency: 'RUB' },
    amount: null,
    online: null,
    promoted: false,
    rating: null,
    reviewCount: null,
  };
}

beforeEach(() => {
  resetDbForTests();
});

describe('listing comparison', () => {
  it('accepts 2–4 listings only', () => {
    expect(canCompare(1)).toBe(false);
    expect(canCompare(2)).toBe(true);
    expect(canCompare(4)).toBe(true);
    expect(canCompare(5)).toBe(false);
  });

  it('computes market position against competitors, never against own offers', () => {
    const own = { listingIds: ['1', '2'], sellerId: null, sellerName: 'Me' };
    const pos = marketPositionFor(
      listing('1'),
      [snap('c1', 18000, 'A'), snap('c2', 21000, 'B'), snap('2', 10000, 'Me')],
      own,
    );
    expect(pos).toMatchObject({ count: 2, lowestMinor: 18000, rank: 2, total: 3 });
    expect(marketPositionFor(listing('1'), [], own)).toBeNull();
  });

  it('attributes 30-day sales only to listings with a unique title', () => {
    const ls = [
      listing('1', { title: 'Alpha' }),
      listing('2', { title: 'Beta' }),
      listing('3', { title: 'Beta' }),
    ];
    const orders = [
      order('A', 'Alpha', 'closed', 1000),
      order('B', 'Alpha, 2 шт.', 'refunded', 500),
      order('C', 'Alpha', 'paid', 1000, 40),
      order('D', 'Beta', 'closed', 700),
    ];
    const sales = salesFor(ls, ls, orders, NOW);
    expect(sales.get('1')).toMatchObject({ orders: 1, refunded: 1 });
    expect(sales.has('2')).toBe(false);
    expect(isTitleUnique(ls[0]!, ls)).toBe(true);
    expect(isTitleUnique(ls[1]!, ls)).toBe(false);
  });

  it('loads columns with economics from settings and unknown sales for ambiguous titles', async () => {
    const db = getDb();
    await db.listings.bulkAdd([
      listing('1', { title: 'Alpha', costMinor: 10000 }),
      listing('2', { title: 'Beta', price: { amountMinor: 30000, currency: 'RUB' } }),
      listing('3', { title: 'Beta' }),
    ]);
    await db.orders.add(order('A', 'Alpha', 'closed', 20000));
    await db.competitorSnapshots.bulkAdd([snap('c1', 18000, 'A', 30)]);
    const settings = mergeSettings(defaultSettings(), { fees: { defaultCommissionPct: 10 } });
    const cols = await loadComparison(['1', '2'], settings, NOW);
    expect(cols.map((c) => c.listing.id)).toEqual(['1', '2']);
    expect(cols[0]!.economics.netMinor).not.toBeNull();
    expect(cols[0]!.economics.profitMinor).toBe(cols[0]!.economics.netMinor! - 10000);
    expect(cols[0]!.economics.estimate).toBe(true);
    expect(cols[0]!.sales).toMatchObject({ orders: 1 });
    expect(cols[1]!.sales).toBeNull();
    expect(cols[0]!.market).toMatchObject({ lowestMinor: 18000 });
    await expect(loadComparison(['1'], settings, NOW)).rejects.toThrow();
  });

  it('highlights a single best value and never across currencies', () => {
    expect(bestIndex([5, 9, 3], 'higher')).toBe(1);
    expect(bestIndex([5, 9, 3], 'lower')).toBe(2);
    expect(bestIndex([9, 9, 3], 'higher')).toBe(-1);
    expect(bestIndex([5, null], 'higher')).toBe(-1);
    expect(bestIndex([5, 9], 'higher', ['RUB', 'USD'])).toBe(-1);
    expect(bestIndex([5, 9], null)).toBe(-1);
  });
});
