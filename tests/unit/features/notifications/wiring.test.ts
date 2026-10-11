import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { clearAlarmHandlersForTests } from '@/background/alarms';
import { assistantModule } from '@/background/modules/assistant';
import { dispatch } from '@/background/router';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, emitEvent } from '@/core/events/bus';
import { updateSettings } from '@/core/settings/store';
import { clearSinksForTests } from '@/features/notifications';
import type { Order } from '@/shared/models';

const EXT_SENDER = { id: 'test-extension-id' };

function order(id: string): Order {
  return {
    id,
    direction: 'sale',
    status: 'paid',
    counterpartyName: 'Petya',
    counterpartyId: '5',
    description: 'Elden Ring key',
    categoryName: 'Steam',
    listingId: null,
    price: { amountMinor: 50000, currency: 'RUB' },
    createdAt: null,
    rawDate: '',
    firstSeenAt: '',
    updatedAt: '',
    history: [],
  };
}

const rpc = (method: string, params: unknown) => dispatch({ __funpro: 1, method, params }, EXT_SENDER);

beforeEach(async () => {
  resetDbForTests();
  clearEventHandlersForTests();
  clearSinksForTests();
  clearAlarmHandlersForTests();
  await updateSettings({ general: { language: 'en' }, notifications: { sound: false } });
  assistantModule.register();
});

describe('assistant background module wiring', () => {
  it('turns a new paid sale into a center entry and a desktop notification with a click target', async () => {
    await getDb().orders.add(order('A1'));
    await emitEvent('ORDER_PAID', 'A1', { orderId: 'A1', direction: 'sale', status: 'paid', buyer: 'Petya', baseline: false });
    const items = await getDb().notifications.toArray();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'order', title: 'New order', url: 'https://funpay.com/orders/A1/' });
    expect(Object.keys(await fakeBrowser.notifications.getAll())).toEqual([items[0]!.id]);
    const targets = (await fakeBrowser.storage.session.get('notificationTargets'))['notificationTargets'] as Record<string, { url: string }>;
    expect(targets[items[0]!.id]?.url).toBe('https://funpay.com/orders/A1/');
  });

  it('stays silent for baseline orders', async () => {
    await getDb().orders.add(order('B1'));
    await emitEvent('ORDER_PAID', 'B1', { orderId: 'B1', direction: 'sale', status: 'paid', baseline: true });
    expect(await getDb().notifications.count()).toBe(0);
  });

  it('records competitor price changes only when some sink wants them', async () => {
    await emitEvent('PRICE_CHANGE_DETECTED', 'x1', { nodeId: '1', offerId: 'o', from: 100, to: 90, seller: 'Rival' });
    expect(await getDb().notifications.count()).toBe(0);
    await updateSettings({ notifications: { onPrice: true } });
    await emitEvent('PRICE_CHANGE_DETECTED', 'x2', { nodeId: '1', offerId: 'o', from: 90, to: 80, seller: 'Rival' });
    expect(await getDb().notifications.count()).toBe(1);
  });

  it('ui.testNotification fires desktop + sound sinks only', async () => {
    const res = await rpc('ui.testNotification', { kind: 'message' });
    expect(res).toMatchObject({ ok: true, data: { desktop: true, sound: false } });
    expect(Object.keys(await fakeBrowser.notifications.getAll())).toHaveLength(1);
  });

  it('ui.replyReview rejects rule-breaking text and needs an open FunPay tab', async () => {
    await getDb().reviews.add({ orderId: 'A1', stars: 5, text: 'ok', authorName: 'P', at: null, rawDate: '', sellerReply: null, firstSeenAt: '' });
    expect(await rpc('ui.replyReview', { orderId: 'A1', text: 'Пишите в t.me/shop' })).toMatchObject({ ok: false, code: 'invalid_reply' });
    expect(await rpc('ui.replyReview', { orderId: 'ZZ', text: 'Спасибо!' })).toMatchObject({ ok: false, code: 'not_found' });
    expect(await rpc('ui.replyReview', { orderId: 'A1', text: 'Спасибо!' })).toMatchObject({ ok: false, code: 'no_tab' });
    expect((await getDb().reviews.get('A1'))?.sellerReply).toBeNull();
  });

  it('Telegram RPCs refuse while Telegram is not connected; cs.playSound is content-only', async () => {
    expect(await rpc('ui.telegramTest', {})).toMatchObject({ ok: false, code: 'not_ready' });
    expect(await rpc('ui.telegramSummaryNow', {})).toMatchObject({ ok: false, code: 'not_ready' });
    expect(await rpc('cs.playSound', { kind: 'order' })).toMatchObject({ ok: false, code: 'forbidden' });
  });
});
