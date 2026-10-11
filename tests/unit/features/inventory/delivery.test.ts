import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/db';
import { completeTask, failTask } from '@/core/queue/queue';
import {
  handleOrderCancelled,
  handleOrderPaid,
  markDeliveredManually,
  prepareDelivery,
  releaseByUser,
  renderForSeller,
  reserveAndPrepare,
  syncDeliveryOutcomes,
} from '@/features/inventory/delivery';
import { importItems } from '@/features/inventory/items';
import { canDeliveryTransition } from '@/features/inventory/model';
import { getDelivery } from '@/features/inventory/reservation';
import { privateChatId, renderDeliveryMessage } from '@/features/inventory/template';
import { addOrder, cancelledEvent, deps, enableAutoDelivery, freshDb, makePool, paidEvent } from './helpers';

beforeEach(() => {
  freshDb();
});

async function setupStock(items = ['GOODS-1', 'GOODS-2', 'GOODS-3']) {
  const pool = await makePool();
  await importItems(pool.id, items);
  return pool;
}

describe('templates and chat ids', () => {
  it('renders {item} and order variables; appends goods when {item} is missing', () => {
    const vars = { orderId: 'AB12', buyer: 'bob', quantity: 2, lot: 'Key', category: 'Steam', price: { amountMinor: 1050, currency: 'RUB' as const } };
    expect(renderDeliveryMessage('Hi {buyer}, order #{order_id}: {item}', ['k1', 'k2'], vars)).toBe('Hi bob, order #AB12: k1\nk2');
    expect(renderDeliveryMessage('Thanks {unknown}', ['k1'], vars)).toBe('Thanks {unknown}\nk1');
  });

  it('builds private chat ids only from two distinct numeric ids', () => {
    expect(privateChatId('200', '15')).toBe('users-15-200');
    expect(privateChatId('15', '200')).toBe('users-15-200');
    expect(privateChatId(null, '200')).toBeNull();
    expect(privateChatId('abc', '200')).toBeNull();
    expect(privateChatId('5', '5')).toBeNull();
  });

  it('has a sticky uncertain state in the transition table', () => {
    expect(canDeliveryTransition('sending', 'uncertain')).toBe(true);
    expect(canDeliveryTransition('uncertain', 'failed')).toBe(false);
    expect(canDeliveryTransition('sent', 'reserved')).toBe(false);
    expect(canDeliveryTransition('cancelled', 'reserved')).toBe(false);
  });
});

describe('ORDER_PAID → reservation → delivery', () => {
  it('ignores baseline and purchase events', async () => {
    await setupStock();
    await addOrder('BASE');
    expect(await handleOrderPaid(paidEvent('BASE', { baseline: true }), deps())).toEqual({ kind: 'skipped', reason: 'baseline' });
    expect(await handleOrderPaid(paidEvent('BASE', { direction: 'purchase' }), deps())).toEqual({ kind: 'skipped', reason: 'not_sale' });
    expect(await getDb().deliveries.count()).toBe(0);
  });

  it('default mode prepares a draft for review (no automatic send)', async () => {
    await setupStock();
    await addOrder('D1');
    const res = await handleOrderPaid(paidEvent('D1'), deps());
    expect(res.kind).toBe('reserved');
    const d = await getDelivery('D1');
    expect(d).toMatchObject({ status: 'reserved', channel: 'draft', chatId: 'users-100-555', reason: 'auto_not_running' });
    const draft = await getDb().drafts.get(d!.draftId!);
    expect(draft).toMatchObject({ source: 'delivery', status: 'pending', chatId: 'users-100-555' });
    expect(draft!.text).toBe('Thanks, buyer1! Your key: GOODS-1');
    expect(d!.messagePreview).not.toContain('GOODS');
    expect(await getDb().tasks.count()).toBe(0);
  });

  it('goes to manual when the chat id cannot be derived', async () => {
    await setupStock();
    await addOrder('M1', { counterpartyId: null });
    await handleOrderPaid(paidEvent('M1'), deps());
    expect(await getDelivery('M1')).toMatchObject({ status: 'manual', reason: 'chat_unknown' });
    expect(await getDb().drafts.count()).toBe(0);
    expect(await renderForSeller('M1')).toContain('GOODS-1');
  });

  it('sends automatically only when autoDelivery is running, with key delivery:<orderId>', async () => {
    await setupStock();
    await enableAutoDelivery();
    await addOrder('A1');
    await handleOrderPaid(paidEvent('A1'), deps());
    const d = await getDelivery('A1');
    expect(d).toMatchObject({ status: 'sending', channel: 'auto', attempts: 1 });
    const task = await getDb().tasks.get(d!.taskId!);
    expect(task).toMatchObject({ kind: 'send_message', idempotencyKey: 'msg:delivery:A1' });
    expect(task!.payload).toMatchObject({ source: 'delivery', chatId: 'users-100-555' });

    // No tab → the feature is blocked → draft instead of a send.
    await addOrder('A2');
    await handleOrderPaid(paidEvent('A2'), deps({ automationContext: async () => ({ funpayTabAvailable: false, sessionLoggedIn: false }) }));
    expect(await getDelivery('A2')).toMatchObject({ status: 'reserved', channel: 'draft' });
  });

  it('is idempotent: a re-dispatched ORDER_PAID never reserves or sends twice', async () => {
    await setupStock();
    await enableAutoDelivery();
    await addOrder('I1');
    await Promise.all([handleOrderPaid(paidEvent('I1'), deps()), handleOrderPaid(paidEvent('I1'), deps())]);
    expect(await getDb().inventoryItems.where('orderId').equals('I1').count()).toBe(1);
    expect(await getDb().tasks.count()).toBe(1);
  });
});

describe('outcome watcher', () => {
  async function autoSent(orderId: string) {
    await enableAutoDelivery();
    await addOrder(orderId);
    await handleOrderPaid(paidEvent(orderId), deps());
    return (await getDelivery(orderId))!;
  }

  it('done → sent: items delivered and plaintext masked in the task', async () => {
    await setupStock();
    const d = await autoSent('S1');
    await completeTask(d.taskId!);
    const res = await syncDeliveryOutcomes();
    expect(res.sent).toEqual(['S1']);
    expect(await getDelivery('S1')).toMatchObject({ status: 'sent' });
    const items = await getDb().inventoryItems.where('orderId').equals('S1').toArray();
    expect(items.every((i) => i.status === 'delivered' && i.deliveredAt)).toBe(true);
    const task = await getDb().tasks.get(d.taskId!);
    expect(String(task!.payload['text'])).not.toContain('GOODS');
  });

  it('"Outcome uncertain" → uncertain, never retried automatically', async () => {
    await setupStock();
    const d = await autoSent('U1');
    await failTask(d.taskId!, 'Outcome uncertain: network error', { retryable: false });
    expect((await syncDeliveryOutcomes()).uncertain).toEqual(['U1']);
    const tasksBefore = await getDb().tasks.count();
    for (let i = 0; i < 3; i++) await syncDeliveryOutcomes();
    expect(await getDb().tasks.count()).toBe(tasksBefore);
    expect(await getDelivery('U1')).toMatchObject({ status: 'uncertain', reason: 'outcome_uncertain' });
    // Items stay reserved; an explicit re-send requires confirmation.
    expect(await getDb().inventoryItems.where('orderId').equals('U1').first()).toMatchObject({ status: 'reserved' });
    await expect(prepareDelivery('U1', 'send', deps())).rejects.toThrow(/Check the chat/);
    // A refund does not release possibly-delivered goods.
    expect(await handleOrderCancelled(cancelledEvent('U1'))).toBe('flagged');
    expect(await getDb().inventoryItems.where('orderId').equals('U1').first()).toMatchObject({ status: 'reserved' });
    const resent = await prepareDelivery('U1', 'send', deps(), { confirmUncertain: true });
    expect(resent.status).toBe('sending');
    expect(await getDb().tasks.get(resent.taskId!)).toMatchObject({ idempotencyKey: 'msg:delivery:U1:retry1' });
  });

  it('definite failure → failed; explicit retry uses a new key; mark-as-sent finishes it', async () => {
    await setupStock();
    const d = await autoSent('F1');
    await failTask(d.taskId!, 'Пользователь заблокирован', { retryable: false });
    expect((await syncDeliveryOutcomes()).failed).toEqual(['F1']);
    expect(await getDelivery('F1')).toMatchObject({ status: 'failed', reason: 'send_failed' });
    expect(await getDb().inventoryItems.where('orderId').equals('F1').first()).toMatchObject({ status: 'reserved' });
    const retry = await prepareDelivery('F1', 'send', deps());
    expect(await getDb().tasks.get(retry.taskId!)).toMatchObject({ idempotencyKey: 'msg:delivery:F1:retry1' });
    expect((await getDb().tasks.get(retry.taskId!))!.payload['source']).toBe('manual');
    await failTask(retry.taskId!, 'Still blocked', { retryable: false });
    await syncDeliveryOutcomes();
    const retry2 = await prepareDelivery('F1', 'send', deps());
    expect(await getDb().tasks.get(retry2.taskId!)).toMatchObject({ idempotencyKey: 'msg:delivery:F1:retry2' });
    await failTask(retry2.taskId!, 'Still blocked', { retryable: false });
    await syncDeliveryOutcomes();
    const done = await markDeliveredManually('F1');
    expect(done.status).toBe('sent');
  });

  it('a draft sent by the seller marks the delivery sent; a dismissed draft asks for manual action', async () => {
    await setupStock();
    await addOrder('DR1');
    await addOrder('DR2');
    await handleOrderPaid(paidEvent('DR1'), deps());
    await handleOrderPaid(paidEvent('DR2'), deps());
    const d1 = (await getDelivery('DR1'))!;
    const d2 = (await getDelivery('DR2'))!;
    await getDb().drafts.update(d1.draftId!, { status: 'sent' });
    await getDb().drafts.update(d2.draftId!, { status: 'dismissed' });
    const res = await syncDeliveryOutcomes();
    expect(res.sent).toEqual(['DR1']);
    expect(res.manual).toEqual(['DR2']);
    expect((await getDb().drafts.get(d1.draftId!))!.text).not.toContain('GOODS');
    expect(await getDelivery('DR2')).toMatchObject({ status: 'manual', reason: 'draft_dismissed' });
  });

  it('a failed draft send with no recorded task is treated as uncertain', async () => {
    await setupStock();
    await addOrder('DF');
    await handleOrderPaid(paidEvent('DF'), deps());
    const d = (await getDelivery('DF'))!;
    await getDb().drafts.update(d.draftId!, { status: 'failed' });
    expect((await syncDeliveryOutcomes()).uncertain).toEqual(['DF']);
  });

  it('explicit send withdraws the pending draft so it cannot be sent twice', async () => {
    await setupStock();
    await addOrder('W1');
    await handleOrderPaid(paidEvent('W1'), deps());
    const before = (await getDelivery('W1'))!;
    const sent = await prepareDelivery('W1', 'send', deps());
    expect(sent.status).toBe('sending');
    expect(await getDb().drafts.get(before.draftId!)).toMatchObject({ status: 'dismissed' });
    expect((await getDb().drafts.get(before.draftId!))!.text).not.toContain('GOODS');
    expect(await getDb().tasks.get(sent.taskId!)).toMatchObject({ idempotencyKey: 'msg:delivery:W1' });
  });
});

describe('refunds', () => {
  it('releases reserved items before sending', async () => {
    await setupStock(['ONLY-ONE']);
    await addOrder('RF1');
    await handleOrderPaid(paidEvent('RF1'), deps());
    expect(await handleOrderCancelled(cancelledEvent('RF1'))).toBe('released');
    expect(await getDelivery('RF1')).toMatchObject({ status: 'cancelled', reason: 'refunded' });
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(1);
    const draft = (await getDb().drafts.toArray())[0]!;
    expect(draft.status).toBe('dismissed');
    expect(draft.text).not.toContain('ONLY-ONE');
  });

  it('cancels a queued (not started) send and releases the items atomically', async () => {
    await setupStock(['Q-ONE']);
    await enableAutoDelivery();
    await addOrder('RF2');
    await handleOrderPaid(paidEvent('RF2'), deps());
    const d = (await getDelivery('RF2'))!;
    expect(await handleOrderCancelled(cancelledEvent('RF2'))).toBe('released');
    expect(await getDb().tasks.get(d.taskId!)).toMatchObject({ status: 'cancelled' });
    expect(await getDelivery('RF2')).toMatchObject({ status: 'cancelled' });
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(1);
  });

  it('keeps sent deliveries and flags a running send; a definite failure then releases', async () => {
    await setupStock(['P-1', 'P-2']);
    await enableAutoDelivery();
    await addOrder('RF3');
    await addOrder('RF4');
    await handleOrderPaid(paidEvent('RF3'), deps());
    await handleOrderPaid(paidEvent('RF4'), deps());
    const d3 = (await getDelivery('RF3'))!;
    const d4 = (await getDelivery('RF4'))!;
    await completeTask(d3.taskId!);
    await syncDeliveryOutcomes();
    expect(await handleOrderCancelled(cancelledEvent('RF3'))).toBe('flagged');
    expect(await getDelivery('RF3')).toMatchObject({ status: 'sent' });

    await getDb().tasks.update(d4.taskId!, { status: 'running' });
    expect(await handleOrderCancelled(cancelledEvent('RF4'))).toBe('flagged');
    expect((await getDelivery('RF4'))!.refundedAt).not.toBeNull();
    await failTask(d4.taskId!, 'Chat is closed', { retryable: false });
    await syncDeliveryOutcomes();
    expect(await getDelivery('RF4')).toMatchObject({ status: 'cancelled', reason: 'refunded' });
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(1);
  });

  it('manual reserve, release by the seller', async () => {
    const pool = await setupStock(['M-1']);
    await addOrder('MR', { description: 'Something unrelated' });
    const res = await reserveAndPrepare('MR', { auto: false, poolId: pool.id }, deps());
    expect(res.kind).toBe('reserved');
    expect(await releaseByUser('MR')).toBe(1);
    expect(await getDelivery('MR')).toMatchObject({ status: 'cancelled', reason: 'released_by_user' });
  });
});
