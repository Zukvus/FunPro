import type { AutomationContext } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { defaultSettings, mergeSettings, type Settings, type SettingsPatch } from '@/core/settings/schema';
import type { AutoReplyRule, ChatMessage, DomainEvent, Order } from '@/shared/models';
import type { MessagingDeps } from '@/features/messages/automation';

export const SELF = '1000001';
export const BUYER = '2000001';
export const CHAT = `users-${SELF}-${BUYER}`;
/** 2026-10-11 12:00 UTC */
export const NOW = Date.UTC(2026, 9, 11, 12, 0, 0);
export const CTX: AutomationContext = { funpayTabAvailable: true, sessionLoggedIn: true };

/** Settings with automation running, live actions acknowledged and all messaging features on. */
export function runningSettings(patch: SettingsPatch = {}): Settings {
  const base = mergeSettings(defaultSettings(), {
    automation: { state: 'running', liveActionsAcknowledged: true, autoReply: true, welcomeMessage: true, postOrderMessage: true },
  });
  return mergeSettings(base, patch);
}

export function deps(over: Partial<MessagingDeps> = {}): MessagingDeps {
  return { settings: runningSettings(), ctx: CTX, now: NOW, selfUserId: SELF, sellerName: 'SellerOne', ...over };
}

export function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function msg(id: string, kind: ChatMessage['kind'], text: string, atMs: number | null = NOW - 60_000, chatId = CHAT): ChatMessage {
  return {
    id,
    chatId,
    authorId: kind === 'customer' ? BUYER : kind === 'self' ? SELF : '0',
    authorName: kind === 'customer' ? 'BuyerAlpha' : kind === 'self' ? 'SellerOne' : 'FunPay',
    kind,
    text,
    at: atMs === null ? null : iso(atMs),
    sentByExtension: false,
  };
}

export async function seedMessages(...messages: ChatMessage[]): Promise<void> {
  await getDb().messages.bulkPut(messages);
}

export async function seedChatBaseline(atMs = NOW - 24 * 3600_000): Promise<void> {
  await getDb().kv.put({ key: 'baseline:chats', value: atMs });
}

export async function seedChat(id = CHAT, partnerName = 'BuyerAlpha', over: Record<string, unknown> = {}): Promise<void> {
  await getDb().chats.put({ id, partnerName, partnerId: null, lastMessageText: '', lastMessageAt: null, unread: false, pinned: false, updatedAt: iso(NOW), ...over });
}

export function rule(over: Partial<AutoReplyRule> = {}): AutoReplyRule {
  return {
    id: 'arr_price',
    name: 'Price',
    enabled: true,
    priority: 0,
    patterns: ['price', 'цена'],
    matchMode: 'contains',
    caseSensitive: false,
    reply: 'Hi {buyer}! The price is in the listing.',
    cooldownSec: 600,
    requireApproval: false,
    createdAt: iso(NOW - 3600_000),
    updatedAt: iso(NOW - 3600_000),
    ...over,
  };
}

export async function seedRules(...rules: AutoReplyRule[]): Promise<void> {
  await getDb().autoReplyRules.bulkPut(rules);
}

export function messageEvent(m: ChatMessage, extra: Record<string, unknown> = {}): DomainEvent {
  return {
    id: `MESSAGE_RECEIVED:${m.chatId}:${m.id}`,
    type: 'MESSAGE_RECEIVED',
    at: iso(NOW),
    payload: { chatId: m.chatId, messageId: m.id, authorId: m.authorId, authorName: m.authorName, text: m.text, at: m.at ?? iso(NOW), ...extra },
    handledBy: [],
  };
}

export function order(id: string, over: Partial<Order> = {}): Order {
  return {
    id,
    direction: 'sale',
    status: 'closed',
    counterpartyName: 'BuyerAlpha',
    counterpartyId: BUYER,
    description: 'Test item, 1 pcs',
    categoryName: 'Game, Accounts',
    listingId: null,
    price: { amountMinor: 125050, currency: 'RUB' },
    createdAt: iso(NOW - 2 * 3600_000),
    rawDate: '',
    firstSeenAt: iso(NOW - 2 * 3600_000),
    updatedAt: iso(NOW),
    history: [],
    ...over,
  };
}

export function orderEvent(o: Order, extra: Record<string, unknown> = {}): DomainEvent {
  return {
    id: `ORDER_COMPLETED:${o.id}`,
    type: 'ORDER_COMPLETED',
    at: iso(NOW),
    payload: { orderId: o.id, direction: o.direction, status: 'closed', buyer: o.counterpartyName, buyerId: o.counterpartyId, baseline: false, createdAt: o.createdAt, ...extra },
    handledBy: [],
  };
}

export async function sendTasks() {
  return getDb().tasks.where('kind').equals('send_message').toArray();
}

/** HH:MM in local time, offset by `deltaMin` from `ms`. */
export function localHHMM(ms: number, deltaMin = 0): string {
  const d = new Date(ms + deltaMin * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
