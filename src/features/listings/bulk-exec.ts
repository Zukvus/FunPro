/**
 * Bulk-edit execution. Flow (all state persisted, MV3-safe):
 *
 *  executeBulkPlan(planId)   policy checks → backup in db.backups (kind 'bulk_edit') → one durable
 *                            `bulk_edit` task per listing (idempotency key `planId:listingId`).
 *  processBulkQueue()        claims ONE task at a time, re-reads the live offer editor, applies the
 *                            optimistic-concurrency / only-if-empty / no-op checks, submits through
 *                            the FunPay tab and records a per-item result (with the live "before"
 *                            values, used by restore). Sequential, spaced, time-boxed per invocation.
 *  cancelBulkPlan(planId)    cancels every not-yet-started task of the plan.
 *
 * FunPay access is injected (`deps.exec`) so the whole flow is unit-testable.
 */
import { CAPABILITIES } from '@/adapters/funpay/capabilities';
import { getDb, type BackupRecord } from '@/core/db/db';
import type { LogInput } from '@/core/log/logger';
import { cancelTask, claimDueTasks, completeTask, deferTask, enqueue, failTask } from '@/core/queue/queue';
import type { Settings } from '@/core/settings/schema';
import { newId } from '@/core/util/id';
import type { NotifyInput } from '@/features/notifications/notify';
import type { Listing, Task } from '@/shared/models';
import { z } from 'zod';
import {
  actionableItems,
  CHANGE_KEYS,
  deleteConfirmationPhrase,
  EN_DESC,
  EN_SUMMARY,
  MAX_EXECUTABLE_ITEMS,
  priceMatches,
  type BulkPlan,
  type ChangeKey,
  type Changes,
  type ItemResult,
  type PlanItem,
  type PlanStatus,
} from './bulk-plan';
import {
  computeProgress,
  getActivePlanIds,
  isPlanFinished,
  loadPlan,
  loadResults,
  planTasks,
  prunePlans,
  reportFromProgress,
  setPlanActive,
  updatePlan,
  writeResult,
} from './bulk-store';
import { formatPriceField, parsePriceInput } from './commission';
import {
  capabilityUsable,
  errorMessage,
  isNoTabError,
  isUnknownCommandError,
  ListingsActionError,
} from './errors';
import { isNoopChange, liveChangeValue, OfferFormSchema, readLiveValues } from './offer-form';

export type BulkExecCommand =
  | { action: 'getOfferForm'; offerId: string }
  | { action: 'saveOffer'; offerId: string; changes: Record<string, string> }
  | { action: 'deleteOffer'; offerId: string };

export interface ListingsLogger {
  info: (i: LogInput) => Promise<void>;
  warn: (i: LogInput) => Promise<void>;
  error: (i: LogInput) => Promise<void>;
}

export interface BulkExecDeps {
  exec: (cmd: BulkExecCommand) => Promise<unknown>;
  getSettings: () => Promise<Settings>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: ListingsLogger;
  notify?: (input: NotifyInput) => Promise<unknown>;
  /** Extra pause between listings on top of the transport's own request spacing (default 1 s). */
  gapMs?: number;
  /** Time box per invocation; the 1-minute tick resumes the rest (default 4 min). */
  budgetMs?: number;
}

/** Retry delay while no logged-in FunPay tab is open (no attempt is consumed). */
export const BULK_NO_TAB_RETRY_MS = 2 * 60_000;

const SaveResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string().max(2000)).max(50).default([]),
});
const PayloadSchema = z.object({
  planId: z.string().min(1).max(100),
  listingId: z.string().regex(/^\d{1,12}$/),
});

const noopLog: ListingsLogger = {
  info: async () => undefined,
  warn: async () => undefined,
  error: async () => undefined,
};

function nowOf(deps: Pick<BulkExecDeps, 'now'>): number {
  return (deps.now ?? Date.now)();
}

/** Bulk edits are user-initiated but change FunPay: emergency stop and the live-actions acknowledgement apply. */
export function assertLiveActionsAllowed(settings: Settings): void {
  if (settings.automation.state === 'stopped') {
    throw new ListingsActionError(
      'Emergency stop is active — resume automation before changing offers on FunPay.',
      'emergency_stop',
    );
  }
  if (!settings.automation.liveActionsAcknowledged) {
    throw new ListingsActionError(
      'Confirm live FunPay actions in Automation settings first.',
      'awaiting_authorization',
    );
  }
}

/** Static validation of a stored plan before anything is enqueued. */
export function validatePlanForExecution(plan: BulkPlan): PlanItem[] {
  const items = actionableItems(plan);
  if (items.length === 0) throw new ListingsActionError('This plan changes nothing.', 'invalid_plan');
  if (items.length > MAX_EXECUTABLE_ITEMS)
    throw new ListingsActionError(
      `Too many listings in one plan (max ${MAX_EXECUTABLE_ITEMS}). Split the selection.`,
      'too_large',
    );
  const isDelete = plan.op.kind === 'delete';
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it.listingId))
      throw new ListingsActionError(`Duplicate listing ${it.listingId} in plan`, 'invalid_plan');
    seen.add(it.listingId);
    const keys = Object.keys(it.changes) as ChangeKey[];
    if (keys.length === 0)
      throw new ListingsActionError(`Listing ${it.listingId} has no changes`, 'invalid_plan');
    for (const k of keys)
      if (!(CHANGE_KEYS as readonly string[]).includes(k))
        throw new ListingsActionError(`Field ${k} cannot be changed`, 'invalid_plan');
    if (isDelete) {
      if (keys.length !== 1 || it.changes.deleted !== '1' || !it.after.deleted)
        throw new ListingsActionError('Delete plans may only delete', 'invalid_plan');
    } else if ('deleted' in it.changes) {
      throw new ListingsActionError(
        'Deletion is only possible through a confirmed delete plan',
        'invalid_plan',
      );
    }
  }
  if (isDelete) {
    if (!capabilityUsable(CAPABILITIES.deleteOffer))
      throw new ListingsActionError('Deleting offers is not supported', 'unsupported');
    if (plan.confirmation !== deleteConfirmationPhrase(items.length)) {
      throw new ListingsActionError(
        `Type "${deleteConfirmationPhrase(items.length)}" to confirm deletion.`,
        'confirmation_required',
      );
    }
  } else if (!capabilityUsable(CAPABILITIES.editOffer)) {
    throw new ListingsActionError('Editing offers is not supported', 'unsupported');
  }
  return items;
}

export interface ExecuteResult {
  planId: string;
  queued: number;
  skipped: number;
  backupId: string | null;
  alreadyQueued: boolean;
}

export async function executeBulkPlan(planId: string, deps: BulkExecDeps): Promise<ExecuteResult> {
  const log = deps.log ?? noopLog;
  const now = nowOf(deps);
  assertLiveActionsAllowed(await deps.getSettings());
  const plan = await loadPlan(planId);
  if (!plan) throw new ListingsActionError('Plan not found — build the preview again.', 'not_found');
  if (plan.status !== 'draft') {
    if (plan.status === 'queued' || plan.status === 'running') {
      // Idempotent resume: (re-)enqueue every item; existing tasks are returned as-is by their key.
      const items = actionableItems(plan);
      await enqueueItems(planId, items, now);
      return {
        planId,
        queued: items.length,
        skipped: plan.items.length - items.length,
        backupId: plan.backupId,
        alreadyQueued: true,
      };
    }
    throw new ListingsActionError('This plan was already executed.', 'already_started');
  }
  const items = validatePlanForExecution(plan);

  const db = getDb();
  const rows = await db.listings.bulkGet(items.map((i) => i.listingId));
  const missing = items.filter((_, i) => !rows[i]).map((i) => i.listingId);
  if (missing.length)
    throw new ListingsActionError(
      `Unknown listing(s): ${missing.slice(0, 5).join(', ')} — only your own synced offers can be edited.`,
      'invalid_plan',
    );

  // 1. Backup first: a snapshot of every affected listing as FunPro knows it.
  const backup: BackupRecord = {
    id: newId('bak'),
    kind: 'bulk_edit',
    createdAt: now,
    label: plan.label.slice(0, 200),
    listings: rows as Listing[],
  };
  await db.backups.add(backup);

  // 2. Mark the plan queued BEFORE enqueuing so a concurrent worker never sees tasks of a draft plan.
  await updatePlan(planId, (p) => ({ ...p, status: 'queued', backupId: backup.id, queuedAt: now }));
  await setPlanActive(planId, true);

  // 3. One durable task per listing, in plan order.
  await enqueueItems(planId, items, now);
  // 4. Items skipped at planning time are reported right away so the report is complete.
  let skipped = 0;
  for (const it of plan.items) {
    if (!it.skip) continue;
    skipped++;
    await writeResult({
      planId,
      listingId: it.listingId,
      status: 'skipped',
      at: now,
      message: `skip:${it.skip}`,
      liveBefore: null,
      applied: null,
      uncertain: false,
    });
  }
  await prunePlans();
  await log.info({
    source: 'bulk-edit',
    message: `Bulk edit queued: "${plan.label}" — ${items.length} listing(s), ${skipped} skipped. Backup ${backup.id}.`,
  });
  return { planId, queued: items.length, skipped, backupId: backup.id, alreadyQueued: false };
}

/**
 * nextRunAt increases by 1 ms per item (all of them already due) so the queue processes listings
 * in plan order.
 */
async function enqueueItems(planId: string, items: readonly PlanItem[], now: number): Promise<void> {
  let i = 0;
  for (const it of items) {
    await enqueue({
      kind: 'bulk_edit',
      idempotencyKey: `${planId}:${it.listingId}`,
      payload: { planId, listingId: it.listingId },
      maxAttempts: 1,
      runAt: now - items.length + i++,
    });
  }
}

let processing = false;

/** Test helper. */
export function resetBulkProcessorForTests(): void {
  processing = false;
}

export interface ProcessResult {
  processed: number;
  busy?: boolean;
  stoppedReason?: 'emergency_stop' | 'no_tab' | 'budget';
}

/**
 * Process due bulk-edit tasks sequentially until none is left, no FunPay tab is available, the
 * emergency stop is pressed, or the time budget is used up. Re-entrant calls return immediately.
 */
export async function processBulkQueue(deps: BulkExecDeps): Promise<ProcessResult> {
  if (processing) return { processed: 0, busy: true };
  processing = true;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = deps.budgetMs ?? 4 * 60_000;
  const gap = deps.gapMs ?? 1000;
  const start = nowOf(deps);
  const result: ProcessResult = { processed: 0 };
  const cache = new Map<string, BulkPlan>();
  const touched = new Set<string>();
  try {
    for (const id of await getActivePlanIds()) touched.add(id);
    for (;;) {
      if (nowOf(deps) - start >= budget) {
        result.stoppedReason = 'budget';
        break;
      }
      const settings = await deps.getSettings();
      if (settings.automation.state === 'stopped') {
        result.stoppedReason = 'emergency_stop';
        break;
      }
      const [task] = await claimDueTasks(nowOf(deps), 1, ['bulk_edit']);
      if (!task) break;
      let outcome: TaskOutcome;
      try {
        outcome = await processTask(task, settings, deps, cache);
      } catch (e) {
        // Unexpected internal error: never retried (the request may have been sent), reported as uncertain.
        outcome = 'network';
        await failTask(task.id, `Outcome uncertain (internal error): ${errorMessage(e)}`, {
          retryable: false,
        });
        const p = PayloadSchema.safeParse(task.payload);
        if (p.success)
          await writeResult(
            itemResult(
              p.data.planId,
              p.data.listingId,
              nowOf(deps),
              'failed',
              `Outcome uncertain — check this offer on FunPay (${errorMessage(e)})`,
              { uncertain: true },
            ),
          ).catch(() => undefined);
        await (deps.log ?? noopLog).error({
          source: 'bulk-edit',
          message: `Bulk edit task failed unexpectedly: ${errorMessage(e)}`,
        });
      }
      result.processed++;
      if (typeof task.payload['planId'] === 'string') touched.add(task.payload['planId']);
      if (outcome === 'no_tab') {
        result.stoppedReason = 'no_tab';
        break;
      }
      if (outcome === 'network' && gap > 0) await sleep(gap);
    }
  } finally {
    try {
      for (const id of touched) await finalizeIfComplete(id, deps);
    } finally {
      processing = false;
    }
  }
  return result;
}

type TaskOutcome = 'network' | 'fast' | 'no_tab';

function itemResult(
  planId: string,
  listingId: string,
  at: number,
  status: ItemResult['status'],
  message: string,
  extra: Partial<ItemResult> = {},
): ItemResult {
  return {
    planId,
    listingId,
    status,
    at,
    message: message.slice(0, 2000),
    liveBefore: null,
    applied: null,
    uncertain: false,
    ...extra,
  };
}

async function processTask(
  task: Task,
  settings: Settings,
  deps: BulkExecDeps,
  cache: Map<string, BulkPlan>,
): Promise<TaskOutcome> {
  const log = deps.log ?? noopLog;
  const payload = PayloadSchema.safeParse(task.payload);
  if (!payload.success) {
    await failTask(task.id, 'Invalid bulk-edit task payload', { retryable: false });
    return 'fast';
  }
  const { planId, listingId } = payload.data;
  const at = () => nowOf(deps);
  let plan = cache.get(planId) ?? (await loadPlan(planId));
  if (!plan) {
    await failTask(task.id, 'Bulk-edit plan not found', { retryable: false });
    await writeResult(itemResult(planId, listingId, at(), 'failed', 'Plan not found'));
    return 'fast';
  }
  cache.set(planId, plan);
  if (plan.status === 'cancelling' || plan.status === 'cancelled') {
    await cancelTask(task.id);
    await writeResult(itemResult(planId, listingId, at(), 'cancelled', 'Cancelled'));
    return 'fast';
  }
  if (!settings.automation.liveActionsAcknowledged) {
    await failTask(task.id, 'Live FunPay actions are not confirmed', { retryable: false });
    await writeResult(
      itemResult(
        planId,
        listingId,
        at(),
        'blocked',
        'Live FunPay actions are not confirmed in Automation settings',
      ),
    );
    return 'fast';
  }
  const item = plan.items.find((i) => i.listingId === listingId && !i.skip);
  if (!item) {
    await completeTask(task.id);
    await writeResult(itemResult(planId, listingId, at(), 'skipped', 'Not part of the plan'));
    return 'fast';
  }
  if (plan.status === 'queued') {
    plan =
      (await updatePlan(planId, (p) => ({ ...p, status: 'running', startedAt: p.startedAt ?? at() }))) ??
      plan;
    cache.set(planId, plan);
  }

  // 1. Read the live offer editor (fresh values, ownership check).
  let rawForm: unknown;
  try {
    rawForm = await deps.exec({ action: 'getOfferForm', offerId: listingId });
  } catch (e) {
    if (isNoTabError(e)) {
      await deferTask(task.id, 'awaiting_tab', BULK_NO_TAB_RETRY_MS, errorMessage(e));
      return 'no_tab';
    }
    await failTask(task.id, errorMessage(e), { retryable: false });
    await writeResult(
      itemResult(planId, listingId, at(), 'failed', `Could not read the offer editor: ${errorMessage(e)}`),
    );
    return 'network';
  }
  const parsed = OfferFormSchema.safeParse(rawForm);
  if (!parsed.success || parsed.data.offerId !== listingId) {
    await failTask(task.id, 'Unexpected offer editor answer', { retryable: false });
    await writeResult(
      itemResult(
        planId,
        listingId,
        at(),
        'failed',
        'Unexpected answer from the FunPay tab (offer editor) — nothing changed',
      ),
    );
    return 'network';
  }
  const fields = parsed.data.fields;

  // 2. Optimistic concurrency for changes derived from the old price.
  if (item.expectPriceMinor !== null) {
    const live = readLiveValues(fields).priceMinor;
    if (!priceMatches(live, item.expectPriceMinor)) {
      await completeTask(task.id);
      await writeResult(
        itemResult(
          planId,
          listingId,
          at(),
          'conflict',
          `FunPay's editor shows ${live === null ? 'no price' : formatPriceField(live)} but the preview assumed ${formatPriceField(item.expectPriceMinor)} — nothing changed. Sync and plan again.`,
          { liveBefore: { price: liveChangeValue(fields, 'price') } },
        ),
      );
      return 'network';
    }
  }

  // 3. Effective changes against the live form.
  const isDelete = plan.op.kind === 'delete' && item.changes.deleted === '1';
  const effective: Changes = {};
  const liveBefore: Changes = {};
  if (isDelete) {
    for (const k of ['price', 'amount', 'active'] as const) liveBefore[k] = liveChangeValue(fields, k);
  } else {
    for (const [k, v] of Object.entries(item.changes) as [ChangeKey, string][]) {
      if (k === 'deleted') continue;
      if (item.onlyIfEmpty.includes(k) && liveChangeValue(fields, k).trim() !== '') continue;
      if (isNoopChange(fields, k, v)) continue;
      effective[k] = v;
      liveBefore[k] = liveChangeValue(fields, k);
    }
    if (Object.keys(effective).length === 0) {
      await completeTask(task.id);
      await writeResult(
        itemResult(planId, listingId, at(), 'skipped', 'Already up to date on FunPay — nothing submitted'),
      );
      return 'network';
    }
  }

  // 4. Submit through the FunPay tab.
  let raw: unknown;
  try {
    raw = isDelete
      ? await deps.exec({ action: 'deleteOffer', offerId: listingId })
      : await deps.exec({
          action: 'saveOffer',
          offerId: listingId,
          changes: effective as Record<string, string>,
        });
  } catch (e) {
    if (isNoTabError(e)) {
      // Thrown before any request is sent: safe to retry later without consuming the attempt.
      await deferTask(task.id, 'awaiting_tab', BULK_NO_TAB_RETRY_MS, errorMessage(e));
      return 'no_tab';
    }
    if (isUnknownCommandError(e)) {
      await failTask(task.id, 'Not available in this FunPro build', { retryable: false });
      await writeResult(
        itemResult(
          planId,
          listingId,
          at(),
          'failed',
          'This FunPro build cannot perform this action yet (content-script command missing) — nothing changed',
          { liveBefore },
        ),
      );
      return 'network';
    }
    // The request may have reached FunPay: never retried automatically.
    await failTask(task.id, `Outcome uncertain: ${errorMessage(e)}`, { retryable: false });
    await writeResult(
      itemResult(
        planId,
        listingId,
        at(),
        'failed',
        `Outcome uncertain — check this offer on FunPay: ${errorMessage(e)}`,
        { liveBefore, applied: isDelete ? { deleted: '1' } : effective, uncertain: true },
      ),
    );
    await log.warn({
      source: 'bulk-edit',
      message: `Offer ${listingId}: outcome uncertain (${errorMessage(e)})`,
    });
    return 'network';
  }
  const res = SaveResultSchema.safeParse(raw);
  if (!res.success) {
    await failTask(task.id, 'Unexpected save answer', { retryable: false });
    await writeResult(
      itemResult(planId, listingId, at(), 'failed', 'Unexpected answer from FunPay — check this offer', {
        liveBefore,
        applied: effective,
        uncertain: true,
      }),
    );
    return 'network';
  }
  if (res.data.ok) {
    await completeTask(task.id);
    await writeResult(
      itemResult(planId, listingId, at(), 'done', isDelete ? 'Deleted' : 'Saved', {
        liveBefore,
        applied: isDelete ? { deleted: '1' } : effective,
      }),
    );
    await applyLocally(listingId, effective, isDelete, at());
  } else {
    const msg = res.data.errors.join('; ') || 'FunPay rejected the change';
    await failTask(task.id, msg, { retryable: false });
    await writeResult(itemResult(planId, listingId, at(), 'failed', msg, { liveBefore }));
  }
  return 'network';
}

/** Mirror a successful change into the local listing so the table is immediately correct. */
async function applyLocally(
  listingId: string,
  changes: Changes,
  deleted: boolean,
  now: number,
): Promise<void> {
  const db = getDb();
  if (deleted) {
    await db.listings.delete(listingId);
    return;
  }
  const l = await db.listings.get(listingId);
  if (!l) return;
  const patch: Partial<Listing> = { updatedAt: new Date(now).toISOString() };
  if (changes.price !== undefined) {
    const p = parsePriceInput(changes.price);
    if (p !== null) patch.price = { ...l.price, amountMinor: p };
  }
  if (changes.amount !== undefined)
    patch.amount = /^\d+$/.test(changes.amount.trim()) ? Number.parseInt(changes.amount, 10) : l.amount;
  if (changes.active !== undefined) patch.active = changes.active !== '';
  if (changes[EN_SUMMARY] !== undefined) patch.titleEn = changes[EN_SUMMARY];
  if (changes[EN_DESC] !== undefined) patch.descriptionEn = changes[EN_DESC];
  await db.listings.update(listingId, patch);
}

const OPEN = new Set(['pending', 'running', 'awaiting_tab', 'blocked']);

/** When no task of the plan is open any more: write missing results, the final report, and notify. */
export async function finalizeIfComplete(
  planId: string,
  deps: Pick<BulkExecDeps, 'now' | 'notify' | 'log'>,
): Promise<PlanStatus | null> {
  const plan = await loadPlan(planId);
  if (!plan || plan.status === 'draft') return null;
  if (isPlanFinished(plan)) {
    await setPlanActive(planId, false);
    return plan.status;
  }
  const tasks = await planTasks(planId);
  if (tasks.some((t) => OPEN.has(t.status))) return null;
  const now = nowOf(deps);
  let results = await loadResults(planId);
  const have = new Set(results.map((r) => r.listingId));
  const taskBy = new Map(tasks.map((t) => [String(t.payload['listingId']), t]));
  for (const it of actionableItems(plan)) {
    if (have.has(it.listingId)) continue;
    const t = taskBy.get(it.listingId);
    const r: ItemResult =
      t?.status === 'cancelled'
        ? itemResult(planId, it.listingId, now, 'cancelled', t.lastError ?? 'Cancelled')
        : itemResult(
            planId,
            it.listingId,
            now,
            'failed',
            t?.lastError ?? 'Outcome unknown — check this offer on FunPay',
            { uncertain: /uncertain/i.test(t?.lastError ?? 'uncertain') },
          );
    await writeResult(r);
  }
  results = await loadResults(planId);
  const progress = computeProgress(plan, results, tasks);
  let status: PlanStatus;
  if (plan.status === 'cancelling' || progress.cancelled > 0) status = 'cancelled';
  else if (progress.failed + progress.conflict === 0) status = 'done';
  else if (progress.done === 0 && progress.skipped === 0) status = 'failed';
  else status = 'partial';
  const report = reportFromProgress(progress);
  await updatePlan(planId, (p) => ({ ...p, status, finishedAt: now, report }));
  await setPlanActive(planId, false);
  const body = `${plan.label}: ${report.done} changed, ${report.failed} failed, ${report.conflict} conflicts, ${report.skipped} unchanged, ${report.cancelled} cancelled`;
  await (deps.log ?? noopLog).info({
    source: 'bulk-edit',
    message: `Bulk edit finished (${status}). ${body}`,
  });
  await deps.notify?.({
    kind: report.failed + report.conflict > 0 ? 'failure' : 'system',
    title:
      status === 'done'
        ? 'Bulk edit finished'
        : status === 'cancelled'
          ? 'Bulk edit cancelled'
          : 'Bulk edit finished with problems',
    body,
    dedupeKey: `bulk:${planId}`,
  });
  return status;
}

/** Cancel all not-yet-started work of a plan. The in-flight listing (if any) finishes. */
export async function cancelBulkPlan(
  planId: string,
  deps: Pick<BulkExecDeps, 'now' | 'notify' | 'log'>,
): Promise<{ cancelled: number; status: PlanStatus | null }> {
  const plan = await loadPlan(planId);
  if (!plan) throw new ListingsActionError('Plan not found', 'not_found');
  if (isPlanFinished(plan)) return { cancelled: 0, status: plan.status };
  const now = nowOf(deps);
  if (plan.status === 'draft') {
    await updatePlan(planId, (p) => ({ ...p, status: 'cancelled', finishedAt: now }));
    return { cancelled: 0, status: 'cancelled' };
  }
  await updatePlan(planId, (p) => ({ ...p, status: 'cancelling' }));
  let cancelled = 0;
  for (const t of await planTasks(planId)) {
    if (t.status === 'pending' || t.status === 'awaiting_tab' || t.status === 'blocked') {
      await cancelTask(t.id);
      await writeResult(
        itemResult(planId, String(t.payload['listingId']), now, 'cancelled', 'Cancelled by you'),
      );
      cancelled++;
    }
  }
  await (deps.log ?? noopLog).info({
    source: 'bulk-edit',
    message: `Bulk edit "${plan.label}" cancelled: ${cancelled} pending change(s) dropped.`,
  });
  const status = await finalizeIfComplete(planId, deps);
  return { cancelled, status: status ?? 'cancelling' };
}
