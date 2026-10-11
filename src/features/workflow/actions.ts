/**
 * Workflow actions. In dry-run every action only DESCRIBES what it would do (no writes, no
 * notifications, no messages). Actions never emit domain events themselves (loop prevention);
 * hooks they call receive `origin: 'workflow'` to propagate the marker.
 */
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { lintOutgoingText } from '@/core/security/sanitize';
import { newId } from '@/core/util/id';
import { queueMessage } from '@/features/messages/outbox';
import { notify, type NotificationKind, type NotifyInput } from '@/features/notifications/notify';
import { recommendationFor } from '@/features/pricing/automation';
import { loadListingMarket } from '@/features/pricing/context';
import { formatMoney } from '@/shared/models/money';
import type { EventType, WorkflowAction, WorkflowRule } from '@/shared/models';
import { renderTemplate, type WorkflowContext } from './context';
import { hasBumpHandler, requestBump } from './hooks';

export type ActionStatus = 'done' | 'dry_run' | 'skipped' | 'failed';

export interface ActionOutcome {
  kind: WorkflowAction['kind'];
  status: ActionStatus;
  message: string;
}

export interface ActionEnv {
  rule: WorkflowRule;
  ctx: WorkflowContext;
  live: boolean;
  settings: Settings;
  now: Date;
  index: number;
}

/** Actions allowed for baseline (historical) events: nothing that contacts buyers or notifies. */
const BASELINE_SAFE = new Set<WorkflowAction['kind']>(['log', 'tag_customer']);

export function notificationKindFor(type: EventType): NotificationKind {
  switch (type) {
    case 'ORDER_DETECTED':
    case 'ORDER_PAID':
    case 'ORDER_COMPLETED':
    case 'ORDER_CANCELLED':
      return 'order';
    case 'MESSAGE_RECEIVED':
      return 'message';
    case 'REVIEW_RECEIVED':
      return 'review';
    case 'PRICE_CHANGE_DETECTED':
      return 'price';
    case 'INVENTORY_LOW':
      return 'inventory';
    case 'LISTING_BUMP_AVAILABLE':
      return 'bump';
    case 'AUTOMATION_FAILED':
      return 'failure';
    default:
      return 'system';
  }
}

const out = (kind: WorkflowAction['kind'], status: ActionStatus, message: string): ActionOutcome => ({ kind, status, message });

export async function runAction(action: WorkflowAction, env: ActionEnv): Promise<ActionOutcome> {
  const { ctx, live, rule, now } = env;
  const event = ctx.event;
  if (ctx.baseline && !BASELINE_SAFE.has(action.kind)) return out(action.kind, 'skipped', 'baseline (historical) event — not acted upon');
  const render = (t: string) => renderTemplate(t, ctx, now);
  const dedupe = `wf:${rule.id}:${event.id}:${env.index}`;
  const db = getDb();
  switch (action.kind) {
    case 'notify': {
      const title = render(action.title).text.slice(0, 200);
      const body = render(action.body).text.slice(0, 1000);
      if (!live) return out('notify', 'dry_run', `would notify: "${title}"`);
      await notify({ kind: notificationKindFor(event.type), title, body, url: ctx.chatId ? `https://funpay.com/chat/?node=${encodeURIComponent(ctx.chatId)}` : null, dedupeKey: dedupe });
      return out('notify', 'done', `notified: "${title}"`);
    }
    case 'telegram': {
      const text = render(action.text).text.slice(0, 1000);
      if (!live) return out('telegram', 'dry_run', `would send to Telegram: "${text.slice(0, 80)}"`);
      // `telegram: true` is a hint for the Telegram sink (owned by the notifications area).
      const input: NotifyInput & { telegram: true } = { kind: notificationKindFor(event.type), title: `Workflow: ${rule.name}`.slice(0, 200), body: text, dedupeKey: dedupe, telegram: true };
      await notify(input);
      return out('telegram', 'done', 'sent to the notification center with a Telegram hint');
    }
    case 'prepare_reply':
    case 'send_reply': {
      const tpl = await db.templates.get(action.templateId);
      if (!tpl) return out(action.kind, 'failed', 'template not found');
      if (!ctx.chatId) return out(action.kind, 'skipped', 'no chat is associated with this event');
      const { text, unresolved } = render(tpl.body);
      const trigger = typeof event.payload['messageId'] === 'string' ? event.payload['messageId'] : null;
      if (action.kind === 'prepare_reply') {
        if (!live) return out('prepare_reply', 'dry_run', `would prepare a draft from "${tpl.name}" for chat ${ctx.chatId}${unresolved.length ? ` (unresolved: ${unresolved.join(', ')})` : ''}`);
        const at = now.getTime();
        await db.drafts.add({ id: newId('draft'), chatId: ctx.chatId, triggerMessageId: trigger, source: 'workflow', text: text.slice(0, 2000), status: 'pending', createdAt: at, updatedAt: at, sendAt: null, meta: { ruleId: rule.id, eventId: event.id } });
        return out('prepare_reply', 'done', `draft prepared from "${tpl.name}"`);
      }
      if (unresolved.length) return out('send_reply', 'skipped', `not sent: unresolved placeholders ${unresolved.map((u) => `{${u}}`).join(', ')}`);
      const warnings = lintOutgoingText(text);
      if (warnings.length) return out('send_reply', 'skipped', `not sent: looks like contact details (${warnings.join(', ')}) — FunPay forbids sharing contacts`);
      if (!live) return out('send_reply', 'dry_run', `would send "${tpl.name}" to chat ${ctx.chatId}`);
      const { created } = await queueMessage({ chatId: ctx.chatId, text, source: 'workflow', idempotencyKey: `wf:${rule.id}:${event.id}`, ruleId: rule.id, triggerMessageId: trigger });
      return out('send_reply', 'done', created ? `reply "${tpl.name}" queued` : 'a reply for this event was already queued');
    }
    case 'queue_bump': {
      if (!live) return out('queue_bump', 'dry_run', hasBumpHandler() ? 'would request a bump' : 'would request a bump (no bump module registered)');
      const gameId = typeof event.payload['gameId'] === 'string' ? event.payload['gameId'] : null;
      const nodeId = typeof event.payload['nodeId'] === 'string' ? event.payload['nodeId'] : null;
      const ok = await requestBump({ ruleId: rule.id, eventId: event.id, origin: 'workflow', depth: 1, gameId, nodeId });
      return ok ? out('queue_bump', 'done', 'bump requested') : out('queue_bump', 'skipped', 'no bump module is registered');
    }
    case 'suggest_reprice': {
      if (ctx.listingIds.length === 0) return out('suggest_reprice', 'skipped', 'no listing is related to this event');
      const lines: string[] = [];
      for (const id of ctx.listingIds.slice(0, 5)) {
        const market = await loadListingMarket(id, now.getTime());
        if (!market) continue;
        const rec = await recommendationFor(market, env.settings, now.getTime());
        if (!rec) continue;
        const money = (m: number) => formatMoney({ amountMinor: m, currency: market.listing.price.currency });
        lines.push(`${market.listing.title.slice(0, 60)}: ${rec.targetMinor !== null && rec.targetMinor !== rec.currentMinor ? `${money(rec.currentMinor)} → ${money(rec.targetMinor)}` : `keep ${money(rec.currentMinor)}`}${rec.hold ? ` (${rec.hold})` : ''}`);
      }
      if (lines.length === 0) return out('suggest_reprice', 'skipped', 'the related listing(s) have no pricing rule');
      if (!live) return out('suggest_reprice', 'dry_run', `would suggest: ${lines.join('; ')}`);
      await notify({ kind: 'price', title: 'Repricing suggestion', body: lines.join('\n'), dedupeKey: dedupe });
      return out('suggest_reprice', 'done', `suggested: ${lines.join('; ')}`);
    }
    case 'tag_customer': {
      const tag = action.tag.trim().slice(0, 32);
      if (!tag) return out('tag_customer', 'failed', 'empty tag');
      const c = ctx.customer;
      if (!c) return out('tag_customer', 'skipped', 'no customer is associated with this event');
      if (!live) return out('tag_customer', 'dry_run', `would tag ${c.name || c.key} with "${tag}"`);
      const iso = now.toISOString();
      await db.transaction('rw', db.customers, async () => {
        const existing = await db.customers.get(c.key);
        if (existing) {
          if (!existing.tags.includes(tag)) await db.customers.update(c.key, { tags: [...existing.tags, tag].slice(0, 30) });
        } else {
          await db.customers.add({ id: c.key, name: c.name, tags: [tag], notes: '', pinned: false, followUpAt: null, followUpNote: '', firstSeenAt: iso, lastSeenAt: iso });
        }
      });
      return out('tag_customer', 'done', `tagged ${c.name || c.key} with "${tag}"`);
    }
    case 'log': {
      const message = render(action.message).text.slice(0, 500);
      if (!live) return out('log', 'dry_run', `would log: "${message}"`);
      await log.info({ source: `workflow:${rule.id}`, message });
      return out('log', 'done', 'logged');
    }
  }
}
