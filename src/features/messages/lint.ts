/**
 * Template / outgoing-text linter. FunPay rules (docs/research-notes-raw.md §E):
 *  - exchanging contacts or moving the conversation off-platform is forbidden;
 *  - buyers must not be pushed to confirm an order before they received what they paid for —
 *    only "please confirm after you've received it" wording is safe;
 *  - rewarding reviews is a common marketplace prohibition (treated as high risk).
 *
 * The linter only warns; it never rewrites text. Automated senders use `hasBlockingIssue()` to
 * turn a risky automatic message into a draft that the seller must approve.
 */
import { lintOutgoingText } from '@/core/security/sanitize';
import { MAX_MESSAGE_LENGTH } from './outbox';
import { extractVariables } from './engine';

export type LintIssueId =
  | 'telegram'
  | 'discord'
  | 'phone'
  | 'email'
  | 'vk'
  | 'external_link'
  | 'confirm_pressure'
  | 'review_incentive'
  | 'unknown_variable'
  | 'too_long';

export interface LintIssue {
  id: LintIssueId;
  severity: 'warning' | 'error';
  /** Extra detail, e.g. the unknown variable names. */
  detail?: string;
}

const CONTACT_IDS = new Set<LintIssueId>(['telegram', 'discord', 'phone', 'email', 'vk', 'external_link']);

// Up to three filler words between the parts of a phrase ("подтвердите, пожалуйста, заказ").
const GAP = '[\\s,]+(?:[\\p{L}]+[\\s,]+){0,3}';
const re = (src: string) => new RegExp(src, 'iu');

/** Phrases that ask the buyer to confirm the order / receipt (RU, EN, UK). */
const CONFIRM_REQUEST: RegExp[] = [
  re(`подтверд\\p{L}*${GAP}(заказ|получени|выполнени|сделк)`),
  re(`(заказ|получение|выполнение)\\p{L}*${GAP}подтверд`),
  re(`(нажм|нажа|жми|кликн)\\p{L}*${GAP}[«"']?подтверд`),
  re(`кнопк\\p{L}*[\\s,]+[«"']?подтвердить`),
  re(`\\bconfirm\\p{L}*${GAP}(order|receipt|delivery|completion|purchase|deal)`),
  re(`\\b(press|click|tap|hit)\\p{L}*\\s+(the\\s+|on\\s+)?[«"']?confirm`),
  re(`\\bmark\\s+(the\\s+|your\\s+)?order\\s+as\\s+(complete|completed|received|done)`),
  re(`підтверд\\p{L}*${GAP}(замовлення|отримання|виконання)`),
  re(`(натисн|клікн)\\p{L}*${GAP}[«"']?підтверд`),
];

/** Wording that makes a confirmation request acceptable: only after the buyer received / checked it. */
const SAFE_QUALIFIER = re(
  [
    '(после|по)\\s+(того,?\\s+как\\s+)?(вс[её]\\s+)?(получ|провер)',
    'когда\\s+(вс[её]\\s+)?(получите|проверите|убедитесь)',
    'как\\s+только\\s+(вс[её]\\s+)?(получите|проверите)',
    '\\b(after|once|when)\\s+(you\\s+)?(have\\s+|\'ve\\s+)?(receiv|check|get|got|verif)',
    '\\bafter\\s+(receiving|checking|getting)',
    'після\\s+(того,?\\s+як\\s+)?(отрим|перевір)',
    'коли\\s+(отримаєте|перевірите)',
  ].join('|'),
);

/** Pressure / ordering wording that makes any confirmation request unsafe. */
const PRESSURE: RegExp[] = [
  re(`(сначала|сперва|заранее|спочатку|заздалегідь)${GAP}(подтверд|підтверд)`),
  re(`(подтверд|підтверд)\\p{L}*${GAP}(сначала|сперва|заранее|спочатку|заздалегідь)`),
  re('(сразу|немедленно)(?![\\s,]+после)'),
  re('(одразу|негайно)(?![\\s,]+після)'),
  re('срочно|терміново'),
  re('прежде\\s+чем\\s+(я\\s+)?(отправ|выда|переда|выполн)'),
  re('до\\s+(получения|отправки|выдачи|выполнения|передачи|отримання|відправки|видачі)'),
  re('иначе\\s+(я\\s+)?не\\s+(отправ|выда|переда)'),
  re(`\\bconfirm\\p{L}*${GAP}first\\b`),
  re('\\bfirst\\s+confirm'),
  re('\\bbefore\\s+(i|we)\\s+(send|deliver|give|transfer|hand)'),
  re('\\bbefore\\s+(receiving|delivery|you\\s+(receive|get))'),
  re('\\bin\\s+advance\\b'),
  re('\\bright\\s+away\\b'),
  re('\\bimmediately\\b(?![\\s,]+after)'),
  re('\\basap\\b'),
  re("\\b(or\\s+else|otherwise)\\s+i\\s+(won'?t|will\\s+not|can'?t)"),
];

/** Offering something in exchange for a (good) review. */
const REVIEW_INCENTIVE: RegExp[] = [
  re('(бонус|скидк|подар|промокод|кэшбэк|кешбэк)\\p{L}*[^.!?\\n]{0,60}(отзыв|оценк|5\\s*(★|звезд|⭐))'),
  re('(отзыв|оценк|5\\s*(★|звезд|⭐))\\p{L}*[^.!?\\n]{0,60}(бонус|скидк|подар|промокод|кэшбэк|кешбэк)'),
  re('\\b(bonus|discount|gift|promo\\s*code|coupon|cashback)\\b[^.!?\\n]{0,60}\\b(review|feedback|rating|5\\s*(★|stars?|⭐))'),
  re('\\b(review|feedback|rating|5\\s*(★|stars?|⭐))[^.!?\\n]{0,60}\\b(bonus|discount|gift|promo\\s*code|coupon|cashback)\\b'),
  re('(бонус|знижк|подарун|промокод)\\p{L}*[^.!?\\n]{0,60}(відгук|оцінк)'),
];

export function hasConfirmPressure(text: string): boolean {
  if (!CONFIRM_REQUEST.some((r) => r.test(text))) return false;
  return PRESSURE.some((r) => r.test(text)) || !SAFE_QUALIFIER.test(text);
}

export function hasReviewIncentive(text: string): boolean {
  return REVIEW_INCENTIVE.some((r) => r.test(text));
}

/**
 * Lint a template body or a final outgoing message.
 * @param opts.checkVariables report `{unknown}` placeholders (they would be sent literally).
 */
export function lintText(text: string, opts: { checkVariables?: boolean } = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const id of lintOutgoingText(text)) {
    if (CONTACT_IDS.has(id as LintIssueId)) issues.push({ id: id as LintIssueId, severity: 'warning' });
  }
  if (hasConfirmPressure(text)) issues.push({ id: 'confirm_pressure', severity: 'warning' });
  if (hasReviewIncentive(text)) issues.push({ id: 'review_incentive', severity: 'warning' });
  if (opts.checkVariables ?? true) {
    const { unknown } = extractVariables(text);
    if (unknown.length) issues.push({ id: 'unknown_variable', severity: 'warning', detail: unknown.map((u) => `{${u}}`).join(', ') });
  }
  if (text.trim().length > MAX_MESSAGE_LENGTH) issues.push({ id: 'too_long', severity: 'error' });
  return issues;
}

/**
 * Issues that must stop a message from being sent automatically (it becomes a draft instead):
 * contacts / external links, confirmation pressure and review incentives.
 */
export function hasBlockingIssue(issues: readonly LintIssue[]): boolean {
  return issues.some((i) => i.severity === 'error' || CONTACT_IDS.has(i.id) || i.id === 'confirm_pressure' || i.id === 'review_incentive');
}

export function isContactIssue(id: LintIssueId): boolean {
  return CONTACT_IDS.has(id);
}
