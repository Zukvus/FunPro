/**
 * Telegram connect flow (runs in the dashboard, after the user granted api.telegram.org access):
 *  1. the user creates a bot with @BotFather and pastes the token → getMe validates it, the token
 *     is stored encrypted (setSecret, never in storage.local);
 *  2. the user sends /start to the bot → one getUpdates call lists the private chats that did so;
 *  3. the user confirms their own Telegram account → chat id saved with consent; earlier updates
 *     are acknowledged so they are never processed as commands.
 */
import { TelegramApi, type TelegramApiDeps, type TgUpdate, type TgUser } from '@/adapters/telegram/api';
import { getDb } from '@/core/db/db';
import { deleteSecret, getSecret, hasSecret, setSecret } from '@/core/security/secrets';
import type { Settings } from '@/core/settings/schema';
import { updateSettings } from '@/core/settings/store';
import { isFlagEnabled } from '@/core/flags/flags';

export const KV_UPDATE_OFFSET = 'telegram:updateOffset';
export const KV_LAST_ERROR = 'telegram:lastError';
export const KV_STOP_REQUEST = 'telegram:stopRequestedAt';
export const KV_SUMMARY_DAY = 'telegram:lastSummaryDay';

export interface ChatCandidate {
  chatId: string;
  /** "@username" when available, otherwise the first/last name. */
  label: string;
  username: string | null;
  lastAt: number;
}

export async function verifyBotToken(token: string, deps?: TelegramApiDeps): Promise<TgUser> {
  const me = await new TelegramApi(token, deps).getMe();
  if (!me.is_bot) throw new Error('This token does not belong to a bot');
  return me;
}

export async function saveBotToken(token: string, bot: TgUser): Promise<void> {
  await setSecret('telegram.botToken', token.trim());
  await updateSettings({ telegram: { botUsername: bot.username ?? '', chatId: '', chatLabel: '', enabled: false } });
}

/** Private chats that sent /start, newest first, plus the highest update id seen. */
export function startCandidates(updates: readonly TgUpdate[]): { candidates: ChatCandidate[]; lastUpdateId: number | null } {
  const byChat = new Map<string, ChatCandidate>();
  let lastUpdateId: number | null = null;
  for (const u of updates) {
    lastUpdateId = Math.max(lastUpdateId ?? 0, u.update_id);
    const m = u.message;
    if (!m || m.chat.type !== 'private' || !/^\/start\b/.test(m.text?.trim() ?? '')) continue;
    if (m.from?.is_bot) continue;
    const username = m.chat.username ?? m.from?.username ?? null;
    const name = [m.chat.first_name ?? m.from?.first_name, m.chat.last_name ?? m.from?.last_name].filter(Boolean).join(' ');
    const id = String(m.chat.id);
    const prev = byChat.get(id);
    if (!prev || prev.lastAt < m.date) byChat.set(id, { chatId: id, label: username ? `@${username}` : name || id, username, lastAt: m.date });
  }
  return { candidates: [...byChat.values()].sort((a, b) => b.lastAt - a.lastAt), lastUpdateId };
}

export async function findStartChats(deps?: TelegramApiDeps): Promise<{ candidates: ChatCandidate[]; lastUpdateId: number | null }> {
  const token = await getSecret('telegram.botToken');
  if (!token) throw new Error('Save the bot token first');
  const updates = await new TelegramApi(token, deps).getUpdates({ limit: 100 });
  return startCandidates(updates);
}

/** Saves the confirmed chat and acknowledges every update seen so far. */
export async function confirmTelegramChat(candidate: ChatCandidate, lastUpdateId: number | null, now = Date.now()): Promise<void> {
  if (!/^\d{1,20}$/.test(candidate.chatId)) throw new Error('Invalid chat');
  if (lastUpdateId !== null) await getDb().kv.put({ key: KV_UPDATE_OFFSET, value: lastUpdateId + 1 });
  await getDb().kv.delete(KV_LAST_ERROR);
  await updateSettings({ telegram: { enabled: true, chatId: candidate.chatId, chatLabel: candidate.label.slice(0, 128), consentAt: now } });
}

export async function disconnectTelegram(): Promise<void> {
  await deleteSecret('telegram.botToken');
  const db = getDb();
  await db.kv.bulkDelete([KV_UPDATE_OFFSET, KV_LAST_ERROR, KV_STOP_REQUEST]);
  await updateSettings({ telegram: { enabled: false, chatId: '', chatLabel: '', botUsername: '', consentAt: null, remoteCommands: false } });
}

export async function recordTelegramError(message: string, now = Date.now()): Promise<void> {
  await getDb().kv.put({ key: KV_LAST_ERROR, value: { message: message.slice(0, 300), at: now } });
}

export async function clearTelegramError(): Promise<void> {
  await getDb().kv.delete(KV_LAST_ERROR);
}

export type TelegramState = 'disabled' | 'awaiting_authorization' | 'connected' | 'error';

export interface TelegramStatus {
  state: TelegramState;
  /** Machine-readable detail for the UI. */
  detail: 'flag_off' | 'local_only' | 'no_token' | 'no_chat' | 'no_consent' | 'no_permission' | 'paused' | 'send_failed' | 'ok';
  lastError: { message: string; at: number } | null;
}

const ERROR_TTL_MS = 30 * 60_000;

export async function telegramStatus(settings: Settings, hasPermission: boolean, now = Date.now()): Promise<TelegramStatus> {
  const t = settings.telegram;
  const raw = (await getDb().kv.get(KV_LAST_ERROR))?.value as { message?: unknown; at?: unknown } | undefined;
  const lastError = raw && typeof raw.message === 'string' && typeof raw.at === 'number' ? { message: raw.message, at: raw.at } : null;
  if (!isFlagEnabled('telegram', settings.flags)) return { state: 'disabled', detail: 'flag_off', lastError };
  if (settings.general.localOnly) return { state: 'disabled', detail: 'local_only', lastError };
  const token = await hasSecret('telegram.botToken');
  if (!token) return { state: 'disabled', detail: 'no_token', lastError };
  if (!hasPermission) return { state: 'awaiting_authorization', detail: 'no_permission', lastError };
  if (!t.chatId) return { state: 'awaiting_authorization', detail: 'no_chat', lastError };
  if (t.consentAt === null) return { state: 'awaiting_authorization', detail: 'no_consent', lastError };
  if (!t.enabled) return { state: 'disabled', detail: 'paused', lastError };
  if (lastError && now - lastError.at < ERROR_TTL_MS) return { state: 'error', detail: 'send_failed', lastError };
  return { state: 'connected', detail: 'ok', lastError };
}
