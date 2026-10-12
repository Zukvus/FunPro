import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { dispatchAlarm } from '@/background/alarms';
import { ALARM_CHAT_SYNC, messagingModule } from '@/background/modules/messaging';
import { operationsModule } from '@/background/modules/operations';
import { dispatch } from '@/background/router';
import { getDb } from '@/core/db/db';
import { updateSettings } from '@/core/settings/store';
import { importItems } from '@/features/inventory/items';
import { freshDb, makePool } from '../features/inventory/helpers';

const page = () => ({ id: browser.runtime.id, url: browser.runtime.getURL('/options.html') });
const call = (method: string, params: unknown) => dispatch({ __funpro: 1, method, params }, page());

beforeAll(() => {
  operationsModule.register();
  messagingModule.register();
});
beforeEach(() => freshDb());

describe('offer changes on FunPay (goods push, manual price apply)', () => {
  it('are refused until live actions are confirmed and while the emergency stop is active', async () => {
    const pool = await makePool({ listingIds: ['777'] });
    await importItems(pool.id, ['GOODS-1']);
    const push = () =>
      call('ui.inventory.push', { poolId: pool.id, offerId: '777', count: 1, confirm: true });
    const apply = () => call('ui.pricing.apply', { listingId: '777', targetMinor: 10_000, confirm: true });

    expect(await push()).toMatchObject({ ok: false, code: 'awaiting_authorization' });
    expect(await apply()).toMatchObject({ ok: false, code: 'awaiting_authorization' });

    await updateSettings({ automation: { liveActionsAcknowledged: true, state: 'stopped' } });
    expect(await push()).toMatchObject({ ok: false, code: 'emergency_stop' });
    expect(await apply()).toMatchObject({ ok: false, code: 'emergency_stop' });
    // Nothing left FunPro's stock.
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(1);

    // Confirmed and not stopped: the request goes on to the FunPay tab (none is open here).
    await updateSettings({ automation: { state: 'paused' } });
    expect(await push()).toMatchObject({ ok: false, code: 'no_tab' });
  });
});

describe('background chat polling', () => {
  const chatSyncLogs = () =>
    getDb()
      .logs.filter((l) => l.source === 'chat-sync')
      .count();

  it('makes no requests while the emergency stop is active and resumes afterwards', async () => {
    await updateSettings({ automation: { state: 'stopped' }, messages: { backgroundChatSync: true } });
    await dispatchAlarm(ALARM_CHAT_SYNC);
    expect(await chatSyncLogs()).toBe(0);

    // Reading chats does not depend on pause; without an open FunPay tab the sync reports "blocked".
    await updateSettings({ automation: { state: 'paused' } });
    await dispatchAlarm(ALARM_CHAT_SYNC);
    expect(await chatSyncLogs()).toBe(1);
  });
});
