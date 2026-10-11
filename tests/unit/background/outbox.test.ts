import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { updateSettings } from '@/core/settings/store';
import { queueMessage, type OutboxSource } from '@/features/messages/outbox';
import { clearSinksForTests } from '@/features/notifications/notify';

const exec = vi.fn();

class FakeNoTab extends Error {}

vi.mock('@/background/tabs', () => ({
  execInFunPayTab: (cmd: unknown) => exec(cmd),
  NoFunPayTabError: FakeNoTab,
  getLastSession: async () => null,
}));
vi.mock('@/background/core-handlers', () => ({
  automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
}));

const { processOutbox, outboxModule, isAutomatedSource, isUnattendedSource } =
  await import('@/background/modules/outbox');
const { dispatch } = await import('@/background/router');
const { browser } = await import('wxt/browser');

let clock = Date.parse('2024-11-05T12:00:00Z');

beforeEach(async () => {
  resetDbForTests();
  clearSinksForTests();
  exec.mockReset();
  exec.mockResolvedValue({ ok: true });
  clock += 3600_000; // keep the module's 3 s send gap from leaking between tests
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  await updateSettings({
    automation: { state: 'running', liveActionsAcknowledged: true, autoReply: true, welcomeMessage: true },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

async function queue(
  source: OutboxSource,
  key: string,
  extra: Partial<Parameters<typeof queueMessage>[0]> = {},
) {
  return (
    await queueMessage({ chatId: 'users-1-2', text: `hello ${key}`, source, idempotencyKey: key, ...extra })
  ).task;
}

async function task(id: string) {
  return (await getDb().tasks.get(id))!;
}

function advance(ms: number) {
  clock += ms;
  vi.setSystemTime(clock);
}

describe('source classification', () => {
  it('treats scheduled messages as unattended but not automated', () => {
    expect(isAutomatedSource('auto_reply')).toBe(true);
    expect(isAutomatedSource('scheduled')).toBe(false);
    expect(isUnattendedSource('scheduled')).toBe(true);
    expect(isUnattendedSource('manual')).toBe(false);
    expect(isUnattendedSource('ai')).toBe(false);
  });
});

describe('processOutbox', () => {
  it('sends a manual message once and records completion', async () => {
    const t = await queue('manual', 'm1');
    await processOutbox();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec.mock.calls[0]![0]).toMatchObject({
      action: 'sendMessage',
      chatId: 'users-1-2',
      text: 'hello m1',
    });
    expect((await task(t.id)).status).toBe('done');
    await processOutbox();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('emergency stop blocks automated and scheduled sends but not manual ones', async () => {
    await updateSettings({ automation: { state: 'stopped' } });
    const auto = await queue('auto_reply', 'a1');
    const sched = await queue('scheduled', 's1');
    const manual = await queue('manual', 'm1');
    await processOutbox();
    expect(await task(auto.id)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/emergency stop/i),
    });
    expect(await task(sched.id)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/emergency stop/i),
    });
    expect((await task(manual.id)).status).toBe('done');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('pause holds automated sends but not the seller’s scheduled messages', async () => {
    await updateSettings({ automation: { state: 'paused' } });
    const auto = await queue('auto_reply', 'a1');
    const sched = await queue('scheduled', 's1');
    await processOutbox();
    expect((await task(auto.id)).status).toBe('blocked');
    expect((await task(sched.id)).status).toBe('done');
  });

  it('does not send automated messages that are not authorised or disabled', async () => {
    await updateSettings({ automation: { liveActionsAcknowledged: false } });
    const auto = await queue('auto_reply', 'a1');
    await processOutbox();
    expect(await task(auto.id)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/Not sent/),
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('enforces the unattended send window limit', async () => {
    const now = Date.now();
    await getDb().replyLedger.bulkAdd(
      Array.from({ length: 15 }, (_, i) => ({
        id: `x${i}`,
        chatId: 'c',
        ruleId: 'r',
        at: now - 1000,
        text: '',
      })),
    );
    const auto = await queue('auto_reply', 'a1');
    await processOutbox();
    expect(await task(auto.id)).toMatchObject({
      status: 'pending',
      lastError: expect.stringMatching(/limit/),
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it('spaces consecutive automatic sends', async () => {
    const a = await queue('auto_reply', 'a1');
    const b = await queue('welcome', 'w1');
    await processOutbox();
    expect((await task(a.id)).status).toBe('done');
    expect(await task(b.id)).toMatchObject({
      status: 'pending',
      lastError: expect.stringMatching(/Spacing/),
    });
    advance(5000);
    await processOutbox();
    expect((await task(b.id)).status).toBe('done');
  });

  it('waits for a FunPay tab without consuming the attempt', async () => {
    exec.mockRejectedValueOnce(new FakeNoTab('no tab'));
    const t = await queue('manual', 'm1');
    await processOutbox();
    expect(await task(t.id)).toMatchObject({ status: 'awaiting_tab', attempts: 0 });
  });

  it('never retries a send whose outcome is uncertain', async () => {
    exec.mockRejectedValueOnce(new Error('connection reset'));
    const t = await queue('manual', 'm1');
    await processOutbox();
    expect(await task(t.id)).toMatchObject({
      status: 'failed',
      lastError: expect.stringMatching(/uncertain/i),
    });
    advance(24 * 3600_000);
    await processOutbox();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('pauses on FunPay flood protection instead of failing', async () => {
    exec.mockResolvedValueOnce({
      ok: false,
      error: 'Нельзя отправлять сообщения слишком часто.',
      flood: true,
    });
    const t = await queue('manual', 'm1');
    await processOutbox();
    expect(await task(t.id)).toMatchObject({ status: 'pending', lastError: expect.stringMatching(/flood/i) });
  });

  it('records automated sends in the reply ledger', async () => {
    await queue('auto_reply', 'a1', { ruleId: 'r1', triggerMessageId: '99' });
    await processOutbox();
    expect(await getDb().replyLedger.get('users-1-2:99:r1')).toBeTruthy();
  });
});

describe('ui.sendMessage with drafts', () => {
  beforeEach(() => {
    outboxModule.register();
  });

  async function send(params: Record<string, unknown>) {
    return dispatch({ __funpro: 1, method: 'ui.sendMessage', params }, { id: browser.runtime.id });
  }

  async function addDraft(id: string) {
    await getDb().drafts.add({
      id,
      chatId: 'users-1-2',
      triggerMessageId: null,
      source: 'ai',
      text: 'hi',
      status: 'approved',
      createdAt: 0,
      updatedAt: 0,
      sendAt: null,
    });
  }

  it('does not send the same draft twice', async () => {
    await addDraft('d1');
    expect(await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd1' })).toMatchObject({
      ok: true,
      data: { status: 'done' },
    });
    expect(await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd1' })).toMatchObject({
      ok: true,
      data: { alreadySent: true },
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect((await getDb().drafts.get('d1'))!.status).toBe('sent');
  });

  it('allows an explicit re-send after a definite failure', async () => {
    await addDraft('d2');
    exec.mockResolvedValueOnce({ ok: false, error: 'Chat not found', flood: false });
    expect(await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd2' })).toMatchObject({
      ok: true,
      data: { status: 'failed' },
    });
    expect(await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd2' })).toMatchObject({
      ok: true,
      data: { status: 'done' },
    });
    expect(exec).toHaveBeenCalledTimes(2);
    const keys = (await getDb().tasks.toArray()).map((t) => t.idempotencyKey).sort();
    expect(keys).toEqual(['msg:manual:d2', 'msg:manual:d2:r1']);
  });

  it('requires confirmation to re-send after an uncertain outcome', async () => {
    await addDraft('d3');
    exec.mockRejectedValueOnce(new Error('tab closed mid-request'));
    await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd3' });
    expect(await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd3' })).toMatchObject({
      ok: false,
      code: 'uncertain_previous_attempt',
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(await send({ chatId: 'users-1-2', text: 'hi', draftId: 'd3', confirmResend: true })).toMatchObject(
      { ok: true, data: { status: 'done' } },
    );
    expect(exec).toHaveBeenCalledTimes(2);
  });
});
