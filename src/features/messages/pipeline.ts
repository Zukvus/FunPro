/**
 * Follow-ups after a chat history was stored:
 *  - the chat is "armed" (later customer messages without timestamps are known to be new);
 *  - a new manual seller message cancels queued automatic replies / greetings for that chat and
 *    dismisses pending automatic drafts — the seller is handling the conversation;
 *  - chats first seen after the baseline get the welcome message (if enabled).
 */
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { MessageIngestResult } from '@/features/sync/ingest';
import type { AutomationOutcome, MessagingDeps } from './automation';
import { dismissStaleAutoDrafts } from './drafts';
import { armChat, automatedTexts, isAutomatedSelfMessage, recordManualSeen } from './state';
import { maybeSendWelcome } from './welcome';

const CANCELLABLE_SOURCES = new Set(['auto_reply', 'welcome']);

/** Cancel not-yet-sent automatic replies and greetings for a chat. Returns how many were cancelled. */
export async function cancelPendingAutoReplies(
  chatId: string,
  reason: string,
  now = Date.now(),
): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.tasks, async () => {
    const tasks = await db.tasks
      .where('status')
      .anyOf(['pending', 'awaiting_tab', 'blocked'])
      .filter(
        (t) =>
          t.kind === 'send_message' &&
          t.payload['chatId'] === chatId &&
          CANCELLABLE_SOURCES.has(String(t.payload['source'])),
      )
      .toArray();
    for (const t of tasks)
      await db.tasks.update(t.id, { status: 'cancelled', lastError: reason, updatedAt: now });
    return tasks.length;
  });
}

export interface AfterHistoryResult {
  manualMessages: number;
  cancelled: number;
  welcome: AutomationOutcome | null;
}

export async function afterHistoryIngest(
  chatId: string,
  result: MessageIngestResult,
  isNewChat: boolean,
  deps: MessagingDeps,
): Promise<AfterHistoryResult> {
  const out: AfterHistoryResult = { manualMessages: 0, cancelled: 0, welcome: null };
  await armChat(chatId, deps.now);
  if (result.newSelfMessages.length) {
    const automated = await automatedTexts(chatId);
    const manual = result.newSelfMessages.filter((m) => !isAutomatedSelfMessage(m, automated));
    out.manualMessages = manual.length;
    const last = manual.at(-1);
    if (last) {
      await recordManualSeen(chatId, last.id, deps.now);
      out.cancelled = await cancelPendingAutoReplies(
        chatId,
        'Cancelled: you replied in this chat yourself',
        deps.now,
      );
      const dismissed = await dismissStaleAutoDrafts(chatId, deps.now);
      if (out.cancelled || dismissed) {
        await log.info({
          source: 'auto-reply',
          message: `You replied in chat ${chatId}: ${out.cancelled} queued automatic message(s) cancelled, ${dismissed} draft(s) dismissed`,
        });
      }
    }
  }
  if (isNewChat) out.welcome = await maybeSendWelcome(chatId, deps);
  return out;
}
