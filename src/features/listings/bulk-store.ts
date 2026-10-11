/**
 * Persistence of bulk-edit plans and per-item results in `db.kv` (no new tables):
 *   bulkplan:<planId>            → BulkPlan (validated with zod on every read)
 *   bulkres:<planId>:<listingId> → ItemResult (one small record per processed listing)
 *   bulkplans:active             → ids of plans that still have work (cheap lookup for the worker)
 * Execution progress therefore survives reloads and service-worker restarts.
 */
import { getDb } from '@/core/db/db';
import type { Task } from '@/shared/models';
import { BulkPlanSchema, ItemResultSchema, type BulkPlan, type ItemResult, type PlanReport } from './bulk-plan';

export const PLAN_PREFIX = 'bulkplan:';
export const RESULT_PREFIX = 'bulkres:';
export const ACTIVE_PLANS_KEY = 'bulkplans:active';
/** Finished plans beyond this count are pruned (oldest first) together with their results. */
export const MAX_STORED_PLANS = 30;

export const planKey = (id: string) => `${PLAN_PREFIX}${id}`;
export const resultKey = (planId: string, listingId: string) => `${RESULT_PREFIX}${planId}:${listingId}`;

export async function savePlan(plan: BulkPlan): Promise<void> {
  const parsed = BulkPlanSchema.parse(plan);
  await getDb().kv.put({ key: planKey(parsed.id), value: parsed });
}

export async function loadPlan(id: string): Promise<BulkPlan | null> {
  const rec = await getDb().kv.get(planKey(id));
  if (!rec) return null;
  const r = BulkPlanSchema.safeParse(rec.value);
  return r.success ? r.data : null;
}

export function parsePlanRecords(records: readonly { key: string; value: unknown }[]): BulkPlan[] {
  const out: BulkPlan[] = [];
  for (const rec of records) {
    if (!rec.key.startsWith(PLAN_PREFIX)) continue;
    const r = BulkPlanSchema.safeParse(rec.value);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listPlans(): Promise<BulkPlan[]> {
  return parsePlanRecords(await getDb().kv.where('key').startsWith(PLAN_PREFIX).toArray());
}

/** Read-modify-write of a plan inside one transaction. Returns the updated plan (or null if missing). */
export async function updatePlan(id: string, fn: (p: BulkPlan) => BulkPlan): Promise<BulkPlan | null> {
  const db = getDb();
  return db.transaction('rw', db.kv, async () => {
    const rec = await db.kv.get(planKey(id));
    const r = BulkPlanSchema.safeParse(rec?.value);
    if (!r.success) return null;
    const next = BulkPlanSchema.parse(fn(r.data));
    await db.kv.put({ key: planKey(id), value: next });
    return next;
  });
}

export async function writeResult(result: ItemResult): Promise<void> {
  const parsed = ItemResultSchema.parse(result);
  await getDb().kv.put({ key: resultKey(parsed.planId, parsed.listingId), value: parsed });
}

export function parseResultRecords(records: readonly { key: string; value: unknown }[]): ItemResult[] {
  const out: ItemResult[] = [];
  for (const rec of records) {
    const r = ItemResultSchema.safeParse(rec.value);
    if (r.success) out.push(r.data);
  }
  return out;
}

export async function loadResults(planId: string): Promise<ItemResult[]> {
  return parseResultRecords(await getDb().kv.where('key').startsWith(`${RESULT_PREFIX}${planId}:`).toArray());
}

export async function getActivePlanIds(): Promise<string[]> {
  const rec = await getDb().kv.get(ACTIVE_PLANS_KEY);
  return Array.isArray(rec?.value) ? (rec.value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

export async function setPlanActive(id: string, active: boolean): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.kv, async () => {
    const rec = await db.kv.get(ACTIVE_PLANS_KEY);
    const ids = new Set(Array.isArray(rec?.value) ? (rec.value as string[]) : []);
    if (active) ids.add(id);
    else ids.delete(id);
    await db.kv.put({ key: ACTIVE_PLANS_KEY, value: [...ids] });
  });
}

export async function deletePlan(id: string): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.kv, async () => {
    await db.kv.delete(planKey(id));
    await db.kv.where('key').startsWith(`${RESULT_PREFIX}${id}:`).delete();
  });
  await setPlanActive(id, false);
}

const FINISHED = new Set(['cancelled', 'done', 'partial', 'failed']);

export function isPlanFinished(plan: Pick<BulkPlan, 'status'>): boolean {
  return FINISHED.has(plan.status);
}

/** Keep the newest `keep` plans; older FINISHED plans (and drafts) are deleted with their results. */
export async function prunePlans(keep = MAX_STORED_PLANS): Promise<number> {
  const plans = await listPlans();
  let removed = 0;
  for (const p of plans.slice(keep)) {
    if (isPlanFinished(p) || p.status === 'draft') {
      await deletePlan(p.id);
      removed++;
    }
  }
  return removed;
}

/** Tasks belonging to a plan (bulk_edit tasks carry `{ planId, listingId }`). */
export async function planTasks(planId: string): Promise<Task[]> {
  return getDb()
    .tasks.where('kind')
    .equals('bulk_edit')
    .filter((t) => t.payload['planId'] === planId)
    .toArray();
}

export interface PlanProgress {
  /** Actionable items (enqueued). */
  total: number;
  done: number;
  failed: number;
  skipped: number;
  conflict: number;
  cancelled: number;
  pending: number;
  running: number;
  awaitingTab: number;
  /** Items whose outcome is known (everything but pending/running/awaiting). */
  finished: number;
}

/**
 * Progress of a plan from its per-item results, falling back to task state for items without a
 * result (e.g. a task the queue marked failed after a worker crash).
 */
export function computeProgress(plan: Pick<BulkPlan, 'items' | 'report' | 'status'>, results: readonly ItemResult[], tasks: readonly Task[]): PlanProgress {
  const p: PlanProgress = { total: 0, done: 0, failed: 0, skipped: 0, conflict: 0, cancelled: 0, pending: 0, running: 0, awaitingTab: 0, finished: 0 };
  const byListing = new Map(results.map((r) => [r.listingId, r]));
  const taskByListing = new Map<string, Task>();
  for (const t of tasks) taskByListing.set(String(t.payload['listingId']), t);
  for (const item of plan.items) {
    if (item.skip) continue;
    p.total++;
    const r = byListing.get(item.listingId);
    if (r) {
      if (r.status === 'done') p.done++;
      else if (r.status === 'failed' || r.status === 'blocked') p.failed++;
      else if (r.status === 'skipped') p.skipped++;
      else if (r.status === 'conflict') p.conflict++;
      else if (r.status === 'cancelled') p.cancelled++;
      continue;
    }
    const t = taskByListing.get(item.listingId);
    if (!t) {
      // No task and no result: not enqueued yet, or (after finishing) an unknown outcome.
      if (isPlanFinished(plan)) p.failed++;
      else p.pending++;
      continue;
    }
    switch (t.status) {
      case 'pending':
      case 'blocked':
        p.pending++;
        break;
      case 'running':
        p.running++;
        break;
      case 'awaiting_tab':
        p.awaitingTab++;
        break;
      case 'done':
        p.done++;
        break;
      case 'failed':
        p.failed++;
        break;
      case 'cancelled':
        p.cancelled++;
        break;
    }
  }
  p.finished = p.done + p.failed + p.skipped + p.conflict + p.cancelled;
  return p;
}

export function reportFromProgress(p: PlanProgress): PlanReport {
  return { total: p.total, done: p.done, failed: p.failed, skipped: p.skipped, conflict: p.conflict, cancelled: p.cancelled };
}
