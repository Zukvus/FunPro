import { beforeEach, describe, expect, it } from 'vitest';
import { resetDbForTests, getDb } from '@/core/db/db';
import { clearEventHandlersForTests, onEvent } from '@/core/events/bus';
import { ingestChatList, ingestMessages, ingestOrders, ingestCompetitors } from '@/features/sync/ingest';
import type { ParsedOrder } from '@/adapters/funpay/types';
import type { ChatMessage, DomainEvent } from '@/shared/models';

function order(id: string, status: ParsedOrder['status']): ParsedOrder {
  return {
    id,
    direction: 'sale',
    status,
    counterpartyName: 'Buyer',
    counterpartyId: '42',
    description: 'Item',
    categoryName: 'Cat',
    listingId: null,
    price: { amountMinor: 1000, currency: 'RUB' },
    createdAt: '2024-11-05T07:15:00.000Z',
    rawDate: '',
  };
}

function msg(id: string, kind: ChatMessage['kind']): ChatMessage {
  return {
    id,
    chatId: 'c1',
    authorId: kind === 'customer' ? '42' : kind === 'self' ? '1' : '0',
    authorName: 'x',
    kind,
    text: `m${id}`,
    at: null,
    sentByExtension: false,
  };
}

let events: DomainEvent[];

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  events = [];
  for (const t of [
    'ORDER_DETECTED',
    'ORDER_PAID',
    'ORDER_COMPLETED',
    'ORDER_CANCELLED',
    'MESSAGE_RECEIVED',
    'PRICE_CHANGE_DETECTED',
  ] as const) {
    onEvent(t, (e) => {
      events.push(e);
    });
  }
});

describe('order ingestion', () => {
  it('marks the first sync as baseline and emits status transitions afterwards', async () => {
    const first = await ingestOrders([order('A', 'paid'), order('B', 'closed')], 'sale', 1000);
    expect(first.baseline).toBe(true);
    expect(events.every((e) => e.payload['baseline'] === true)).toBe(true);
    events = [];

    const second = await ingestOrders([order('A', 'closed'), order('C', 'paid')], 'sale', 2000);
    expect(second.baseline).toBe(false);
    expect(second.changed).toEqual([{ id: 'A', from: 'paid', to: 'closed' }]);
    expect(events.map((e) => e.id).sort()).toEqual(
      ['ORDER_COMPLETED:A', 'ORDER_DETECTED:C', 'ORDER_PAID:C'].sort(),
    );
    const a = await getDb().orders.get('A');
    expect(a!.history.map((h) => h.status)).toEqual(['paid', 'closed']);
  });

  it('is idempotent: re-ingesting identical data emits nothing', async () => {
    await ingestOrders([order('A', 'paid')], 'sale', 1000);
    events = [];
    await ingestOrders([order('A', 'paid')], 'sale', 2000);
    await ingestOrders([order('A', 'paid')], 'sale', 3000);
    expect(events).toEqual([]);
  });

  it('rejects impossible transitions (refunded → paid)', async () => {
    await ingestOrders([order('A', 'refunded')], 'sale', 1000);
    const r = await ingestOrders([order('A', 'paid')], 'sale', 2000);
    expect(r.changed).toEqual([]);
    expect((await getDb().orders.get('A'))!.status).toBe('refunded');
  });

  it('creates CRM customers for buyers', async () => {
    await ingestOrders([order('A', 'paid')], 'sale', 1000);
    expect(await getDb().customers.get('42')).toMatchObject({ name: 'Buyer' });
  });
});

describe('chat ingestion', () => {
  it('baselines chats and reports only changes later', async () => {
    const base = await ingestChatList([
      {
        id: 'c1',
        partnerName: 'B',
        partnerId: null,
        lastMessageText: 'hi',
        lastMessageAt: null,
        unread: false,
      },
    ]);
    expect(base).toMatchObject({ baseline: true, changed: [], newChats: [] });
    const next = await ingestChatList([
      {
        id: 'c1',
        partnerName: 'B',
        partnerId: null,
        lastMessageText: 'hi',
        lastMessageAt: null,
        unread: false,
      },
      {
        id: 'c2',
        partnerName: 'C',
        partnerId: null,
        lastMessageText: 'new',
        lastMessageAt: null,
        unread: true,
      },
    ]);
    expect(next).toMatchObject({ baseline: false, changed: ['c2'], newChats: ['c2'] });
  });

  it('on first history only reports the latest message when the customer wrote last', async () => {
    const r = await ingestMessages('c1', [msg('1', 'customer'), msg('2', 'self'), msg('3', 'customer')], {
      retentionDays: 30,
    });
    expect(r.firstHistoryForChat).toBe(true);
    expect(r.newCustomerMessages.map((m) => m.id)).toEqual(['3']);
    expect(events.map((e) => e.id)).toEqual(['MESSAGE_RECEIVED:c1:3']);
  });

  it('does not report anything on first history when the seller wrote last', async () => {
    const r = await ingestMessages('c1', [msg('1', 'customer'), msg('2', 'self')], { retentionDays: 30 });
    expect(r.newCustomerMessages).toEqual([]);
  });

  it('deduplicates messages and never reports self/system as customer', async () => {
    await ingestMessages('c1', [msg('1', 'self')], { retentionDays: 30 });
    events = [];
    const r = await ingestMessages(
      'c1',
      [msg('1', 'self'), msg('2', 'system'), msg('3', 'customer'), msg('3', 'customer')],
      { retentionDays: 30 },
    );
    expect(r.newCustomerMessages.map((m) => m.id)).toEqual(['3']);
    expect(r.newSystemMessages.map((m) => m.id)).toEqual(['2']);
    expect(events.map((e) => e.id)).toEqual(['MESSAGE_RECEIVED:c1:3']);
  });

  it('stores no bodies when retention is 0 days', async () => {
    await ingestMessages('c1', [msg('1', 'customer')], { retentionDays: 0 });
    expect((await getDb().messages.get(['c1', '1']))!.text).toBe('');
  });
});

describe('competitor ingestion', () => {
  it('records snapshots and emits on price change', async () => {
    const offer = {
      offerId: 'o1',
      nodeId: '5',
      sellerName: 'S',
      sellerId: null,
      title: 't',
      price: { amountMinor: 100, currency: 'RUB' as const },
      amount: null,
      online: null,
      promoted: false,
      rating: null,
      reviewCount: null,
    };
    expect(await ingestCompetitors('5', [offer], 1_000_000)).toBe(0);
    expect(await ingestCompetitors('5', [offer], 1_000_100)).toBe(0);
    expect(
      await ingestCompetitors('5', [{ ...offer, price: { amountMinor: 90, currency: 'RUB' } }], 1_000_200),
    ).toBe(1);
    expect(events.filter((e) => e.type === 'PRICE_CHANGE_DETECTED')).toHaveLength(1);
    expect(await getDb().competitorSnapshots.count()).toBe(2);
  });
});

describe('MESSAGE_RECEIVED baseline flag', () => {
  function timed(id: string, at: string): ChatMessage {
    return { ...msg(id, 'customer'), at };
  }

  it('flags first-history messages older than the chat baseline', async () => {
    const now = Date.parse('2024-11-05T12:00:00Z');
    await ingestChatList(
      [
        {
          id: 'c1',
          partnerName: 'B',
          partnerId: null,
          lastMessageText: 'x',
          lastMessageAt: null,
          unread: false,
        },
      ],
      now,
    );
    await ingestMessages('c1', [timed('1', '2024-11-05T10:00:00.000Z')], { retentionDays: 30, now });
    expect(events.at(-1)!.payload).toMatchObject({ baseline: true, firstHistory: true, atKnown: true });
  });

  it('does not flag a fresh first message in a new chat, nor messages without a timestamp', async () => {
    const now = Date.parse('2024-11-05T12:00:00Z');
    await ingestChatList([], now - 3600_000);
    await ingestMessages('c2', [timed('5', '2024-11-05T11:59:00.000Z')], { retentionDays: 30, now });
    expect(events.at(-1)!.payload).toMatchObject({ baseline: false, firstHistory: true });
    await ingestMessages('c3', [msg('9', 'customer')], { retentionDays: 30, now });
    expect(events.at(-1)!.payload).toMatchObject({ baseline: false, atKnown: false });
  });

  it('flags stale messages even without a chat baseline', async () => {
    const now = Date.parse('2024-11-05T12:00:00Z');
    await ingestMessages('c4', [timed('1', '2024-11-03T12:00:00.000Z')], { retentionDays: 30, now });
    expect(events.at(-1)!.payload).toMatchObject({ baseline: true });
  });
});
