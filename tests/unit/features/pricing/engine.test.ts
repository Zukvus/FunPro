import { describe, expect, it } from 'vitest';
import { marginFloor, recommendPrice, type RepriceInput } from '@/features/pricing/engine';
import { buildHistory, classifyOffers, marketStats, stateAt, type MarketOffer } from '@/features/pricing/market';
import { PriceRuleExtSchema, type PriceRuleExt } from '@/features/pricing/model';
import { titleSimilarity } from '@/features/pricing/similarity';
import type { CompetitorSnapshot, Currency } from '@/shared/models';

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const MIN = 60_000;

function rule(over: Partial<PriceRuleExt> = {}): PriceRuleExt {
  return PriceRuleExtSchema.parse({ listingId: 'L1', minMinor: 5000, maxMinor: 20000, stepMinor: 100, strategy: 'undercut_lowest', ...over });
}

function offer(offerId: string, priceMinor: number, over: Partial<MarketOffer> = {}, currency: Currency = 'RUB'): MarketOffer {
  return { offerId, sellerId: `s-${offerId}`, sellerName: `seller-${offerId}`, title: 'Gems 100 fast', price: { amountMinor: priceMinor, currency }, at: NOW, promoted: false, online: true, rating: 5, reviewCount: 10, changeTimes: [], ...over };
}

function input(over: Partial<RepriceInput> = {}): RepriceInput {
  return {
    rule: rule(),
    listing: { id: 'L1', title: 'Gems 100 fast' },
    currentPriceMinor: 10000,
    currency: 'RUB',
    costMinor: null,
    commissionPct: null,
    offers: [offer('a', 9000), offer('b', 9500), offer('c', 11000)],
    own: { listingIds: ['L1', 'L2'], sellerId: '100', sellerName: 'Me' },
    appliedAt: [],
    now: NOW,
    ...over,
  };
}

describe('strategies', () => {
  it('undercut_lowest goes one step below the cheapest comparable offer', () => {
    const r = recommendPrice(input());
    expect(r).toMatchObject({ action: 'change', idealMinor: 8900, targetMinor: 8900, referenceOfferId: 'a' });
    expect(r.stats).toMatchObject({ lowestMinor: 9000, medianMinor: 9500, rank: 3, total: 4 });
  });

  it('match_lowest matches the cheapest offer', () => {
    expect(recommendPrice(input({ rule: rule({ strategy: 'match_lowest' }) }))).toMatchObject({ action: 'change', targetMinor: 9000 });
  });

  it('stay_in_top_n prices just below the N-th cheapest (and may raise the price)', () => {
    const r = recommendPrice(input({ rule: rule({ strategy: 'stay_in_top_n', topN: 3 }), currentPriceMinor: 8000 }));
    expect(r).toMatchObject({ action: 'change', targetMinor: 10900, referenceOfferId: 'c' });
    expect(r.notes).toContain('raise');
    expect(recommendPrice(input({ rule: rule({ strategy: 'stay_in_top_n', topN: 5 }) }))).toMatchObject({ action: 'hold', hold: 'fewer_than_n' });
  });

  it('holds when already at the target', () => {
    expect(recommendPrice(input({ currentPriceMinor: 8900 }))).toMatchObject({ action: 'hold', hold: 'already_optimal', targetMinor: 8900 });
  });
});

describe('clamps and floors', () => {
  it('clamps to [min, max] and produces integer minor units', () => {
    const low = recommendPrice(input({ rule: rule({ minMinor: 9200 }) }));
    expect(low).toMatchObject({ targetMinor: 9200 });
    expect(low.notes).toContain('clamped_floor');
    const high = recommendPrice(input({ rule: rule({ strategy: 'match_lowest', maxMinor: 8500 }), currentPriceMinor: 8000 }));
    expect(high).toMatchObject({ targetMinor: 8500 });
    expect(high.notes).toContain('clamped_ceiling');
    expect(Number.isInteger(low.targetMinor)).toBe(true);
  });

  it('never goes below the margin floor (cost + margin + commission)', () => {
    expect(marginFloor(7000, 20, 10)).toBe(9240);
    expect(marginFloor(null, 20, 10)).toBeNull();
    const r = recommendPrice(input({ costMinor: 7000, commissionPct: 10, rule: rule({ minMarginPct: 20 }) }));
    expect(r).toMatchObject({ targetMinor: 9240, marginFloorMinor: 9240, floorMinor: 9240 });
    expect(r.notes).toContain('margin_floor');
  });

  it('flags an unknown commission when a margin floor is used', () => {
    const r = recommendPrice(input({ costMinor: 7000, commissionPct: null, rule: rule({ minMarginPct: 20 }) }));
    expect(r.marginFloorMinor).toBe(8400);
    expect(r.notes).toContain('commission_unknown');
  });

  it('holds on impossible bounds and unknown currency', () => {
    expect(recommendPrice(input({ costMinor: 30000, rule: rule({ minMarginPct: 10 }) }))).toMatchObject({ action: 'hold', hold: 'invalid_bounds' });
    expect(recommendPrice(input({ currency: 'UNKNOWN' }))).toMatchObject({ action: 'hold', hold: 'currency_unknown' });
  });
});

describe('what is (not) a competitor', () => {
  it('ignores offers in another or unknown currency', () => {
    const r = recommendPrice(input({ offers: [offer('usd', 50, {}, 'USD'), offer('unk', 100, {}, 'UNKNOWN'), offer('b', 9500)] }));
    expect(r).toMatchObject({ targetMinor: 9400, referenceOfferId: 'b' });
    expect(r.excluded.currency).toBe(2);
  });

  it('never reacts to own offers (by listing id, seller id or name)', () => {
    const r = recommendPrice(
      input({
        offers: [offer('L2', 5000), offer('x', 5100, { sellerId: '100' }), offer('y', 5200, { sellerId: null, sellerName: 'me' }), offer('b', 9500)],
      }),
    );
    expect(r).toMatchObject({ targetMinor: 9400, referenceOfferId: 'b' });
    expect(r.excluded.own).toBe(3);
  });

  it('ignores listed sellers by name or id', () => {
    const r = recommendPrice(input({ rule: rule({ ignoreSellers: ['SELLER-A', 's-b'] }) }));
    expect(r).toMatchObject({ targetMinor: 10900, referenceOfferId: 'c' });
    expect(r.excluded.ignored).toBe(2);
  });

  it('drops price-band outliers and dissimilar titles', () => {
    const r = recommendPrice(input({ offers: [offer('cheap', 100), offer('b', 9500), offer('other', 9000, { title: 'Steam wallet card' })], rule: rule({ minSimilarity: 0.5 }) }));
    expect(r.excluded).toMatchObject({ band: 1, similarity: 1 });
    expect(r.referenceOfferId).toBe('b');
    expect(titleSimilarity('Gems 100 fast', 'gems 100, FAST!')).toBe(1);
    expect(titleSimilarity('Gems 100', 'Steam key')).toBe(0);
  });

  it('holds without competitors', () => {
    expect(recommendPrice(input({ offers: [] }))).toMatchObject({ action: 'hold', hold: 'no_competitors' });
  });
});

describe('anti price-war', () => {
  it('respects the per-listing cooldown', () => {
    const r = recommendPrice(input({ appliedAt: [NOW - 30 * MIN], rule: rule({ cooldownMinutes: 60 }) }));
    expect(r).toMatchObject({ action: 'hold', hold: 'cooldown', targetMinor: 8900 });
    expect(recommendPrice(input({ appliedAt: [NOW - 61 * MIN], rule: rule({ cooldownMinutes: 60 }) })).action).toBe('change');
  });

  it('respects maxChangesPerDay over a sliding 24 h window', () => {
    const applied = [NOW - 20 * 3600_000, NOW - 10 * 3600_000, NOW - 5 * 3600_000];
    expect(recommendPrice(input({ appliedAt: applied, rule: rule({ maxChangesPerDay: 3, cooldownMinutes: 30 }) }))).toMatchObject({ hold: 'daily_limit' });
    expect(recommendPrice(input({ appliedAt: [NOW - 25 * 3600_000, ...applied.slice(1)], rule: rule({ maxChangesPerDay: 3, cooldownMinutes: 30 }) })).action).toBe('change');
  });

  it('holds while the reference competitor oscillates', () => {
    const osc = offer('a', 9000, { changeTimes: [NOW - 50 * MIN, NOW - 30 * MIN, NOW - 10 * MIN] });
    const r = recommendPrice(input({ offers: [osc, offer('b', 9500)], rule: rule({ oscillationMaxChanges: 2, oscillationWindowMin: 60 }) }));
    expect(r).toMatchObject({ action: 'hold', hold: 'oscillation' });
    const calm = offer('a', 9000, { changeTimes: [NOW - 200 * MIN, NOW - 150 * MIN, NOW - 10 * MIN] });
    expect(recommendPrice(input({ offers: [calm, offer('b', 9500)], rule: rule({ oscillationMaxChanges: 2, oscillationWindowMin: 60 }) })).action).toBe('change');
  });
});

describe('market reconstruction', () => {
  const snap = (offerId: string, at: number, price: number): CompetitorSnapshot => ({
    id: `1:${offerId}:${at}`,
    offerId,
    nodeId: '1',
    sellerName: offerId,
    sellerId: null,
    title: 'Gems',
    price: { amountMinor: price, currency: 'RUB' },
    amount: null,
    online: null,
    promoted: false,
    rating: null,
    reviewCount: null,
    at: new Date(at).toISOString(),
  });

  it('takes the latest snapshot per offer, drops stale ones and records change times', () => {
    const h = buildHistory([snap('a', NOW - 3 * 3600_000, 100), snap('a', NOW - 2 * 3600_000, 90), snap('a', NOW - 3600_000, 90), snap('old', NOW - 30 * 3600_000, 50)]);
    const s = stateAt(h, NOW);
    expect(s.map((o) => o.offerId)).toEqual(['a']);
    expect(s[0]!.price.amountMinor).toBe(90);
    expect(s[0]!.changeTimes).toEqual([NOW - 2 * 3600_000]);
    expect(stateAt(h, NOW - 2.5 * 3600_000)[0]!.price.amountMinor).toBe(100);
  });

  it('computes rank with ties sharing the better position', () => {
    expect(marketStats([100, 200, 200, 300], 200)).toMatchObject({ rank: 2, total: 5, medianMinor: 200 });
    expect(classifyOffers([offer('z', 100)], { title: 'x', currency: 'RUB', currentPriceMinor: 0, own: { listingIds: [], sellerId: null, sellerName: null }, priceBandPct: 50 })[0]!.excluded).toBeNull();
  });
});
