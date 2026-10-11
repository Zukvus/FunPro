import type { ChatMessage, CompetitorOffer, OrderDirection, OrderStatus } from '@/shared/models';
import { detectCurrency, parseLocalizedNumber, toMinor, type Currency, type Money } from '@/shared/models/money';
import { cleanMultiline, cleanText } from '@/core/security/sanitize';
import { parseHumanDate } from '@/core/util/time';
import type {
  FunPayParser,
  OfferForm,
  PageSession,
  ParsedFinanceOp,
  ParsedListing,
  ParsedOrder,
  ParsedReview,
  RaiseOutcome,
  RaiseTarget,
  SystemMessageInfo,
} from '../types';
import { ADAPTER_VERSION, SEL } from './selectors';

// ---------------------------------------------------------------------------------------------
// Small DOM helpers (never use innerHTML; always textContent)
// ---------------------------------------------------------------------------------------------

function text(el: Element | null | undefined): string {
  return cleanText(el?.textContent ?? '');
}

function $(root: ParentNode, sel: string): Element | null {
  return root.querySelector(sel);
}

function $$(root: ParentNode, sel: string): Element[] {
  return Array.from(root.querySelectorAll(sel));
}

function userIdFromHref(href: string | null | undefined): string | null {
  const m = href?.match(/\/users\/(\d+)\/?/);
  return m ? m[1]! : null;
}

function idFromQuery(href: string | null | undefined, key: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, 'https://funpay.com/').searchParams.get(key);
  } catch {
    return null;
  }
}

function nodeIdFromHref(href: string | null | undefined): string | null {
  const m = href?.match(/\/(?:lots|chips)\/(\d+)\/?/);
  return m ? m[1]! : null;
}

/** Unit sign rendered inside `.unit`, falling back to whole-text detection. */
function currencyOf(el: Element | null): Currency {
  if (!el) return 'UNKNOWN';
  const unit = el.querySelector('.unit');
  const c = detectCurrency(unit?.textContent ?? '');
  return c !== 'UNKNOWN' ? c : detectCurrency(el.textContent ?? '');
}

/**
 * Price of a row. `.tc-price[data-s]` carries the unrounded numeric value; the visible text carries
 * the currency. Negative amounts use U+2212 (&minus;) or '-'.
 */
function priceOf(el: Element | null): Money | null {
  if (!el) return null;
  const raw = el.getAttribute('data-s');
  const visible = el.textContent ?? '';
  const value = raw !== null && raw !== '' ? Number.parseFloat(raw) : parseLocalizedNumber(visible);
  if (value === null || !Number.isFinite(value)) return null;
  return { amountMinor: toMinor(Math.abs(value)), currency: currencyOf(el) };
}

function signOf(el: Element | null): -1 | 1 {
  const t = (el?.textContent ?? '').trim();
  return t.startsWith('−') || t.startsWith('-') ? -1 : 1;
}

// ---------------------------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------------------------

function readAppData(doc: Document): Record<string, unknown> | null {
  const raw = doc.body?.getAttribute(SEL.appDataAttr);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const obj = Array.isArray(parsed) ? parsed[0] : parsed;
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function badgeNumber(doc: Document, sel: string): number | null {
  const el = $(doc, sel);
  if (!el) return null;
  const n = parseLocalizedNumber(el.textContent ?? '');
  return n === null ? null : Math.trunc(n);
}

function parseSession(doc: Document, now = Date.now()): PageSession {
  const app = readAppData(doc);
  const rawUserId = app?.['userId'];
  const userId = rawUserId !== undefined && rawUserId !== null && String(rawUserId) !== '0' ? String(rawUserId) : null;
  const username = text($(doc, SEL.userName)) || null;
  const localeRaw = app?.['locale'];
  const locale = localeRaw === 'ru' || localeRaw === 'en' || localeRaw === 'uk' ? localeRaw : null;
  const csrf = typeof app?.['csrf-token'] === 'string' ? (app['csrf-token'] as string) : null;
  let status: PageSession['status'] = 'unknown';
  if (app) status = userId ? 'logged_in' : 'logged_out';
  else if (username) status = 'logged_in';
  return {
    status,
    userId,
    username,
    locale,
    activeSales: badgeNumber(doc, SEL.badgeTrade),
    activePurchases: badgeNumber(doc, SEL.badgeOrders),
    unreadChats: badgeNumber(doc, SEL.badgeChat),
    balanceText: text($(doc, SEL.badgeBalance)) || null,
    adapterVersion: ADAPTER_VERSION,
    observedAt: now,
    csrfToken: csrf,
  };
}

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

function listingFromRow(row: Element, nodeId: string | null, categoryName: string, gameId: string | null): ParsedListing | null {
  const href = row.getAttribute('href');
  const id = row.getAttribute('data-offer') ?? idFromQuery(href, 'id') ?? idFromQuery(href, 'offer');
  if (!id || !/^\d+$/.test(id)) return null;
  const priceEl = $(row, SEL.rowPrice);
  const price = priceOf(priceEl) ?? { amountMinor: 0, currency: 'UNKNOWN' as const };
  const amountText = text($(row, SEL.rowAmount));
  const amountNum = amountText ? parseLocalizedNumber(amountText) : null;
  const cls = row.classList;
  return {
    id,
    nodeId,
    gameId,
    categoryName,
    title: text($(row, SEL.rowDescText)),
    price,
    amount: amountNum === null ? null : Math.trunc(amountNum),
    // On own-lots pages FunPay marks inactive offers with the `warning` class.
    active: !cls.contains('warning'),
    promoted: cls.contains('offer-promo') || cls.contains('offer-promoted'),
    autoDelivery: !!$(row, SEL.rowAutoDelivery) || row.getAttribute('data-auto') === '1',
  };
}

function parseRaiseButton(root: ParentNode): RaiseTarget | null {
  const btn = $(root, SEL.raiseButton);
  const gameId = btn?.getAttribute('data-game');
  const nodeId = btn?.getAttribute('data-node');
  return gameId && nodeId ? { gameId, nodeId } : null;
}

function parseOwnLotsPage(doc: ParentNode, nodeId: string): { listings: ParsedListing[]; raise: RaiseTarget | null } {
  const raise = parseRaiseButton(doc);
  const categoryName = text($(doc, SEL.pageHeader));
  const listings = $$(doc, SEL.row)
    .map((r) => listingFromRow(r, nodeId, categoryName, raise?.gameId ?? null))
    .filter((x): x is ParsedListing => x !== null);
  return { listings, raise };
}

function parseProfileOffers(doc: ParentNode): ParsedListing[] {
  const out: ParsedListing[] = [];
  for (const section of $$(doc, SEL.offerSection)) {
    const link = $(section, SEL.offerSectionTitleLink);
    const nodeId = nodeIdFromHref(link?.getAttribute('href'));
    const categoryName = text(link);
    for (const row of $$(section, SEL.row)) {
      const l = listingFromRow(row, nodeId, categoryName, null);
      if (l) out.push(l);
    }
  }
  return out;
}

function parsePublicOffers(doc: ParentNode, nodeId: string): CompetitorOffer[] {
  const out: CompetitorOffer[] = [];
  for (const row of $$(doc, SEL.row)) {
    const offerId = idFromQuery(row.getAttribute('href'), 'id');
    if (!offerId) continue;
    const price = priceOf($(row, SEL.rowPrice));
    if (!price) continue;
    const userEl = $(row, SEL.userHrefAttr);
    const sellerId = row.getAttribute('data-user') ?? userIdFromHref(userEl?.getAttribute('data-href'));
    const stars = $$(row, '.rating-stars i.fas').length;
    const reviewsNum = parseLocalizedNumber(text($(row, '.media-user-reviews')));
    const amountNum = parseLocalizedNumber(text($(row, SEL.rowAmount)));
    out.push({
      offerId,
      nodeId,
      sellerName: text($(row, SEL.mediaUserName)),
      sellerId,
      title: text($(row, SEL.rowDescText)),
      price,
      amount: amountNum === null ? null : Math.trunc(amountNum),
      online: row.hasAttribute('data-online') ? row.getAttribute('data-online') === '1' : null,
      promoted: row.classList.contains('offer-promo') || row.classList.contains('offer-promoted'),
      rating: stars > 0 ? stars : null,
      reviewCount: reviewsNum === null ? null : Math.trunc(reviewsNum),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------

function statusFromRow(row: Element): OrderStatus {
  if (row.classList.contains('info')) return 'paid';
  if (row.classList.contains('warning')) return 'refunded';
  const statusText = text($(row, SEL.rowStatus)).toLowerCase();
  if (/оплачен|paid|оплачено/.test(statusText)) return 'paid';
  if (/возврат|refund|повернення/.test(statusText)) return 'refunded';
  if (/закрыт|closed|закрито/.test(statusText)) return 'closed';
  // No modifier class on an order row means "closed" (FunPayAPI/Wingman convention).
  return row.classList.contains('tc-item') ? 'closed' : 'unknown';
}

function parseOrders(doc: ParentNode, direction: OrderDirection, now = new Date()): { orders: ParsedOrder[]; continueToken: string | null } {
  const orders: ParsedOrder[] = [];
  for (const row of $$(doc, SEL.row)) {
    const orderText = text($(row, SEL.rowOrder));
    const m = orderText.match(/#?([A-Z0-9]{6,12})/);
    if (!m) continue;
    const desc = $(row, SEL.orderDesc);
    const muted = $(row, SEL.orderDescMuted);
    const description = text(desc?.querySelector(':scope > div:not(.text-muted)') ?? null);
    const userEl = $(row, `${SEL.mediaUserName} ${SEL.userHrefAttr}`) ?? $(row, SEL.mediaUserName);
    const rawDate = text($(row, SEL.rowDate));
    orders.push({
      id: m[1]!,
      direction,
      status: statusFromRow(row),
      counterpartyName: text(userEl),
      counterpartyId: userIdFromHref(userEl?.getAttribute('data-href')),
      description,
      categoryName: text(muted),
      listingId: null,
      price: priceOf($(row, SEL.rowPrice)) ?? { amountMinor: 0, currency: 'UNKNOWN' },
      createdAt: parseHumanDate(rawDate, now),
      rawDate,
    });
  }
  const inputs = $$(doc, SEL.continueInput);
  const token = inputs.length ? inputs[inputs.length - 1]!.getAttribute('value') : null;
  return { orders, continueToken: token ? token : null };
}

// ---------------------------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------------------------

function parseChatList(doc: ParentNode, now = new Date()) {
  return $$(doc, SEL.contactItem)
    .map((a) => {
      const id = a.getAttribute('data-id') ?? idFromQuery(a.getAttribute('href'), 'node');
      if (!id) return null;
      const timeText = text($(a, SEL.contactTime));
      return {
        id,
        partnerName: text($(a, SEL.mediaUserName)),
        partnerId: null as string | null,
        lastMessageText: text($(a, SEL.contactMessage)),
        lastMessageAt: timeText ? parseHumanDate(timeText, now) : null,
        unread: a.classList.contains('unread'),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

function messageKind(authorId: string | null, selfUserId: string | null, isSystemLabel: boolean): ChatMessage['kind'] {
  if (authorId === '0' || isSystemLabel) return 'system';
  if (authorId && selfUserId && authorId === selfUserId) return 'self';
  if (!authorId) return 'system';
  return 'customer';
}

function messageFromElement(item: Element, chatId: string, selfUserId: string | null, fallbackId: string | null, now: Date, authorIdHint?: string | null): ChatMessage | null {
  const idAttr = item.getAttribute('id')?.match(/(\d+)/)?.[1] ?? item.getAttribute('data-id') ?? fallbackId;
  if (!idAttr) return null;
  const authorLink = $(item, SEL.chatMsgAuthorLink);
  const authorId = authorIdHint ?? userIdFromHref(authorLink?.getAttribute('href'));
  const label = $(item, SEL.chatMsgAuthorLabel);
  const isSystem = (!authorLink && !authorIdHint) || (!!label && /funpay|оповещение|notification|сповіщення/i.test(label.textContent ?? ''));
  const textEl = $(item, SEL.chatMsgText);
  const dateEl = $(item, SEL.chatMsgDate);
  const dateRaw = dateEl?.getAttribute('title') ?? text(dateEl);
  return {
    id: idAttr,
    chatId,
    authorId: authorId ?? (isSystem ? '0' : null),
    authorName: text(authorLink) || (isSystem ? 'FunPay' : ''),
    kind: messageKind(authorId ?? (isSystem ? '0' : null), selfUserId, isSystem && !authorIdHint),
    text: cleanMultiline(textEl?.textContent ?? ''),
    at: dateRaw ? parseHumanDate(dateRaw, now) : null,
    sentByExtension: false,
  };
}

function parseChatMessages(doc: ParentNode, chatId: string, selfUserId: string | null, now = new Date()): ChatMessage[] {
  return $$(doc, SEL.chatMsgItem)
    .map((el) => messageFromElement(el, chatId, selfUserId, null, now))
    .filter((x): x is ChatMessage => x !== null && x.text.length > 0);
}

/**
 * `/chat/history` returns `{chat:{node:{id}, messages:[{id, author, html}]}}` (evidence: FunPayAPI,
 * Wingman). `author` is the numeric user id; 0 denotes FunPay system messages.
 */
function parseChatHistoryJson(json: unknown, chatId: string, selfUserId: string | null): ChatMessage[] {
  const messages = (json as { chat?: { messages?: unknown } } | null)?.chat?.messages;
  if (!Array.isArray(messages)) return [];
  const out: ChatMessage[] = [];
  const parser = new DOMParser();
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const rec = m as { id?: unknown; author?: unknown; html?: unknown };
    if (rec.id === undefined || typeof rec.html !== 'string') continue;
    const authorId = rec.author === undefined || rec.author === null ? null : String(rec.author);
    // DOMParser creates an inert document: scripts do not run and resources are not loaded.
    const frag = parser.parseFromString(rec.html, 'text/html');
    const item = $(frag, SEL.chatMsgItem) ?? frag.body;
    const msg = messageFromElement(item, chatId, selfUserId, String(rec.id), new Date(), authorId);
    if (msg) {
      msg.id = String(rec.id);
      msg.kind = messageKind(authorId, selfUserId, false);
      if (msg.kind === 'system') msg.authorName = 'FunPay';
      out.push(msg);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------

function parseReviews(doc: ParentNode, now = new Date()): ParsedReview[] {
  const out: ParsedReview[] = [];
  for (const c of $$(doc, SEL.review)) {
    const orderHref = $(c, SEL.reviewOrderLink)?.getAttribute('href');
    const orderId = orderHref?.match(/\/orders\/([A-Z0-9]+)\/?/)?.[1] ?? c.getAttribute('data-order') ?? null;
    if (!orderId) continue; // anonymous reviews without an order link cannot be attributed
    let stars: number | null = null;
    const ratingEl = $(c, SEL.reviewRating);
    const rm = ratingEl?.className.match(/rating(\d)/);
    if (rm) stars = Number(rm[1]);
    else if (c.getAttribute('data-rating')) stars = Number(c.getAttribute('data-rating'));
    const rawDate = text($(c, SEL.reviewDate));
    const datePart = rawDate.split(',')[0] ?? rawDate;
    const reply = $(c, SEL.reviewReply);
    out.push({
      orderId,
      stars: stars && stars >= 1 && stars <= 5 ? stars : null,
      text: cleanMultiline($(c, SEL.reviewText)?.textContent ?? ''),
      authorName: text($(c, SEL.reviewAuthor)),
      at: parseHumanDate(datePart.replace(/\s+в\s+/, ', ').replace(/\s+at\s+/i, ', '), now),
      rawDate,
      sellerReply: reply ? cleanMultiline(reply.textContent ?? '') || null : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------------------------

function financeKind(title: string, sign: -1 | 1): ParsedFinanceOp['kind'] {
  const t = title.toLowerCase();
  if (/вывод|withdraw|виведення/.test(t)) return 'withdrawal';
  if (/пополнение|deposit|top.?up|поповнення/.test(t)) return 'deposit';
  if (/возврат|refund|повернення/.test(t)) return 'refund';
  if (/заказ|order|замовлення/.test(t)) return sign > 0 ? 'income' : 'expense';
  return sign > 0 ? 'income' : 'other';
}

function parseFinance(doc: ParentNode, now = new Date()): ParsedFinanceOp[] {
  return $$(doc, SEL.financeRow).map((row) => {
    const priceEl = $(row, SEL.rowPrice);
    const sign = signOf(priceEl);
    const title = text($(row, SEL.rowTitle));
    const rawDate = text($(row, SEL.rowDate));
    const statusClass = Array.from(row.classList).find((c) => c.startsWith('transaction-status-'));
    return {
      id: row.getAttribute('data-transaction')!,
      kind: financeKind(title, sign),
      amount: priceOf(priceEl) ?? { amountMinor: 0, currency: 'UNKNOWN' },
      at: parseHumanDate(rawDate, now),
      rawDate,
      description: title,
      status: statusClass ? statusClass.replace('transaction-status-', '') : text($(row, SEL.rowStatus)),
      orderId: title.match(/#([A-Z0-9]{8})\b/)?.[1] ?? null,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Offer edit form
// ---------------------------------------------------------------------------------------------

/** Serialise a form the way a browser would on submit (successful controls only). */
function serializeForm(form: Element): [string, string][] {
  const out: [string, string][] = [];
  for (const el of $$(form, 'input[name], textarea[name], select[name]')) {
    const name = el.getAttribute('name')!;
    if (el.hasAttribute('disabled')) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === 'input') {
      const type = (el.getAttribute('type') ?? 'text').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (el.hasAttribute('checked')) out.push([name, el.getAttribute('value') ?? 'on']);
        continue;
      }
      if (type === 'file' || type === 'submit' || type === 'button' || type === 'image') continue;
      out.push([name, el.getAttribute('value') ?? '']);
    } else if (tag === 'textarea') {
      out.push([name, el.textContent ?? '']);
    } else {
      const selected = el.querySelector('option[selected]') ?? el.querySelector('option');
      if (selected) out.push([name, selected.getAttribute('value') ?? selected.textContent ?? '']);
    }
  }
  return out;
}

function parseOfferForm(doc: ParentNode): OfferForm | null {
  const form = $(doc, SEL.offerForm);
  if (!form) return null;
  const fields = serializeForm(form);
  const get = (n: string) => fields.find(([k]) => k === n)?.[1] ?? null;
  const offerId = get('offer_id');
  if (!offerId) return null;
  const buyerPrices = $$(doc, SEL.buyerPricesRow)
    .map((tr) => ({ method: text($(tr, 'th')), priceText: text($(tr, 'td')) }))
    .filter((r) => r.method && r.priceText);
  return { offerId, nodeId: get('node_id'), currencyText: text($(doc, SEL.offerCurrency)), fields, buyerPrices };
}

// ---------------------------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------------------------

function parseRaiseModal(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const ids = $$(doc, SEL.raiseModalCheckbox)
    .map((i) => i.getAttribute('value') ?? '')
    .filter((v) => /^\d+$/.test(v));
  return Array.from(new Set(ids));
}

/**
 * Convert FunPay's human cooldown text into seconds, rounding conservatively towards *later*
 * attempts is not possible without knowing the exact remainder, so we follow the convention used
 * by existing open-source clients: minutes → (N−1)·60, hours → (N−0.5)·3600, then add a safety margin
 * at the scheduler level.
 */
export function parseWaitSeconds(message: string): number | null {
  const m = message.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  const t = message.toLowerCase();
  if (/(секунд|second|секунд)/.test(t)) return n;
  if (/(минут|minute|хвилин)/.test(t)) return Math.max(60, (n - 1) * 60);
  if (/(час|hour|годин)/.test(t)) return Math.round((n - 0.5) * 3600);
  return null;
}

function parseRaiseResponse(status: number, json: unknown): RaiseOutcome {
  const rec = (json && typeof json === 'object' ? json : {}) as { error?: unknown; msg?: unknown; wait?: unknown; modal?: unknown; url?: unknown };
  const msg = typeof rec.msg === 'string' ? cleanText(rec.msg, 500) : '';
  const wait = typeof rec.wait === 'number' && rec.wait > 0 ? rec.wait : null;
  if (status === 429) return { kind: 'cooldown', message: msg || 'Too many requests (HTTP 429)', waitSec: wait ?? 600 };
  if (status === 401 || status === 403) return { kind: 'error', message: `Not authorised (HTTP ${status}). Log in to FunPay.`, waitSec: 1800 };
  if (status >= 500) return { kind: 'error', message: `FunPay server error (HTTP ${status})`, waitSec: 600 };
  if (typeof rec.modal === 'string') return { kind: 'needs_selection', nodeIds: parseRaiseModal(rec.modal) };
  if (rec.error === false || rec.error === 0) return { kind: 'raised', message: msg, waitSec: wait };
  if (typeof rec.url === 'string' && !rec.error) return { kind: 'rejected', message: msg || 'FunPay redirected the request', waitSec: 7200 };
  if (rec.error) {
    const w = wait ?? parseWaitSeconds(msg);
    if (/подождите|please wait|зачекайте|wait/i.test(msg) || w !== null) return { kind: 'cooldown', message: msg, waitSec: w ?? 3600 };
    return { kind: 'error', message: msg || 'Unknown error', waitSec: 600 };
  }
  return { kind: 'error', message: 'Unrecognised response from FunPay', waitSec: 600 };
}

// ---------------------------------------------------------------------------------------------
// System messages (FunPay notifications posted into chats)
// ---------------------------------------------------------------------------------------------

const ORDER_ID = /#([A-Z0-9]{8})\b/;
const SYSTEM_PATTERNS: { type: SystemMessageInfo['type']; re: RegExp }[] = [
  { type: 'order_paid', re: /(Покупатель|The buyer|Покупець)\s+(.+?)\s+(оплатил|has paid for|оплатив)\s+заказ|has paid for order|оплатив замовлення/i },
  { type: 'order_confirmed', re: /подтвердил успешное выполнение|has confirmed that order|підтвердив успішне виконання/i },
  { type: 'review_new', re: /(написал|has given feedback|написав)\s+отзыв|has given feedback|написав відгук/i },
  { type: 'review_changed', re: /изменил отзыв|has edited their feedback|змінив відгук/i },
  { type: 'review_deleted', re: /удалил отзыв|has deleted their feedback|видалив відгук/i },
  { type: 'review_replied', re: /ответил на отзыв|has replied to (the )?feedback|відповів на відгук/i },
  { type: 'order_reopened', re: /открыт повторно|has been reopened|відкрито повторно/i },
  { type: 'partial_refund', re: /Часть средств по заказу|part of the funds|Частину коштів/i },
  { type: 'refund', re: /вернул деньги|has refunded|повернув гроші/i },
  { type: 'confirm_reminder', re: /не забудьте потом нажать кнопку|don't forget to press|не забудьте потім натиснути/i },
  { type: 'safety_notice', re: /не доверяйте сообщениям в чате|do not trust messages in chat|не довіряйте повідомленням/i },
  { type: 'admin', re: /^(Администратор|Administrator|Адміністратор)\s/i },
];

function classifySystemMessage(raw: string): SystemMessageInfo | null {
  const t = cleanText(raw, 2000);
  for (const p of SYSTEM_PATTERNS) {
    const m = t.match(p.re);
    if (m) {
      const buyer = p.type === 'order_paid' ? (t.match(/(?:Покупатель|The buyer|Покупець)\s+(\S+)/i)?.[1] ?? null) : null;
      return { type: p.type, orderId: t.match(ORDER_ID)?.[1] ?? null, buyerName: buyer };
    }
  }
  return null;
}

export const parserV1: FunPayParser = {
  version: ADAPTER_VERSION,
  parseSession,
  parseOwnLotsPage,
  parseProfileOffers,
  parsePublicOffers,
  parseOrders,
  parseChatList,
  parseChatMessages,
  parseChatHistoryJson,
  parseReviews,
  parseFinance,
  parseOfferForm,
  parseRaiseModal,
  parseRaiseResponse,
  classifySystemMessage,
};

export const __test = { priceOf, serializeForm, statusFromRow, financeKind };
