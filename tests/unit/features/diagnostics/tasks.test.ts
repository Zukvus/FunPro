import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import {
  cancelQueuedTask,
  canCancelTask,
  canRetryTask,
  retryTask,
  TaskActionError,
} from '@/features/diagnostics/tasks';
import { effectiveFlags, flagPatch, isOverridden } from '@/features/diagnostics/flags';
import type { Task } from '@/shared/models';

function task(id: string, over: Partial<Task>): Task {
  return {
    id,
    kind: 'bump',
    status: 'failed',
    idempotencyKey: id,
    payload: {},
    attempts: 3,
    maxAttempts: 3,
    nextRunAt: 0,
    lastError: 'boom',
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

beforeEach(() => {
  resetDbForTests();
});

describe('task actions', () => {
  it('retries only failed tasks of retryable kinds, with a fresh attempt budget', async () => {
    await getDb().tasks.put(task('a', {}));
    const t = await retryTask('a', 1000);
    expect(t).toMatchObject({ status: 'pending', attempts: 0, nextRunAt: 1000, lastError: null });
    expect(await getDb().tasks.get('a')).toMatchObject({ status: 'pending' });
  });

  it('never retries uncertain sends, deliveries or bulk edits', async () => {
    for (const kind of ['send_message', 'deliver', 'bulk_edit'] as const) {
      expect(canRetryTask({ kind, status: 'failed' })).toBe(false);
      await getDb().tasks.put(task(kind, { kind }));
      await expect(retryTask(kind)).rejects.toBeInstanceOf(TaskActionError);
      expect((await getDb().tasks.get(kind))!.status).toBe('failed');
    }
    expect(canRetryTask({ kind: 'bump', status: 'done' })).toBe(false);
  });

  it('cancels only tasks that have not started', async () => {
    await getDb().tasks.bulkPut([
      task('p', { status: 'pending' }),
      task('r', { status: 'running' }),
      task('w', { status: 'awaiting_tab' }),
    ]);
    expect(canCancelTask({ status: 'running' })).toBe(false);
    await cancelQueuedTask('p');
    await cancelQueuedTask('w');
    await expect(cancelQueuedTask('r')).rejects.toMatchObject({ code: 'not_cancellable' });
    expect((await getDb().tasks.toArray()).map((t) => [t.id, t.status]).sort()).toEqual([
      ['p', 'cancelled'],
      ['r', 'running'],
      ['w', 'cancelled'],
    ]);
    await expect(cancelQueuedTask('missing')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('feature flags', () => {
  it('applies overrides but keeps locked flags off', () => {
    expect(effectiveFlags({})['commandPalette']).toBe(true);
    expect(effectiveFlags({ commandPalette: false })['commandPalette']).toBe(false);
    expect(effectiveFlags({ nicknameSync: true })['nicknameSync']).toBe(false);
    expect(flagPatch('nicknameSync', true)).toEqual({ nicknameSync: false });
    expect(isOverridden('commandPalette', { commandPalette: true })).toBe(false);
    expect(isOverridden('commandPalette', { commandPalette: false })).toBe(true);
  });
});
