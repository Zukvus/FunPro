import { getDb } from '@/core/db/db';
import { NON_RETRYABLE_ON_CRASH } from '@/core/queue/queue';
import type { Task, TaskKind, TaskStatus } from '@/shared/models';

/**
 * Task kinds whose outcome may already have reached FunPay when they fail (a chat message, a
 * delivery, a bulk edit). They are NEVER retried from the log viewer: the user must check FunPay
 * and act manually. Same set the queue uses for crash recovery.
 */
export const NON_RETRYABLE_TASK_KINDS: ReadonlySet<TaskKind> = NON_RETRYABLE_ON_CRASH;

export const CANCELLABLE_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'pending',
  'awaiting_tab',
  'blocked',
]);

export function canRetryTask(t: Pick<Task, 'kind' | 'status'>): boolean {
  return t.status === 'failed' && !NON_RETRYABLE_TASK_KINDS.has(t.kind);
}

export function canCancelTask(t: Pick<Task, 'status'>): boolean {
  return CANCELLABLE_STATUSES.has(t.status);
}

export class TaskActionError extends Error {
  constructor(readonly code: 'not_found' | 'not_retryable' | 'not_cancellable') {
    super(code);
    this.name = 'TaskActionError';
  }
}

/** Manually re-queue a failed, retryable task (fresh attempt budget). */
export async function retryTask(id: string, now = Date.now()): Promise<Task> {
  const db = getDb();
  return db.transaction('rw', db.tasks, async () => {
    const t = await db.tasks.get(id);
    if (!t) throw new TaskActionError('not_found');
    if (!canRetryTask(t)) throw new TaskActionError('not_retryable');
    const next: Task = {
      ...t,
      status: 'pending',
      attempts: 0,
      nextRunAt: now,
      lastError: null,
      updatedAt: now,
    };
    await db.tasks.put(next);
    return next;
  });
}

/** Cancel a task that has not started yet. Running tasks cannot be cancelled (they may be mid-request). */
export async function cancelQueuedTask(id: string, now = Date.now()): Promise<Task> {
  const db = getDb();
  return db.transaction('rw', db.tasks, async () => {
    const t = await db.tasks.get(id);
    if (!t) throw new TaskActionError('not_found');
    if (!canCancelTask(t)) throw new TaskActionError('not_cancellable');
    const next: Task = { ...t, status: 'cancelled', lastError: 'Cancelled by user', updatedAt: now };
    await db.tasks.put(next);
    return next;
  });
}
