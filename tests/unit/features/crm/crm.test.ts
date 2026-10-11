import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { chatIdForCustomer, computeCustomerStats, customerOrders, groupOrdersByCustomer, updateCustomer } from '@/features/crm/customers';
import { processFollowUps } from '@/features/crm/followUps';
import { computeServiceMetrics, median } from '@/features/crm/metrics';
import { ingestOrders } from '@/features/sync/ingest';
import type { Customer } from '@/shared/models';
import { iso, msg, NOW, order } from '../messages/helpers';

beforeEach(() => {
  resetDbForTests();
});

const customer = (over: Partial<Customer> = {}): Customer => ({
  id: '2000001',
  name: 'BuyerAlpha',
  tags: [],
  notes: '',
  pinned: false,
  followUpAt: null,
  followUpNote: '',
  firstSeenAt: iso(NOW),
  lastSeenAt: iso(NOW),
  ...over,
});

describe('customer aggregations', () => {
  it('counts orders, repeat buyers and total spent per currency (refunds excluded, never converted)', () => {
    const stats = computeCustomerStats([
      order('A1', { price: { amountMinor: 10000, currency: 'RUB' }, createdAt: iso(NOW - 3000) }),
      order('A2', { price: { amountMinor: 2500, currency: 'RUB' }, status: 'paid', createdAt: iso(NOW - 2000) }),
      order('A3', { price: { amountMinor: 999, currency: 'USD' }, createdAt: iso(NOW - 1000) }),
      order('A4', { price: { amountMinor: 5000, currency: 'RUB' }, status: 'refunded' }),
      order('P1', { direction: 'purchase', price: { amountMinor: 7777, currency: 'RUB' } }),
    ]);
    expect(stats).toMatchObject({ orderCount: 4, activeCount: 3, refundedCount: 1, repeatBuyer: true, totalSpent: { RUB: 12500, USD: 999 } });
    expect(stats.lastOrderAt).toBe(iso(NOW - 1000));
    expect(stats.firstOrderAt).toBe(iso(NOW - 2 * 3600_000));
  });

  it('a buyer with one order (or one order plus a refund) is not a repeat buyer', () => {
    expect(computeCustomerStats([order('A1')]).repeatBuyer).toBe(false);
    expect(computeCustomerStats([order('A1'), order('A2', { status: 'refunded' })]).repeatBuyer).toBe(false);
  });

  it('groups sales by customer key like ingestion does', () => {
    const groups = groupOrdersByCustomer([order('A1'), order('A2'), order('B1', { counterpartyId: null, counterpartyName: 'NoId' }), order('P1', { direction: 'purchase' })]);
    expect([...groups.keys()].sort()).toEqual(['2000001', 'name:noid']);
    expect(groups.get('2000001')!.map((o) => o.id).sort()).toEqual(['A1', 'A2']);
  });

  it('finds purchase history by id and by name, newest first', async () => {
    await getDb().orders.bulkPut([
      order('A1', { createdAt: iso(NOW - 5000) }),
      order('A2', { createdAt: iso(NOW - 1000), counterpartyId: null, counterpartyName: 'buyeralpha' }),
      order('X1', { counterpartyId: '999', counterpartyName: 'BuyerAlpha' }),
      order('P1', { direction: 'purchase' }),
    ]);
    expect((await customerOrders(customer())).map((o) => o.id)).toEqual(['A2', 'A1']);
  });

  it('customers are created by order ingestion', async () => {
    await ingestOrders([{ ...order('A1'), firstSeenAt: undefined } as never], 'sale', NOW);
    expect(await getDb().customers.get('2000001')).toMatchObject({ name: 'BuyerAlpha' });
  });
});

describe('notes, tags, pins and follow-ups', () => {
  it('updates private fields with normalised tags and UTC follow-up times', async () => {
    await getDb().customers.put(customer());
    const c = await updateCustomer('2000001', { notes: 'Prefers EU server', tags: ['#VIP', ' vip ', 'wholesale', ''], pinned: true, followUpAt: '2026-10-12T09:00:00+03:00', followUpNote: 'Ask about restock' });
    expect(c).toMatchObject({ notes: 'Prefers EU server', tags: ['VIP', 'vip', 'wholesale'], pinned: true, followUpAt: '2026-10-12T06:00:00.000Z' });
    await expect(updateCustomer('nope', { notes: 'x' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(updateCustomer('2000001', { followUpAt: 'not a date' })).rejects.toMatchObject({ code: 'invalid' });
  });

  it('notifies a due follow-up once per follow-up time', async () => {
    await getDb().customers.bulkPut([
      customer({ followUpAt: iso(NOW - 1000), followUpNote: 'Offer a bundle' }),
      customer({ id: '3', name: 'Later', followUpAt: iso(NOW + 3600_000) }),
      customer({ id: '4', name: 'None' }),
    ]);
    const notify = vi.fn(async () => undefined);
    const d = { now: NOW, notify, urlFor: (id: string) => `chrome-extension://x/options.html#/customers?id=${id}` };
    expect(await processFollowUps(d)).toBe(1);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'system', title: 'Follow up: BuyerAlpha', body: 'Offer a bundle', url: 'chrome-extension://x/options.html#/customers?id=2000001' }));
    expect(await processFollowUps(d)).toBe(0);
    await updateCustomer('2000001', { followUpAt: iso(NOW - 10) });
    expect(await processFollowUps(d)).toBe(1);
  });

  it('finds the conversation with a customer', async () => {
    expect(await chatIdForCustomer(customer(), '1000001')).toBe('users-1000001-2000001');
    await getDb().chats.put({ id: 'users-5-6', partnerName: 'NameOnly', partnerId: null, lastMessageText: '', lastMessageAt: null, unread: false, pinned: false, updatedAt: iso(NOW) });
    expect(await chatIdForCustomer(customer({ id: 'name:nameonly', name: 'NameOnly' }), '1000001')).toBe('users-5-6');
    expect(await chatIdForCustomer(customer({ id: 'name:x', name: 'X' }), null)).toBeNull();
  });
});

describe('service metrics (local history only)', () => {
  it('computes the median first-response time over customer turns', () => {
    const m = computeServiceMetrics(
      [
        // chat A: answered after 2 min (two customer messages form one turn)
        msg('1', 'customer', 'hi', NOW - 10 * 60_000, 'A'),
        msg('2', 'customer', 'anyone?', NOW - 9 * 60_000, 'A'),
        msg('3', 'self', 'yes', NOW - 8 * 60_000, 'A'),
        // chat B: answered after 10 min; a system message does not break the turn
        msg('1', 'customer', 'price?', NOW - 30 * 60_000, 'B'),
        msg('2', 'system', 'Покупатель оплатил заказ', NOW - 25 * 60_000, 'B'),
        msg('3', 'self', '100', NOW - 20 * 60_000, 'B'),
        // chat C: answered, but without timestamps (counts for reply rate only)
        msg('1', 'customer', 'q', null, 'C'),
        msg('2', 'self', 'a', null, 'C'),
        // chat D: answered after 4 min
        msg('5', 'customer', 'q', NOW - 6 * 60_000, 'D'),
        msg('6', 'self', 'a', NOW - 2 * 60_000, 'D'),
      ],
      NOW,
    );
    expect(m.responseSamples).toBe(3);
    expect(m.medianFirstResponseMs).toBe(4 * 60_000);
    expect(m).toMatchObject({ chatsAnalyzed: 4, messagesAnalyzed: 10, customerTurns: 4, answeredTurns: 4, replyRate: 1, unansweredChats: 0 });
  });

  it('counts unanswered chats and excludes still-open turns from the reply rate', () => {
    const m = computeServiceMetrics(
      [
        msg('1', 'customer', 'old question', NOW - 5 * 3600_000, 'A'),
        msg('1', 'customer', 'just now', NOW - 60_000, 'B'),
        msg('1', 'customer', 'q', NOW - 600_000, 'C'),
        msg('2', 'self', 'a', NOW - 300_000, 'C'),
        msg('3', 'customer', 'thanks', null, 'C'),
      ],
      NOW,
    );
    expect(m.unansweredChats).toBe(3);
    expect(m.unansweredChatIds.sort()).toEqual(['A', 'B', 'C']);
    // A (old, unanswered) and C's last turn (no timestamp) count as unanswered; B is still open.
    expect(m).toMatchObject({ customerTurns: 3, answeredTurns: 1, openTurns: 1 });
    expect(m.replyRate).toBeCloseTo(1 / 3);
  });

  it('returns nulls when there is nothing to measure', () => {
    expect(computeServiceMetrics([], NOW)).toMatchObject({ replyRate: null, medianFirstResponseMs: null, chatsAnalyzed: 0 });
    expect(median([5, 1, 3, 2])).toBe(2.5);
  });
});
