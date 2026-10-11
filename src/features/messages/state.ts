/**
 * Small per-chat state for messaging automations, kept in `db.kv` (no extra tables).
 *
 *  - fire log      `autoreply:chat:<chatId>`    every automatic reply decision (queued or drafted),
 *                                                used for per-rule / per-chat cooldowns and hourly caps;
 *  - customer mark `autoreply:customer:<key>`   last automatic reply to a customer (per-customer cooldown);
 *  - armed         `messaging:armed:<chatId>`   FunPro has processed this chat's history before, so a new
 *                                                customer message without a timestamp is genuinely new;
 *  - manual seen   `messaging:manual:<chatId>`  latest manual seller message and when FunPro first saw it.
 *
 * The fire log is written when a reply is decided (not when it is sent), so two quick customer
 * messages can never both pass a cooldown while the first reply is still waiting in the queue.
 */
import { getDb } from '@/core/db/db';
import type { ChatMessage } from '@/shared/models';
import { compareIds } from '@/features/sync/ingest';

export interface FireEntry {
  ruleId: string;
  messageId: string;
  at: number;
  mode: 'queued' | 'draft';
}

const DAY_MS = 24 * 3600_000;
const MAX_FIRE_ENTRIES = 100;

const fireKey = (chatId: string) => `autoreply:chat:${chatId}`;
const customerKey = (key: string) => `autoreply:customer:${key}`;
const armedKey = (chatId: string) => `messaging:armed:${chatId}`;
const manualKey = (chatId: string) => `messaging:manual:${chatId}`;

function isFireEntry(v: unknown): v is FireEntry {
  const e = v as FireEntry | null;
  return !!e && typeof e.ruleId === 'string' && typeof e.messageId === 'string' && typeof e.at === 'number';
}

export async function getFireLog(chatId: string): Promise<FireEntry[]> {
  const rec = await getDb().kv.get(fireKey(chatId));
  return Array.isArray(rec?.value) ? rec.value.filter(isFireEntry) : [];
}

export async function recordFire(chatId: string, customer: string, entry: FireEntry): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.kv, async () => {
    const log = (await getFireLog(chatId)).filter((e) => entry.at - e.at < DAY_MS);
    log.push(entry);
    await db.kv.put({ key: fireKey(chatId), value: log.slice(-MAX_FIRE_ENTRIES) });
    await db.kv.put({ key: customerKey(customer), value: entry.at });
  });
}

export async function lastCustomerReplyAt(customer: string): Promise<number | null> {
  const rec = await getDb().kv.get(customerKey(customer));
  return typeof rec?.value === 'number' ? rec.value : null;
}

export async function isChatArmed(chatId: string): Promise<boolean> {
  return !!(await getDb().kv.get(armedKey(chatId)));
}

export async function armChat(chatId: string, now = Date.now()): Promise<void> {
  const db = getDb();
  if (!(await db.kv.get(armedKey(chatId)))) await db.kv.put({ key: armedKey(chatId), value: now });
}

export interface ManualSeen {
  messageId: string;
  seenAt: number;
}

export async function getManualSeen(chatId: string): Promise<ManualSeen | null> {
  const v = (await getDb().kv.get(manualKey(chatId)))?.value as ManualSeen | undefined;
  return v && typeof v.messageId === 'string' && typeof v.seenAt === 'number' ? v : null;
}

/** Remember the newest manual seller message of a chat and when FunPro first noticed it. */
export async function recordManualSeen(chatId: string, messageId: string, now = Date.now()): Promise<void> {
  const prev = await getManualSeen(chatId);
  if (prev && compareIds(prev.messageId, messageId) >= 0) return;
  await getDb().kv.put({ key: manualKey(chatId), value: { messageId, seenAt: now } satisfies ManualSeen });
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * Whether a seller (`self`) message was produced by FunPro automation: the outbox records every
 * automatic send in `replyLedger` with the first 200 characters of its text.
 */
export async function automatedTexts(chatId: string): Promise<Set<string>> {
  const entries = await getDb().replyLedger.where('chatId').equals(chatId).toArray();
  return new Set(entries.map((e) => norm(e.text)));
}

export function isAutomatedSelfMessage(m: ChatMessage, automated: ReadonlySet<string>): boolean {
  return m.sentByExtension || automated.has(norm(m.text));
}
