import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { EMPTY_FILTER, filterListings, isFilterActive, listingNodes, sortListings } from '@/features/listings/filters';
import { moveItem, reassignSortIndexes, saveLocalOrder } from '@/features/listings/reorder';
import { makeListing } from './helpers';

beforeEach(() => {
  resetDbForTests();
});

describe('local reordering', () => {
  it('moves items with clamped indices', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b', 'c'], 1, 99)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('keeps a re-ordered subset in its own sortIndex slots', () => {
    const old = [
      { id: 'a', sortIndex: 10 },
      { id: 'b', sortIndex: 20 },
      { id: 'c', sortIndex: 30 },
    ];
    expect(Object.fromEntries(reassignSortIndexes(old, ['c', 'a', 'b']))).toEqual({ c: 10, a: 20, b: 30 });
    // duplicates are spread so the new order is strict
    expect(Object.fromEntries(reassignSortIndexes([{ id: 'a', sortIndex: 0 }, { id: 'b', sortIndex: 0 }, { id: 'c', sortIndex: 0 }], ['b', 'c', 'a']))).toEqual({ b: 0, c: 1, a: 2 });
    expect(() => reassignSortIndexes(old, ['a', 'b'])).toThrow();
    expect(() => reassignSortIndexes(old, ['a', 'b', 'x'])).toThrow();
  });

  it('persists the order with a reorder backup', async () => {
    await getDb().listings.bulkAdd([makeListing('1', { sortIndex: 1 }), makeListing('2', { sortIndex: 2 }), makeListing('3', { sortIndex: 3 })]);
    const res = await saveLocalOrder(['3', '1', '2'], 'order');
    expect(res.changed).toBe(3);
    const sorted = (await getDb().listings.orderBy('sortIndex').toArray()).map((l) => l.id);
    expect(sorted).toEqual(['3', '1', '2']);
    expect((await getDb().backups.get(res.backupId!))!).toMatchObject({ kind: 'reorder' });
    expect(await saveLocalOrder(['3', '1', '2'], 'same')).toEqual({ changed: 0, backupId: null });
  });
});

describe('filters', () => {
  const ls = [
    makeListing('1', { title: 'Аккаунт Starter', categoryName: 'A', promoted: true }, 5_000),
    makeListing('2', { title: 'Premium', titleEn: 'Premium EN', categoryName: 'B', active: false, autoDelivery: true }, 15_000),
    makeListing('3', { title: 'Boost', categoryName: 'A', nodeId: '777' }, 900, 'USD'),
  ];

  it('combines search, category, status, flags, price range and currency', () => {
    const ids = (f: Partial<typeof EMPTY_FILTER>) => filterListings(ls, { ...EMPTY_FILTER, ...f }).map((l) => l.id);
    expect(ids({})).toEqual(['1', '2', '3']);
    expect(ids({ query: 'аккаунт' })).toEqual(['1']);
    expect(ids({ query: 'premium en' })).toEqual(['2']);
    expect(ids({ query: '3' })).toEqual(['3']);
    expect(ids({ category: 'A' })).toEqual(['1', '3']);
    expect(ids({ status: 'inactive' })).toEqual(['2']);
    expect(ids({ promoted: 'yes' })).toEqual(['1']);
    expect(ids({ autoDelivery: 'no' })).toEqual(['1', '3']);
    expect(ids({ priceMinMinor: 1_000, priceMaxMinor: 10_000 })).toEqual(['1']);
    expect(ids({ currency: 'USD' })).toEqual(['3']);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
    expect(isFilterActive({ ...EMPTY_FILTER, query: ' x ' })).toBe(true);
  });

  it('sorts stably with unknown metrics last', () => {
    const metrics = new Map([
      ['1', { netMinor: 100, profitMinor: null }],
      ['2', { netMinor: 300, profitMinor: 50 }],
      ['3', { netMinor: null, profitMinor: 10 }],
    ]);
    expect(sortListings(ls, 'net', 'desc', metrics).map((l) => l.id)).toEqual(['2', '1', '3']);
    expect(sortListings(ls, 'net', 'asc', metrics).map((l) => l.id)).toEqual(['1', '2', '3']);
    expect(sortListings(ls, 'profit', 'asc', metrics).map((l) => l.id)).toEqual(['3', '2', '1']);
    expect(sortListings(ls, 'price', 'asc').map((l) => l.id)).toEqual(['3', '1', '2']);
    expect(sortListings(ls, 'title', 'asc').map((l) => l.id)).toEqual(['3', '2', '1']);
  });

  it('summarises subcategories with their most common name', () => {
    expect(listingNodes([...ls, makeListing('4', { categoryName: 'A' })])).toEqual([
      { nodeId: '501', name: 'A', count: 3, gameId: '41' },
      { nodeId: '777', name: 'A', count: 1, gameId: '41' },
    ]);
  });
});
