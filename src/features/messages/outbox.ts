/**
 * Outbox: every message FunPro sends goes through the durable task queue (`send_message` tasks).
 * This gives a single place for rate limiting, emergency stop, idempotency and audit.
 *
 * Idempotency: callers pass a deterministic key (e.g. `delivery:<orderId>`, `autoreply:<chatId>:<msgId>`)
 * so the same logical message can never be queued twice.
 */
import { getDb } from '@/core/db/db';
import { enqueue } from '@/core/queue/queue';
import { lintOutgoingText } from '@/core/security/sanitize';
import type { Task } from '@/shared/models';

export type OutboxSource = 'manual' | 'auto_reply' | 'welcome' | 'post_order' | 'delivery' | 'workflow' | 'scheduled' | 'ai';

export interface OutgoingMessage {
  chatId: string;
  text: string;
  source: OutboxSource;
  idempotencyKey: string;
  /** Rule / draft / order that produced the message (for the reply ledger). */
  ruleId?: string;
  triggerMessageId?: string | null;
  draftId?: string;
  runAt?: number;
}

export const MAX_MESSAGE_LENGTH = 2000;

export async function queueMessage(msg: OutgoingMessage): Promise<{ task: Task; created: boolean }> {
  const text = msg.text.trim();
  if (!text) throw new Error('Message is empty');
  if (text.length > MAX_MESSAGE_LENGTH) throw new Error(`Message exceeds ${MAX_MESSAGE_LENGTH} characters`);
  return enqueue({
    kind: 'send_message',
    idempotencyKey: `msg:${msg.idempotencyKey}`,
    // Sending a chat message is not idempotent on FunPay's side, so it is attempted at most once
    // automatically; failures surface to the user instead of being retried blindly.
    maxAttempts: 1,
    runAt: msg.runAt,
    payload: {
      chatId: msg.chatId,
      text,
      source: msg.source,
      ruleId: msg.ruleId ?? null,
      triggerMessageId: msg.triggerMessageId ?? null,
      draftId: msg.draftId ?? null,
      contactWarnings: lintOutgoingText(text),
    },
  });
}

/** Sliding-window limiter state for automatic sends (manual sends are not limited). */
export const AUTO_SEND_LIMIT = { max: 15, windowMs: 10 * 60_000, gapMs: 3000 };

export async function countRecentAutoSends(now = Date.now()): Promise<number> {
  return getDb()
    .replyLedger.where('at')
    .above(now - AUTO_SEND_LIMIT.windowMs)
    .count();
}
