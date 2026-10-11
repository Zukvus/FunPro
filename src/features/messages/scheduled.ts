/**
 * Scheduled messages: the seller picks a chat, a text and a time. They are stored as drafts with
 * `source: 'scheduled'` and `sendAt`; at the due time the background tick hands them to the outbox
 * (source 'scheduled'). The emergency stop always wins: nothing is queued while it is active, and
 * messages that are more than SCHEDULE_GRACE_MS late are never sent automatically.
 *
 * Lifecycle (DraftReply.status): scheduling IS the seller's approval, so a waiting message is
 * `approved` without `meta.taskId` (it never shows up as a "pending draft to review");
 * `approved` + `meta.taskId` = handed to the outbox; then `sent`, `failed` or `dismissed`.
 */
import { z } from 'zod';
import { getDb, type DraftReply } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { newId } from '@/core/util/id';
import { isValidChatId } from './context';
import { MAX_MESSAGE_LENGTH, outboxTaskKey, queueMessage } from './outbox';

/** A scheduled message that is this late (browser closed, emergency stop…) needs the seller's review. */
export const SCHEDULE_GRACE_MS = 6 * 3600_000;
export const SCHEDULE_MAX_AHEAD_MS = 365 * 24 * 3600_000;

export class ScheduleError extends Error {
  constructor(readonly code: 'invalid_chat' | 'invalid_text' | 'in_past' | 'too_far' | 'not_found' | 'not_editable') {
    super(code);
    this.name = 'ScheduleError';
  }
}

const TextSchema = z.string().trim().min(1).max(MAX_MESSAGE_LENGTH);

function validate(chatId: string, text: string, sendAt: number, now: number): string {
  if (!isValidChatId(chatId)) throw new ScheduleError('invalid_chat');
  const t = TextSchema.safeParse(text);
  if (!t.success) throw new ScheduleError('invalid_text');
  if (!Number.isFinite(sendAt) || sendAt < now - 60_000) throw new ScheduleError('in_past');
  if (sendAt > now + SCHEDULE_MAX_AHEAD_MS) throw new ScheduleError('too_far');
  return t.data;
}

/** Scheduled and not yet handed to the outbox. */
export function isWaiting(d: DraftReply): boolean {
  return d.source === 'scheduled' && d.status === 'approved' && typeof d.meta?.['taskId'] !== 'string';
}

export function scheduledKey(draftId: string): string {
  return `scheduled:${draftId}`;
}

export async function scheduleMessage(input: { chatId: string; text: string; sendAt: number; now?: number }): Promise<DraftReply> {
  const now = input.now ?? Date.now();
  const text = validate(input.chatId, input.text, input.sendAt, now);
  const draft: DraftReply = {
    id: newId('sched'),
    chatId: input.chatId,
    triggerMessageId: null,
    source: 'scheduled',
    text,
    status: 'approved',
    createdAt: now,
    updatedAt: now,
    sendAt: input.sendAt,
    meta: {},
  };
  await getDb().drafts.add(draft);
  return draft;
}

export async function updateScheduled(id: string, patch: { text?: string; sendAt?: number }, now = Date.now()): Promise<void> {
  const db = getDb();
  const d = await db.drafts.get(id);
  if (!d || d.source !== 'scheduled') throw new ScheduleError('not_found');
  if (!isWaiting(d) && d.status !== 'failed') throw new ScheduleError('not_editable');
  const sendAt = patch.sendAt ?? d.sendAt ?? now;
  const text = validate(d.chatId, patch.text ?? d.text, sendAt, now);
  // Re-scheduling a failed message is allowed; `attempt` (kept in meta) gives it a fresh outbox key.
  await db.drafts.update(id, { text, sendAt, status: 'approved', updatedAt: now, meta: { ...(d.meta ?? {}), error: undefined, blocked: undefined, taskId: undefined } });
}

export interface ScheduledRunResult {
  queued: string[];
  /** Due but held back (emergency stop). */
  blocked: string[];
  /** Too late to send automatically; marked failed for review. */
  missed: string[];
}

/**
 * Queue due scheduled messages. Also reconciles drafts whose outbox task was cancelled or failed
 * without the outbox updating the draft (e.g. cancelled by the emergency stop).
 */
export async function processDueScheduled(deps: { settings: Settings; now: number }): Promise<ScheduledRunResult> {
  const db = getDb();
  const { now, settings } = deps;
  const res: ScheduledRunResult = { queued: [], blocked: [], missed: [] };
  const due = await db.drafts
    .where('sendAt')
    .belowOrEqual(now)
    .filter(isWaiting)
    .toArray();
  for (const d of due) {
    if (now - (d.sendAt ?? now) > SCHEDULE_GRACE_MS) {
      await db.drafts.update(d.id, { status: 'failed', updatedAt: now, meta: { ...(d.meta ?? {}), error: 'missed' } });
      res.missed.push(d.id);
      continue;
    }
    if (settings.automation.state === 'stopped') {
      if (d.meta?.['blocked'] !== 'emergency_stop') await db.drafts.update(d.id, { updatedAt: now, meta: { ...(d.meta ?? {}), blocked: 'emergency_stop' } });
      res.blocked.push(d.id);
      continue;
    }
    // A re-scheduled failed message must not collide with its previous outbox key.
    const attempt = typeof d.meta?.['attempt'] === 'number' ? (d.meta['attempt'] as number) : 0;
    const key = scheduledKey(attempt ? `${d.id}:${attempt}` : d.id);
    const { task } = await queueMessage({ chatId: d.chatId, text: d.text, source: 'scheduled', idempotencyKey: key, draftId: d.id });
    await db.drafts.update(d.id, { status: 'approved', updatedAt: now, meta: { ...(d.meta ?? {}), blocked: undefined, taskId: task.id, attempt: attempt + 1 } });
    res.queued.push(d.id);
  }
  if (res.queued.length) await log.info({ source: 'scheduled', message: `${res.queued.length} scheduled message(s) handed to the outbox` });
  if (res.missed.length) await log.warn({ source: 'scheduled', message: `${res.missed.length} scheduled message(s) missed their time and were not sent`, hint: 'Review them in Messages → Drafts & scheduled.' });
  await reconcileScheduled(now);
  return res;
}

/** Drafts handed to the outbox whose task ended without the outbox updating the draft. */
export async function reconcileScheduled(now = Date.now()): Promise<number> {
  const db = getDb();
  const inFlight = await db.drafts
    .where('status')
    .equals('approved')
    .filter((d) => d.source === 'scheduled' && typeof d.meta?.['taskId'] === 'string')
    .toArray();
  let changed = 0;
  for (const d of inFlight) {
    const taskId = typeof d.meta?.['taskId'] === 'string' ? (d.meta['taskId'] as string) : null;
    const task = taskId ? await db.tasks.get(taskId) : await db.tasks.where('idempotencyKey').equals(outboxTaskKey(scheduledKey(d.id))).first();
    if (!task) continue;
    if (task.status === 'done') {
      await db.drafts.update(d.id, { status: 'sent', updatedAt: now });
      changed++;
    } else if (task.status === 'cancelled' || task.status === 'failed') {
      await db.drafts.update(d.id, { status: 'failed', updatedAt: now, meta: { ...(d.meta ?? {}), error: task.lastError ?? task.status } });
      changed++;
    }
  }
  return changed;
}
