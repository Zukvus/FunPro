/**
 * Per-star review reply templates (db.reviewTemplates) and built-in defaults.
 *
 * Policy: replies thank or acknowledge the buyer; they never offer rewards, never ask the buyer to
 * change or raise a rating, and never contain contacts or links outside FunPay. `lintReviewReply`
 * enforces this for templates, AI drafts and manual edits alike.
 */
import { getDb } from '@/core/db/db';
import { lintOutgoingText } from '@/core/security/sanitize';
import { newId } from '@/core/util/id';
import { ReviewTemplateSchema, type ReviewTemplate } from '@/shared/models';
import type { CopilotLang } from '@/features/ai/heuristics';

/** Same bound as the `ui.replyReview` RPC. */
export const REVIEW_REPLY_MAX = 1000;

export type Stars = 1 | 2 | 3 | 4 | 5;

export const DEFAULT_REVIEW_REPLIES: Record<CopilotLang, Record<Stars, string>> = {
  ru: {
    5: 'Спасибо за отзыв и за покупку! Приятно, что всё понравилось. Обращайтесь ещё!',
    4: 'Спасибо за отзыв! Если что-то можно было сделать лучше — напишите, обязательно учту.',
    3: 'Спасибо за отзыв. Жаль, что не всё прошло идеально — напишите в чат заказа, что именно не понравилось, постараюсь помочь.',
    2: 'Жаль, что у вас остались неприятные впечатления. Опишите, пожалуйста, в чате заказа, что произошло, — разберусь и постараюсь помочь.',
    1: 'Очень жаль, что так вышло. Напишите, пожалуйста, в чат заказа, что произошло, — я разберусь в ситуации.',
  },
  en: {
    5: 'Thank you for the review and for your purchase! Glad everything went well — you are always welcome back.',
    4: 'Thanks for the review! If there is anything I could have done better, please let me know.',
    3: 'Thank you for the feedback. Sorry it was not perfect — tell me in the order chat what went wrong and I will try to help.',
    2: 'I am sorry you had an unpleasant experience. Please describe what happened in the order chat — I will look into it and try to help.',
    1: 'I am very sorry about this. Please describe what happened in the order chat and I will look into it.',
  },
  uk: {
    5: 'Дякую за відгук і покупку! Приємно, що все сподобалося. Звертайтеся ще!',
    4: 'Дякую за відгук! Якщо щось можна було зробити краще — напишіть, обов’язково врахую.',
    3: 'Дякую за відгук. Шкода, що не все пройшло ідеально — напишіть у чат замовлення, що саме не сподобалося, постараюся допомогти.',
    2: 'Шкода, що у вас залишилися неприємні враження. Опишіть, будь ласка, у чаті замовлення, що сталося, — розберуся і постараюся допомогти.',
    1: 'Дуже шкода, що так сталося. Напишіть, будь ласка, у чат замовлення, що сталося, — я розберуся в ситуації.',
  },
};

export function starsOf(stars: number | null | undefined): Stars {
  // Unknown ratings get the neutral 4★ text.
  if (stars === 1 || stars === 2 || stars === 3 || stars === 4 || stars === 5) return stars;
  return 4;
}

export async function listReviewTemplates(): Promise<ReviewTemplate[]> {
  const all = await getDb().reviewTemplates.toArray();
  return all.sort((a, b) => b.stars - a.stars || a.id.localeCompare(b.id));
}

export type ReviewTextIssue = 'empty' | 'too_long' | 'contacts' | 'reward' | 'rating_request';

/** Incentives tied to feedback (product names such as "gift card" are deliberately not matched). */
const REWARD = /(промо-?код|promo\s*code|coupon|купон|кэшб[еэ]к|кешб[еэ]к|cashback|бонус[\p{L}\p{N}_]*\s+за|bonus\s+for|подар[\p{L}\p{N}_]*\s+(за|вам|тебе)|gift\s+for\s+(your|the|a)\s+(review|feedback|rating)|скидк[\p{L}\p{N}_]*\s+(на\s+)?(следующ|будущ)|discount\s+(code|on\s+(your\s+)?next)|знижк[\p{L}\p{N}_]*\s+на\s+наступн|reward\s+for|винагород[\p{L}\p{N}_]*\s+за|в\s+благодарность\s+за\s+отзыв|in\s+return\s+for\s+(a|your)\s+review)/iu;
/** Asking the buyer to change, raise or leave a particular rating (thanking for one is fine). */
const RATING_REQUEST = /(измени[\p{L}\p{N}_]*\s+(оценк|отзыв)|исправ[\p{L}\p{N}_]*\s+(оценк|отзыв)|поменя[\p{L}\p{N}_]*\s+(оценк|отзыв)|удали[\p{L}\p{N}_]*\s+отзыв|постав[\p{L}\p{N}_]*\s+(5|пять|высок)|остав[\p{L}\p{N}_]*\s+(положительн|хорош|5)[\p{L}\p{N}_]*|change\s+(your\s+)?(rating|review)|update\s+(your\s+)?(rating|review)|remove\s+(your\s+)?(rating|review)|leave\s+(a\s+)?(positive|good|5[-\s]?star)|give\s+(me\s+)?5\s+stars|змін[\p{L}\p{N}_]*\s+(оцінк|відгук)|видал[\p{L}\p{N}_]*\s+відгук|залиш[\p{L}\p{N}_]*\s+(позитивн|гарн|5)[\p{L}\p{N}_]*)/iu;

/** Problems that block saving/sending a review reply or template. */
export function lintReviewReply(text: string): ReviewTextIssue[] {
  const t = text.trim();
  const issues: ReviewTextIssue[] = [];
  if (!t) issues.push('empty');
  if (t.length > REVIEW_REPLY_MAX) issues.push('too_long');
  if (lintOutgoingText(t).length > 0) issues.push('contacts');
  if (REWARD.test(t)) issues.push('reward');
  if (RATING_REQUEST.test(t)) issues.push('rating_request');
  return issues;
}

export interface ReviewTemplateInput {
  id?: string;
  stars: number;
  body: string;
  enabled?: boolean;
}

export async function saveReviewTemplate(input: ReviewTemplateInput): Promise<ReviewTemplate> {
  const body = input.body.trim();
  const issues = lintReviewReply(body);
  if (issues.length) throw new Error(`Template rejected: ${issues.join(', ')}`);
  const tpl = ReviewTemplateSchema.parse({ id: input.id ?? newId('rtpl'), stars: input.stars, body, enabled: input.enabled ?? true });
  await getDb().reviewTemplates.put(tpl);
  return tpl;
}

export async function deleteReviewTemplate(id: string): Promise<void> {
  await getDb().reviewTemplates.delete(id);
}

export async function setReviewTemplateEnabled(id: string, enabled: boolean): Promise<void> {
  await getDb().reviewTemplates.update(id, { enabled });
}

/** Adds the built-in templates (one per star) when the seller has none yet. Returns how many were added. */
export async function seedDefaultReviewTemplates(lang: CopilotLang): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.reviewTemplates, async () => {
    if ((await db.reviewTemplates.count()) > 0) return 0;
    const rows: ReviewTemplate[] = ([5, 4, 3, 2, 1] as const).map((stars) => ({ id: newId('rtpl'), stars, body: DEFAULT_REVIEW_REPLIES[lang][stars], enabled: true }));
    await db.reviewTemplates.bulkAdd(rows);
    return rows.length;
  });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Enabled user template for the rating; several templates rotate deterministically by `seed`. */
export function pickTemplate(stars: number | null, templates: readonly ReviewTemplate[], seed = ''): ReviewTemplate | null {
  const s = starsOf(stars);
  const candidates = templates.filter((t) => t.enabled && t.stars === s).sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return null;
  return candidates[hash(seed) % candidates.length]!;
}

export interface ReviewTemplateVars {
  buyer?: string | null;
  item?: string | null;
  stars?: number | null;
}

/** Supported variables: {buyer}, {item}, {stars}. Unknown values are removed cleanly. */
export function renderReviewTemplate(body: string, vars: ReviewTemplateVars): string {
  return body
    .replace(/\{buyer\}/gi, vars.buyer?.trim() ?? '')
    .replace(/\{item\}/gi, vars.item?.trim() ?? '')
    .replace(/\{stars\}/gi, vars.stars ? String(vars.stars) : '')
    .replace(/[ \t]+([,.!?])/g, '$1')
    // A removed name leaves "Спасибо,!" behind: drop the dangling comma.
    .replace(/,+([.!?])/g, '$1')
    .replace(/,{2,}/g, ',')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/^[,\s]+/, '')
    .trim();
}
