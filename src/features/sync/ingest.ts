/**
 * Ingestion: turns parsed FunPay data into persisted FunPro state and deduplicated domain events.
 *
 * Key safety property — BASELINE: the very first time FunPro sees a data stream (orders, chats) it
 * records everything as baseline and emits events flagged `baseline: true`. Automations ignore
 * baseline events, so installing FunPro never messages hundreds of past buyers.
 */
import type {
  ParsedFinanceOp,
  ParsedListing,
  ParsedOrder,
  ParsedReview,
  RaiseTarget,
} from '@/adapters/funpay/types';
import { getDb } from '@/core/db/db';
import { emitEvent } from '@/core/events/bus';
import type {
  ChatMessage,
  ChatSummary,
  CompetitorOffer,
  Customer,
  Listing,
  Order,
  OrderDirection,
} from '@/shared/models';
import { canTransition } from '@/shared/models/order';
import { parseMoney } from '@/shared/models/money';
import { nowIso } from '@/core/util/id';

async function getBaseline(key: string): Promise<number | null> {
  const rec = await getDb().kv.get(`baseline:${key}`);
  return typeof rec?.value === 'number' ? rec.value : null;
}

async function ensureBaseline(key: string, now: number): Promise<boolean> {
  const existing = await getBaseline(key);
  if (existing !== null) return false;
  await getDb().kv.put({ key: `baseline:${key}`, value: now });
  return true;
}

const STATUS_EVENT = {
  paid: 'ORDER_PAID',
  closed: 'ORDER_COMPLETED',
  refunded: 'ORDER_CANCELLED',
} as const;

export interface OrderIngestResult {
  created: string[];
  changed: { id: string; from: Order['status']; to: Order['status'] }[];
  baseline: boolean;
}

export async function ingestOrders(
  parsed: ParsedOrder[],
  direction: OrderDirection,
  now = Date.now(),
): Promise<OrderIngestResult> {
  const db = getDb();
  const isBaseline = await ensureBaseline(`orders:${direction}`, now);
  const result: OrderIngestResult = { created: [], changed: [], baseline: isBaseline };
  const at = new Date(now).toISOString();
  const pendingEvents: [Parameters<typeof emitEvent>[0], string, Record<string, unknown>][] = [];

  await db.transaction('rw', db.orders, db.customers, async () => {
    for (const p of parsed) {
      if (p.direction !== direction) continue;
      const existing = await db.orders.get(p.id);
      if (!existing) {
        const order: Order = {
          ...p,
          firstSeenAt: at,
          updatedAt: at,
          history: [{ status: p.status, at, source: 'observed' }],
        };
        await db.orders.add(order);
        result.created.push(p.id);
        const payload = {
          orderId: p.id,
          direction,
          status: p.status,
          buyer: p.counterpartyName,
          buyerId: p.counterpartyId,
          baseline: isBaseline,
          createdAt: p.createdAt,
        };
        pendingEvents.push(['ORDER_DETECTED', p.id, payload]);
        if (p.status !== 'unknown') pendingEvents.push([STATUS_EVENT[p.status], p.id, payload]);
      } else {
        const patch: Partial<Order> = {
          counterpartyName: p.counterpartyName || existing.counterpartyName,
          counterpartyId: p.counterpartyId ?? existing.counterpartyId,
          description: p.description || existing.description,
          categoryName: p.categoryName || existing.categoryName,
          price: p.price.currency === 'UNKNOWN' ? existing.price : p.price,
          createdAt: existing.createdAt ?? p.createdAt,
        };
        if (
          p.status !== existing.status &&
          p.status !== 'unknown' &&
          canTransition(existing.status, p.status)
        ) {
          patch.status = p.status;
          patch.history = [...existing.history, { status: p.status, at, source: 'observed' }];
          patch.updatedAt = at;
          result.changed.push({ id: p.id, from: existing.status, to: p.status });
          pendingEvents.push([
            STATUS_EVENT[p.status],
            p.id,
            {
              orderId: p.id,
              direction,
              status: p.status,
              from: existing.status,
              buyer: patch.counterpartyName,
              buyerId: patch.counterpartyId,
              baseline: false,
              createdAt: patch.createdAt,
            },
          ]);
        }
        await db.orders.update(p.id, patch);
      }
      if (direction === 'sale' && p.counterpartyName)
        await touchCustomer(p.counterpartyId, p.counterpartyName, at);
    }
  });
  for (const [type, key, payload] of pendingEvents) await emitEvent(type, key, payload);
  return result;
}

export function customerKey(id: string | null, name: string): string {
  return id ? id : `name:${name.toLowerCase()}`;
}

async function touchCustomer(id: string | null, name: string, at: string): Promise<void> {
  const db = getDb();
  const key = customerKey(id, name);
  const existing = await db.customers.get(key);
  if (existing) {
    await db.customers.update(key, { lastSeenAt: at, name });
  } else {
    const c: Customer = {
      id: key,
      name,
      tags: [],
      notes: '',
      pinned: false,
      followUpAt: null,
      followUpNote: '',
      firstSeenAt: at,
      lastSeenAt: at,
    };
    await db.customers.add(c);
  }
}

export interface ChatListIngestResult {
  /** Chats whose last message changed since the previous sync (need history fetch). */
  changed: string[];
  /** Chats first seen after the baseline (candidates for welcome messages). */
  newChats: string[];
  baseline: boolean;
}

export async function ingestChatList(
  items: Omit<ChatSummary, 'pinned' | 'updatedAt'>[],
  now = Date.now(),
): Promise<ChatListIngestResult> {
  const db = getDb();
  const isBaseline = await ensureBaseline('chats', now);
  const at = new Date(now).toISOString();
  const res: ChatListIngestResult = { changed: [], newChats: [], baseline: isBaseline };
  await db.transaction('rw', db.chats, async () => {
    for (const c of items) {
      const existing = await db.chats.get(c.id);
      if (!existing) {
        await db.chats.add({ ...c, pinned: false, updatedAt: at });
        if (!isBaseline) {
          res.newChats.push(c.id);
          res.changed.push(c.id);
        }
      } else {
        const changed = existing.lastMessageText !== c.lastMessageText || (c.unread && !existing.unread);
        await db.chats.update(c.id, {
          partnerName: c.partnerName || existing.partnerName,
          lastMessageText: c.lastMessageText,
          lastMessageAt: c.lastMessageAt ?? existing.lastMessageAt,
          unread: c.unread,
          updatedAt: changed ? at : existing.updatedAt,
        });
        if (changed) res.changed.push(c.id);
      }
    }
  });
  return res;
}

export interface MessageIngestResult {
  newCustomerMessages: ChatMessage[];
  newSelfMessages: ChatMessage[];
  newSystemMessages: ChatMessage[];
  firstHistoryForChat: boolean;
}

/**
 * Store chat history. Only messages not seen before produce events. When this is the first history
 * we ever loaded for a chat, older messages are stored silently and only the newest customer message
 * (if it is the latest message overall) is reported — so a buyer waiting for an answer still gets one.
 */
export async function ingestMessages(
  chatId: string,
  messages: ChatMessage[],
  opts: { retentionDays: number; now?: number },
): Promise<MessageIngestResult> {
  const db = getDb();
  const now = opts.now ?? Date.now();
  const res: MessageIngestResult = {
    newCustomerMessages: [],
    newSelfMessages: [],
    newSystemMessages: [],
    firstHistoryForChat: false,
  };
  const fresh: ChatMessage[] = [];
  await db.transaction('rw', db.messages, async () => {
    const known = await db.messages.where('chatId').equals(chatId).count();
    res.firstHistoryForChat = known === 0;
    for (const m of messages) {
      if (m.chatId !== chatId) continue;
      if (await db.messages.get([chatId, m.id])) continue;
      fresh.push(m);
      // Respect retention: with 0 days we keep only metadata (no body).
      await db.messages.add(opts.retentionDays === 0 ? { ...m, text: '' } : m);
    }
  });
  const sorted = [...fresh].sort((a, b) => compareIds(a.id, b.id));
  let candidates = sorted;
  if (res.firstHistoryForChat) {
    const last = [...messages].sort((a, b) => compareIds(a.id, b.id)).at(-1);
    candidates = last && last.kind === 'customer' ? [last] : [];
  }
  for (const m of candidates) {
    if (m.kind === 'customer') res.newCustomerMessages.push(m);
    else if (m.kind === 'self') res.newSelfMessages.push(m);
    else res.newSystemMessages.push(m);
  }
  const chatsBaselineAt = res.newCustomerMessages.length ? await getBaseline('chats') : null;
  for (const m of res.newCustomerMessages) {
    const atMs = m.at ? Date.parse(m.at) : NaN;
    // A message reported from the first history FunPro loads for a chat is "baseline" (history,
    // not news) when its own timestamp shows it predates FunPro's chat baseline or is stale.
    const baseline =
      res.firstHistoryForChat &&
      Number.isFinite(atMs) &&
      ((chatsBaselineAt !== null && atMs < chatsBaselineAt - MESSAGE_BASELINE_SLACK_MS) ||
        now - atMs > STALE_MESSAGE_MS);
    await emitEvent('MESSAGE_RECEIVED', `${chatId}:${m.id}`, {
      chatId,
      messageId: m.id,
      authorId: m.authorId,
      authorName: m.authorName,
      text: m.text,
      at: m.at ?? new Date(now).toISOString(),
      atKnown: Number.isFinite(atMs),
      firstHistory: res.firstHistoryForChat,
      baseline,
    });
  }
  return res;
}

/** FunPay shows minute-precision times; allow for that when comparing with the baseline. */
const MESSAGE_BASELINE_SLACK_MS = 2 * 60_000;
/** Messages older than this are never treated as news (no notifications / automation). */
const STALE_MESSAGE_MS = 12 * 3600_000;

/** FunPay message ids are numeric and increase over time; fall back to string comparison. */
export function compareIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export async function ingestListings(
  parsed: ParsedListing[],
  opts: { complete?: boolean; nodeId?: string | null; now?: number } = {},
): Promise<{ created: number; updated: number }> {
  const db = getDb();
  const at = new Date(opts.now ?? Date.now()).toISOString();
  let created = 0;
  let updated = 0;
  const changedIds: string[] = [];
  await db.transaction('rw', db.listings, async () => {
    const maxSort = (await db.listings.orderBy('sortIndex').last())?.sortIndex ?? 0;
    let sort = maxSort;
    for (const p of parsed) {
      const existing = await db.listings.get(p.id);
      if (!existing) {
        const l: Listing = { ...p, costMinor: null, sortIndex: ++sort, seenAt: at, updatedAt: at };
        await db.listings.add(l);
        created++;
      } else {
        const changed =
          existing.price.amountMinor !== p.price.amountMinor ||
          existing.active !== p.active ||
          existing.title !== p.title ||
          existing.amount !== p.amount;
        await db.listings.update(p.id, {
          title: p.title || existing.title,
          price: p.price.currency === 'UNKNOWN' ? existing.price : p.price,
          amount: p.amount ?? existing.amount,
          active: p.active,
          promoted: p.promoted,
          autoDelivery: p.autoDelivery,
          nodeId: p.nodeId ?? existing.nodeId,
          gameId: p.gameId ?? existing.gameId,
          categoryName: p.categoryName || existing.categoryName,
          seenAt: at,
          ...(changed ? { updatedAt: at } : {}),
        });
        if (changed) changedIds.push(p.id);
        updated++;
      }
    }
  });
  for (const id of changedIds) await emitEvent('LISTING_UPDATED', `${id}:${at}`, { listingId: id });
  return { created, updated };
}

export async function ingestReviews(parsed: ParsedReview[], now = Date.now()): Promise<string[]> {
  const db = getDb();
  const isBaseline = await ensureBaseline('reviews', now);
  const at = new Date(now).toISOString();
  const created: string[] = [];
  await db.transaction('rw', db.reviews, async () => {
    for (const r of parsed) {
      const existing = await db.reviews.get(r.orderId);
      if (!existing) {
        await db.reviews.add({ ...r, firstSeenAt: at });
        created.push(r.orderId);
      } else {
        // Keep a locally known reply (e.g. just posted from FunPro) when a stale page does not show it yet.
        await db.reviews.update(r.orderId, {
          stars: r.stars ?? existing.stars,
          text: r.text,
          sellerReply: r.sellerReply ?? existing.sellerReply,
        });
      }
    }
  });
  for (const id of created) {
    const r = parsed.find((x) => x.orderId === id)!;
    await emitEvent('REVIEW_RECEIVED', id, {
      orderId: id,
      stars: r.stars,
      authorName: r.authorName,
      hasReply: !!r.sellerReply,
      baseline: isBaseline,
    });
  }
  return created;
}

export async function ingestFinance(parsed: ParsedFinanceOp[], now = Date.now()): Promise<number> {
  const db = getDb();
  const at = new Date(now).toISOString();
  let created = 0;
  await db.transaction('rw', db.financeOps, async () => {
    for (const f of parsed) {
      const existing = await db.financeOps.get(f.id);
      if (!existing) {
        await db.financeOps.add({ ...f, firstSeenAt: at });
        created++;
      } else if (existing.status !== f.status) {
        await db.financeOps.update(f.id, { status: f.status });
      }
    }
  });
  return created;
}

export async function ingestBalance(balanceText: string | null, now = Date.now()): Promise<void> {
  if (!balanceText) return;
  const m = parseMoney(balanceText);
  if (!m) return;
  const db = getDb();
  const last = await db.balances.orderBy('at').last();
  const same =
    last?.balances.length === 1 &&
    last.balances[0]!.amountMinor === m.amountMinor &&
    last.balances[0]!.currency === m.currency;
  // Store a point only when the balance changed or hourly, to keep history compact.
  if (same && now - Date.parse(last.at) < 3600_000) return;
  await db.balances.add({ balances: [m], at: new Date(now).toISOString() });
}

/** Record competitor prices; emits PRICE_CHANGE_DETECTED when an offer's price changes. */
export async function ingestCompetitors(
  nodeId: string,
  offers: CompetitorOffer[],
  now = Date.now(),
): Promise<number> {
  const db = getDb();
  const at = new Date(now).toISOString();
  const changes: { offerId: string; from: number; to: number; seller: string }[] = [];
  await db.transaction('rw', db.competitorSnapshots, async () => {
    for (const o of offers) {
      const prev = await db.competitorSnapshots
        .where('[offerId+at]')
        .between([o.offerId, ''], [o.offerId, '￿'])
        .last();
      if (prev && prev.price.amountMinor === o.price.amountMinor && now - Date.parse(prev.at) < 6 * 3600_000)
        continue;
      await db.competitorSnapshots.put({ ...o, nodeId, id: `${nodeId}:${o.offerId}:${at}`, at });
      if (prev && prev.price.amountMinor !== o.price.amountMinor)
        changes.push({
          offerId: o.offerId,
          from: prev.price.amountMinor,
          to: o.price.amountMinor,
          seller: o.sellerName,
        });
    }
  });
  for (const c of changes)
    await emitEvent('PRICE_CHANGE_DETECTED', `${c.offerId}:${c.to}:${at}`, { nodeId, ...c });
  return changes.length;
}

export async function ingestBumpTarget(target: RaiseTarget, categoryName: string): Promise<void> {
  const db = getDb();
  const existing = await db.bumpState.get(target.gameId);
  if (existing) {
    const nodeIds = Array.from(new Set([...existing.nodeIds, target.nodeId]));
    await db.bumpState.update(target.gameId, {
      nodeIds,
      categoryName: existing.categoryName || categoryName,
    });
  } else {
    await db.bumpState.add({
      gameId: target.gameId,
      nodeIds: [target.nodeId],
      categoryName,
      status: 'idle',
      lastAttemptAt: null,
      lastSuccessAt: null,
      nextEligibleAt: null,
      lastMessage: '',
      consecutiveFailures: 0,
    });
  }
}

export { nowIso };
