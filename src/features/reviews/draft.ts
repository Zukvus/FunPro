/**
 * Review reply drafting: AI draft from the review text when the copilot is available, with an
 * automatic fallback to the seller's star template (then to the built-in default). The result is
 * always an editable suggestion; posting requires explicit confirmation (or, for auto replies, a
 * user-defined template and the auto-post setting — never AI text).
 */
import { redactForAi } from '@/adapters/ai';
import { getDb, type DraftReply } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { Order, Review, ReviewTemplate } from '@/shared/models';
import type { AiFallbackInfo, CopilotOptions } from '@/features/ai/copilot';
import { detectLanguage, type CopilotLang } from '@/features/ai/heuristics';
import { sanitizeDraft, type DraftWarning } from '@/features/ai/postprocess';
import { LANG_NAMES, systemPrompt, TASKS } from '@/features/ai/prompts';
import { runAiText } from '@/features/ai/run';
import { getSettings } from '@/core/settings/store';
import {
  DEFAULT_REVIEW_REPLIES,
  lintReviewReply,
  pickTemplate,
  renderReviewTemplate,
  REVIEW_REPLY_MAX,
  starsOf,
} from './templates';

export interface ReviewReplyDraft {
  text: string;
  source: 'ai' | 'template' | 'default';
  templateId: string | null;
  warnings: DraftWarning[];
  aiError?: AiFallbackInfo;
}

export function reviewLang(review: Review, fallback: CopilotLang): CopilotLang {
  return detectLanguage(review.text) ?? fallback;
}

/** Template text for a review: the seller's enabled template for the rating, else the built-in one. */
export function templateReplyFor(
  review: Review,
  order: Order | null,
  templates: readonly ReviewTemplate[],
  lang: CopilotLang,
): Omit<ReviewReplyDraft, 'warnings'> {
  const tpl = pickTemplate(review.stars, templates, review.orderId);
  const vars = { buyer: review.authorName, item: order?.description ?? null, stars: review.stars };
  if (tpl) return { text: renderReviewTemplate(tpl.body, vars), source: 'template', templateId: tpl.id };
  return {
    text: DEFAULT_REVIEW_REPLIES[reviewLang(review, lang)][starsOf(review.stars)],
    source: 'default',
    templateId: null,
  };
}

export async function draftReviewReply(
  review: Review,
  order: Order | null,
  opts: CopilotOptions & { templates?: readonly ReviewTemplate[] } = {},
): Promise<ReviewReplyDraft> {
  const lang = opts.lang ?? 'ru';
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false) {
    const settings = opts.settings ?? (await getSettings());
    const names =
      settings.ai.redactPersonalData && review.authorName
        ? [{ name: review.authorName, placeholder: '[buyer]' }]
        : [];
    const res = await runAiText(
      'review_reply',
      {
        system: systemPrompt(TASKS.reviewReply, { lang: LANG_NAMES[reviewLang(review, lang)] }),
        user: [
          `Rating: ${review.stars ?? 'unknown'} of 5`,
          order?.description ? `Item: ${redactForAi(order.description.slice(0, 200))}` : null,
          `Review text: ${review.text.trim() ? redactForAi(review.text.slice(0, 1500), { names }) : '(no text)'}`,
        ]
          .filter(Boolean)
          .join('\n'),
        maxTokens: 300,
      },
      { ...opts, settings },
    );
    if (res.ok) {
      const s = sanitizeDraft(res.text, { maxLength: REVIEW_REPLY_MAX, buyerName: review.authorName });
      const blocking = lintReviewReply(s.text).filter((i) => i !== 'too_long');
      if (s.text && blocking.length === 0)
        return { text: s.text, source: 'ai', templateId: null, warnings: s.warnings };
      aiError = {
        reason: 'invalid_response',
        message: blocking.length
          ? `The AI draft broke review rules (${blocking.join(', ')})`
          : 'The AI answer was empty',
      };
    } else {
      aiError = { reason: res.reason, message: res.message };
    }
  }
  const templates = opts.templates ?? (await getDb().reviewTemplates.toArray());
  const fallback = templateReplyFor(review, order, templates, lang);
  return { ...fallback, warnings: [], aiError };
}

/** Stores a review reply awaiting the seller's approval. One pending draft per review. */
export async function saveReviewReplyDraft(
  review: Review,
  draft: Pick<ReviewReplyDraft, 'text' | 'source' | 'templateId'>,
  extraMeta: Record<string, unknown> = {},
  now = Date.now(),
): Promise<DraftReply> {
  const db = getDb();
  return db.transaction('rw', db.drafts, async () => {
    const existing = await db.drafts
      .where('status')
      .equals('pending')
      .filter(
        (d) =>
          d.source === 'review' &&
          d.meta?.['kind'] === 'review_reply' &&
          d.meta?.['orderId'] === review.orderId,
      )
      .first();
    if (existing) {
      await db.drafts.update(existing.id, {
        text: draft.text,
        updatedAt: now,
        meta: { ...existing.meta, generatedBy: draft.source, templateId: draft.templateId, ...extraMeta },
      });
      return { ...existing, text: draft.text, updatedAt: now };
    }
    const row: DraftReply = {
      id: newId('draft'),
      // Review replies are not chat messages: an empty chat id keeps them out of the chat outbox
      // (ui.sendMessage rejects it); they are posted only through ui.replyReview.
      chatId: '',
      triggerMessageId: null,
      source: 'review',
      text: draft.text,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      sendAt: null,
      meta: {
        kind: 'review_reply',
        orderId: review.orderId,
        stars: review.stars,
        generatedBy: draft.source,
        templateId: draft.templateId,
        ...extraMeta,
      },
    };
    await db.drafts.add(row);
    return row;
  });
}
