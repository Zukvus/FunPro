import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, onEvent } from '@/core/events/bus';
import { handleOrderCompleted } from '@/features/messages/postOrder';
import { recordFire } from '@/features/messages/state';
import { maybeSendWelcome } from '@/features/messages/welcome';
import { ingestChatList, ingestOrders } from '@/features/sync/ingest';
import type { ParsedOrder } from '@/adapters/funpay/types';
import { BUYER, CHAT, deps, iso, msg, NOW, order, orderEvent, runningSettings, seedChat, seedMessages, sendTasks } from './helpers';

const WELCOME = runningSettings({ messages: { welcomeText: 'Hello {buyer}, I am {seller}. How can I help?', postOrderText: 'Thanks for order #{order_id} ({product})!' } });

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
});

describe('welcome message', () => {
  beforeEach(async () => {
    await seedChat();
  });

  it('greets a new chat once when the buyer wrote first', async () => {
    await seedMessages(msg('10', 'customer', 'Hi, is it available?'));
    const out = await maybeSendWelcome(CHAT, deps({ settings: WELCOME }));
    expect(out).toMatchObject({ action: 'queued' });
    const tasks = await sendTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.idempotencyKey).toBe(`msg:welcome:${CHAT}`);
    expect(tasks[0]!.payload).toMatchObject({ source: 'welcome', text: 'Hello BuyerAlpha, I am SellerOne. How can I help?' });
    expect(await maybeSendWelcome(CHAT, deps({ settings: WELCOME }))).toMatchObject({ reason: 'duplicate' });
    expect(await sendTasks()).toHaveLength(1);
  });

  it('does not greet when the seller already wrote, the buyer has not written, or the text is empty', async () => {
    await seedMessages(msg('9', 'system', 'Покупатель BuyerAlpha оплатил заказ #AAAA1111.'));
    expect(await maybeSendWelcome(CHAT, deps({ settings: WELCOME }))).toMatchObject({ reason: 'no_customer_message' });
    await seedMessages(msg('10', 'customer', 'hi'), msg('11', 'self', 'hello!'));
    expect(await maybeSendWelcome(CHAT, deps({ settings: WELCOME }))).toMatchObject({ reason: 'seller_replied' });
    expect(await maybeSendWelcome(CHAT, deps())).toMatchObject({ reason: 'no_text' });
  });

  it('respects the feature switch and authorization', async () => {
    await seedMessages(msg('10', 'customer', 'hi'));
    const off = runningSettings({ automation: { welcomeMessage: false }, messages: { welcomeText: 'Hi' } });
    expect(await maybeSendWelcome(CHAT, deps({ settings: off }))).toMatchObject({ reason: 'not_running' });
    const stopped = runningSettings({ automation: { state: 'stopped' }, messages: { welcomeText: 'Hi' } });
    expect(await maybeSendWelcome(CHAT, deps({ settings: stopped }))).toMatchObject({ reason: 'not_running' });
  });

  it('only chats first seen after the baseline are new (installation never greets old chats)', async () => {
    const item = (id: string) => ({ id, partnerName: 'B', partnerId: null, lastMessageText: 'hi', lastMessageAt: null, unread: true });
    const base = await ingestChatList([item('users-1-2'), item('users-1-3')], NOW - 1000);
    expect(base.newChats).toEqual([]);
    const later = await ingestChatList([item('users-1-2'), item('users-1-3'), item('users-1-4')], NOW);
    expect(later.newChats).toEqual(['users-1-4']);
  });

  it('does not greet a chat that a keyword auto-reply already answered', async () => {
    await seedMessages(msg('10', 'customer', 'price?'));
    await recordFire(CHAT, `u:${BUYER}`, { ruleId: 'arr_price', messageId: '10', at: NOW - 1000, mode: 'queued' });
    expect(await maybeSendWelcome(CHAT, deps({ settings: WELCOME }))).toMatchObject({ reason: 'auto_replied' });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('a greeting with contacts becomes a draft', async () => {
    await seedMessages(msg('10', 'customer', 'hi'));
    const s = runningSettings({ messages: { welcomeText: 'Hi! Write me at t.me/shop' } });
    expect(await maybeSendWelcome(CHAT, deps({ settings: s }))).toMatchObject({ action: 'draft', reason: 'lint' });
    expect(await sendTasks()).toHaveLength(0);
  });
});

describe('post-order message', () => {
  it('queues a thank-you to the buyer’s private chat with order variables', async () => {
    const o = order('ABCD1234');
    await getDb().orders.put(o);
    const out = await handleOrderCompleted(orderEvent(o), deps({ settings: WELCOME }));
    expect(out).toMatchObject({ action: 'queued' });
    const tasks = await sendTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.idempotencyKey).toBe('msg:postorder:ABCD1234');
    expect(tasks[0]!.payload).toMatchObject({ chatId: CHAT, source: 'post_order', text: 'Thanks for order #ABCD1234 (Test item, 1 pcs)!' });
    expect(await handleOrderCompleted(orderEvent(o), deps({ settings: WELCOME }))).toMatchObject({ reason: 'duplicate' });
  });

  it('ignores baseline events, purchases and old orders', async () => {
    const o = order('ABCD1234');
    await getDb().orders.put(o);
    expect(await handleOrderCompleted(orderEvent(o, { baseline: true }), deps({ settings: WELCOME }))).toMatchObject({ reason: 'baseline' });
    const p = order('PURC0001', { direction: 'purchase' });
    await getDb().orders.put(p);
    expect(await handleOrderCompleted(orderEvent(p), deps({ settings: WELCOME }))).toMatchObject({ reason: 'not_sale' });
    const old = order('OLDD0001', { createdAt: iso(NOW - 8 * 24 * 3600_000) });
    await getDb().orders.put(old);
    expect(await handleOrderCompleted(orderEvent(old), deps({ settings: WELCOME }))).toMatchObject({ reason: 'too_old' });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('creates an explanatory draft when the buyer cannot be addressed', async () => {
    const o = order('NOID0001', { counterpartyId: null, counterpartyName: 'Ghost' });
    await getDb().orders.put(o);
    const out = await handleOrderCompleted(orderEvent(o), deps({ settings: WELCOME }));
    expect(out).toMatchObject({ action: 'draft', reason: 'unaddressable' });
    const d = await getDb().drafts.get('draft_postorder_NOID0001');
    expect(d).toMatchObject({ chatId: '', status: 'pending', text: 'Thanks for order #NOID0001 (Test item, 1 pcs)!' });
    expect(d!.meta).toMatchObject({ kind: 'post_order', reason: 'unaddressable', orderId: 'NOID0001', buyer: 'Ghost' });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('falls back to an existing chat with the buyer’s name when the id is unknown', async () => {
    await seedChat('users-1000001-3000003', 'NamedBuyer');
    const o = order('NAME0001', { counterpartyId: null, counterpartyName: 'namedbuyer' });
    await getDb().orders.put(o);
    expect(await handleOrderCompleted(orderEvent(o), deps({ settings: WELCOME }))).toMatchObject({ action: 'queued' });
    expect((await sendTasks())[0]!.payload['chatId']).toBe('users-1000001-3000003');
  });

  it('end-to-end: only a real completion after the baseline triggers the message', async () => {
    onEvent('ORDER_COMPLETED', async (e) => {
      await handleOrderCompleted(e, deps({ settings: WELCOME }));
    });
    const parsed = (status: ParsedOrder['status']): ParsedOrder => ({
      id: 'E2E00001',
      direction: 'sale',
      status,
      counterpartyName: 'BuyerAlpha',
      counterpartyId: BUYER,
      description: 'Item',
      categoryName: 'Cat',
      listingId: null,
      price: { amountMinor: 1000, currency: 'RUB' },
      createdAt: iso(NOW - 3600_000),
      rawDate: '',
    });
    // Baseline: an already-closed order must not be thanked.
    await ingestOrders([{ ...parsed('closed'), id: 'BASE0001' }], 'sale', NOW - 1000);
    expect(await sendTasks()).toHaveLength(0);
    await ingestOrders([parsed('paid')], 'sale', NOW - 500);
    await ingestOrders([parsed('closed')], 'sale', NOW);
    const tasks = await sendTasks();
    expect(tasks.map((t) => t.idempotencyKey)).toEqual(['msg:postorder:E2E00001']);
  });
});
