/**
 * Restore = plan the reverse changes of an executed bulk edit. The reverse plan goes through the
 * same preview → backup → queue path as any other bulk edit, so a restore is itself reversible.
 *
 * Source of the "old" values, best first:
 *  1. the live editor values recorded right before each change (`ItemResult.liveBefore`) — exact;
 *  2. the local snapshot in the backup (when the worker died before recording a result) — flagged
 *     `stale_snapshot` because it reflects the last sync, not necessarily FunPay's editor.
 * Deleted offers cannot be restored (FunPay has no undelete); they are listed as not restorable.
 *
 * Backups of LOCAL-only operations (import of costs/drafts, display order) are restored directly
 * into the local database by `restoreLocalBackup`.
 */
import type { BackupRecord } from '@/core/db/db';
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { Listing } from '@/shared/models';
import {
  EN_DESC,
  EN_SUMMARY,
  emptyPlan,
  type BulkPlan,
  type ChangeKey,
  type Changes,
  type ItemResult,
  type PlanItem,
  type PlanValues,
} from './bulk-plan';
import { formatPriceField, parsePriceInput } from './commission';

function valuesFromChanges(changes: Changes): PlanValues {
  const v: PlanValues = {};
  if (changes.price !== undefined) v.priceMinor = parsePriceInput(changes.price);
  if (changes.active !== undefined) v.active = changes.active !== '';
  if (changes.amount !== undefined)
    v.amount = /^\s*\d+\s*$/.test(changes.amount) ? Number.parseInt(changes.amount, 10) : null;
  if (changes[EN_SUMMARY] !== undefined) v.summaryEn = changes[EN_SUMMARY];
  if (changes[EN_DESC] !== undefined) v.descEn = changes[EN_DESC];
  return v;
}

/** Old value of a field from the local snapshot, in plan `changes` representation. */
function snapshotValue(l: Listing, key: ChangeKey): string | null {
  switch (key) {
    case 'price':
      return l.price.amountMinor > 0 ? formatPriceField(l.price.amountMinor) : null;
    case 'active':
      return l.active ? 'on' : '';
    case 'amount':
      return l.amount === null ? null : String(l.amount);
    case EN_SUMMARY:
      return l.titleEn ?? '';
    case EN_DESC:
      return l.descriptionEn ?? '';
    default:
      return null;
  }
}

export function buildRestorePlan(
  source: BulkPlan,
  results: readonly ItemResult[],
  backup: Pick<BackupRecord, 'id' | 'listings'> | null,
  ctx: { now: number; label: string },
): BulkPlan {
  const byListing = new Map(results.map((r) => [r.listingId, r]));
  const snapshot = new Map((backup?.listings ?? []).map((l) => [l.id, l]));
  const items: PlanItem[] = [];
  for (const it of source.items) {
    if (it.skip) continue;
    const r = byListing.get(it.listingId);
    const item: PlanItem = {
      listingId: it.listingId,
      title: it.title,
      categoryName: it.categoryName,
      nodeId: it.nodeId,
      currency: it.currency,
      costMinor: it.costMinor,
      before: { ...it.after },
      after: {},
      changes: {},
      expectPriceMinor: null,
      onlyIfEmpty: [],
      warnings: [],
      skip: null,
    };
    const applied = r && (r.status === 'done' || r.uncertain);
    if (source.op.kind === 'delete') {
      item.skip = applied ? 'not_restorable' : 'not_applied';
      items.push(item);
      continue;
    }
    if (applied && r.liveBefore && Object.keys(r.liveBefore).length > 0) {
      for (const [k, v] of Object.entries(r.liveBefore) as [ChangeKey, string][]) {
        if (k !== 'deleted') item.changes[k] = v;
      }
    } else if (!r && snapshot.has(it.listingId)) {
      const l = snapshot.get(it.listingId)!;
      for (const k of Object.keys(it.changes) as ChangeKey[]) {
        const v = snapshotValue(l, k);
        if (v !== null) item.changes[k] = v;
      }
      item.warnings.push('stale_snapshot');
    }
    if (Object.keys(item.changes).length === 0) item.skip = 'not_applied';
    item.after = valuesFromChanges(item.changes);
    if (
      item.after.priceMinor !== undefined &&
      (item.after.priceMinor === null || item.after.priceMinor <= 0)
    ) {
      delete item.changes.price;
      item.warnings.push('price_non_positive');
      if (Object.keys(item.changes).length === 0) item.skip = 'not_applied';
    }
    items.push(item);
  }
  return emptyPlan(
    { kind: 'restore', fromPlanId: source.id, backupId: source.backupId ?? backup?.id ?? null },
    { now: ctx.now, label: ctx.label, source: 'restore' },
    items,
  );
}

/** Local-only fields that imports and reordering may change. */
export type LocalField = 'costMinor' | 'sortIndex' | 'titleEn' | 'descriptionEn';
export const LOCAL_FIELDS: readonly LocalField[] = ['costMinor', 'sortIndex', 'titleEn', 'descriptionEn'];

/**
 * Restore local fields from a backup (import / reorder / manual). A safety backup of the current
 * values is written first, so this restore can be undone too. FunPay is never contacted.
 */
export async function restoreLocalBackup(
  backupId: string,
  now = Date.now(),
): Promise<{ restored: number; missing: number; safetyBackupId: string }> {
  const db = getDb();
  const backup = await db.backups.get(backupId);
  if (!backup) throw new Error('Backup not found');
  const current = await db.listings.bulkGet(backup.listings.map((l) => l.id));
  const existing = current.filter((x): x is Listing => !!x);
  const safety: BackupRecord = {
    id: newId('bak'),
    kind: 'manual',
    createdAt: now,
    label: `Before restoring "${backup.label}"`.slice(0, 200),
    listings: existing,
  };
  let restored = 0;
  let missing = 0;
  await db.transaction('rw', db.listings, db.backups, async () => {
    await db.backups.add(safety);
    for (const l of backup.listings) {
      const cur = await db.listings.get(l.id);
      if (!cur) {
        missing++;
        continue;
      }
      await db.listings.update(l.id, {
        costMinor: l.costMinor,
        sortIndex: l.sortIndex,
        titleEn: l.titleEn,
        descriptionEn: l.descriptionEn,
      });
      restored++;
    }
  });
  return { restored, missing, safetyBackupId: safety.id };
}
