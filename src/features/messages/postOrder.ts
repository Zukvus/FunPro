/**
 * Post-order message: sent once when FunPro observes a sale being completed (ORDER_COMPLETED,
 * non-baseline) for an order created within the last POST_ORDER_MAX_AGE_MS.
 *
 * Addressing: the buyer's chat is `users-{min(selfId, buyerId)}-{max}` (research §D.3), or an
 * existing chat with the buyer's name. When neither is known the text is saved as a draft that
 * explains why it could not be addressed — FunPro never guesses a recipient.
 *
 * Idempotency: queue key `postorder:<orderId>` and draft id `draft_postorder_<orderId>`.
 */
import { z } from 'zod';
import { evaluateFeature } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { DomainEvent } from '@/shared/models';
import {
  automationDraftId,
  createAutomationDraft,
  hasQueuedMessage,
  logSkip,
  quietHoursState,
  skipped,
  type AutomationOutcome,
  type DraftReason,
  type MessagingDeps,
} from './automation';
import { orderVariables, privateChatId } from './context';
import { hasBlockingIssue, lintText } from './lint';
import { queueMessage } from './outbox';
import { chatUrl, clockVariables, renderTemplate } from './templates';

export const POST_ORDER_MAX_AGE_MS = 7 * 24 * 3600_000;

const PayloadSchema = z.object({
  orderId: z.string().min(1).max(16),
  direction: z.enum(['sale', 'purchase']).optional(),
  buyer: z.string().nullable().optional(),
  buyerId: z.string().nullable().optional(),
  baseline: z.boolean().optional(),
  createdAt: z.string().nullable().optional(),
});

export function postOrderKey(orderId: string): string {
  return `postorder:${orderId}`;
}

export async function handleOrderCompleted(
  event: DomainEvent,
  deps: MessagingDeps,
): Promise<AutomationOutcome> {
  const parsed = PayloadSchema.safeParse(event.payload);
  const out = parsed.success ? await decide(parsed.data, deps) : skipped('invalid_event');
  await logSkip('post-order', out, { order: parsed.success ? parsed.data.orderId : null });
  return out;
}

async function decide(p: z.infer<typeof PayloadSchema>, deps: MessagingDeps): Promise<AutomationOutcome> {
  const { settings, now } = deps;
  if (p.baseline === true) return skipped('baseline');
  const status = evaluateFeature(settings, 'postOrderMessage', deps.ctx);
  if (status.status !== 'running') return skipped('not_running', status.reason);
  const body = settings.messages.postOrderText.trim();
  if (!body) return skipped('no_text');

  const db = getDb();
  const order = await db.orders.get(p.orderId);
  const direction = order?.direction ?? p.direction;
  if (direction !== 'sale') return skipped('not_sale');
  const created = Date.parse(order?.createdAt ?? p.createdAt ?? order?.firstSeenAt ?? '');
  if (!Number.isFinite(created) || now - created > POST_ORDER_MAX_AGE_MS) return skipped('too_old');

  const key = postOrderKey(p.orderId);
  const draftId = automationDraftId('postorder', p.orderId);
  if ((await hasQueuedMessage(key)) || (await db.drafts.get(draftId))) return skipped('duplicate');

  const buyerName = order?.counterpartyName || p.buyer || null;
  const buyerId = order?.counterpartyId ?? p.buyerId ?? null;
  let chatId = privateChatId(deps.selfUserId, buyerId);
  if (!chatId && buyerName) {
    const chat = await db.chats.where('partnerName').equalsIgnoreCase(buyerName).first();
    chatId = chat?.id ?? null;
  }

  const vars = {
    buyer: buyerName,
    seller: deps.sellerName,
    ...clockVariables(new Date(now)),
    ...(order ? orderVariables(order) : { order_id: p.orderId }),
    chat_url: chatId ? chatUrl(chatId) : null,
  };
  const rendered = renderTemplate(body, vars);
  const text = rendered.text.trim();
  if (!text) return skipped('empty_reply');
  const lint = lintText(text, { checkVariables: false });
  const draftReason: DraftReason | null = !chatId
    ? 'unaddressable'
    : rendered.missing.length
      ? 'missing_variables'
      : hasBlockingIssue(lint)
        ? 'lint'
        : null;

  if (draftReason) {
    const draftText = rendered.missing.length
      ? renderTemplate(body, vars, { missing: 'keep' }).text.trim()
      : text;
    const res = await createAutomationDraft({
      id: draftId,
      // An unaddressable draft has no chat: the seller copies the text into the buyer's chat.
      chatId: chatId ?? '',
      triggerMessageId: null,
      text: draftText,
      now,
      meta: {
        kind: 'post_order',
        reason: draftReason,
        orderId: p.orderId,
        buyer: buyerName,
        lint: lint.map((i) => i.id),
        missing: rendered.missing,
      },
    });
    if (!res.created) return skipped('duplicate');
    await log.info({
      source: 'post-order',
      message: `Post-order draft prepared for order #${p.orderId} (${draftReason})`,
    });
    return { action: 'draft', draftId, reason: draftReason };
  }

  const quiet = quietHoursState(settings, new Date(now));
  if (quiet.active && !settings.messages.queueDuringQuietHours) return skipped('quiet_hours');
  const runAt = quiet.active ? quiet.endsAt : null;
  const { task, created: queued } = await queueMessage({
    chatId: chatId!,
    text,
    source: 'post_order',
    idempotencyKey: key,
    ...(runAt ? { runAt } : {}),
  });
  if (!queued) return skipped('duplicate');
  await log.info({ source: 'post-order', message: `Post-order message queued for order #${p.orderId}` });
  return { action: 'queued', taskId: task.id, runAt };
}
