/**
 * Telegram alert texts (parse_mode HTML). All dynamic values are sanitised (sanitize.ts) and then
 * HTML-escaped; links point only to funpay.com. Buyer names and customer-written text appear only
 * when the user enabled `telegram.includePreviews`.
 */
import {
  bold,
  chatUrl,
  escapeTelegramHtml,
  funpayLink,
  orderUrl,
  truncatePlain,
} from '@/adapters/telegram/format';
import type { NotificationKind } from '@/features/notifications/notify';
import { nt, starsText, type NotifyLang } from '@/features/notifications/texts';

export interface AlertFields {
  title: string;
  body: string;
  item?: string | null;
  price?: string | null;
  buyer?: string | null;
  preview?: string | null;
  stars?: number | null;
  orderId?: string | null;
  chatId?: string | null;
}

export interface AlertOptions {
  includePreviews: boolean;
  lang: NotifyLang;
}

const ICON: Record<NotificationKind, string> = {
  order: '🛒',
  message: '💬',
  review: '⭐',
  failure: '❗',
  inventory: '📦',
  price: '📉',
  bump: '🔼',
  system: '🔔',
};

const line = (text: string | null | undefined, max = 300) =>
  text && text.trim() ? escapeTelegramHtml(truncatePlain(text, max)) : null;

export function buildTelegramAlert(kind: NotificationKind, f: AlertFields, opts: AlertOptions): string {
  const { lang, includePreviews } = opts;
  const parts: (string | null)[] = [];
  switch (kind) {
    case 'order': {
      parts.push(`${ICON.order} ${bold(nt(lang, 'tg.order'))}`);
      parts.push(line(f.item, 200));
      parts.push(line(f.price, 40));
      if (includePreviews && f.buyer)
        parts.push(`${escapeTelegramHtml(nt(lang, 'tg.buyer'))}: ${line(f.buyer, 60)}`);
      if (f.orderId) parts.push(funpayLink(`${nt(lang, 'tg.openOrder')} #${f.orderId}`, orderUrl(f.orderId)));
      break;
    }
    case 'message': {
      const from = includePreviews && f.buyer ? ` — ${escapeTelegramHtml(truncatePlain(f.buyer, 60))}` : '';
      parts.push(`${ICON.message} ${bold(nt(lang, 'tg.message'))}${from}`);
      if (includePreviews) parts.push(line(f.preview, 400));
      if (f.chatId) parts.push(funpayLink(nt(lang, 'tg.openChat'), chatUrl(f.chatId)));
      break;
    }
    case 'review': {
      parts.push(`${ICON.review} ${bold(`${nt(lang, 'tg.review')} ${starsText(f.stars)}`.trim())}`);
      if (includePreviews) parts.push(line(f.preview, 400));
      if (f.orderId) parts.push(funpayLink(`${nt(lang, 'tg.openOrder')} #${f.orderId}`, orderUrl(f.orderId)));
      break;
    }
    default: {
      parts.push(`${ICON[kind]} ${bold(truncatePlain(f.title, 120))}`);
      parts.push(line(f.body, 400));
    }
  }
  return parts.filter((p): p is string => !!p).join('\n');
}
