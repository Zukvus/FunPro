/**
 * Small, pure helpers about orders shared by the orders, analytics and finance features.
 */
import type { Order } from '@/shared/models';

export const FUNPAY_ORIGIN = 'https://funpay.com';

/** FunPay order ids are 8 upper-case alphanumerics (6–12 accepted for safety). */
export const ORDER_ID_RE = /^[A-Z0-9]{6,12}$/;

export function isValidOrderId(id: string): boolean {
  return ORDER_ID_RE.test(id);
}

/** Link to the order page on FunPay. Returns null for ids that do not look like FunPay ids. */
export function orderUrl(id: string): string | null {
  return isValidOrderId(id) ? `${FUNPAY_ORIGIN}/orders/${id}/` : null;
}

export function userUrl(userId: string | null | undefined): string | null {
  return userId && /^\d{1,12}$/.test(userId) ? `${FUNPAY_ORIGIN}/users/${userId}/` : null;
}

export function listingUrl(listingId: string | null | undefined): string | null {
  return listingId && /^\d{1,12}$/.test(listingId) ? `${FUNPAY_ORIGIN}/lots/offer?id=${listingId}` : null;
}

/**
 * Private chat node id between two users: `users-{min}-{max}` (numeric order), the convention used
 * by FunPay's own links (research §B.2/§D.3). Null when either id is unknown or not numeric.
 */
export function privateChatId(selfId: string | null | undefined, otherId: string | null | undefined): string | null {
  if (!selfId || !otherId || !/^\d{1,12}$/.test(selfId) || !/^\d{1,12}$/.test(otherId) || selfId === otherId) return null;
  const a = Number(selfId);
  const b = Number(otherId);
  return `users-${Math.min(a, b)}-${Math.max(a, b)}`;
}

export function chatUrl(chatId: string | null): string | null {
  return chatId && /^[\w-]{1,64}$/.test(chatId) ? `${FUNPAY_ORIGIN}/chat/?node=${chatId}` : null;
}

/**
 * Best known creation time of an order (epoch ms). FunPay's own date is preferred; when it could
 * not be parsed we fall back to the moment FunPro first saw the order (a lower bound of its age).
 */
export function orderTime(o: Pick<Order, 'createdAt' | 'firstSeenAt'>): { ts: number; approximate: boolean } {
  const created = o.createdAt ? Date.parse(o.createdAt) : Number.NaN;
  if (Number.isFinite(created)) return { ts: created, approximate: false };
  const seen = Date.parse(o.firstSeenAt);
  return { ts: Number.isFinite(seen) ? seen : 0, approximate: true };
}

/** Creation time or null (analytics never invent dates for undated orders). */
export function createdTs(o: Pick<Order, 'createdAt'>): number | null {
  if (!o.createdAt) return null;
  const t = Date.parse(o.createdAt);
  return Number.isFinite(t) ? t : null;
}

const QTY_SUFFIX = /,\s*(\d{1,7})\s*(?:шт|pcs|штук|од|units?)\.?\s*$/iu;

/**
 * FunPay appends the quantity to order descriptions ("Item, 3 шт." / "Item, 3 pcs."). Returns the
 * description without it and the quantity (1 when absent).
 */
export function splitQuantity(description: string): { title: string; quantity: number } {
  const m = QTY_SUFFIX.exec(description);
  if (!m) return { title: description.trim(), quantity: 1 };
  const q = Number(m[1]);
  return { title: description.slice(0, m.index).trim(), quantity: q > 0 ? q : 1 };
}

/** Case/whitespace-insensitive key for matching order titles with listing titles. */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** "Game, Section" → "Game" (FunPay renders the order category as game + section). */
export function gameOf(categoryName: string): string {
  const i = categoryName.indexOf(',');
  return (i >= 0 ? categoryName.slice(0, i) : categoryName).trim();
}

/** Newline-separated order ids (the format FunPay support and spreadsheets accept). */
export function idsText(orders: readonly Pick<Order, 'id'>[]): string {
  return orders.map((o) => o.id).join('\n');
}
