/**
 * Shared plumbing for messaging automations (auto-replies, welcome, post-order, scheduled):
 * injectable dependencies, outcome types, quiet hours and deterministic drafts.
 */
import type { AutomationContext } from '@/core/automation/policy';
import { getDb, type DraftReply } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { isWithinWindow, nextWindowEnd } from '@/core/util/time';
import { outboxTaskKey } from './outbox';

/** Everything an automation needs from the runtime, injected so it is testable without a worker. */
export interface MessagingDeps {
  settings: Settings;
  ctx: AutomationContext;
  /** Epoch ms. */
  now: number;
  /** The seller's FunPay user id (from the last observed session). */
  selfUserId: string | null;
  sellerName: string | null;
}

export type SkipReason =
  | 'invalid_event'
  | 'baseline'
  | 'not_running'
  | 'not_customer'
  | 'system_message'
  | 'stale'
  | 'unknown_time_first_history'
  | 'seller_replied'
  | 'duplicate'
  | 'no_match'
  | 'chat_hourly_limit'
  | 'customer_cooldown'
  | 'rule_cooldown'
  | 'manual_pause'
  | 'quiet_hours'
  | 'empty_reply'
  | 'no_text'
  | 'not_sale'
  | 'too_old'
  | 'no_customer_message'
  | 'emergency_stop';

export type DraftReason = 'approval_required' | 'lint' | 'missing_variables' | 'unaddressable';

export type AutomationOutcome =
  | { action: 'queued'; taskId: string; runAt: number | null; ruleId?: string }
  | { action: 'draft'; draftId: string; reason: DraftReason; ruleId?: string }
  | { action: 'skipped'; reason: SkipReason; detail?: string };

export const skipped = (reason: SkipReason, detail?: string): AutomationOutcome => (detail ? { action: 'skipped', reason, detail } : { action: 'skipped', reason });

/** Metadata stored on drafts created by messaging automations. */
export interface AutomationDraftMeta extends Record<string, unknown> {
  kind: 'auto_reply' | 'welcome' | 'post_order';
  reason: DraftReason;
  ruleId?: string;
  ruleName?: string;
  pattern?: string;
  orderId?: string;
  buyer?: string | null;
  lint?: string[];
  missing?: string[];
}

export interface QuietHoursState {
  active: boolean;
  /** When the current quiet window ends (epoch ms), if active. */
  endsAt: number | null;
}

/** Quiet hours in the seller's local time; windows may cross midnight (23:00 → 08:00). */
export function quietHoursState(settings: Settings, now: Date): QuietHoursState {
  const q = settings.messages.quietHours;
  if (!q.enabled || !isWithinWindow(now, q.start, q.end)) return { active: false, endsAt: null };
  return { active: true, endsAt: nextWindowEnd(now, q.end).getTime() };
}

/** Deterministic draft ids make drafts idempotent: the same trigger never creates two drafts. */
export function automationDraftId(kind: 'ar' | 'welcome' | 'postorder', ...parts: string[]): string {
  return `draft_${kind}_${parts.join('_')}`;
}

export async function createAutomationDraft(input: {
  id: string;
  chatId: string;
  triggerMessageId: string | null;
  text: string;
  meta: AutomationDraftMeta;
  now: number;
}): Promise<{ created: boolean; draft: DraftReply }> {
  const db = getDb();
  return db.transaction('rw', db.drafts, async () => {
    const existing = await db.drafts.get(input.id);
    if (existing) return { created: false, draft: existing };
    const draft: DraftReply = {
      id: input.id,
      chatId: input.chatId,
      triggerMessageId: input.triggerMessageId,
      source: 'auto_reply',
      text: input.text,
      status: 'pending',
      createdAt: input.now,
      updatedAt: input.now,
      sendAt: null,
      meta: input.meta,
    };
    await db.drafts.add(draft);
    return { created: true, draft };
  });
}

export async function hasQueuedMessage(key: string): Promise<boolean> {
  return !!(await getDb().tasks.where('idempotencyKey').equals(outboxTaskKey(key)).first());
}

export async function logSkip(source: string, outcome: AutomationOutcome, ids: Record<string, string | null | undefined>): Promise<void> {
  if (outcome.action !== 'skipped') return;
  const where = Object.entries(ids)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  await log.debug({ source, message: `Skipped (${outcome.reason}) ${where}`.trim(), ...(outcome.detail ? { details: { detail: outcome.detail } } : {}) });
}
