import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { approveDraft, dismissDraft, dismissStaleAutoDrafts, DraftError, isChatDraft, isSendable, updateDraftText } from '@/features/messages/drafts';
import { processDueScheduled, reconcileScheduled, scheduleMessage, SCHEDULE_GRACE_MS, ScheduleError, updateScheduled } from '@/features/messages/scheduled';
import { CHAT, NOW, runningSettings, sendTasks } from './helpers';

beforeEach(() => {
  resetDbForTests();
});

describe('scheduled messages', () => {
  it('validates input', async () => {
    await expect(scheduleMessage({ chatId: 'bad id!', text: 'x', sendAt: NOW + 1000, now: NOW })).rejects.toBeInstanceOf(ScheduleError);
    await expect(scheduleMessage({ chatId: CHAT, text: '   ', sendAt: NOW + 1000, now: NOW })).rejects.toMatchObject({ code: 'invalid_text' });
    await expect(scheduleMessage({ chatId: CHAT, text: 'x', sendAt: NOW - 3600_000, now: NOW })).rejects.toMatchObject({ code: 'in_past' });
    await expect(scheduleMessage({ chatId: CHAT, text: 'x', sendAt: NOW + 400 * 86400_000, now: NOW })).rejects.toMatchObject({ code: 'too_far' });
  });

  it('queues a message only when it is due, with source "scheduled" and the draft id', async () => {
    const d = await scheduleMessage({ chatId: CHAT, text: ' Reminder ', sendAt: NOW + 3600_000, now: NOW });
    // Scheduling is the approval: it never counts as a pending draft to review.
    expect(d).toMatchObject({ source: 'scheduled', status: 'approved', text: 'Reminder' });
    expect(await getDb().drafts.where('status').equals('pending').count()).toBe(0);
    expect(await processDueScheduled({ settings: runningSettings(), now: NOW })).toEqual({ queued: [], blocked: [], missed: [] });
    const res = await processDueScheduled({ settings: runningSettings(), now: NOW + 3600_000 });
    expect(res.queued).toEqual([d.id]);
    const tasks = await sendTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.idempotencyKey).toBe(`msg:scheduled:${d.id}`);
    expect(tasks[0]!.payload).toMatchObject({ chatId: CHAT, text: 'Reminder', source: 'scheduled', draftId: d.id });
    expect((await getDb().drafts.get(d.id))!.meta).toMatchObject({ taskId: tasks[0]!.id });
    // Running again does not queue twice.
    await processDueScheduled({ settings: runningSettings(), now: NOW + 3700_000 });
    expect(await sendTasks()).toHaveLength(1);
  });

  it('is held back by the emergency stop, and sent after it is lifted', async () => {
    const d = await scheduleMessage({ chatId: CHAT, text: 'Hi', sendAt: NOW, now: NOW });
    const stopped = runningSettings({ automation: { state: 'stopped' } });
    expect((await processDueScheduled({ settings: stopped, now: NOW + 1000 })).blocked).toEqual([d.id]);
    expect(await sendTasks()).toHaveLength(0);
    expect((await getDb().drafts.get(d.id))!.meta).toMatchObject({ blocked: 'emergency_stop' });
    expect((await processDueScheduled({ settings: runningSettings(), now: NOW + 2000 })).queued).toEqual([d.id]);
  });

  it('never sends a message that is too late automatically', async () => {
    const d = await scheduleMessage({ chatId: CHAT, text: 'Hi', sendAt: NOW, now: NOW });
    const res = await processDueScheduled({ settings: runningSettings(), now: NOW + SCHEDULE_GRACE_MS + 1 });
    expect(res.missed).toEqual([d.id]);
    expect(await getDb().drafts.get(d.id)).toMatchObject({ status: 'failed', meta: { error: 'missed' } });
    expect(await sendTasks()).toHaveLength(0);
  });

  it('reconciles drafts whose task was cancelled (emergency stop) and allows re-scheduling', async () => {
    const d = await scheduleMessage({ chatId: CHAT, text: 'Hi', sendAt: NOW, now: NOW });
    await processDueScheduled({ settings: runningSettings(), now: NOW });
    const task = (await sendTasks())[0]!;
    await getDb().tasks.update(task.id, { status: 'cancelled', lastError: 'Cancelled by emergency stop' });
    expect(await reconcileScheduled(NOW + 1000)).toBe(1);
    expect(await getDb().drafts.get(d.id)).toMatchObject({ status: 'failed', meta: { error: 'Cancelled by emergency stop' } });

    await updateScheduled(d.id, { sendAt: NOW + 60_000 }, NOW + 1000);
    await processDueScheduled({ settings: runningSettings(), now: NOW + 60_000 });
    const keys = (await sendTasks()).map((t) => t.idempotencyKey).sort();
    expect(keys).toEqual([`msg:scheduled:${d.id}`, `msg:scheduled:${d.id}:1`]);
  });

  it('marks drafts sent when the outbox completed the task', async () => {
    const d = await scheduleMessage({ chatId: CHAT, text: 'Hi', sendAt: NOW, now: NOW });
    await processDueScheduled({ settings: runningSettings(), now: NOW });
    await getDb().tasks.update((await sendTasks())[0]!.id, { status: 'done' });
    await reconcileScheduled(NOW + 1);
    expect((await getDb().drafts.get(d.id))!.status).toBe('sent');
    await expect(updateScheduled(d.id, { text: 'x' })).rejects.toMatchObject({ code: 'not_editable' });
  });
});

describe('drafts inbox', () => {
  const base = { triggerMessageId: null, createdAt: NOW, updatedAt: NOW, sendAt: null };

  it('approves, edits and dismisses chat drafts', async () => {
    await getDb().drafts.add({ ...base, id: 'd1', chatId: CHAT, source: 'auto_reply', text: 'Hello', status: 'pending', meta: { kind: 'auto_reply' } });
    await updateDraftText('d1', ' Hello there ');
    const approved = await approveDraft('d1');
    expect(approved).toMatchObject({ status: 'approved', text: 'Hello there' });
    await expect(updateDraftText('d1', 'x')).rejects.toBeInstanceOf(DraftError);
    await getDb().drafts.add({ ...base, id: 'd2', chatId: CHAT, source: 'ai', text: 'x', status: 'pending' });
    await dismissDraft('d2');
    expect((await getDb().drafts.get('d2'))!.status).toBe('dismissed');
  });

  it('separates chat drafts from review/delivery drafts and unaddressable ones', () => {
    const d = (over: object) => ({ ...base, id: 'x', chatId: CHAT, source: 'auto_reply' as const, text: 'Hi', status: 'pending' as const, ...over });
    expect(isChatDraft(d({}))).toBe(true);
    expect(isChatDraft(d({ source: 'review' }))).toBe(false);
    expect(isChatDraft(d({ source: 'delivery' }))).toBe(false);
    expect(isSendable(d({}))).toBe(true);
    expect(isSendable(d({ chatId: '' }))).toBe(false);
  });

  it('dismisses stale automatic drafts when the seller replied manually', async () => {
    await getDb().drafts.add({ ...base, id: 'a1', chatId: CHAT, source: 'auto_reply', text: 'x', status: 'pending', meta: { kind: 'auto_reply' } });
    await getDb().drafts.add({ ...base, id: 'p1', chatId: CHAT, source: 'auto_reply', text: 'x', status: 'pending', meta: { kind: 'post_order' } });
    expect(await dismissStaleAutoDrafts(CHAT, NOW)).toBe(1);
    expect((await getDb().drafts.get('a1'))!.status).toBe('dismissed');
    expect((await getDb().drafts.get('p1'))!.status).toBe('pending');
  });
});
