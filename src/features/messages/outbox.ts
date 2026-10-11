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

export type OutboxSource =
  'manual' | 'auto_reply' | 'welcome' | 'post_order' | 'delivery' | 'workflow' | 'scheduled' | 'ai';

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

/** The task idempotency key `queueMessage` stores for a message key (for lookups by callers). */
export function outboxTaskKey(idempotencyKey: string): string {
  return `msg:${idempotencyKey}`;
}

/**
 * Draft sends from the UI. The first attempt uses `manual:<draftId>`; an explicit re-send after a
 * failure uses `manual:<draftId>:r<n>`, so a draft can never be sent twice by accident (the same key
 * is deduplicated) but can be sent again when the seller deliberately retries.
 */
export function draftSendKey(draftId: string, attempt = 0): string {
  return attempt === 0 ? `manual:${draftId}` : `manual:${draftId}:r${attempt}`;
}

/** All outbox tasks created for sending a draft, oldest first. */
export async function draftSendTasks(draftId: string): Promise<Task[]> {
  const base = outboxTaskKey(draftSendKey(draftId));
  const tasks = await getDb().tasks.where('idempotencyKey').startsWith(base).toArray();
  return tasks
    .filter((t) => t.idempotencyKey === base || /^:r\d+$/.test(t.idempotencyKey.slice(base.length)))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The most recent send attempt for a draft (or undefined if it was never handed to the outbox). */
export async function latestDraftSendTask(draftId: string): Promise<Task | undefined> {
  return (await draftSendTasks(draftId)).at(-1);
}

/** Errors recorded when a send may or may not have reached FunPay. */
export function isUncertainSendError(error: string | null | undefined): boolean {
  return !!error && /uncertain/i.test(error);
}
