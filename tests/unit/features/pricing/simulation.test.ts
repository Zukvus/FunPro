import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, onEvent } from '@/core/events/bus';
import { updateSettings, getSettings } from '@/core/settings/store';
import { clearSinksForTests } from '@/features/notifications/notify';
import { handlePriceChange } from '@/features/pricing/alerts';
import {
  applyPrice,
  formPriceFor,
  formatFormPrice,
  runRepricingTick,
  type OfferExec,
} from '@/features/pricing/automation';
import { fetchCompetitorsForNode, nextNodeDue, validOffers } from '@/features/pricing/fetch';
import { getChangeLog, markSimulated, PriceRuleExtSchema, saveRule } from '@/features/pricing/model';
import { simulateRepricing } from '@/features/pricing/simulate';
import { ingestCompetitors } from '@/features/sync/ingest';
import type { OfferForm } from '@/adapters/funpay/types';
import type { CompetitorOffer, CompetitorSnapshot, DomainEvent, Listing } from '@/shared/models';

const T0 = Date.UTC(2026, 8, 1, 0, 0, 0);
const H = 3600_000;

function snap(offerId: string, at: number, price: number, seller = offerId): CompetitorSnapshot {
  return {
    id: `1:${offerId}:${at}`,
    offerId,
    nodeId: '1',
    sellerName: seller,
    sellerId: null,
    title: 'Gems 100',
    price: { amountMinor: price, currency: 'RUB' },
    amount: null,
    online: null,
    promoted: false,
    rating: null,
    reviewCount: null,
    at: new Date(at).toISOString(),
  };
}

function listing(over: Partial<Listing> = {}): Listing {
  return {
    id: 'L1',
    nodeId: '1',
    gameId: '9',
    categoryName: 'Gems',
    title: 'Gems 100',
    price: { amountMinor: 10000, currency: 'RUB' },
    amount: null,
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

function competitor(offerId: string, price: number, seller = offerId): CompetitorOffer {
  return {
    offerId,
    nodeId: '1',
    sellerName: seller,
    sellerId: null,
    title: 'Gems 100',
    price: { amountMinor: price, currency: 'RUB' },
    amount: null,
    online: true,
    promoted: false,
    rating: null,
    reviewCount: null,
  };
}

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  clearSinksForTests();
});

describe('simulation', () => {
  it('replays history deterministically with cooldown and the floor', () => {
    const rule = PriceRuleExtSchema.parse({
      listingId: 'L1',
      minMinor: 8500,
      maxMinor: 20000,
      stepMinor: 100,
      strategy: 'undercut_lowest',
      cooldownMinutes: 120,
      maxChangesPerDay: 10,
    });
    const snapshots = [
      snap('a', T0, 9500),
      snap('L1', T0, 10000),
      snap('a', T0 + 1 * H, 9000),
      snap('a', T0 + 2 * H, 8800),
      snap('a', T0 + 4 * H, 8000),
    ];
    const input = {
      rule,
      listing: { id: 'L1', title: 'Gems 100', priceMinor: 10000, currency: 'RUB' as const, costMinor: null },
      snapshots,
      own: { listingIds: ['L1'], sellerId: null, sellerName: null },
      commissionPct: null,
      from: T0,
      to: T0 + 5 * H,
    };
    const res = simulateRepricing(input);
    expect(res.evaluations).toBe(4);
    expect(res.changes.map((c) => [c.at - T0, c.fromMinor, c.toMinor])).toEqual([
      [0, 10000, 9400],
      [2 * H, 9400, 8700],
      [4 * H, 8700, 8500],
    ]);
    expect(res.holds.cooldown).toBe(1);
    expect(res).toMatchObject({ startMinor: 10000, endMinor: 8500, minMinor: 8500, maxMinor: 10000 });
    expect(res.points.map((p) => p.actualMinor)).toEqual([10000, 10000, 10000, 10000]);
    expect(simulateRepricing(input)).toEqual(res);
  });
});

describe('form price conversion', () => {
  it('converts buyer price to the form price without exceeding the target', () => {
    expect(formPriceFor(11000, 10)).toBe(10000);
    expect(formPriceFor(10999, 10)).toBe(9999);
    expect(formatFormPrice(9999, '100,00')).toBe('99,99');
    expect(formatFormPrice(9999, '100.00')).toBe('99.99');
  });
});

function fakeExec(
  formPrice = '100.00',
  buyerPrice = '110.00 ₽',
): OfferExec & { saved: Record<string, string>[] } {
  const saved: Record<string, string>[] = [];
  return {
    saved,
    getOfferForm: async (offerId: string): Promise<OfferForm> => ({
      offerId,
      nodeId: '1',
      currencyText: '₽',
      fields: [
        ['offer_id', offerId],
        ['price', formPrice],
      ],
      buyerPrices: [{ method: 'Card', priceText: buyerPrice }],
    }),
    saveOffer: async (_id: string, changes: Record<string, string>) => {
      saved.push(changes);
      return { ok: true, errors: [] };
    },
  };
}

describe('applying prices', () => {
  it('derives the commission from the form, backs up, saves once and logs', async () => {
    await getDb().listings.add(listing({ price: { amountMinor: 11000, currency: 'RUB' } }));
    const exec = fakeExec();
    const res = await applyPrice('L1', 10450, 'manual', {
      getSettings,
      automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
      exec,
    });
    expect(res).toMatchObject({ changed: true, formFrom: '100.00', formTo: '95.00', commissionPct: 10 });
    expect(exec.saved).toEqual([{ price: '95.00' }]);
    expect(await getDb().backups.where('kind').equals('manual').count()).toBe(1);
    expect((await getChangeLog('L1'))[0]).toMatchObject({ mode: 'manual', toMinor: 10450 });
  });

  it('refuses when the commission is unknown', async () => {
    await getDb().listings.add(listing());
    const exec: OfferExec = {
      ...fakeExec(),
      getOfferForm: async (offerId) => ({
        offerId,
        nodeId: '1',
        currencyText: '',
        fields: [['price', '100']],
        buyerPrices: [],
      }),
    };
    await expect(
      applyPrice('L1', 9000, 'manual', {
        getSettings,
        automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
        exec,
      }),
    ).rejects.toThrow(/commission/i);
  });

  it('automation needs the feature running, an enabled simulated rule and fresh data', async () => {
    const now = Date.now();
    await getDb().listings.add(listing({ price: { amountMinor: 11000, currency: 'RUB' } }));
    await ingestCompetitors('1', [competitor('a', 10500), competitor('L1', 11000)], now - 10 * 60_000);
    const exec = fakeExec();
    const deps = {
      getSettings,
      automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
      exec,
      now: () => now,
    };
    expect((await runRepricingTick(deps)).status).toBe('disabled');
    await updateSettings({
      automation: { state: 'running', liveActionsAcknowledged: true, repricing: true },
    });
    const rule = PriceRuleExtSchema.parse({
      listingId: 'L1',
      enabled: true,
      minMinor: 9000,
      maxMinor: 20000,
      stepMinor: 100,
    });
    await expect(saveRule(rule)).rejects.toThrow(/simulation/i);
    await markSimulated('L1', { at: now, days: 30, changes: 1 });
    await saveRule(rule);
    const out = await runRepricingTick(deps);
    expect(out.applied).toEqual(['L1']);
    expect(exec.saved).toEqual([{ price: '94.54' }]);
    // Cooldown / evaluation throttle: an immediate second tick does nothing.
    expect((await runRepricingTick(deps)).applied).toEqual([]);
    expect(exec.saved).toHaveLength(1);
    const notes = await getDb().notifications.toArray();
    expect(notes.some((n) => n.kind === 'price')).toBe(true);
  });
});

describe('alerts and fetching', () => {
  it('notifies when a comparable competitor undercuts the seller (once)', async () => {
    await getDb().listings.add(listing());
    const events: DomainEvent[] = [];
    onEvent('PRICE_CHANGE_DETECTED', (e) => {
      events.push(e);
    });
    const t = Date.now() - 60_000;
    await ingestCompetitors('1', [competitor('a', 10500), competitor('L1', 10000)], t - 1000);
    await ingestCompetitors('1', [competitor('a', 9500), competitor('L1', 10000)], t);
    expect(events).toHaveLength(1);
    expect(await handlePriceChange(events[0]!, getSettings)).toEqual(['L1']);
    expect(await handlePriceChange(events[0]!, getSettings)).toEqual(['L1']);
    expect((await getDb().notifications.toArray()).filter((n) => n.kind === 'price')).toHaveLength(1);
    await updateSettings({ pricing: { alertOnUndercut: false } });
    expect(await handlePriceChange(events[0]!, getSettings)).toEqual([]);
  });

  it('fetches only nodes of own listings, validates offers and throttles manual refreshes', async () => {
    await getDb().listings.add(listing());
    const fetchNode = async () => [
      competitor('a', 100),
      { bogus: true },
      { ...competitor('b', 200), nodeId: '2' },
    ];
    await expect(fetchCompetitorsForNode('2', fetchNode, { manual: true })).rejects.toThrow(/own listings/);
    expect(await fetchCompetitorsForNode('1', fetchNode, { manual: true, now: 1_000_000 })).toMatchObject({
      offers: 1,
    });
    await expect(fetchCompetitorsForNode('1', fetchNode, { manual: true, now: 1_030_000 })).rejects.toThrow(
      /just refreshed/,
    );
    expect(validOffers('nope', '1')).toEqual([]);
    const s = await getSettings();
    expect(await nextNodeDue(s, 2_000_000)).toBeNull();
    await updateSettings({ pricing: { autoFetch: true, autoFetchIntervalMinutes: 60 } });
    expect(await nextNodeDue(await getSettings(), 1_000_000 + 30 * 60_000)).toBeNull();
    expect(await nextNodeDue(await getSettings(), 1_000_000 + 61 * 60_000)).toBe('1');
  });
});

describe('apply never undercuts the margin floor', () => {
  it('rounds the form price up to respect min / margin with the form-derived commission', async () => {
    await getDb().listings.add(listing({ price: { amountMinor: 11000, currency: 'RUB' }, costMinor: 7000 }));
    await saveRule(
      PriceRuleExtSchema.parse({ listingId: 'L1', minMinor: 5000, maxMinor: 20000, minMarginPct: 20 }),
    );
    const exec = fakeExec();
    // Margin floor with 10% commission: 7000 × 1.2 × 1.1 = 9240 buyer → form 84.00.
    const res = await applyPrice('L1', 9000, 'manual', {
      getSettings,
      automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
      exec,
    });
    expect(res.formTo).toBe('84.00');
  });
});
