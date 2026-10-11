import { beforeEach, describe, expect, it } from 'vitest';
import { funpayParser } from '@/adapters/funpay';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, onEvent } from '@/core/events/bus';
import type { ContentCommand } from '@/core/messaging/protocol';
import { handleMessageReceived } from '@/features/messages/autoReply';
import {
  drainHistoryQueue,
  fetchChatHistory,
  readSyncStatus,
  resetChatSyncStateForTests,
  syncChats,
  type ChatSyncDeps,
} from '@/features/messages/chatSync';
import { queueMessage } from '@/features/messages/outbox';
import { afterHistoryIngest, cancelPendingAutoReplies } from '@/features/messages/pipeline';
import type { ChatMessage } from '@/shared/models';
import { fixtureDoc, loadFixture } from '../../../fixtures';
import { CHAT, deps, msg, NOW, rule, runningSettings, seedMessages, seedRules, sendTasks } from './helpers';

class NoTab extends Error {}

interface FakeFunPay {
  list: {
    id: string;
    partnerName: string;
    partnerId: null;
    lastMessageText: string;
    lastMessageAt: string | null;
    unread: boolean;
  }[];
  histories: Record<string, ChatMessage[]>;
  noTab: boolean;
  calls: ContentCommand[];
}

function fake(): FakeFunPay {
  return { list: [], histories: {}, noTab: false, calls: [] };
}

function syncDeps(fp: FakeFunPay, clock: { now: number }, extra: Partial<ChatSyncDeps> = {}): ChatSyncDeps {
  return {
    exec: async (cmd) => {
      fp.calls.push(cmd);
      if (fp.noTab) throw new NoTab('no tab');
      if (cmd.action !== 'fetchPage') throw new Error('unexpected');
      if (cmd.kind === 'chats') return fp.list;
      const node = new URLSearchParams(cmd.path.split('?')[1]).get('node')!;
      return fp.histories[node] ?? [];
    },
    isNoTab: (e) => e instanceof NoTab,
    settings: runningSettings(),
    now: () => clock.now,
    ...extra,
  };
}

const item = (id: string, text: string) => ({
  id,
  partnerName: `P-${id}`,
  partnerId: null,
  lastMessageText: text,
  lastMessageAt: null,
  unread: true,
});
const historyCalls = (fp: FakeFunPay) =>
  fp.calls.filter((c) => c.action === 'fetchPage' && c.kind === 'chat');

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  resetChatSyncStateForTests();
});

describe('chat sync', () => {
  it('baselines first, then fetches at most 5 changed histories per cycle and keeps the rest queued', async () => {
    const fp = fake();
    const clock = { now: NOW };
    const ids = Array.from({ length: 7 }, (_, i) => `users-1-${i + 10}`);
    fp.list = ids.map((id) => item(id, 'old'));
    const first = await syncChats(syncDeps(fp, clock));
    expect(first).toMatchObject({
      state: 'ok',
      message: 'baseline',
      chats: 7,
      historiesFetched: 0,
      pending: 0,
    });

    fp.list = ids.map((id) => item(id, 'new message'));
    clock.now += 60_000;
    const second = await syncChats(syncDeps(fp, clock));
    expect(second).toMatchObject({ state: 'ok', historiesFetched: 5, pending: 2 });

    clock.now += 60_000;
    const third = await syncChats(syncDeps(fp, clock));
    expect(third).toMatchObject({ state: 'ok', historiesFetched: 2, pending: 0 });
    expect(new Set(historyCalls(fp).map((c) => (c as { path: string }).path)).size).toBe(7);
    expect((await readSyncStatus())!.lastOkAt).toBe(clock.now);
  });

  it('reports "blocked" without a FunPay tab and keeps queued chats for later', async () => {
    const fp = fake();
    const clock = { now: NOW };
    fp.list = [item('users-1-2', 'a')];
    await syncChats(syncDeps(fp, clock));
    fp.noTab = true;
    expect(await syncChats(syncDeps(fp, clock))).toMatchObject({ state: 'blocked', message: 'open FunPay' });

    // The list was read but the history fetch failed: the chat stays queued.
    fp.noTab = false;
    const d = syncDeps(fp, clock);
    const throwingHistory: ChatSyncDeps = {
      ...d,
      exec: async (cmd) =>
        cmd.action === 'fetchPage' && cmd.kind === 'chat' ? Promise.reject(new NoTab('x')) : d.exec(cmd),
    };
    fp.list = [item('users-1-2', 'b')];
    clock.now += 60_000;
    expect(await syncChats(throwingHistory)).toMatchObject({ state: 'blocked', pending: 1 });
    clock.now += 60_000;
    expect(await syncChats(syncDeps(fp, clock))).toMatchObject({
      state: 'ok',
      historiesFetched: 1,
      pending: 0,
    });
  });

  it('drops a chat from the queue after repeated non-tab errors and records the error', async () => {
    const fp = fake();
    const clock = { now: NOW };
    fp.list = [item('users-1-2', 'a')];
    await syncChats(syncDeps(fp, clock));
    fp.list = [item('users-1-2', 'b')];
    const failing = (): ChatSyncDeps => {
      const d = syncDeps(fp, clock);
      return {
        ...d,
        exec: async (cmd) =>
          cmd.action === 'fetchPage' && cmd.kind === 'chat'
            ? Promise.reject(new Error('HTTP 500'))
            : d.exec(cmd),
      };
    };
    for (let i = 0; i < 3; i++) {
      clock.now += 60_000;
      await syncChats(failing());
    }
    expect((await readSyncStatus())!.pending).toBe(0);
    expect(await getDb().logs.where('source').equals('chat-sync').count()).toBeGreaterThan(0);
  });

  it('never fetches the same chat twice within the minimum interval', async () => {
    const fp = fake();
    const clock = { now: NOW };
    const d = syncDeps(fp, clock);
    await fetchChatHistory('users-1-2', d);
    await getDb().kv.put({
      key: 'messaging:historyQueue',
      value: [{ chatId: 'users-1-2', isNew: false, since: NOW, attempts: 0 }],
    });
    expect((await drainHistoryQueue(d)).fetched).toEqual([]);
    clock.now += 21_000;
    expect((await drainHistoryQueue(d)).fetched).toEqual(['users-1-2']);
    await expect(fetchChatHistory('../evil', d)).rejects.toThrow();
  });

  it('greets chats that appear after the baseline once their history is loaded', async () => {
    const fp = fake();
    const clock = { now: NOW };
    const settings = runningSettings({ messages: { welcomeText: 'Welcome, {buyer}!' } });
    const d = syncDeps(fp, clock, {
      settings,
      afterHistory: async (chatId, result, isNew) => {
        await afterHistoryIngest(chatId, result, isNew, deps({ settings, now: clock.now }));
      },
    });
    fp.list = [item('users-1000001-2000005', 'old chat')];
    await syncChats(d);
    fp.list.push(item(CHAT, 'hi'));
    fp.histories[CHAT] = [msg('10', 'customer', 'Hi there')];
    clock.now += 60_000;
    await syncChats(d);
    const tasks = await sendTasks();
    expect(tasks.map((t) => [t.idempotencyKey, t.payload['text']])).toEqual([
      [`msg:welcome:${CHAT}`, 'Welcome, BuyerAlpha!'],
    ]);
  });

  it('cancels queued automatic replies when the seller answers manually (but not post-order or manual sends)', async () => {
    await seedMessages(msg('5', 'customer', 'earlier'));
    const auto = await queueMessage({
      chatId: CHAT,
      text: 'auto',
      source: 'auto_reply',
      idempotencyKey: 'autoreply:x:1',
      runAt: NOW + 3600_000,
    });
    const post = await queueMessage({
      chatId: CHAT,
      text: 'thanks',
      source: 'post_order',
      idempotencyKey: 'postorder:X',
      runAt: NOW + 3600_000,
    });
    const manual = await queueMessage({
      chatId: CHAT,
      text: 'manual',
      source: 'manual',
      idempotencyKey: 'manual:1',
      runAt: NOW + 3600_000,
    });
    const res = await afterHistoryIngest(
      CHAT,
      {
        newCustomerMessages: [],
        newSelfMessages: [msg('6', 'self', 'I am here')],
        newSystemMessages: [],
        firstHistoryForChat: false,
      },
      false,
      deps(),
    );
    expect(res).toMatchObject({ manualMessages: 1, cancelled: 1 });
    const status = async (id: string) => (await getDb().tasks.get(id))!.status;
    expect(await status(auto.task.id)).toBe('cancelled');
    expect(await status(post.task.id)).toBe('pending');
    expect(await status(manual.task.id)).toBe('pending');
    expect(await cancelPendingAutoReplies(CHAT, 'again')).toBe(0);
  });

  it('full path from FunPay fixtures: list → history → MESSAGE_RECEIVED → auto-reply', async () => {
    await seedRules(rule());
    const clock = { now: NOW - 3 * 3600_000 };
    onEvent('MESSAGE_RECEIVED', async (e) => {
      await handleMessageReceived(e, deps({ now: clock.now }));
    });
    const listDoc = fixtureDoc('chat.html');
    const historyJson = JSON.parse(loadFixture('messaging-chat-history.json')) as unknown;
    let changed = false;
    const d: ChatSyncDeps = {
      exec: async (cmd) => {
        if (cmd.action !== 'fetchPage') throw new Error('unexpected');
        if (cmd.kind === 'chats') {
          // The content script parses the page; "now" pins relative times like "12:40".
          const list = funpayParser.parseChatList(listDoc, new Date(NOW));
          return changed
            ? list.map((c) => (c.id === CHAT ? { ...c, lastMessageText: 'What is the price for 2 pcs?' } : c))
            : list;
        }
        return funpayParser.parseChatHistoryJson(historyJson, CHAT, '1000001');
      },
      isNoTab: () => false,
      settings: runningSettings(),
      now: () => clock.now,
    };
    await syncChats(d);
    changed = true;
    clock.now = NOW;
    await syncChats(d);
    const stored = await getDb().messages.where('chatId').equals(CHAT).toArray();
    expect(stored.map((m) => [m.id, m.kind]).sort()).toEqual([
      ['88000001', 'system'],
      ['88000002', 'self'],
      ['88000003', 'customer'],
    ]);
    const tasks = await sendTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.payload).toMatchObject({
      chatId: CHAT,
      source: 'auto_reply',
      triggerMessageId: '88000003',
      text: 'Hi BuyerAlpha! The price is in the listing.',
    });
  });
});
