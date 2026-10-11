/**
 * Telegram HTML formatting helpers (parse_mode "HTML"). Telegram supports only the &lt; &gt; &amp;
 * &quot; entities; every piece of dynamic text goes through `escapeTelegramHtml`, and links are
 * restricted to https://funpay.com so a crafted value can never inject markup or a foreign link.
 */
import { safeFunPayUrl } from '@/core/security/sanitize';

export function escapeTelegramHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
  return escapeTelegramHtml(text).replace(/"/g, '&quot;');
}

/** Truncate plain text (before escaping, so entities are never cut in half). */
export function truncatePlain(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function bold(text: string): string {
  return `<b>${escapeTelegramHtml(text)}</b>`;
}

export function code(text: string): string {
  return `<code>${escapeTelegramHtml(text)}</code>`;
}

/** A link to funpay.com, or just the escaped label when the URL is not a FunPay URL. */
export function funpayLink(label: string, url: string | null | undefined): string {
  const safe = safeFunPayUrl(url ?? null);
  if (!safe) return escapeTelegramHtml(label);
  return `<a href="${escapeAttr(safe)}">${escapeTelegramHtml(label)}</a>`;
}

export function orderUrl(orderId: string): string {
  return `https://funpay.com/orders/${encodeURIComponent(orderId)}/`;
}

export function chatUrl(chatId: string): string {
  return `https://funpay.com/chat/?node=${encodeURIComponent(chatId)}`;
}
