/**
 * Buyer feedback.
 *
 * Platform limitation: FunPay lets buyers review sellers, but sellers cannot rate buyers — there is
 * no seller→buyer rating feature and no evidenced endpoint for one (research notes §D.6), so
 * FunPro does not offer "rate the buyer".
 *
 * What FunPro offers instead: neutral, manual templates for a polite chat message after the order
 * was confirmed (closed), inserted as a draft the seller reviews and sends. They never offer
 * rewards, never ask for a particular rating and are never sent automatically.
 */
import { getDb, type DraftReply } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { Order } from '@/shared/models';
import type { CopilotLang } from '@/features/ai/heuristics';

export interface FeedbackTemplate {
  id: string;
  lang: CopilotLang;
  text: string;
}

export const FEEDBACK_REQUEST_TEMPLATES: readonly FeedbackTemplate[] = [
  {
    id: 'thanks-honest-ru',
    lang: 'ru',
    text: 'Спасибо за покупку! Если будет минутка, можете оставить честный отзыв на странице заказа — это помогает другим покупателям. Если что-то не так, просто напишите мне здесь.',
  },
  {
    id: 'check-ru',
    lang: 'ru',
    text: 'Здравствуйте! Заказ подтверждён — спасибо! Всё ли работает как нужно? Если будут вопросы, пишите сюда в любое время. Ваш честный отзыв о заказе тоже будет полезен.',
  },
  {
    id: 'thanks-honest-en',
    lang: 'en',
    text: 'Thank you for your purchase! If you have a minute, you can leave honest feedback on the order page — it helps other buyers. If anything is not right, just message me here.',
  },
  {
    id: 'check-en',
    lang: 'en',
    text: 'Hello! The order is confirmed — thank you! Is everything working as expected? If you have questions, write here any time. Honest feedback about the order is welcome too.',
  },
  {
    id: 'thanks-honest-uk',
    lang: 'uk',
    text: 'Дякую за покупку! Якщо матимете хвилинку, можете залишити чесний відгук на сторінці замовлення — це допомагає іншим покупцям. Якщо щось не так, просто напишіть мені тут.',
  },
  {
    id: 'check-uk',
    lang: 'uk',
    text: 'Вітаю! Замовлення підтверджено — дякую! Чи все працює як слід? Якщо будуть питання, пишіть сюди будь-коли. Ваш чесний відгук про замовлення теж буде корисним.',
  },
];

export type FeedbackBlock = 'not_sale' | 'not_confirmed' | 'refunded' | 'already_reviewed' | 'no_chat';

/** Feedback may be requested only for sales the buyer has confirmed (closed), without a review yet. */
export function feedbackRequestBlock(order: Order, hasReview: boolean): FeedbackBlock | null {
  if (order.direction !== 'sale') return 'not_sale';
  if (order.status === 'refunded') return 'refunded';
  if (order.status !== 'closed') return 'not_confirmed';
  if (hasReview) return 'already_reviewed';
  return null;
}

/** FunPay private chat id convention: users-{min}-{max} (research notes §D.3). */
export function privateChatId(selfUserId: string | null | undefined, buyerId: string | null | undefined): string | null {
  if (!selfUserId || !buyerId || !/^\d+$/.test(selfUserId) || !/^\d+$/.test(buyerId) || selfUserId === buyerId) return null;
  const [a, b] = [Number(selfUserId), Number(buyerId)].sort((x, y) => x - y);
  return `users-${a}-${b}`;
}

export async function createFeedbackRequestDraft(order: Order, text: string, selfUserId: string | null, now = Date.now()): Promise<DraftReply> {
  const db = getDb();
  const hasReview = (await db.reviews.get(order.id)) !== undefined;
  const block = feedbackRequestBlock(order, hasReview);
  if (block) throw new Error(`Feedback request not allowed: ${block}`);
  const chatId = privateChatId(selfUserId, order.counterpartyId);
  if (!chatId) throw new Error('Feedback request not allowed: no_chat');
  const body = text.trim();
  if (!body) throw new Error('The message is empty');
  const draft: DraftReply = {
    id: newId('draft'),
    chatId,
    triggerMessageId: null,
    source: 'review',
    text: body,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    sendAt: null,
    meta: { kind: 'feedback_request', orderId: order.id },
  };
  await db.drafts.add(draft);
  return draft;
}
