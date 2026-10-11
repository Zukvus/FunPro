/**
 * Delivery orchestration (manual-assisted by default).
 *
 * Status machine: reserved → sending → sent | uncertain | failed, plus manual / cancelled.
 *  - Default: a draft (source 'delivery') is prepared for the seller to review and send.
 *  - Automatic send ONLY when evaluateFeature('autoDelivery') is `running`; the message goes through
 *    the outbox with the idempotency key `delivery:<orderId>`.
 *  - `uncertain` (the send may or may not have reached FunPay) is never retried automatically.
 *  - Retries are explicit seller actions with a new key `delivery:<orderId>:retry<n>`.
 *
 * Plaintext goods exist in memory while rendering. The rendered message necessarily sits in the
 * outbox task / draft until it is sent (durable MV3 queue); FunPro masks those copies as soon as the
 * delivery is resolved (sent or cancelled). Logs never contain goods.
 */
import { evaluateFeature, type AutomationContext } from '@/core/automation/policy';
import { getDb, type DraftReply } from '@/core/db/db';
import { log } from '@/core/log/logger';
import { isFlagEnabled } from '@/core/flags/flags';
import type { Settings } from '@/core/settings/schema';
import { newId } from '@/core/util/id';
import {
  draftSendTasks,
  latestDraftSendTask,
  MAX_MESSAGE_LENGTH,
  queueMessage,
  type OutboxSource,
} from '@/features/messages/outbox';
import { notify } from '@/features/notifications/notify';
import type { DeliveryStatus, DomainEvent, Order, Task } from '@/shared/models';
import { decryptItem } from './items';
import { checkLowStock } from './lowstock';
import {
  canDeliveryTransition,
  toDelivery,
  type DeliveryChannel,
  type DeliveryReason,
  type DeliveryRecord,
  type Pool,
} from './model';
import { findPoolForOrder, getPool, parseOrderQuantity } from './pools';
import { getDelivery, markItemsDelivered, releaseDelivery, reserveForOrder } from './reservation';
import {
  MASK,
  privateChatId,
  renderDeliveryMessage,
  renderMaskedMessage,
  type DeliveryVars,
} from './template';
import { reportAutomationFailure } from '@/core/events/failures';

export interface DeliveryDeps {
  getSettings: () => Promise<Settings>;
  automationContext: () => Promise<AutomationContext>;
  /** The seller's FunPay user id (from the last observed session). */
  selfUserId: () => Promise<string | null>;
  now?: () => number;
}

const nowOf = (deps: Pick<DeliveryDeps, 'now'>) => (deps.now ? deps.now() : Date.now());

const TERMINAL_TASK: ReadonlySet<Task['status']> = new Set(['done', 'failed', 'cancelled']);

/** A `sending` delivery without a task for this long is treated as uncertain (worker died mid-way). */
const ORPHAN_SENDING_MS = 5 * 60_000;

export function isUncertainError(message: string | null | undefined): boolean {
  return /outcome uncertain/i.test(message ?? '');
}

/** Guarded, transactional status update. Returns null when the delivery is not in an allowed state. */
async function updateDelivery(
  orderId: string,
  allowedFrom: readonly DeliveryStatus[],
  patch: (d: DeliveryRecord) => Partial<DeliveryRecord>,
  now: number,
): Promise<DeliveryRecord | null> {
  const db = getDb();
  return db.transaction('rw', db.deliveries, async () => {
    const raw = await db.deliveries.get(orderId);
    if (!raw) return null;
    const d = toDelivery(raw);
    if (!allowedFrom.includes(d.status)) return null;
    const next: DeliveryRecord = { ...d, ...patch(d), updatedAt: new Date(now).toISOString() };
    if (next.status !== d.status && !canDeliveryTransition(d.status, next.status))
      throw new Error(`Invalid delivery transition ${d.status} → ${next.status}`);
    await db.deliveries.put(next);
    return next;
  });
}

function varsFor(d: DeliveryRecord, order: Order | undefined): DeliveryVars {
  return {
    orderId: d.orderId,
    buyer: d.buyerName || order?.counterpartyName || '',
    quantity: d.quantity,
    lot: order?.description ?? '',
    category: order?.categoryName ?? '',
    price: order?.price ?? null,
  };
}

// ---------------------------------------------------------------------------------------------
// Reservation entry points
// ---------------------------------------------------------------------------------------------

export type ReserveFlowResult =
  | { kind: 'skipped'; reason: 'baseline' | 'not_sale' | 'disabled' | 'order_unknown' | 'no_order_id' }
  | { kind: 'no_pool' }
  | { kind: 'ambiguous'; poolIds: string[] }
  | { kind: 'existing'; delivery: DeliveryRecord }
  | { kind: 'out_of_stock'; delivery: DeliveryRecord }
  | { kind: 'reserved'; delivery: DeliveryRecord; prepared: PrepareResult | null };

/** ORDER_PAID handler: reserve stock for new (non-baseline) sales and prepare the delivery. */
export async function handleOrderPaid(event: DomainEvent, deps: DeliveryDeps): Promise<ReserveFlowResult> {
  const p = event.payload;
  if (p['baseline'] === true) return { kind: 'skipped', reason: 'baseline' };
  if (p['direction'] !== 'sale') return { kind: 'skipped', reason: 'not_sale' };
  const orderId = typeof p['orderId'] === 'string' ? p['orderId'] : '';
  if (!orderId) return { kind: 'skipped', reason: 'no_order_id' };
  const settings = await deps.getSettings();
  if (!isFlagEnabled('inventory', settings.flags) || !settings.inventory.autoReserve)
    return { kind: 'skipped', reason: 'disabled' };
  return reserveAndPrepare(orderId, { auto: true }, deps);
}

export async function reserveAndPrepare(
  orderId: string,
  opts: { auto: boolean; poolId?: string; refill?: boolean },
  deps: DeliveryDeps,
): Promise<ReserveFlowResult> {
  const db = getDb();
  const order = await db.orders.get(orderId);
  if (!order) {
    if (opts.auto) return { kind: 'skipped', reason: 'order_unknown' };
    throw new Error('Order not found — sync your sales first');
  }
  if (order.direction !== 'sale') {
    if (opts.auto) return { kind: 'skipped', reason: 'not_sale' };
    throw new Error('Only sales can be fulfilled');
  }
  let pool: Pool;
  if (opts.poolId) {
    const p = await getPool(opts.poolId);
    if (!p) throw new Error('Pool not found');
    pool = p;
  } else {
    const m = await findPoolForOrder(order, { autoOnly: opts.auto });
    if (m.kind === 'none') return { kind: 'no_pool' };
    if (m.kind === 'ambiguous') {
      await log.warn({
        source: 'inventory',
        message: `Order ${orderId} matches several pools; choose one manually`,
        details: { pools: m.pools.map((x) => x.id) },
      });
      await notify({
        kind: 'inventory',
        title: `Choose a pool for order #${orderId}`,
        body: `The order matches ${m.pools.length} pools (${m.pools.map((x) => x.name).join(', ')}). Reserve it manually in Inventory.`,
        dedupeKey: `inv-ambiguous:${orderId}`,
      });
      return { kind: 'ambiguous', poolIds: m.pools.map((x) => x.id) };
    }
    pool = m.pool;
  }
  const res = await reserveForOrder({
    orderId,
    pool,
    quantity: parseOrderQuantity(order.description),
    buyerId: order.counterpartyId,
    buyerName: order.counterpartyName,
    now: nowOf(deps),
    refill: opts.refill,
  });
  if (res.kind === 'existing') return res;
  const settings = await deps.getSettings();
  await checkLowStock(pool, { notify: settings.inventory.notifyLowStock });
  if (res.kind === 'out_of_stock') {
    await log.warn({
      source: 'inventory',
      message: `Order ${orderId}: not enough stock (needed ${res.needed}, available ${res.available})`,
      details: { poolId: pool.id },
    });
    await notify({
      kind: 'inventory',
      title: `Not enough stock for order #${orderId}`,
      body: `Pool "${pool.name}" has ${res.available} of ${res.needed} needed item(s). Add stock, then reserve again in Inventory.`,
      dedupeKey: `inv-oos:${orderId}`,
    });
    return { kind: 'out_of_stock', delivery: res.delivery };
  }
  await log.info({
    source: 'inventory',
    message: `Reserved ${res.delivery.itemIds.length} item(s) for order ${orderId}`,
    details: { poolId: pool.id },
  });
  const prepared = await prepareDelivery(orderId, opts.auto ? 'auto' : 'draft', deps).catch(
    async (e: Error) => {
      await log.error({
        source: 'inventory',
        message: `Order ${orderId}: preparing the delivery failed: ${e.message}`,
      });
      return null;
    },
  );
  const fresh = (await getDelivery(orderId)) ?? res.delivery;
  return { kind: 'reserved', delivery: fresh, prepared };
}

// ---------------------------------------------------------------------------------------------
// Prepare / send
// ---------------------------------------------------------------------------------------------

export type PrepareMode = 'auto' | 'draft' | 'send';

export interface PrepareResult {
  status: DeliveryStatus;
  channel: DeliveryChannel;
  reason: DeliveryReason | null;
  taskId?: string;
  draftId?: string;
}

function allowedFor(mode: PrepareMode, confirmUncertain: boolean): DeliveryStatus[] {
  if (mode === 'auto') return ['reserved'];
  if (mode === 'draft') return ['reserved', 'manual', 'failed', 'uncertain'];
  return confirmUncertain ? ['reserved', 'manual', 'failed', 'uncertain'] : ['reserved', 'manual', 'failed'];
}

/**
 * Render the delivery and either queue it (automatic / explicit send) or prepare a draft.
 * `send` is an explicit seller action; from `uncertain` it additionally needs `confirmUncertain`.
 */
export async function prepareDelivery(
  orderId: string,
  mode: PrepareMode,
  deps: DeliveryDeps,
  opts: { confirmUncertain?: boolean } = {},
): Promise<PrepareResult> {
  const db = getDb();
  const now = nowOf(deps);
  const d = await getDelivery(orderId);
  if (!d) throw new Error('Nothing is reserved for this order yet');
  const allowed = allowedFor(mode, !!opts.confirmUncertain);
  if (!allowed.includes(d.status)) {
    if (d.status === 'uncertain' && mode === 'send')
      throw new Error(
        'The previous send may have reached the buyer. Check the chat, then confirm the re-send.',
      );
    throw new Error(`Delivery is ${d.status}; this action is not available`);
  }
  if (d.itemIds.length === 0)
    throw new Error('No items are reserved for this order (out of stock) — reserve again after restocking');
  const pool = await getPool(d.poolId);
  if (!pool) throw new Error('The pool of this delivery no longer exists');
  const order = await db.orders.get(orderId);
  const vars = varsFor(d, order);
  const preview = renderMaskedMessage(pool.deliveryTemplate, d.itemIds.length, vars);
  const chatId =
    d.chatId ?? privateChatId(await deps.selfUserId(), d.buyerId ?? order?.counterpartyId ?? null);

  const toManual = async (reason: DeliveryReason): Promise<PrepareResult> => {
    const next = await updateDelivery(
      orderId,
      allowed,
      () => ({ status: 'manual', reason, messagePreview: preview, chatId }),
      now,
    );
    await log.info({
      source: 'inventory',
      message: `Order ${orderId}: delivery needs the seller (${reason})`,
    });
    return { status: next?.status ?? d.status, channel: next?.channel ?? d.channel, reason };
  };
  if (!chatId) return toManual('chat_unknown');

  const items = await db.inventoryItems.bulkGet(d.itemIds);
  if (items.some((i) => !i || i.orderId !== orderId || i.status !== 'reserved'))
    return toManual('items_missing');
  const plain: string[] = [];
  for (const it of items) plain.push(await decryptItem(it!));
  const text = renderDeliveryMessage(pool.deliveryTemplate, plain, vars).trim();
  if (text.length > MAX_MESSAGE_LENGTH) return toManual('message_too_long');

  if (mode === 'auto') {
    const settings = await deps.getSettings();
    const st = evaluateFeature(settings, 'autoDelivery', await deps.automationContext());
    if (st.status === 'running')
      return queueSend(
        d,
        chatId,
        text,
        preview,
        'delivery',
        () => `delivery:${orderId}`,
        'auto',
        allowed,
        now,
      );
    if (!settings.inventory.prepareDrafts) {
      const next = await updateDelivery(
        orderId,
        allowed,
        () => ({ reason: 'auto_not_running', messagePreview: preview, chatId }),
        now,
      );
      return { status: next?.status ?? d.status, channel: d.channel, reason: 'auto_not_running' };
    }
    return createDraft(d, chatId, text, preview, 'auto_not_running', allowed, now);
  }
  if (mode === 'draft') return createDraft(d, chatId, text, preview, null, allowed, now);

  // Explicit send: a pending draft for this delivery is withdrawn first so it cannot be sent too.
  await withdrawDraft(d.draftId, preview, now);
  return queueSend(
    d,
    chatId,
    text,
    preview,
    'manual',
    (n) => (n === 0 ? `delivery:${orderId}` : `delivery:${orderId}:retry${n}`),
    'manual_send',
    allowed,
    now,
  );
}

async function queueSend(
  d: DeliveryRecord,
  chatId: string,
  text: string,
  preview: string,
  source: OutboxSource,
  keyFor: (attempt: number) => string,
  channel: DeliveryChannel,
  allowed: readonly DeliveryStatus[],
  now: number,
): Promise<PrepareResult> {
  // Claim first (→ sending) so a concurrent refund/release cannot race with the queued message.
  const claimed = await updateDelivery(
    d.orderId,
    allowed,
    (cur) => ({
      status: 'sending',
      channel,
      chatId,
      taskId: null,
      draftId: channel === 'manual_send' ? null : cur.draftId,
      messagePreview: preview,
      reason: null,
      lastError: null,
    }),
    now,
  );
  if (!claimed) throw new Error('Delivery changed meanwhile — refresh and try again');
  let task: Task | null = null;
  let created = false;
  let attempt = claimed.attempts;
  try {
    // Explicit sends never reuse a finished task: a key that already belongs to a done/failed/
    // cancelled task moves on to the next `:retry<n>` key. The automatic key is constant.
    for (let i = 0; i < 10; i++) {
      ({ task, created } = await queueMessage({ chatId, text, source, idempotencyKey: keyFor(attempt) }));
      if (created || channel === 'auto' || !TERMINAL_TASK.has(task.status)) break;
      attempt++;
    }
  } catch (e) {
    await updateDelivery(
      d.orderId,
      ['sending'],
      () => ({ status: 'failed', reason: 'send_failed', lastError: (e as Error).message }),
      now,
    );
    throw e;
  }
  if (!task) throw new Error('Could not queue the delivery');
  const queued = task;
  const linked = await updateDelivery(
    d.orderId,
    ['sending'],
    () => ({ taskId: queued.id, attempts: created ? attempt + 1 : attempt }),
    now,
  );
  // A refund that arrived between the claim and the enqueue is honoured here.
  if (linked?.refundedAt) await cancelIfRefunded(d.orderId, now);
  await log.info({
    source: 'inventory',
    message: `Order ${d.orderId}: delivery queued (${channel})`,
    details: { taskId: queued.id },
  });
  return { status: 'sending', channel, reason: null, taskId: queued.id };
}

async function createDraft(
  d: DeliveryRecord,
  chatId: string,
  text: string,
  preview: string,
  reason: DeliveryReason | null,
  allowed: readonly DeliveryStatus[],
  now: number,
): Promise<PrepareResult> {
  const db = getDb();
  await withdrawDraft(d.draftId, preview, now);
  const draft: DraftReply = {
    id: newId('draft'),
    chatId,
    triggerMessageId: null,
    source: 'delivery',
    text,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    sendAt: null,
    meta: { orderId: d.orderId, poolId: d.poolId, kind: 'delivery' },
  };
  await db.drafts.add(draft);
  const next = await updateDelivery(
    d.orderId,
    allowed,
    () => ({
      status: 'reserved',
      channel: 'draft',
      draftId: draft.id,
      chatId,
      messagePreview: preview,
      reason,
      lastError: null,
    }),
    now,
  );
  if (!next) {
    await withdrawDraft(draft.id, preview, now);
    throw new Error('Delivery changed meanwhile — refresh and try again');
  }
  await log.info({ source: 'inventory', message: `Order ${d.orderId}: delivery draft prepared for review` });
  return { status: 'reserved', channel: 'draft', reason, draftId: draft.id };
}

/** Dismiss a still-pending delivery draft and mask its text. */
async function withdrawDraft(draftId: string | null, masked: string, now: number): Promise<void> {
  if (!draftId) return;
  const db = getDb();
  await db.transaction('rw', db.drafts, async () => {
    const dr = await db.drafts.get(draftId);
    if (dr && (dr.status === 'pending' || dr.status === 'approved'))
      await db.drafts.update(draftId, { status: 'dismissed', text: masked || MASK, updatedAt: now });
  });
}

/** Mask the goods in the outbox task / draft once a delivery is resolved (sent or cancelled). */
export async function scrubPlaintext(d: DeliveryRecord, now = Date.now()): Promise<void> {
  const db = getDb();
  const masked = d.messagePreview || MASK;
  const taskIds = new Set<string>();
  if (d.taskId) taskIds.add(d.taskId);
  if (d.draftId) {
    const dr = await db.drafts.get(d.draftId);
    if (dr)
      await db.drafts.update(d.draftId, {
        text: masked,
        status: dr.status === 'pending' || dr.status === 'approved' ? 'dismissed' : dr.status,
        updatedAt: now,
      });
    for (const t of await draftSendTasks(d.draftId)) taskIds.add(t.id);
  }
  for (const id of taskIds) {
    await db.transaction('rw', db.tasks, async () => {
      const t = await db.tasks.get(id);
      if (
        t &&
        (t.status === 'done' || t.status === 'failed' || t.status === 'cancelled') &&
        typeof t.payload['text'] === 'string'
      ) {
        await db.tasks.update(id, { payload: { ...t.payload, text: masked } });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Outcome watcher (runs on the background tick)
// ---------------------------------------------------------------------------------------------

export interface SyncResult {
  sent: string[];
  uncertain: string[];
  failed: string[];
  manual: string[];
}

export async function syncDeliveryOutcomes(deps: Pick<DeliveryDeps, 'now'> = {}): Promise<SyncResult> {
  const db = getDb();
  const now = nowOf(deps);
  const out: SyncResult = { sent: [], uncertain: [], failed: [], manual: [] };
  const active = (
    await db.deliveries.where('status').anyOf(['sending', 'reserved', 'failed', 'uncertain']).toArray()
  ).map(toDelivery);
  for (const d of active) {
    try {
      if (d.status === 'sending') {
        if (!d.taskId) {
          if (
            now - Date.parse(d.updatedAt) > ORPHAN_SENDING_MS &&
            (await markUncertain(d, 'task_missing', 'The send was interrupted before it was queued', now))
          )
            out.uncertain.push(d.orderId);
          continue;
        }
        const t = await db.tasks.get(d.taskId);
        if (!t) {
          if (await markUncertain(d, 'task_missing', 'The send task record is missing', now))
            out.uncertain.push(d.orderId);
        } else if (t.status === 'done') {
          if (await markSent(d, now)) out.sent.push(d.orderId);
        } else if (t.status === 'failed') {
          if (isUncertainError(t.lastError)) {
            if (await markUncertain(d, 'outcome_uncertain', t.lastError ?? '', now))
              out.uncertain.push(d.orderId);
          } else if (await markFailed(d, 'send_failed', t.lastError ?? 'Send failed', now))
            out.failed.push(d.orderId);
        } else if (t.status === 'cancelled') {
          if (await markFailed(d, 'cancelled_by_stop', t.lastError ?? 'Cancelled', now))
            out.failed.push(d.orderId);
        }
        continue;
      }
      if (d.channel === 'draft' && d.draftId) {
        const dr = await db.drafts.get(d.draftId);
        if (!dr) {
          if (
            d.status === 'reserved' &&
            (await updateDelivery(
              d.orderId,
              ['reserved'],
              () => ({ status: 'manual', reason: 'draft_deleted', draftId: null, channel: 'none' }),
              now,
            ))
          )
            out.manual.push(d.orderId);
        } else if (dr.status === 'sent') {
          if (await markSent(d, now)) out.sent.push(d.orderId);
        } else if (dr.status === 'failed' && d.status === 'reserved') {
          const t = await latestDraftSendTask(dr.id);
          // Unknown outcome is treated as uncertain: never invite a blind re-send.
          if (!t || isUncertainError(t.lastError)) {
            if (
              await markUncertain(
                d,
                'outcome_uncertain',
                t?.lastError ?? 'The draft send failed with an unknown outcome',
                now,
              )
            )
              out.uncertain.push(d.orderId);
          } else if (await markFailed(d, 'send_failed', t.lastError ?? 'Send failed', now))
            out.failed.push(d.orderId);
        } else if (dr.status === 'dismissed' && d.status === 'reserved') {
          if (
            await updateDelivery(
              d.orderId,
              ['reserved'],
              () => ({ status: 'manual', reason: 'draft_dismissed', draftId: null, channel: 'none' }),
              now,
            )
          )
            out.manual.push(d.orderId);
        }
      }
    } catch (e) {
      await log.warn({
        source: 'inventory',
        message: `Delivery check for order ${d.orderId} failed: ${(e as Error).message}`,
      });
    }
  }
  return out;
}

async function markSent(d: DeliveryRecord, now: number): Promise<boolean> {
  const next = await markItemsDelivered(d.orderId, now);
  if (!next) return false;
  await scrubPlaintext(next, now);
  await log.info({ source: 'inventory', message: `Order ${d.orderId}: goods delivered` });
  if (d.refundedAt) {
    await notify({
      kind: 'inventory',
      title: `Order #${d.orderId} was refunded after delivery`,
      body: 'The goods were delivered before FunPay reported the refund. Review the order on FunPay.',
      dedupeKey: `inv-refund-after:${d.orderId}`,
    });
  }
  return true;
}

async function markUncertain(
  d: DeliveryRecord,
  reason: DeliveryReason,
  error: string,
  now: number,
): Promise<boolean> {
  const next = await updateDelivery(
    d.orderId,
    ['sending', 'reserved'],
    () => ({ status: 'uncertain', reason, lastError: error.slice(0, 500) }),
    now,
  );
  if (!next) return false;
  await log.warn({
    source: 'inventory',
    message: `Order ${d.orderId}: delivery outcome uncertain — check the chat manually`,
    hint: 'Mark it as sent, or re-send after checking the chat. FunPro never re-sends automatically.',
  });
  await notify({
    kind: 'failure',
    title: `Check delivery for order #${d.orderId}`,
    body: 'FunPro could not confirm whether the goods were sent. Check the chat, then mark the delivery as sent or re-send it.',
    url: d.chatId ? `https://funpay.com/chat/?node=${encodeURIComponent(d.chatId)}` : null,
    dedupeKey: `inv-uncertain:${d.orderId}:${d.attempts}`,
  });
  await reportAutomationFailure({
    source: 'delivery',
    message: `Order ${d.orderId}: delivery outcome uncertain`,
    key: `uncertain:${d.orderId}`,
    notified: true,
  });
  return true;
}

async function markFailed(
  d: DeliveryRecord,
  reason: DeliveryReason,
  error: string,
  now: number,
): Promise<boolean> {
  const next = await updateDelivery(
    d.orderId,
    ['sending', 'reserved'],
    () => ({ status: 'failed', reason, lastError: error.slice(0, 500) }),
    now,
  );
  if (!next) return false;
  if (next.refundedAt) {
    // The order was refunded while the send was in flight and the send definitely failed.
    const rel = await releaseDelivery(d.orderId, 'refunded', { now });
    if (rel) await scrubPlaintext(rel.delivery, now);
    await log.info({
      source: 'inventory',
      message: `Order ${d.orderId}: refunded; reserved items returned to stock`,
    });
    return true;
  }
  await log.warn({
    source: 'inventory',
    message: `Order ${d.orderId}: delivery failed: ${error.slice(0, 200)}`,
    hint: 'Items stay reserved. Retry from Inventory → Deliveries.',
  });
  await notify({
    kind: 'failure',
    title: `Delivery failed for order #${d.orderId}`,
    body: `${error.slice(0, 200)}. The items stay reserved; retry from Inventory.`,
    dedupeKey: `inv-failed:${d.orderId}:${d.attempts}`,
  });
  await reportAutomationFailure({
    source: 'delivery',
    message: `Order ${d.orderId}: ${error.slice(0, 200)}`,
    key: `failed:${d.orderId}`,
    notified: true,
  });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Refunds and explicit seller actions
// ---------------------------------------------------------------------------------------------

export type RefundOutcome = 'none' | 'released' | 'flagged';

/** ORDER_CANCELLED (refund): release reserved items unless the goods were (possibly) sent. */
export async function handleOrderCancelled(
  event: DomainEvent,
  deps: Pick<DeliveryDeps, 'now'> = {},
): Promise<RefundOutcome> {
  const orderId = typeof event.payload['orderId'] === 'string' ? event.payload['orderId'] : '';
  if (!orderId || event.payload['direction'] === 'purchase') return 'none';
  return refundDelivery(orderId, nowOf(deps));
}

export async function refundDelivery(orderId: string, now: number): Promise<RefundOutcome> {
  const d = await getDelivery(orderId);
  if (!d || d.status === 'cancelled') return 'none';
  if (d.status === 'reserved' || d.status === 'manual' || d.status === 'failed') {
    await withdrawDraft(d.draftId, d.messagePreview, now);
    const rel = await releaseDelivery(orderId, 'refunded', { now });
    if (rel) await scrubPlaintext(rel.delivery, now);
    await log.info({
      source: 'inventory',
      message: `Order ${orderId} refunded: ${rel?.released ?? 0} reserved item(s) returned to stock`,
    });
    return 'released';
  }
  if (d.status === 'sending' && (await cancelIfRefunded(orderId, now, true))) return 'released';
  const iso = new Date(now).toISOString();
  await updateDelivery(orderId, ['sending', 'sent', 'uncertain'], () => ({ refundedAt: iso }), now);
  if (d.status === 'sent' || d.status === 'uncertain') {
    await notify({
      kind: 'inventory',
      title: `Order #${orderId} refunded`,
      body:
        d.status === 'sent'
          ? 'The goods were already delivered for this order.'
          : 'The delivery outcome was uncertain; check the chat — the goods may have been delivered.',
      dedupeKey: `inv-refund:${orderId}`,
    });
  }
  return 'flagged';
}

/**
 * If the delivery is `sending` and its task has not started, cancel the task and release the items —
 * all in one transaction with the outbox claim, so a message is never sent after its items were
 * returned to stock.
 */
async function cancelIfRefunded(orderId: string, now: number, markRefund = false): Promise<boolean> {
  const db = getDb();
  const at = new Date(now).toISOString();
  const done = await db.transaction('rw', db.tasks, db.deliveries, db.inventoryItems, async () => {
    const raw = await db.deliveries.get(orderId);
    if (!raw) return false;
    const d = toDelivery(raw);
    if (d.status !== 'sending' || !d.taskId) {
      if (markRefund && d.status === 'sending') {
        const flagged: DeliveryRecord = { ...d, refundedAt: at, updatedAt: at };
        await db.deliveries.put(flagged);
      }
      return false;
    }
    const t = await db.tasks.get(d.taskId);
    if (!t || !(t.status === 'pending' || t.status === 'awaiting_tab' || t.status === 'blocked')) {
      if (markRefund) {
        const flagged: DeliveryRecord = { ...d, refundedAt: at, updatedAt: at };
        await db.deliveries.put(flagged);
      }
      return false;
    }
    await db.tasks.put({ ...t, status: 'cancelled', lastError: 'Cancelled: order refunded', updatedAt: now });
    for (const id of d.itemIds) {
      await db.inventoryItems
        .where('id')
        .equals(id)
        .and((i) => i.status === 'reserved' && i.orderId === orderId)
        .modify({ status: 'available', orderId: null, reservedAt: null });
    }
    const cancelled: DeliveryRecord = {
      ...d,
      status: 'cancelled',
      reason: 'refunded',
      refundedAt: d.refundedAt ?? at,
      updatedAt: at,
    };
    await db.deliveries.put(cancelled);
    return true;
  });
  if (done) {
    const d = await getDelivery(orderId);
    if (d) await scrubPlaintext(d, now);
    await log.info({
      source: 'inventory',
      message: `Order ${orderId} refunded before sending: queued message cancelled, items returned to stock`,
    });
  }
  return done;
}

/** Seller confirms the goods reached the buyer (e.g. after checking the chat). */
export async function markDeliveredManually(orderId: string, now = Date.now()): Promise<DeliveryRecord> {
  const d = await getDelivery(orderId);
  if (!d) throw new Error('Delivery not found');
  if (d.status === 'sending') throw new Error('A send is in progress — wait for its outcome');
  if (d.status === 'cancelled') throw new Error('Delivery was cancelled');
  await withdrawDraft(d.draftId, d.messagePreview, now);
  const next = await markItemsDelivered(orderId, now);
  if (!next) throw new Error('Delivery not found');
  await scrubPlaintext(next, now);
  await log.info({ source: 'inventory', message: `Order ${orderId}: marked as delivered by the seller` });
  return next;
}

/** Seller cancels the delivery and returns its items to stock. */
export async function releaseByUser(
  orderId: string,
  opts: { confirmUncertain?: boolean; now?: number } = {},
): Promise<number> {
  const now = opts.now ?? Date.now();
  const d = await getDelivery(orderId);
  if (!d) throw new Error('Delivery not found');
  await withdrawDraft(d.draftId, d.messagePreview, now);
  const rel = await releaseDelivery(orderId, 'released_by_user', {
    allowUncertain: opts.confirmUncertain,
    now,
  });
  if (!rel) throw new Error('Delivery not found');
  await scrubPlaintext(rel.delivery, now);
  await log.info({
    source: 'inventory',
    message: `Order ${orderId}: delivery cancelled by the seller, ${rel.released} item(s) returned to stock`,
  });
  return rel.released;
}

/**
 * Render the full message for the seller (explicit reveal in the dashboard, e.g. to deliver by
 * hand when the chat id is unknown). Returned, never stored.
 */
export async function renderForSeller(orderId: string): Promise<string> {
  const db = getDb();
  const d = await getDelivery(orderId);
  if (!d) throw new Error('Delivery not found');
  const pool = await getPool(d.poolId);
  if (!pool) throw new Error('Pool not found');
  const items = await db.inventoryItems.bulkGet(d.itemIds);
  const plain: string[] = [];
  for (const it of items) if (it && it.orderId === orderId) plain.push(await decryptItem(it));
  if (plain.length === 0) throw new Error('No items are reserved for this order');
  await log.info({
    source: 'inventory',
    message: `Order ${orderId}: delivery message revealed by the seller`,
  });
  return renderDeliveryMessage(pool.deliveryTemplate, plain, varsFor(d, await db.orders.get(orderId)));
}
