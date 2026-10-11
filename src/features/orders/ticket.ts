/**
 * Support-ticket DRAFT assistant for unconfirmed orders.
 *
 * FunPro never contacts FunPay support and never submits anything: it only prepares a text the
 * seller reviews, completes (delivery details, evidence) and submits manually through FunPay's
 * official support channel.
 */
import type { Currency, Order } from '@/shared/models';
import { formatZoned, HOUR_MS } from '@/features/analytics/time';
import { formatByCurrencyPlain, formatMinorPlain } from '@/features/analytics/format';
import { isValidOrderId, orderTime } from './model';

export type TicketLang = 'ru' | 'en';

export type TicketExclusionReason = 'not_sale' | 'not_paid' | 'too_recent' | 'invalid_id';

export interface TicketDraftInput {
  /** Candidate orders (typically the selected unconfirmed sales). */
  orders: readonly Order[];
  now: number;
  /** Eligibility threshold (settings.analytics.supportTicketAfterHours). */
  minAgeHours: number;
  lang: TicketLang;
  includeBuyerNames?: boolean;
}

export interface TicketDraft {
  subject: string;
  body: string;
  /** Orders included in the draft, oldest first. */
  orderIds: string[];
  excluded: { id: string; reason: TicketExclusionReason }[];
  totalByCurrency: Partial<Record<Currency, number>>;
}

export function ticketEligibility(o: Order, now: number, minAgeHours: number): TicketExclusionReason | null {
  if (!isValidOrderId(o.id)) return 'invalid_id';
  if (o.direction !== 'sale') return 'not_sale';
  if (o.status !== 'paid') return 'not_paid';
  if (now - orderTime(o).ts < minAgeHours * HOUR_MS) return 'too_recent';
  return null;
}

const TEXT = {
  ru: {
    subject: (n: number) =>
      n === 1 ? 'Заказ не подтверждён покупателем' : 'Заказы не подтверждены покупателями',
    greeting: 'Здравствуйте!',
    intro: (n: number) =>
      n === 1
        ? 'Прошу помочь с заказом, который я выполнил(а), но покупатель до сих пор не подтвердил его выполнение:'
        : 'Прошу помочь с заказами, которые я выполнил(а), но покупатели до сих пор не подтвердили их выполнение:',
    line: (id: string, date: string, amount: string, buyer: string | null) =>
      `Заказ #${id} — оплачен ${date} (МСК), сумма ${amount}${buyer ? `, покупатель ${buyer}` : ''}`,
    unknownDate: 'дата неизвестна',
    total: 'Итого:',
    delivered: (n: number) =>
      n === 1 ? 'Заказ выполнен в полном объёме.' : 'Все перечисленные заказы выполнены в полном объёме.',
    placeholder: '[Опишите, когда и как был передан товар; при необходимости приложите скриншоты переписки.]',
    request: (n: number) =>
      n === 1
        ? 'Прошу закрыть заказ или подсказать, что ещё требуется с моей стороны.'
        : 'Прошу закрыть эти заказы или подсказать, что ещё требуется с моей стороны.',
    thanks: 'Спасибо!',
  },
  en: {
    subject: (n: number) => (n === 1 ? 'Order not confirmed by the buyer' : 'Orders not confirmed by buyers'),
    greeting: 'Hello,',
    intro: (n: number) =>
      n === 1
        ? 'Please help with an order I have fulfilled, but the buyer has not confirmed it yet:'
        : 'Please help with orders I have fulfilled, but the buyers have not confirmed them yet:',
    line: (id: string, date: string, amount: string, buyer: string | null) =>
      `Order #${id} — paid ${date} (Moscow time), amount ${amount}${buyer ? `, buyer ${buyer}` : ''}`,
    unknownDate: 'date unknown',
    total: 'Total:',
    delivered: (n: number) =>
      n === 1
        ? 'The order has been delivered in full.'
        : 'All orders listed above have been delivered in full.',
    placeholder: '[Describe when and how you delivered the goods; attach chat screenshots if needed.]',
    request: (n: number) =>
      n === 1
        ? 'Could you please close the order or tell me what else is needed from my side?'
        : 'Could you please close these orders or tell me what else is needed from my side?',
    thanks: 'Thank you!',
  },
} as const;

/**
 * Build the draft. Ineligible orders (not a paid sale, too recent, malformed id) are excluded and
 * reported so the UI can explain why.
 */
export function buildSupportTicketDraft(input: TicketDraftInput): TicketDraft {
  const tx = TEXT[input.lang];
  const includeBuyer = input.includeBuyerNames ?? true;
  const excluded: TicketDraft['excluded'] = [];
  const eligible: Order[] = [];
  for (const o of input.orders) {
    const reason = ticketEligibility(o, input.now, input.minAgeHours);
    if (reason) excluded.push({ id: o.id, reason });
    else eligible.push(o);
  }
  eligible.sort((a, b) => orderTime(a).ts - orderTime(b).ts || a.id.localeCompare(b.id));

  const totalByCurrency: Partial<Record<Currency, number>> = {};
  const lines = eligible.map((o, i) => {
    totalByCurrency[o.price.currency] = (totalByCurrency[o.price.currency] ?? 0) + o.price.amountMinor;
    const date = o.createdAt ? formatZoned(o.createdAt) : tx.unknownDate;
    const amount = formatMinorPlain(o.price.amountMinor, o.price.currency, input.lang);
    const buyer = includeBuyer && o.counterpartyName ? o.counterpartyName : null;
    return `${i + 1}. ${tx.line(o.id, date, amount, buyer)}`;
  });

  const n = eligible.length;
  const body =
    n === 0
      ? ''
      : [
          tx.greeting,
          '',
          tx.intro(n),
          '',
          ...lines,
          '',
          `${tx.total} ${formatByCurrencyPlain(totalByCurrency, input.lang)}`,
          '',
          tx.delivered(n),
          tx.placeholder,
          '',
          tx.request(n),
          '',
          tx.thanks,
        ].join('\n');

  return {
    subject: n === 0 ? '' : tx.subject(n),
    body,
    orderIds: eligible.map((o) => o.id),
    excluded,
    totalByCurrency,
  };
}
