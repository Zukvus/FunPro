/**
 * Keyword auto-replies, triggered by MESSAGE_RECEIVED events.
 *
 * Loop prevention and rate limiting, in evaluation order:
 *  1. baseline events and events while the `autoReply` feature is not running are ignored;
 *  2. only `customer` messages count — never the seller's own (`self`) or FunPay system messages,
 *     re-checked against the stored message and the system-message classifier;
 *  3. messages from before FunPro's chat baseline, older than AUTO_REPLY_MAX_AGE_MS, or (when no
 *     timestamp is known) from the first history FunPro ever loaded for a chat are ignored;
 *  4. nothing happens if the seller already wrote after the trigger message;
 *  5. at most one automatic reply per trigger message (queue idempotency key, draft id, replyLedger);
 *  6. at most `maxAutoRepliesPerChatPerHour` replies per chat, a per-customer cooldown and a
 *     per-rule-per-chat cooldown;
 *  7. replies pause in a chat for `pauseAfterManualReplyMin` after the seller wrote there manually;
 *  8. quiet hours either delay the reply to the end of the window or skip it.
 * Replies with contacts, confirmation pressure or missing variables, and rules marked
 * `requireApproval`, become drafts that the seller reviews instead of being sent.
 * The outbox additionally enforces the emergency stop, policy, 15 per 10 min and a 3 s gap.
 */
import { z } from 'zod';
import { funpayParser } from '@/adapters/funpay';
import { evaluateFeature } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { ChatMessage, DomainEvent } from '@/shared/models';
import { compareIds } from '@/features/sync/ingest';
import {
  automationDraftId,
  createAutomationDraft,
  hasQueuedMessage,
  logSkip,
  quietHoursState,
  skipped,
  type AutomationOutcome,
  type DraftReason,
  type MessagingDeps,
} from './automation';
import { chatMessages, chatVariables } from './context';
import { hasBlockingIssue, lintText } from './lint';
import { findMatchingRule } from './matching';
import { queueMessage } from './outbox';
import {
  armChat,
  automatedTexts,
  getFireLog,
  getManualSeen,
  isAutomatedSelfMessage,
  isChatArmed,
  lastCustomerReplyAt,
  recordFire,
} from './state';
import { renderTemplate } from './templates';

/** Customer messages older than this are never answered automatically. */
export const AUTO_REPLY_MAX_AGE_MS = 12 * 3600_000;
/** Minute-precision FunPay timestamps vs. the millisecond baseline. */
const BASELINE_SLACK_MS = 2 * 60_000;

const PayloadSchema = z.object({
  chatId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(64),
  authorId: z.string().nullable().optional(),
  authorName: z.string().optional(),
  text: z.string().optional(),
  baseline: z.boolean().optional(),
});
type Payload = z.infer<typeof PayloadSchema>;

export function autoReplyKey(chatId: string, messageId: string): string {
  return `autoreply:${chatId}:${messageId}`;
}

// Decisions are serialised so concurrent ingestion paths (page + background sync) cannot both pass
// the same cooldown check.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export async function handleMessageReceived(
  event: DomainEvent,
  deps: MessagingDeps,
): Promise<AutomationOutcome> {
  const parsed = PayloadSchema.safeParse(event.payload);
  if (!parsed.success) return skipped('invalid_event');
  const p = parsed.data;
  if (p.baseline === true) return skipped('baseline');
  const status = evaluateFeature(deps.settings, 'autoReply', deps.ctx);
  if (status.status !== 'running') {
    const out = skipped('not_running', status.reason);
    await logSkip('auto-reply', out, { chat: p.chatId, message: p.messageId });
    return out;
  }
  const out = await serialized(() => decide(p, deps));
  await logSkip('auto-reply', out, { chat: p.chatId, message: p.messageId });
  return out;
}

async function chatBaselineAt(): Promise<number | null> {
  const rec = await getDb().kv.get('baseline:chats');
  return typeof rec?.value === 'number' ? rec.value : null;
}

/** Best known time of a message: its own timestamp, else the chat list time if it is the latest message. */
async function messageTime(
  chatId: string,
  msg: ChatMessage | undefined,
  history: ChatMessage[],
): Promise<number | null> {
  const own = msg?.at ? Date.parse(msg.at) : NaN;
  if (Number.isFinite(own)) return own;
  const latest = history.at(-1);
  if (msg && latest && latest.id === msg.id) {
    const chat = await getDb().chats.get(chatId);
    const t = chat?.lastMessageAt ? Date.parse(chat.lastMessageAt) : NaN;
    if (Number.isFinite(t)) return t;
  }
  return null;
}

/** When the seller last wrote manually in a chat (automatic FunPro messages excluded). */
export async function lastManualMessageAt(chatId: string, history: ChatMessage[]): Promise<number | null> {
  const automated = await automatedTexts(chatId);
  const manual = history.filter((m) => m.kind === 'self' && !isAutomatedSelfMessage(m, automated));
  const last = manual.at(-1);
  if (!last) return null;
  const at = last.at ? Date.parse(last.at) : NaN;
  if (Number.isFinite(at)) return at;
  const seen = await getManualSeen(chatId);
  return seen && compareIds(seen.messageId, last.id) >= 0 ? seen.seenAt : null;
}

async function decide(p: Payload, deps: MessagingDeps): Promise<AutomationOutcome> {
  const db = getDb();
  const { chatId, messageId } = p;
  const { settings, now } = deps;

  // 2. Customer messages only.
  const msg = await db.messages.get([chatId, messageId]);
  const authorId = msg?.authorId ?? p.authorId ?? null;
  const text = (p.text || msg?.text || '').trim();
  if (
    (msg && msg.kind !== 'customer') ||
    msg?.sentByExtension ||
    authorId === '0' ||
    (!!deps.selfUserId && authorId === deps.selfUserId)
  ) {
    return skipped('not_customer');
  }
  if (!text) return skipped('empty_reply', 'trigger message has no text');
  if (funpayParser.classifySystemMessage(text)) return skipped('system_message');

  // 3. Baseline / staleness.
  const history = await chatMessages(chatId);
  const t = await messageTime(chatId, msg, history);
  if (t !== null) {
    const baselineAt = await chatBaselineAt();
    if (baselineAt !== null && t < baselineAt - BASELINE_SLACK_MS) return skipped('baseline');
    if (now - t > AUTO_REPLY_MAX_AGE_MS) return skipped('stale');
    await armChat(chatId, now);
  } else if (!(await isChatArmed(chatId))) {
    await armChat(chatId, now);
    return skipped('unknown_time_first_history');
  }

  // 4. The seller already answered.
  if (history.some((m) => m.kind === 'self' && compareIds(m.id, messageId) > 0))
    return skipped('seller_replied');

  // 5. One reply per trigger message.
  const key = autoReplyKey(chatId, messageId);
  const draftId = automationDraftId('ar', chatId, messageId);
  if (
    (await hasQueuedMessage(key)) ||
    (await db.drafts.get(draftId)) ||
    (await db.replyLedger.where('id').startsWith(`${chatId}:${messageId}:`).first())
  ) {
    return skipped('duplicate');
  }

  const match = findMatchingRule(await db.autoReplyRules.toArray(), text);
  if (!match) return skipped('no_match');
  const { rule, pattern } = match;

  // 6. Limits and cooldowns.
  const fires = await getFireLog(chatId);
  if (fires.filter((f) => now - f.at < 3600_000).length >= settings.messages.maxAutoRepliesPerChatPerHour)
    return skipped('chat_hourly_limit');
  const customer = authorId ? `u:${authorId}` : `c:${chatId}`;
  const lastCustomer = await lastCustomerReplyAt(customer);
  if (lastCustomer !== null && now - lastCustomer < settings.messages.perCustomerCooldownSec * 1000)
    return skipped('customer_cooldown');
  const lastRule = Math.max(-Infinity, ...fires.filter((f) => f.ruleId === rule.id).map((f) => f.at));
  if (now - lastRule < rule.cooldownSec * 1000) return skipped('rule_cooldown', rule.id);

  // 7. Pause after the seller's own manual message.
  const pauseMs = settings.messages.pauseAfterManualReplyMin * 60_000;
  if (pauseMs > 0) {
    const manualAt = await lastManualMessageAt(chatId, history);
    if (manualAt !== null && now - manualAt < pauseMs) return skipped('manual_pause');
  }

  // Render and decide between sending and a draft.
  const buyerName = p.authorName || msg?.authorName || null;
  const { vars } = await chatVariables({
    chatId,
    selfUserId: deps.selfUserId,
    sellerName: deps.sellerName,
    buyerName,
    buyerId: authorId,
    now: new Date(now),
  });
  const rendered = renderTemplate(rule.reply, vars);
  const reply = rendered.text.trim();
  if (!reply) return skipped('empty_reply');
  const lint = lintText(reply, { checkVariables: false });
  let draftReason: DraftReason | null = null;
  if (rendered.missing.length) draftReason = 'missing_variables';
  else if (hasBlockingIssue(lint)) draftReason = 'lint';
  else if (rule.requireApproval) draftReason = 'approval_required';

  if (draftReason) {
    // Missing variables stay visible as {name} so the seller can fill them in.
    const draftText =
      draftReason === 'missing_variables'
        ? renderTemplate(rule.reply, vars, { missing: 'keep' }).text.trim()
        : reply;
    const { created } = await createAutomationDraft({
      id: draftId,
      chatId,
      triggerMessageId: messageId,
      text: draftText,
      now,
      meta: {
        kind: 'auto_reply',
        reason: draftReason,
        ruleId: rule.id,
        ruleName: rule.name,
        pattern,
        buyer: buyerName,
        lint: lint.map((i) => i.id),
        missing: rendered.missing,
      },
    });
    if (!created) return skipped('duplicate');
    await recordFire(chatId, customer, { ruleId: rule.id, messageId, at: now, mode: 'draft' });
    await log.info({
      source: 'auto-reply',
      message: `Draft prepared by rule "${rule.name}" for chat ${chatId} (${draftReason})`,
    });
    return { action: 'draft', draftId, reason: draftReason, ruleId: rule.id };
  }

  // 8. Quiet hours.
  const quiet = quietHoursState(settings, new Date(now));
  if (quiet.active && !settings.messages.queueDuringQuietHours) return skipped('quiet_hours');
  const runAt = quiet.active ? quiet.endsAt : null;

  const { task, created } = await queueMessage({
    chatId,
    text: reply,
    source: 'auto_reply',
    idempotencyKey: key,
    ruleId: rule.id,
    triggerMessageId: messageId,
    ...(runAt ? { runAt } : {}),
  });
  if (!created) return skipped('duplicate');
  await recordFire(chatId, customer, { ruleId: rule.id, messageId, at: now, mode: 'queued' });
  await log.info({
    source: 'auto-reply',
    message: `Reply by rule "${rule.name}" queued for chat ${chatId}${runAt ? ` (held until quiet hours end at ${new Date(runAt).toLocaleTimeString()})` : ''}`,
  });
  return { action: 'queued', taskId: task.id, runAt, ruleId: rule.id };
}
