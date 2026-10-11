/**
 * Automatic review replies (REVIEW_RECEIVED).
 *
 * Gating, in order: baseline events and reviews that already have a reply are ignored; the
 * `autoReviewReply` automation must be `running` (policy: enabled, not paused/stopped, live actions
 * acknowledged, FunPay tab open); each event is handled once.
 *
 * Default: an approval draft (template text, or AI text when `ai.autoDraftReviews` is on).
 * Direct posting only when `ai.autoPostReviewReplies` is on, only with a user-defined enabled star
 * template that passes the review-text rules, rate-limited — AI text is never posted unapproved.
 */
import { evaluateFeature, type AutomationContext, type AutomationStatus } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { markHandled } from '@/core/events/bus';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import type { DomainEvent } from '@/shared/models';
import type { AiRuntimeDeps } from '@/features/ai/availability';
import type { CopilotLang } from '@/features/ai/heuristics';
import { draftReviewReply, saveReviewReplyDraft, templateReplyFor } from './draft';
import { lintReviewReply, pickTemplate, renderReviewTemplate } from './templates';

export const AUTO_REVIEW_HANDLER_ID = 'auto-review-reply';
/** Direct posts per window (FunPay requests are also spaced by the content-script transport). */
export const AUTO_POST_LIMIT = { max: 5, windowMs: 10 * 60_000 };
/** Automatic AI drafts per window; beyond this the template is used (bounded provider usage). */
export const AUTO_AI_LIMIT = { max: 10, windowMs: 60 * 60_000 };

export type AutoReviewOutcome =
  | 'ignored_baseline'
  | 'ignored_has_reply'
  | 'ignored_missing'
  | 'not_running'
  | 'duplicate'
  | 'drafted'
  | 'posted'
  | 'post_failed'
  | 'awaiting_tab';

export interface AutoReviewDeps {
  getSettings(): Promise<Settings>;
  automationContext(): Promise<AutomationContext>;
  /** Posts through an open FunPay tab; throws an error named `NoFunPayTabError` when none is open. */
  postReply(orderId: string, text: string): Promise<{ ok: boolean; error?: string }>;
  aiDeps?: AiRuntimeDeps;
  lang: CopilotLang;
  now?: () => number;
}

export interface AutoReviewResult {
  outcome: AutoReviewOutcome;
  status?: AutomationStatus;
  draftId?: string;
  detail?: string;
}

/** Sliding-window limiter persisted in db.kv (survives service-worker restarts). */
export async function takeSlot(key: string, limit: { max: number; windowMs: number }, now: number): Promise<boolean> {
  const db = getDb();
  return db.transaction('rw', db.kv, async () => {
    const rec = await db.kv.get(key);
    const times = (Array.isArray(rec?.value) ? (rec.value as unknown[]) : []).filter((t): t is number => typeof t === 'number' && now - t < limit.windowMs);
    if (times.length >= limit.max) return false;
    times.push(now);
    await db.kv.put({ key, value: times });
    return true;
  });
}

export async function handleReviewForAutoReply(event: DomainEvent, deps: AutoReviewDeps): Promise<AutoReviewResult> {
  const p = event.payload;
  if (p['baseline'] === true) return { outcome: 'ignored_baseline' };
  if (p['hasReply'] === true) return { outcome: 'ignored_has_reply' };
  const orderId = typeof p['orderId'] === 'string' ? p['orderId'] : '';
  const db = getDb();
  const review = orderId ? await db.reviews.get(orderId) : undefined;
  if (!review) return { outcome: 'ignored_missing' };
  if (review.sellerReply) return { outcome: 'ignored_has_reply' };

  const settings = await deps.getSettings();
  const policy = evaluateFeature(settings, 'autoReviewReply', await deps.automationContext());
  if (policy.status !== 'running') return { outcome: 'not_running', status: policy.status, detail: policy.reason };
  if (!(await markHandled(event.id, AUTO_REVIEW_HANDLER_ID))) return { outcome: 'duplicate' };

  const now = deps.now?.() ?? Date.now();
  const order = (await db.orders.get(orderId)) ?? null;
  const templates = await db.reviewTemplates.toArray();
  let outcome: AutoReviewOutcome = 'drafted';
  let detail: string | undefined;

  if (settings.ai.autoPostReviewReplies) {
    const tpl = pickTemplate(review.stars, templates, review.orderId);
    if (!tpl) {
      detail = `No enabled template for ${review.stars ?? '?'}★ reviews — saved for approval`;
    } else {
      const text = renderReviewTemplate(tpl.body, { buyer: review.authorName, item: order?.description ?? null, stars: review.stars });
      const issues = lintReviewReply(text);
      if (issues.length) {
        detail = `Template not posted (${issues.join(', ')}) — saved for approval`;
      } else if (!(await takeSlot('reviews:autoPost', AUTO_POST_LIMIT, now))) {
        detail = 'Automatic reply limit reached — saved for approval';
      } else {
        try {
          const res = await deps.postReply(orderId, text);
          if (res.ok) {
            await db.reviews.update(orderId, { sellerReply: text });
            await log.info({ source: 'reviews', message: `Auto-replied to the ${review.stars ?? '?'}★ review on order ${orderId} using a template` });
            return { outcome: 'posted', status: 'running' };
          }
          outcome = 'post_failed';
          detail = `FunPay rejected the reply: ${res.error ?? 'unknown error'}`;
        } catch (e) {
          const err = e as Error;
          outcome = err.name === 'NoFunPayTabError' ? 'awaiting_tab' : 'post_failed';
          detail = outcome === 'awaiting_tab' ? 'No FunPay tab was open — saved for approval' : `Reply may not have been posted: ${err.message}`;
        }
        await log.warn({ source: 'reviews', message: `Auto reply for order ${orderId}: ${detail}` });
      }
    }
  }

  const useAi = settings.ai.autoDraftReviews && (await takeSlot('reviews:autoAi', AUTO_AI_LIMIT, now));
  const draft = useAi
    ? await draftReviewReply(review, order, { settings, deps: deps.aiDeps, lang: deps.lang, templates })
    : { ...templateReplyFor(review, order, templates, deps.lang), warnings: [] };
  const saved = await saveReviewReplyDraft(review, draft, { auto: true, ...(detail ? { note: detail } : {}) }, now);
  return { outcome, status: 'running', draftId: saved.id, detail };
}
