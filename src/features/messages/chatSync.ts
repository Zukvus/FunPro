/**
 * Chat synchronisation through an open FunPay tab (reading only — sending is the outbox's job).
 *
 *  1. fetch the chat list (`/chat/`) and ingest it (baseline semantics live in ingestChatList);
 *  2. chats whose last message changed, and chats first seen after the baseline, go into a
 *     persistent history queue (kv), so nothing is lost when the service worker is suspended;
 *  3. at most MAX_HISTORIES_PER_CYCLE histories are fetched per run (`/chat/history`), each chat at
 *     most once per MIN_HISTORY_INTERVAL_MS; the content-script transport spaces requests further.
 *
 * Ingesting a history emits MESSAGE_RECEIVED for new customer messages (auto-replies react to that);
 * `afterHistory` runs follow-ups such as the welcome message.
 */
import type { z } from 'zod';
import type { ContentCommand } from '@/core/messaging/protocol';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { ChatMessageSchema, ChatSummarySchema, type ChatMessage } from '@/shared/models';
import { ingestChatList, ingestMessages, type MessageIngestResult } from '@/features/sync/ingest';
import { isValidChatId } from './context';

export const MAX_HISTORIES_PER_CYCLE = 5;
export const MIN_HISTORY_INTERVAL_MS = 20_000;
const MAX_ATTEMPTS = 3;
const MAX_QUEUE = 200;

export const SYNC_STATUS_KEY = 'messaging:syncStatus';
const QUEUE_KEY = 'messaging:historyQueue';

export type Exec = (cmd: ContentCommand) => Promise<unknown>;

export interface ChatSyncDeps {
  exec: Exec;
  /** True when `exec` failed because no logged-in FunPay tab is open. */
  isNoTab: (e: unknown) => boolean;
  settings: Settings;
  now: () => number;
  /** Runs after each chat history was stored. */
  afterHistory?: (chatId: string, result: MessageIngestResult, isNewChat: boolean) => Promise<void>;
}

export interface ChatSyncStatus {
  state: 'ok' | 'blocked' | 'error' | 'disabled';
  /** Short machine-friendly detail (the UI translates the state). */
  message: string;
  at: number;
  lastOkAt: number | null;
  chats: number;
  historiesFetched: number;
  pending: number;
}

interface QueueEntry {
  chatId: string;
  isNew: boolean;
  since: number;
  attempts: number;
}

const ChatItemSchema = ChatSummarySchema.omit({ pinned: true, updatedAt: true });
type ChatItem = z.output<typeof ChatItemSchema>;

/** Last history fetch per chat (in memory; resets with the service worker, which is fine). */
const lastFetch = new Map<string, number>();

export function resetChatSyncStateForTests(): void {
  lastFetch.clear();
  draining = null;
}

async function readQueue(): Promise<QueueEntry[]> {
  const v = (await getDb().kv.get(QUEUE_KEY))?.value;
  return Array.isArray(v) ? (v as QueueEntry[]).filter((e) => e && typeof e.chatId === 'string') : [];
}

async function writeQueue(q: QueueEntry[]): Promise<void> {
  await getDb().kv.put({ key: QUEUE_KEY, value: q.slice(0, MAX_QUEUE) });
}

export async function pendingHistoryCount(): Promise<number> {
  return (await readQueue()).length;
}

/** Add chats to the history queue (new chats first; an entry keeps its "new" flag). */
export async function enqueueHistories(changed: readonly string[], newChats: readonly string[], now: number): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.kv, async () => {
    const q = await readQueue();
    const fresh = new Set(newChats);
    for (const chatId of [...newChats, ...changed]) {
      if (!isValidChatId(chatId)) continue;
      const existing = q.find((e) => e.chatId === chatId);
      if (existing) existing.isNew ||= fresh.has(chatId);
      else q.push({ chatId, isNew: fresh.has(chatId), since: now, attempts: 0 });
    }
    q.sort((a, b) => Number(b.isNew) - Number(a.isNew) || a.since - b.since);
    await writeQueue(q);
  });
}

async function removeFromQueue(chatId: string): Promise<void> {
  await writeQueue((await readQueue()).filter((e) => e.chatId !== chatId));
}

function validMessages(raw: unknown, chatId: string): ChatMessage[] {
  if (!Array.isArray(raw)) throw new Error('Unexpected chat history response');
  const out: ChatMessage[] = [];
  for (const item of raw) {
    const r = ChatMessageSchema.safeParse(item);
    if (r.success && r.data.chatId === chatId) out.push(r.data);
  }
  return out;
}

/** Fetch and store one chat's history. Throws on transport errors (callers decide what to do). */
export async function fetchChatHistory(chatId: string, deps: ChatSyncDeps, isNewChat = false): Promise<MessageIngestResult> {
  if (!isValidChatId(chatId)) throw new Error('Invalid chat id');
  lastFetch.set(chatId, deps.now());
  const raw = await deps.exec({ action: 'fetchPage', kind: 'chat', path: `/chat/history?node=${chatId}&last_message=-1` });
  const result = await ingestMessages(chatId, validMessages(raw, chatId), { retentionDays: deps.settings.privacy.messageRetentionDays, now: deps.now() });
  await deps.afterHistory?.(chatId, result, isNewChat);
  return result;
}

let draining: Promise<{ fetched: string[]; blocked: boolean }> | null = null;

/**
 * Fetch up to `limit` queued histories. Concurrent callers share the running drain, so the page hook
 * and the alarm never fetch the same chat twice in parallel.
 */
export function drainHistoryQueue(deps: ChatSyncDeps, limit = MAX_HISTORIES_PER_CYCLE): Promise<{ fetched: string[]; blocked: boolean }> {
  draining ??= (async () => {
    const fetched: string[] = [];
    let blocked = false;
    try {
      const skip = new Set<string>();
      while (fetched.length < limit) {
        const now = deps.now();
        const next = (await readQueue()).find((e) => !skip.has(e.chatId) && now - (lastFetch.get(e.chatId) ?? 0) >= MIN_HISTORY_INTERVAL_MS);
        if (!next) break;
        skip.add(next.chatId);
        try {
          await fetchChatHistory(next.chatId, deps, next.isNew);
          await removeFromQueue(next.chatId);
          fetched.push(next.chatId);
        } catch (e) {
          if (deps.isNoTab(e)) {
            blocked = true;
            break;
          }
          const q = await readQueue();
          const entry = q.find((x) => x.chatId === next.chatId);
          if (entry) {
            entry.attempts += 1;
            await writeQueue(entry.attempts >= MAX_ATTEMPTS ? q.filter((x) => x !== entry) : q);
          }
          await log.warn({ source: 'chat-sync', message: `Could not load history of chat ${next.chatId}: ${e instanceof Error ? e.message : String(e)}` });
        }
      }
    } finally {
      draining = null;
    }
    return { fetched, blocked };
  })();
  return draining;
}

export async function readSyncStatus(): Promise<ChatSyncStatus | null> {
  const v = (await getDb().kv.get(SYNC_STATUS_KEY))?.value as ChatSyncStatus | undefined;
  return v && typeof v.state === 'string' ? v : null;
}

async function saveStatus(s: Omit<ChatSyncStatus, 'lastOkAt' | 'pending'>): Promise<ChatSyncStatus> {
  const prev = await readSyncStatus();
  const status: ChatSyncStatus = { ...s, lastOkAt: s.state === 'ok' ? s.at : (prev?.lastOkAt ?? null), pending: await pendingHistoryCount() };
  await getDb().kv.put({ key: SYNC_STATUS_KEY, value: status });
  return status;
}

export async function recordSyncDisabled(now: number): Promise<ChatSyncStatus> {
  return saveStatus({ state: 'disabled', message: 'background chat sync is off', at: now, chats: 0, historiesFetched: 0 });
}

/** One full sync cycle: chat list, then queued histories. Never throws. */
export async function syncChats(deps: ChatSyncDeps): Promise<ChatSyncStatus> {
  const now = deps.now();
  let items: unknown;
  try {
    items = await deps.exec({ action: 'fetchPage', kind: 'chats', path: '/chat/' });
  } catch (e) {
    if (deps.isNoTab(e)) return saveStatus({ state: 'blocked', message: 'open FunPay', at: now, chats: 0, historiesFetched: 0 });
    const message = e instanceof Error ? e.message : String(e);
    await log.warn({ source: 'chat-sync', message: `Chat list sync failed: ${message}` });
    return saveStatus({ state: 'error', message: message.slice(0, 200), at: now, chats: 0, historiesFetched: 0 });
  }
  const list: ChatItem[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    const r = ChatItemSchema.safeParse(item);
    if (r.success) list.push(r.data);
  }
  const res = await ingestChatList(list, now);
  await enqueueHistories(res.changed, res.newChats, now);
  const { fetched, blocked } = await drainHistoryQueue(deps);
  if (blocked) return saveStatus({ state: 'blocked', message: 'open FunPay', at: now, chats: list.length, historiesFetched: fetched.length });
  return saveStatus({ state: 'ok', message: res.baseline ? 'baseline' : '', at: now, chats: list.length, historiesFetched: fetched.length });
}
