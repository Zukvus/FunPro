/**
 * Shared guard for any automatic chat message that is not an auto-reply rule (e.g. workflow
 * `send_reply`). It applies the same conversational safety rules as auto-replies so automations
 * never talk over the seller or flood a buyer:
 *  - the seller already answered after the trigger message;
 *  - the seller wrote manually in this chat recently (pause window);
 *  - the per-chat hourly cap of automatic messages is reached;
 *  - quiet hours are active.
 * Callers turn a blocked send into a draft for the seller to review.
 */
import { getDb } from '@/core/db/db';
import type { Settings } from '@/core/settings/schema';
import { compareIds } from '@/features/sync/ingest';
import { lastManualMessageAt } from './autoReply';
import { quietHoursState } from './automation';
import { chatMessages } from './context';

export type ReplyBlockReason = 'seller_replied' | 'manual_pause' | 'chat_hourly_cap' | 'quiet_hours';

export async function unattendedReplyBlocker(
  chatId: string,
  triggerMessageId: string | null,
  settings: Settings,
  now = Date.now(),
): Promise<ReplyBlockReason | null> {
  const history = await chatMessages(chatId);
  if (triggerMessageId && history.some((m) => m.kind === 'self' && compareIds(m.id, triggerMessageId) > 0)) {
    return 'seller_replied';
  }
  const pauseMs = settings.messages.pauseAfterManualReplyMin * 60_000;
  if (pauseMs > 0) {
    const manual = await lastManualMessageAt(chatId, history);
    if (manual !== null && now - manual < pauseMs) return 'manual_pause';
  }
  const lastHour = await getDb()
    .replyLedger.where('[chatId+at]')
    .between([chatId, now - 3600_000], [chatId, now + 1])
    .count();
  if (lastHour >= settings.messages.maxAutoRepliesPerChatPerHour) return 'chat_hourly_cap';
  if (quietHoursState(settings, new Date(now)).active) return 'quiet_hours';
  return null;
}
