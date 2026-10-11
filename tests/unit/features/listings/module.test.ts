import { beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { getDb, resetDbForTests } from '@/core/db/db';
import { updateSettings } from '@/core/settings/store';
import { listingsModule } from '@/background/modules/listings';
import { dispatch } from '@/background/router';
import { BUMP_ALARM } from '@/features/bump/runner';
import { buildBulkPlan } from '@/features/listings/bulk-plan';
import { savePlan } from '@/features/listings/bulk-store';
import { defaultSettings } from '@/core/settings/schema';
import { makeListing } from './helpers';

const page = () => ({ id: browser.runtime.id, url: browser.runtime.getURL('/options.html') });
const funpayTab = () => ({ id: browser.runtime.id, url: 'https://funpay.com/lots/offerEdit?offer=9000001', tab: { id: 7, url: 'https://funpay.com/lots/offerEdit?offer=9000001' } });
const call = (method: string, params: unknown, sender: ReturnType<typeof page> | ReturnType<typeof funpayTab> = page()) => dispatch({ __funpro: 1, method, params }, sender);

beforeEach(() => {
  resetDbForTests();
  listingsModule.register();
});

describe('listings background module (through the RPC router)', () => {
  it('maps feature errors to user-facing codes', async () => {
    expect(await call('ui.bumpNow', {})).toMatchObject({ ok: false, code: 'no_targets' });
    expect(await call('ui.fetchOfferForm', { offerId: '9000001' })).toMatchObject({ ok: false, code: 'no_tab' });
    expect(await call('ui.calcCommission', { nodeId: '501', priceMinor: 100 })).toMatchObject({ ok: false, code: 'no_tab' });
  });

  it('refuses bulk execution and cloning without the live-actions acknowledgement or during the emergency stop', async () => {
    await getDb().listings.add(makeListing('9000001'));
    const plan = buildBulkPlan([makeListing('9000001')], { kind: 'disable' }, { fees: defaultSettings().fees, now: Date.now() });
    await savePlan(plan);
    expect(await call('ui.bulkEdit.execute', { planId: plan.id })).toMatchObject({ ok: false, code: 'awaiting_authorization' });
    expect(await call('ui.clone.create', { sourceOfferId: '9000001', nodeId: '501', changes: {}, confirm: true })).toMatchObject({ ok: false, code: 'awaiting_authorization' });
    await updateSettings({ automation: { liveActionsAcknowledged: true, state: 'stopped' } });
    expect(await call('ui.bulkEdit.execute', { planId: plan.id })).toMatchObject({ ok: false, code: 'emergency_stop' });
    expect(await call('ui.bumpNow', {})).toMatchObject({ ok: false, code: 'emergency_stop' });
  });

  it('validates parameters strictly', async () => {
    expect(await call('ui.clone.create', { sourceOfferId: '9000001', nodeId: '501', changes: {} })).toMatchObject({ ok: false, code: 'invalid_params' });
    expect(await call('ui.clone.create', { sourceOfferId: '../x', nodeId: '501', changes: {}, confirm: true })).toMatchObject({ ok: false, code: 'invalid_params' });
    await updateSettings({ automation: { liveActionsAcknowledged: true } });
    await getDb().listings.add(makeListing('9000001'));
    expect(await call('ui.clone.create', { sourceOfferId: '9000001', nodeId: '501', changes: { secrets: 'KEY' }, confirm: true })).toMatchObject({ ok: false, code: 'invalid_plan' });
    expect(await call('ui.clone.create', { sourceOfferId: '9000001', nodeId: '777', changes: {}, confirm: true })).toMatchObject({ ok: false, code: 'invalid_plan' });
  });

  it('only lets the content script open the dashboard deep link', async () => {
    expect(await call('cs.openListingInDashboard', { offerId: '9000001' })).toMatchObject({ ok: false, code: 'forbidden' });
    const res = await call('cs.openListingInDashboard', { offerId: '9000001' }, funpayTab());
    expect(res).toMatchObject({ ok: true });
    const tabs = await browser.tabs.query({});
    expect(tabs.some((t) => t.url?.endsWith('/options.html#/listings?offer=9000001'))).toBe(true);
  });

  it('arms the bump alarm only when auto-bump can run', async () => {
    await getDb().bumpState.add({ gameId: '41', nodeIds: ['501'], categoryName: 'A', status: 'idle', lastAttemptAt: null, lastSuccessAt: null, nextEligibleAt: null, lastMessage: '', consecutiveFailures: 0 });
    expect(await browser.alarms.get(BUMP_ALARM)).toBeUndefined();
    expect(await call('ui.bump.resume', {})).toMatchObject({ ok: true, data: { resumed: 0 } });
    expect(await browser.alarms.get(BUMP_ALARM)).toBeUndefined(); // auto-bump off by default
  });
});
