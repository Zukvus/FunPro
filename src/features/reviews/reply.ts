/**
 * Local bookkeeping after a review reply was posted on FunPay (via the `ui.replyReview` RPC).
 */
import { getDb } from '@/core/db/db';
import { cleanMultiline } from '@/core/security/sanitize';
import { lintReviewReply, REVIEW_REPLY_MAX, type ReviewTextIssue } from './templates';
import { isReviewReplyDraft } from './context';

export function prepareReviewReply(
  raw: string,
): { ok: true; text: string } | { ok: false; issues: ReviewTextIssue[] } {
  const text = cleanMultiline(raw, REVIEW_REPLY_MAX + 1);
  const issues = lintReviewReply(text);
  return issues.length ? { ok: false, issues } : { ok: true, text };
}

/** Records the reply on the review, closes its approval draft(s). */
export async function markReviewReplied(
  orderId: string,
  text: string,
  draftId: string | null = null,
  now = Date.now(),
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.reviews, db.drafts, async () => {
    await db.reviews.update(orderId, { sellerReply: text });
    const pending = await db.drafts
      .where('status')
      .equals('pending')
      .filter((d) => isReviewReplyDraft(d) && d.meta?.['orderId'] === orderId)
      .toArray();
    for (const d of pending)
      await db.drafts.update(d.id, { status: d.id === draftId ? 'sent' : 'dismissed', updatedAt: now });
    if (draftId && !pending.some((d) => d.id === draftId))
      await db.drafts.update(draftId, { status: 'sent', updatedAt: now });
  });
}

export async function dismissReviewDraft(draftId: string, now = Date.now()): Promise<void> {
  await getDb().drafts.update(draftId, { status: 'dismissed', updatedAt: now });
}
