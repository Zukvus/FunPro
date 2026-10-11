/**
 * Remote commands from the authorised Telegram chat (polled with getUpdates in the 1-minute tick).
 *
 *  - /status        read-only summary (numbers only);
 *  - /stop          asks for confirmation;
 *  - /stop CONFIRM  within 2 minutes of /stop → the same emergency stop as the dashboard button.
 * Updates from any other chat, non-private chats, other users, stale messages and every other
 * command are ignored. There is deliberately no remote "resume" or any FunPay action.
 */
import type { TgUpdate } from '@/adapters/telegram/api';
import type { Settings } from '@/core/settings/schema';

export const STOP_CONFIRM_WINDOW_SEC = 120;
/** Commands older than this (e.g. queued while the browser was closed) are ignored. */
export const MAX_COMMAND_AGE_SEC = 10 * 60;

export interface ParsedCommand {
  name: string;
  args: string;
}

/** "/stop@MyBot CONFIRM" → { name: "stop", args: "CONFIRM" }. */
export function parseCommand(text: string | undefined): ParsedCommand | null {
  if (!text) return null;
  const m = text.trim().match(/^\/([a-z_]{1,32})(?:@[A-Za-z0-9_]{3,64})?(?:\s+([\s\S]*))?$/i);
  if (!m) return null;
  return { name: m[1]!.toLowerCase(), args: (m[2] ?? '').trim() };
}

/** Only private messages from the confirmed chat (and from that same user) are accepted. */
export function isAuthorizedUpdate(update: TgUpdate, authorizedChatId: string): boolean {
  const msg = update.message;
  if (!msg || !authorizedChatId) return false;
  if (String(msg.chat.id) !== authorizedChatId) return false;
  if (msg.chat.type !== 'private') return false;
  if (msg.from && (msg.from.is_bot || String(msg.from.id) !== authorizedChatId)) return false;
  return true;
}

export interface CommandDeps {
  settings: Settings;
  reply(html: string): Promise<void>;
  emergencyStop(reason: string): Promise<void>;
  statusHtml(): Promise<string>;
  texts: { stopAsk: string; stopDone: string; stopExpired: string };
  getStopRequestedAt(): Promise<number | null>;
  setStopRequestedAt(at: number | null): Promise<void>;
  nowSec(): number;
}

export interface ProcessResult {
  /** getUpdates offset to acknowledge everything processed (null when there were no updates). */
  nextOffset: number | null;
  handled: string[];
  ignored: number;
}

export async function processTelegramUpdates(
  updates: readonly TgUpdate[],
  deps: CommandDeps,
): Promise<ProcessResult> {
  const result: ProcessResult = { nextOffset: null, handled: [], ignored: 0 };
  const chatId = deps.settings.telegram.chatId;
  const sorted = [...updates].sort((a, b) => a.update_id - b.update_id);
  for (const update of sorted) {
    result.nextOffset = Math.max(result.nextOffset ?? 0, update.update_id + 1);
    if (!isAuthorizedUpdate(update, chatId)) {
      result.ignored++;
      continue;
    }
    const msg = update.message!;
    if (deps.nowSec() - msg.date > MAX_COMMAND_AGE_SEC) {
      result.ignored++;
      continue;
    }
    const cmd = parseCommand(msg.text);
    if (!cmd) {
      result.ignored++;
      continue;
    }
    if (cmd.name === 'status' && !cmd.args) {
      await deps.reply(await deps.statusHtml());
      result.handled.push('status');
    } else if (cmd.name === 'stop' && !cmd.args) {
      await deps.setStopRequestedAt(msg.date);
      await deps.reply(deps.texts.stopAsk);
      result.handled.push('stop_requested');
    } else if (cmd.name === 'stop' && /^confirm$/i.test(cmd.args)) {
      const requestedAt = await deps.getStopRequestedAt();
      if (
        requestedAt !== null &&
        msg.date >= requestedAt &&
        msg.date - requestedAt <= STOP_CONFIRM_WINDOW_SEC
      ) {
        await deps.setStopRequestedAt(null);
        await deps.emergencyStop('Telegram /stop');
        await deps.reply(deps.texts.stopDone);
        result.handled.push('stop_confirmed');
      } else {
        await deps.reply(deps.texts.stopExpired);
        result.handled.push('stop_expired');
      }
    } else {
      result.ignored++;
    }
  }
  return result;
}
