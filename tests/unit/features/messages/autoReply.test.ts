import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, emitEvent, onEvent } from '@/core/events/bus';
import { handleMessageReceived } from '@/features/messages/autoReply';
import { nextWindowEnd } from '@/core/util/time';
import { ingestMessages } from '@/features/sync/ingest';
import { BUYER, CHAT, deps, iso, localHHMM, messageEvent, msg, NOW, order, rule, runningSettings, seedChat, seedChatBaseline, seedMessages, seedRules, sendTasks } from './helpers';

beforeEach(async () => {
  resetDbForTests();
  clearEventHandlersForTests();
  await seedChatBaseline();
  await seedChat();
  await seedRules(rule());
});

async function receive(id: string, text: string, opts: { at?: number | null; d?: Parameters<typeof deps>[0] } = {}) {
  const m = msg(id, 'customer', text, opts.at === undefined ? NOW - 60_000 : opts.at);
  await seedMessages(m);
  return handleMessageReceived(messageEvent(m), deps(opts.d));
}

describe('auto-reply: sending', () => {
  it('queues one reply with a deterministic idempotency key and filled variables', async () => {
    const out = await receive('10', 'What is the price?');
    expect(out).toMatchObject({ action: 'queued', ruleId: 'arr_price', runAt: null });
    const tasks = await sendTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.idempotencyKey).toBe(`msg:autoreply:${CHAT}:10`);
    expect(tasks[0]!.payload).toMatchObject({ chatId: CHAT, text: 'Hi BuyerAlpha! The price is in the listing.', source: 'auto_reply', ruleId: 'arr_price', triggerMessageId: '10' });
  });

  it('fills order variables from the buyer’s latest sale', async () => {
    await getDb().orders.put(order('ABCD1234'));
    await seedRules(rule({ reply: 'Order #{order_id}: {product} — {price}' }));
    await receive('10', 'price?');
    expect((await sendTasks())[0]!.payload['text']).toBe('Order #ABCD1234: Test item, 1 pcs — 1250.50 ₽');
  });

  it('handles the same MESSAGE_RECEIVED twice as one reply (dedupe)', async () => {
    const m = msg('10', 'customer', 'price please');
    await seedMessages(m);
    const first = await handleMessageReceived(messageEvent(m), deps());
    const second = await handleMessageReceived(messageEvent(m), deps());
    expect(first.action).toBe('queued');
    expect(second).toEqual({ action: 'skipped', reason: 'duplicate' });
    expect(await getDb().tasks.where('idempotencyKey').equals(`msg:autoreply:${CHAT}:10`).count()).toBe(1);
  });

  it('end-to-end through ingestion and the event bus: re-ingesting never replies twice', async () => {
    onEvent('MESSAGE_RECEIVED', async (e) => {
      await handleMessageReceived(e, deps());
    });
    const history = [msg('8', 'self', 'Hello!', NOW - 2 * 3600_000), msg('9', 'customer', 'price?')];
    await ingestMessages(CHAT, history, { retentionDays: 30, now: NOW });
    await ingestMessages(CHAT, history, { retentionDays: 30, now: NOW });
    const event = messageEvent(history[1]!);
    expect(await emitEvent('MESSAGE_RECEIVED', `${CHAT}:9`, event.payload)).toBe(false);
    expect(await sendTasks()).toHaveLength(1);
  });

  it('respects a 1-reply-per-trigger ledger entry from an earlier send', async () => {
    await getDb().replyLedger.put({ id: `${CHAT}:10:arr_price`, chatId: CHAT, ruleId: 'arr_price', at: NOW - 10_000, text: 'x' });
    expect(await receive('10', 'price')).toEqual({ action: 'skipped', reason: 'duplicate' });
  });
});

describe('auto-reply: loop prevention', () => {
  it('does nothing while the feature is not running (and logs at debug level)', async () => {
    const paused = runningSettings({ automation: { state: 'paused' } });
    expect(await receive('10', 'price', { d: { settings: paused } })).toMatchObject({ action: 'skipped', reason: 'not_running' });
    const unack = runningSettings({ automation: { liveActionsAcknowledged: false } });
    expect(await receive('11', 'price', { d: { settings: unack } })).toMatchObject({ reason: 'not_running' });
    expect(await sendTasks()).toHaveLength(0);
    const logs = await getDb().logs.where('source').equals('auto-reply').toArray();
    expect(logs.some((l) => l.level === 'debug' && l.message.includes('not_running'))).toBe(true);
  });

  it('ignores baseline events', async () => {
    const m = msg('10', 'customer', 'price');
    await seedMessages(m);
    expect(await handleMessageReceived(messageEvent(m, { baseline: true }), deps())).toEqual({ action: 'skipped', reason: 'baseline' });
  });

  it('never reacts to the seller’s own or FunPay system messages', async () => {
    const self = msg('10', 'self', 'price is 10');
    const system = msg('11', 'system', 'price');
    await seedMessages(self, system);
    expect(await handleMessageReceived(messageEvent(self), deps())).toMatchObject({ reason: 'not_customer' });
    expect(await handleMessageReceived(messageEvent(system), deps())).toMatchObject({ reason: 'not_customer' });
    // A FunPay notification mis-attributed to the buyer is still recognised as a system message.
    expect(await receive('12', 'Покупатель BuyerAlpha оплатил заказ #AAAA1111. price')).toMatchObject({ reason: 'system_message' });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('ignores messages written before FunPro’s baseline or too long ago', async () => {
    await seedChatBaseline(NOW - 3600_000);
    expect(await receive('10', 'price', { at: NOW - 2 * 3600_000 })).toMatchObject({ reason: 'baseline' });
    await seedChatBaseline(NOW - 48 * 3600_000);
    expect(await receive('11', 'price', { at: NOW - 13 * 3600_000 })).toMatchObject({ reason: 'stale' });
  });

  it('without a timestamp, ignores the first history of a chat but answers later messages', async () => {
    expect(await receive('10', 'price', { at: null })).toMatchObject({ reason: 'unknown_time_first_history' });
    expect(await receive('11', 'price again', { at: null })).toMatchObject({ action: 'queued' });
  });

  it('uses the chat list time as an estimate for the latest message', async () => {
    await seedChatBaseline(NOW - 48 * 3600_000);
    await seedChat(CHAT, 'BuyerAlpha', { lastMessageAt: iso(NOW - 30 * 3600_000) });
    expect(await receive('10', 'price', { at: null })).toMatchObject({ reason: 'stale' });
  });

  it('does not react when the seller already wrote after the trigger message', async () => {
    await seedMessages(msg('11', 'self', 'Done, sent you the details'));
    expect(await receive('10', 'price')).toMatchObject({ reason: 'seller_replied' });
  });

  it('pauses after a manual seller message, but not after FunPro’s own automatic one', async () => {
    await seedMessages(msg('9', 'self', 'Let me check that for you', NOW - 5 * 60_000));
    expect(await receive('10', 'price')).toMatchObject({ reason: 'manual_pause' });

    resetDbForTests();
    await seedChatBaseline();
    await seedChat();
    await seedRules(rule());
    await seedMessages(msg('9', 'self', 'Automatic hello', NOW - 5 * 60_000));
    await getDb().replyLedger.put({ id: `${CHAT}:8:welcome`, chatId: CHAT, ruleId: 'welcome', at: NOW - 5 * 60_000, text: 'Automatic hello' });
    expect(await receive('10', 'price')).toMatchObject({ action: 'queued' });
  });

  it('allows replies again once the manual pause is over', async () => {
    await seedMessages(msg('9', 'self', 'Manual answer', NOW - 31 * 60_000));
    expect(await receive('10', 'price')).toMatchObject({ action: 'queued' });
  });
});

describe('auto-reply: cooldowns and limits', () => {
  it('per-rule-per-chat cooldown', async () => {
    const d = { settings: runningSettings({ messages: { perCustomerCooldownSec: 0 } }) };
    expect(await receive('10', 'price', { d })).toMatchObject({ action: 'queued' });
    expect(await receive('11', 'price?', { d: { ...d, now: NOW + 5 * 60_000 } })).toMatchObject({ reason: 'rule_cooldown' });
    // Another rule is not affected by this rule's cooldown.
    await seedRules(rule({ id: 'arr_eta', name: 'ETA', patterns: ['when'], reply: 'Within 10 minutes.' }));
    expect(await receive('12', 'when?', { d: { ...d, now: NOW + 6 * 60_000 } })).toMatchObject({ action: 'queued', ruleId: 'arr_eta' });
    expect(await receive('13', 'price', { d: { ...d, now: NOW + 11 * 60_000 } })).toMatchObject({ action: 'queued' });
  });

  it('per-customer cooldown across rules', async () => {
    await seedRules(rule({ id: 'arr_eta', name: 'ETA', patterns: ['when'], reply: 'Within 10 minutes.', cooldownSec: 0 }));
    expect(await receive('10', 'price')).toMatchObject({ action: 'queued' });
    expect(await receive('11', 'when?', { d: { now: NOW + 60_000 } })).toMatchObject({ reason: 'customer_cooldown' });
    expect(await receive('12', 'when?', { d: { now: NOW + 901_000 } })).toMatchObject({ action: 'queued' });
  });

  it('caps automatic replies per chat per hour', async () => {
    const settings = runningSettings({ messages: { perCustomerCooldownSec: 0, maxAutoRepliesPerChatPerHour: 2 } });
    await seedRules(rule({ cooldownSec: 0 }));
    expect(await receive('10', 'price', { d: { settings } })).toMatchObject({ action: 'queued' });
    expect(await receive('11', 'price', { d: { settings, now: NOW + 1000 } })).toMatchObject({ action: 'queued' });
    expect(await receive('12', 'price', { d: { settings, now: NOW + 2000 } })).toMatchObject({ reason: 'chat_hourly_limit' });
    expect(await receive('13', 'price', { d: { settings, now: NOW + 3601_000 } })).toMatchObject({ action: 'queued' });
  });

  it('ignores messages that match no rule', async () => {
    expect(await receive('10', 'hello')).toMatchObject({ reason: 'no_match' });
  });
});

describe('auto-reply: drafts instead of sending', () => {
  it('requireApproval creates a pending draft (once)', async () => {
    await seedRules(rule({ requireApproval: true }));
    const out = await receive('10', 'price');
    expect(out).toMatchObject({ action: 'draft', reason: 'approval_required' });
    const drafts = await getDb().drafts.toArray();
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ chatId: CHAT, triggerMessageId: '10', source: 'auto_reply', status: 'pending', text: 'Hi BuyerAlpha! The price is in the listing.' });
    expect(drafts[0]!.meta).toMatchObject({ kind: 'auto_reply', reason: 'approval_required', ruleId: 'arr_price' });
    expect(await sendTasks()).toHaveLength(0);
    expect(await handleMessageReceived(messageEvent(msg('10', 'customer', 'price')), deps())).toMatchObject({ reason: 'duplicate' });
  });

  it('turns replies with contacts or confirmation pressure into drafts', async () => {
    await seedRules(rule({ reply: 'Write me in telegram t.me/myshop' }));
    expect(await receive('10', 'price')).toMatchObject({ action: 'draft', reason: 'lint' });
    expect((await getDb().drafts.toArray())[0]!.meta).toMatchObject({ lint: ['telegram'] });
    await seedRules(rule({ reply: 'Подтвердите заказ, пожалуйста' }));
    expect(await receive('20', 'price', { d: { now: NOW + 3600_000 }, at: NOW + 3600_000 - 1000 })).toMatchObject({ action: 'draft', reason: 'lint' });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('keeps unfilled variables visible in a draft', async () => {
    await seedRules(rule({ reply: 'Your order {order_id} is on its way' }));
    expect(await receive('10', 'price')).toMatchObject({ action: 'draft', reason: 'missing_variables' });
    const d = (await getDb().drafts.toArray())[0]!;
    expect(d.text).toBe('Your order {order_id} is on its way');
    expect(d.meta).toMatchObject({ missing: ['order_id'] });
  });
});

describe('auto-reply: quiet hours', () => {
  it('holds the reply until the end of the quiet window', async () => {
    const settings = runningSettings({ messages: { quietHours: { enabled: true, start: localHHMM(NOW, -60), end: localHHMM(NOW, 60) } } });
    const out = await receive('10', 'price', { d: { settings } });
    const expected = nextWindowEnd(new Date(NOW), localHHMM(NOW, 60)).getTime();
    expect(out).toMatchObject({ action: 'queued', runAt: expected });
    expect((await sendTasks())[0]!.nextRunAt).toBe(expected);
  });

  it('skips the reply when queueing during quiet hours is off', async () => {
    const settings = runningSettings({ messages: { queueDuringQuietHours: false, quietHours: { enabled: true, start: localHHMM(NOW, -60), end: localHHMM(NOW, 60) } } });
    expect(await receive('10', 'price', { d: { settings } })).toMatchObject({ reason: 'quiet_hours' });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('sends normally outside the window', async () => {
    const settings = runningSettings({ messages: { quietHours: { enabled: true, start: localHHMM(NOW, 60), end: localHHMM(NOW, 120) } } });
    expect(await receive('10', 'price', { d: { settings } })).toMatchObject({ action: 'queued', runAt: null });
  });
});

describe('auto-reply: authorship from the stored message wins', () => {
  it('uses the stored message kind even if the event payload claims a customer', async () => {
    const self = msg('10', 'self', 'price');
    await seedMessages(self);
    const ev = messageEvent({ ...self, kind: 'customer', authorId: BUYER });
    expect(await handleMessageReceived(ev, deps())).toMatchObject({ reason: 'not_customer' });
  });
});
