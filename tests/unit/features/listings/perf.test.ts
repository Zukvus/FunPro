import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/settings/schema';
import { buildBulkPlan, summarizePlan } from '@/features/listings/bulk-plan';
import { listingEconomics } from '@/features/listings/commission';
import { EMPTY_FILTER, filterListings, listingCategories, sortListings } from '@/features/listings/filters';
import type { Listing } from '@/shared/models';
import { makeListing } from './helpers';

function generate(n: number): Listing[] {
  const out: Listing[] = [];
  for (let i = 0; i < n; i++) {
    out.push(
      makeListing(
        String(1_000_000 + i),
        {
          title: `${i % 3 ? 'Аккаунт' : 'Account'} #${i} level ${i % 90}`,
          categoryName: `Game ${i % 40} — Category ${i % 7}`,
          nodeId: String(500 + (i % 120)),
          active: i % 5 !== 0,
          promoted: i % 11 === 0,
          autoDelivery: i % 4 === 0,
          costMinor: i % 2 ? (i % 997) * 10 : null,
          sortIndex: n - i,
        },
        100 + ((i * 7919) % 500_000),
        i % 13 === 0 ? 'USD' : 'RUB',
      ),
    );
  }
  return out;
}

describe('large datasets (10k listings)', () => {
  const listings = generate(10_000);
  const fees = defaultSettings().fees;
  fees.defaultCommissionPct = 8;

  it('filters, sorts and plans in well under a second', () => {
    const t0 = performance.now();
    const filtered = filterListings(listings, {
      ...EMPTY_FILTER,
      query: 'аккаунт',
      status: 'active',
      priceMinMinor: 1_000,
      priceMaxMinor: 400_000,
    });
    const economics = new Map(listings.map((l) => [l.id, listingEconomics(l, fees)]));
    const sorted = sortListings(listings, 'profit', 'desc', economics);
    const cats = listingCategories(listings);
    const plan = buildBulkPlan(
      listings,
      { kind: 'adjust_pct', pct: 7.5, rounding: 'end_99' },
      { fees, now: 0 },
    );
    const summary = summarizePlan(plan);
    const elapsed = performance.now() - t0;

    expect(filtered.length).toBeGreaterThan(0);
    expect(
      filtered.every(
        (l) =>
          l.active &&
          l.title.startsWith('Аккаунт') &&
          l.price.amountMinor >= 1_000 &&
          l.price.amountMinor <= 400_000,
      ),
    ).toBe(true);
    expect(sorted).toHaveLength(10_000);
    expect(cats.length).toBeGreaterThan(0);
    expect(plan.items).toHaveLength(10_000);
    expect(summary.tooLarge).toBe(true); // execution refuses > MAX_EXECUTABLE_ITEMS
    expect(elapsed).toBeLessThan(1000);
  });

  it('filters repeatedly (typing in the search box) quickly', () => {
    const t0 = performance.now();
    for (const q of ['a', 'ак', 'акк', 'level', 'level 4', '#99', 'game 3'])
      filterListings(listings, { ...EMPTY_FILTER, query: q });
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
