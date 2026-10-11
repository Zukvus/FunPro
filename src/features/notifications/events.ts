/**
 * Domain events → notifications. Pure mapping plus read-only lookups (order details); the
 * background module calls `notify()` with the result. Baseline events never notify.
 *
 * Privacy mode hides names and message text from the notification itself (it is shown on screen);
 * structured `meta` is still attached for sinks that apply their own settings (Telegram previews).
 */
import { getDb } from '@/core/db/db';
import { safeFunPayUrl } from '@/core/security/sanitize';
import type { Settings } from '@/core/settings/schema';
import type { DomainEvent } from '@/shared/models';
import { formatMoney } from '@/shared/models/money';
import type { NotifyInput } from './notify';
import { nt, resolveNotifyLang, starsText } from './texts';

const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

export function orderUrl(orderId: string): string {
  return `https://funpay.com/orders/${encodeURIComponent(orderId)}/`;
}

export function chatUrl(chatId: string): string {
  return `https://funpay.com/chat/?node=${encodeURIComponent(chatId)}`;
}

function oneLine(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export interface EventMappingContext {
  /** Dashboard URL for a hash route, e.g. "#/inventory" → chrome-extension://…/options.html#/inventory. */
  dashboardUrl: (hash: string) => string;
}

export async function notificationForEvent(event: DomainEvent, settings: Settings, ctx: EventMappingContext): Promise<NotifyInput | null> {
  const p = event.payload;
  if (p['baseline'] === true) return null;
  const lang = resolveNotifyLang(settings.general.language);
  const privacy = settings.privacy.privacyMode;

  switch (event.type) {
    case 'ORDER_PAID': {
      if (p['direction'] !== 'sale') return null;
      const orderId = str(p['orderId']);
      if (!orderId) return null;
      const order = await getDb().orders.get(orderId);
      const item = oneLine(order?.description || order?.categoryName || '', 120);
      const price = order && order.price.currency !== 'UNKNOWN' ? formatMoney(order.price) : '';
      const buyer = str(p['buyer']) || order?.counterpartyName || '';
      const parts = [item, price].filter(Boolean).join(' — ');
      const body = privacy || !buyer ? parts : [parts, buyer].filter(Boolean).join(' · ');
      return {
        kind: 'order',
        title: nt(lang, 'order.title'),
        body: body || `#${orderId}`,
        url: orderUrl(orderId),
        dedupeKey: `order:${orderId}`,
        meta: { orderId, item, price, buyer: buyer || null },
      };
    }
    case 'MESSAGE_RECEIVED': {
      const chatId = str(p['chatId']);
      const messageId = str(p['messageId']);
      if (!chatId) return null;
      const name = str(p['authorName']);
      const text = str(p['text']);
      return {
        kind: 'message',
        title: !privacy && name ? nt(lang, 'message.title', { name }) : nt(lang, 'message.titleAnon'),
        body: !privacy && text.trim() ? oneLine(text, 300) : nt(lang, 'message.hidden'),
        url: chatUrl(chatId),
        dedupeKey: `msg:${chatId}:${messageId || event.id}`,
        meta: { chatId, buyer: name || null, preview: text ? oneLine(text, 500) : null },
      };
    }
    case 'REVIEW_RECEIVED': {
      const orderId = str(p['orderId']);
      if (!orderId) return null;
      const review = await getDb().reviews.get(orderId);
      const stars = typeof p['stars'] === 'number' ? p['stars'] : (review?.stars ?? null);
      const text = review?.text ?? '';
      const author = str(p['authorName']) || review?.authorName || '';
      return {
        kind: 'review',
        title: nt(lang, 'review.title', { stars: starsText(stars) }).trim(),
        body: privacy ? starsText(stars) || nt(lang, 'review.noText') : text.trim() ? oneLine(text, 300) : nt(lang, 'review.noText'),
        url: orderUrl(orderId),
        dedupeKey: `review:${orderId}`,
        meta: { orderId, stars, buyer: author || null, preview: text ? oneLine(text, 500) : null },
      };
    }
    case 'AUTOMATION_FAILED': {
      const what = str(p['feature']) || str(p['source']) || str(p['kind']);
      const message = str(p['message']) || str(p['error']) || str(p['reason']);
      const url = safeFunPayUrl(str(p['url']) || null) ?? ctx.dashboardUrl('#/logs');
      return {
        kind: 'failure',
        title: what ? `${nt(lang, 'failure.title')}: ${what}` : nt(lang, 'failure.title'),
        body: oneLine(message || what || nt(lang, 'failure.title'), 400),
        url,
        dedupeKey: event.id,
      };
    }
    case 'INVENTORY_LOW': {
      const pool = str(p['poolName']) || str(p['name']) || str(p['poolId']);
      const count = typeof p['available'] === 'number' ? p['available'] : typeof p['remaining'] === 'number' ? p['remaining'] : typeof p['count'] === 'number' ? p['count'] : null;
      return {
        kind: 'inventory',
        title: nt(lang, 'inventory.title'),
        body: count !== null ? nt(lang, 'inventory.body', { pool: pool || '—', count }) : pool || nt(lang, 'inventory.title'),
        url: ctx.dashboardUrl('#/inventory'),
        dedupeKey: event.id,
      };
    }
    case 'PRICE_CHANGE_DETECTED': {
      const seller = str(p['seller']) || str(p['sellerName']);
      const from = typeof p['from'] === 'number' ? p['from'] : null;
      const to = typeof p['to'] === 'number' ? p['to'] : null;
      const nodeId = str(p['nodeId']);
      const money = (minor: number) => (minor / 100).toLocaleString(lang === 'en' ? 'en-US' : lang === 'uk' ? 'uk-UA' : 'ru-RU', { maximumFractionDigits: 2 });
      const change = from !== null && to !== null ? `${money(from)} → ${money(to)}` : '';
      return {
        kind: 'price',
        title: nt(lang, 'price.title'),
        body: [privacy ? '' : seller, change].filter(Boolean).join(': ') || nt(lang, 'price.title'),
        url: nodeId && /^\d+$/.test(nodeId) ? `https://funpay.com/lots/${nodeId}/` : ctx.dashboardUrl('#/pricing'),
        dedupeKey: event.id,
      };
    }
    default:
      return null;
  }
}

/**
 * Competitor price changes can be very frequent: they are recorded only when some sink wants them
 * (desktop/sound or Telegram), so the notification center is not flooded.
 */
export function wantsPriceNotifications(settings: Settings): boolean {
  const n = settings.notifications;
  return (n.desktop && n.onPrice) || (n.sound && n.soundKinds.price) || (settings.telegram.enabled && settings.telegram.notifyPrices);
}
