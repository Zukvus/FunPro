/**
 * Reviews joined with their order context (db.orders by orderId: item, price, buyer, date) and any
 * pending reply draft, plus the filters used by the Reviews page.
 */
import { getDb, type DraftReply } from '@/core/db/db';
import type { Order, Review } from '@/shared/models';

export interface ReviewRow {
  review: Review;
  order: Order | null;
  /** Pending review-reply draft awaiting approval, if any. */
  draft: DraftReply | null;
}

export interface ReviewFilter {
  /** 1-5, or null for all ratings. */
  stars: number | null;
  unansweredOnly: boolean;
  query: string;
}

export const DEFAULT_REVIEW_FILTER: ReviewFilter = { stars: null, unansweredOnly: false, query: '' };

export function isReviewReplyDraft(d: DraftReply): boolean {
  return (
    d.source === 'review' && d.meta?.['kind'] === 'review_reply' && typeof d.meta?.['orderId'] === 'string'
  );
}

export function reviewTime(r: Review): number {
  const t = Date.parse(r.at ?? r.firstSeenAt);
  return Number.isFinite(t) ? t : 0;
}

export function matchesReviewFilter(row: ReviewRow, f: ReviewFilter): boolean {
  const { review, order } = row;
  if (f.stars !== null && review.stars !== f.stars) return false;
  if (f.unansweredOnly && review.sellerReply) return false;
  const q = f.query.trim().toLowerCase();
  if (q) {
    const hay = [
      review.text,
      review.authorName,
      review.orderId,
      review.sellerReply ?? '',
      order?.description ?? '',
      order?.categoryName ?? '',
    ]
      .join('\n')
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export async function loadReviewRows(
  filter: ReviewFilter = DEFAULT_REVIEW_FILTER,
  limit = 500,
): Promise<ReviewRow[]> {
  const db = getDb();
  const reviews =
    filter.stars !== null
      ? await db.reviews.where('stars').equals(filter.stars).toArray()
      : await db.reviews.toArray();
  const orders = await db.orders.bulkGet(reviews.map((r) => r.orderId));
  const drafts = await db.drafts.where('status').equals('pending').filter(isReviewReplyDraft).toArray();
  const draftByOrder = new Map<string, DraftReply>();
  for (const d of drafts.sort((a, b) => a.createdAt - b.createdAt))
    draftByOrder.set(String(d.meta!['orderId']), d);
  const rows: ReviewRow[] = reviews.map((review, i) => ({
    review,
    order: orders[i] ?? null,
    draft: draftByOrder.get(review.orderId) ?? null,
  }));
  return rows
    .filter((r) => matchesReviewFilter(r, filter))
    .sort((a, b) => reviewTime(b.review) - reviewTime(a.review))
    .slice(0, limit);
}

export interface ReviewStats {
  total: number;
  unanswered: number;
  average: number | null;
  byStars: Record<1 | 2 | 3 | 4 | 5, number>;
}

export async function reviewStats(): Promise<ReviewStats> {
  const all = await getDb().reviews.toArray();
  const byStars: ReviewStats['byStars'] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let rated = 0;
  for (const r of all) {
    if (r.stars && r.stars >= 1 && r.stars <= 5) {
      byStars[r.stars as 1 | 2 | 3 | 4 | 5]++;
      sum += r.stars;
      rated++;
    }
  }
  return {
    total: all.length,
    unanswered: all.filter((r) => !r.sellerReply).length,
    average: rated ? sum / rated : null,
    byStars,
  };
}
