/**
 * Post-processing of AI-written drafts before the seller sees them: strips off-platform contacts
 * and foreign links, restores locally known placeholders and flags risky wording (refund
 * promises, binding commitments, early order confirmation, review solicitation) for review.
 */
import { restorePlaceholder } from '@/adapters/ai';
import { cleanMultiline, lintOutgoingText } from '@/core/security/sanitize';

export type DraftWarning =
  | 'contacts_removed'
  | 'off_platform'
  | 'mentions_refund'
  | 'binding_commitment'
  | 'asks_confirmation'
  | 'asks_review'
  | 'placeholder_left'
  | 'truncated';

const isPhoneLike = (m: string) =>
  m.replace(/\D/g, '').length >= 10 && !/\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/.test(m);

const CONTACT_REMOVALS: { re: RegExp; applies?: (match: string) => boolean }[] = [
  { re: /https?:\/\/(?!(?:[a-z0-9-]+\.)*funpay\.com(?:[/?#]|$))\S+/gi },
  { re: /\b(?:t\.me|telegram\.me|discord\.gg|discord\.com\/invite|vk\.com|wa\.me)\/\S*/gi },
  { re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  { re: /(?<![\w.])@[a-z0-9_]{4,}\b/gi },
  { re: /(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])/g, applies: isPhoneLike },
];

const REFUND =
  /(верн[\p{L}\p{N}_]*\s+(вам\s+)?(деньги|средства|оплату)|оформлю\s+возврат|сделаю\s+возврат|возврат\s+(будет|гарантир)|will\s+refund|i'?ll\s+refund|refund\s+you|money\s+back|поверн[\p{L}\p{N}_]*\s+(вам\s+)?(гроші|кошти)|оформлю\s+повернення)/iu;
const COMMITMENT =
  /(гарантир|guarantee|обещаю|i\s+promise|100\s?%|компенсац|compensat|бесплатно\s+отправлю|for\s+free|безкоштовно|обіцяю)/i;
const CONFIRM =
  /(подтверди(те)?\s+(заказ|выполнение|получение)|нажмите\s+.{0,20}подтвердить|confirm\s+(the\s+|your\s+)?order|підтвердіть\s+(замовлення|виконання|отримання))/i;
const REVIEW_ASK =
  /(остав[\p{L}\p{N}_]*\s+(положительн[\p{L}\p{N}_]*\s+|хорош[\p{L}\p{N}_]*\s+)?отзыв|постав[\p{L}\p{N}_]*\s+(5|пять)|leave\s+(a\s+)?(positive\s+|good\s+)?(review|feedback)|5\s*(stars?|звезд|звёзд|зірок)|залиш[\p{L}\p{N}_]*\s+(позитивн[\p{L}\p{N}_]*\s+)?відгук)/iu;
const PLACEHOLDER =
  /\[(order|order-link|user-link|chat-link|funpay-link|chat|email|phone|number|key|token|credentials|user-id|redacted)\]/i;

export interface SanitizeOptions {
  maxLength: number;
  /** Local value for the `[buyer]` placeholder (the provider never saw it). */
  buyerName?: string | null;
}

export function sanitizeDraft(
  raw: string,
  opts: SanitizeOptions,
): { text: string; warnings: DraftWarning[] } {
  const warnings = new Set<DraftWarning>();
  let text = cleanMultiline(raw);
  // Models sometimes wrap the answer in quotes or a code fence.
  text = text.replace(/^```\w*\n?|\n?```$/g, '').trim();
  if (/^["«“].*["»”]$/s.test(text)) text = text.slice(1, -1).trim();
  let removed = false;
  for (const { re, applies } of CONTACT_REMOVALS) {
    text = text.replace(re, (m) => {
      if (applies && !applies(m)) return m;
      removed = true;
      return '';
    });
  }
  if (removed) {
    warnings.add('contacts_removed');
    text = text
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/ +([,.!?])/g, '$1')
      .trim();
  }
  if (lintOutgoingText(text).length > 0) warnings.add('off_platform');
  text = restorePlaceholder(text, '[buyer]', opts.buyerName ?? null);
  if (REFUND.test(text)) warnings.add('mentions_refund');
  if (COMMITMENT.test(text)) warnings.add('binding_commitment');
  if (CONFIRM.test(text)) warnings.add('asks_confirmation');
  if (REVIEW_ASK.test(text)) warnings.add('asks_review');
  if (PLACEHOLDER.test(text) || /\[buyer\]/i.test(text)) warnings.add('placeholder_left');
  if (text.length > opts.maxLength) {
    text = text.slice(0, opts.maxLength).trimEnd();
    warnings.add('truncated');
  }
  return { text, warnings: [...warnings] };
}

/** Same checks without modifying the text (used for templates and manual edits). */
export function draftWarnings(text: string): DraftWarning[] {
  const out: DraftWarning[] = [];
  if (lintOutgoingText(text).length > 0) out.push('off_platform');
  if (REFUND.test(text)) out.push('mentions_refund');
  if (COMMITMENT.test(text)) out.push('binding_commitment');
  if (CONFIRM.test(text)) out.push('asks_confirmation');
  if (REVIEW_ASK.test(text)) out.push('asks_review');
  if (PLACEHOLDER.test(text)) out.push('placeholder_left');
  return out;
}
