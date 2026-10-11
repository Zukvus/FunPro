import type { Task, TaskKind, TaskStatus } from '@/shared/models';
import { getDb } from '../db/db';
import { newId } from '../util/id';
import { backoffDelay } from '../util/async';

/**
 * Durable task queue backed by IndexedDB. Designed for MV3: the service worker may be killed at
 * any moment, so every state transition is persisted before and after work is attempted.
 *
 * Tasks stuck in `running` for longer than RUNNING_LEASE_MS (worker died mid-task) are recovered:
 * - idempotent kinds are re-queued;
 * - non-idempotent kinds that may have reached FunPay (send_message, deliver) are marked `failed`
 *   with an "uncertain outcome" error and are never retried automatically.
 */
export const RUNNING_LEASE_MS = 5 * 60_000;

export const NON_RETRYABLE_ON_CRASH: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'send_message',
  'deliver',
  'bulk_edit',
]);

export interface EnqueueOptions {
  kind: TaskKind;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
  runAt?: number;
  maxAttempts?: number;
}

export async function enqueue(opts: EnqueueOptions): Promise<{ task: Task; created: boolean }> {
  const db = getDb();
  return db.transaction('rw', db.tasks, async () => {
    const existing = await db.tasks.where('idempotencyKey').equals(opts.idempotencyKey).first();
    if (existing) return { task: existing, created: false };
    const now = Date.now();
    const task: Task = {
      id: newId('task'),
      kind: opts.kind,
      status: 'pending',
      idempotencyKey: opts.idempotencyKey,
      payload: opts.payload ?? {},
      attempts: 0,
      maxAttempts: opts.maxAttempts ?? 3,
      nextRunAt: opts.runAt ?? now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.tasks.add(task);
    return { task, created: true };
  });
}

/** Atomically claim due tasks (pending/awaiting_tab whose nextRunAt has passed). */
export async function claimDueTasks(
  now = Date.now(),
  limit = 10,
  kinds?: readonly TaskKind[],
): Promise<Task[]> {
  const db = getDb();
  return db.transaction('rw', db.tasks, async () => {
    const due = await db.tasks
      .where('nextRunAt')
      .belowOrEqual(now)
      .filter(
        (t) => (t.status === 'pending' || t.status === 'awaiting_tab') && (!kinds || kinds.includes(t.kind)),
      )
      .limit(limit)
      .toArray();
    for (const t of due) {
      t.status = 'running';
      t.attempts += 1;
      t.updatedAt = now;
      await db.tasks.put(t);
    }
    return due;
  });
}

export async function completeTask(id: string): Promise<void> {
  await getDb().tasks.update(id, { status: 'done', updatedAt: Date.now(), lastError: null });
}

/** Record a failure; retries with exponential backoff until maxAttempts. */
export async function failTask(
  id: string,
  error: string,
  opts: { retryable?: boolean; now?: number } = {},
): Promise<Task | undefined> {
  const db = getDb();
  const now = opts.now ?? Date.now();
  return db.transaction('rw', db.tasks, async () => {
    const t = await db.tasks.get(id);
    if (!t) return undefined;
    const retry = (opts.retryable ?? true) && t.attempts < t.maxAttempts;
    const next: Task = {
      ...t,
      status: retry ? 'pending' : 'failed',
      lastError: error.slice(0, 500),
      nextRunAt: retry ? now + backoffDelay(t.attempts) : t.nextRunAt,
      updatedAt: now,
    };
    await db.tasks.put(next);
    return next;
  });
}

/** Put a task back without consuming an attempt (e.g. no FunPay tab is open, or rate limited). */
export async function deferTask(
  id: string,
  status: Extract<TaskStatus, 'awaiting_tab' | 'pending' | 'blocked'>,
  delayMs: number,
  reason: string,
): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.tasks, async () => {
    const t = await db.tasks.get(id);
    if (!t) return;
    await db.tasks.put({
      ...t,
      status,
      attempts: Math.max(0, t.attempts - 1),
      nextRunAt: Date.now() + delayMs,
      lastError: reason.slice(0, 500),
      updatedAt: Date.now(),
    });
  });
}

export async function cancelTask(id: string): Promise<void> {
  await getDb().tasks.update(id, { status: 'cancelled', updatedAt: Date.now() });
}

/** Cancel every not-yet-started task (used by the emergency stop). */
export async function cancelPendingTasks(): Promise<number> {
  const db = getDb();
  return db.tasks
    .where('status')
    .anyOf(['pending', 'awaiting_tab', 'blocked'])
    .modify({ status: 'cancelled', updatedAt: Date.now(), lastError: 'Cancelled by emergency stop' });
}

export async function recoverStaleTasks(now = Date.now()): Promise<{ requeued: number; uncertain: number }> {
  const db = getDb();
  let requeued = 0;
  let uncertain = 0;
  await db.transaction('rw', db.tasks, async () => {
    const stale = await db.tasks
      .where('status')
      .equals('running')
      .filter((t) => now - t.updatedAt > RUNNING_LEASE_MS)
      .toArray();
    for (const t of stale) {
      if (NON_RETRYABLE_ON_CRASH.has(t.kind)) {
        uncertain++;
        await db.tasks.put({
          ...t,
          status: 'failed',
          lastError:
            'Outcome uncertain: the extension stopped while this task was running. Check FunPay manually.',
          updatedAt: now,
        });
      } else {
        requeued++;
        await db.tasks.put({ ...t, status: 'pending', nextRunAt: now, updatedAt: now });
      }
    }
  });
  return { requeued, uncertain };
}

export async function pruneTasks(now = Date.now(), keepMs = 7 * 24 * 3600_000): Promise<number> {
  return getDb()
    .tasks.where('status')
    .anyOf(['done', 'cancelled', 'failed'])
    .filter((t) => now - t.updatedAt > keepMs)
    .delete();
}
