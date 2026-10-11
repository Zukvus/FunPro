/**
 * Chat ↔ buyer ↔ order lookups used to fill template variables. Everything comes from data FunPro
 * already stored locally (chats, messages, orders); nothing is fetched from FunPay here.
 */
import { getDb } from '@/core/db/db';
import type { ChatMessage, Order } from '@/shared/models';
import { compareIds } from '@/features/sync/ingest';
import { chatUrl, clockVariables, formatPrice, type TemplateVars } from './templates';

const CHAT_ID_RE = /^[\w-]{1,64}$/;

/** Chat ids FunPro may request history for (matches the transport allow-list). */
export function isValidChatId(chatId: string): boolean {
  return CHAT_ID_RE.test(chatId);
}

/**
 * Private chat id convention `users-{min}-{max}` (research §D.3). Returns null unless both ids are
 * known numeric user ids.
 */
export function privateChatId(selfId: string | null | undefined, otherId: string | null | undefined): string | null {
  if (!selfId || !otherId || !/^\d{1,12}$/.test(selfId) || !/^\d{1,12}$/.test(otherId) || selfId === otherId) return null;
  const [a, b] = [selfId, otherId].sort((x, y) => Number(x) - Number(y));
  return `users-${a}-${b}`;
}

/** The other participant of a `users-a-b` chat, or null for other chat ids. */
export function otherUserIdFromChatId(chatId: string, selfId: string | null | undefined): string | null {
  const m = chatId.match(/^users-(\d+)-(\d+)$/);
  if (!m) return null;
  if (selfId === m[1]) return m[2]!;
  if (selfId === m[2]) return m[1]!;
  return null;
}

export async function chatMessages(chatId: string): Promise<ChatMessage[]> {
  const list = await getDb().messages.where('chatId').equals(chatId).toArray();
  return list.sort((a, b) => compareIds(a.id, b.id));
}

const orderTime = (o: Order) => o.createdAt ?? o.firstSeenAt;

/** Most recent sale to a buyer, matched by user id when known, otherwise by name (case-insensitive). */
export async function latestSaleForBuyer(buyerId: string | null, buyerName: string | null): Promise<Order | null> {
  const db = getDb();
  let orders: Order[] = [];
  if (buyerId) orders = await db.orders.where('counterpartyId').equals(buyerId).toArray();
  if (orders.length === 0 && buyerName) {
    const lower = buyerName.toLowerCase();
    orders = await db.orders.where('counterpartyName').equalsIgnoreCase(lower).toArray();
  }
  const sales = orders.filter((o) => o.direction === 'sale');
  sales.sort((a, b) => orderTime(b).localeCompare(orderTime(a)));
  return sales[0] ?? null;
}

export function orderVariables(order: Order | null): Pick<TemplateVars, 'order_id' | 'product' | 'price'> {
  if (!order) return {};
  return { order_id: order.id, product: order.description || null, price: formatPrice(order.price) };
}

export interface ChatContextInput {
  chatId: string;
  selfUserId: string | null;
  sellerName: string | null;
  /** Buyer name if the caller already knows it (e.g. from the message author). */
  buyerName?: string | null;
  buyerId?: string | null;
  now: Date;
}

/** All template variables FunPro can fill for a chat from local data. */
export async function chatVariables(input: ChatContextInput): Promise<{ vars: TemplateVars; order: Order | null }> {
  const chat = await getDb().chats.get(input.chatId);
  const buyerName = input.buyerName || chat?.partnerName || null;
  const buyerId = input.buyerId ?? otherUserIdFromChatId(input.chatId, input.selfUserId);
  const order = await latestSaleForBuyer(buyerId, buyerName);
  return {
    order,
    vars: {
      buyer: buyerName,
      seller: input.sellerName,
      chat_url: chatUrl(input.chatId),
      ...clockVariables(input.now),
      ...orderVariables(order),
    },
  };
}
