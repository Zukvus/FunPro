/**
 * LOCAL display order of listings (`sortIndex`).
 *
 * FunPay-side reordering is blocked by a platform limitation: FunPay exposes no evidenced endpoint
 * to reorder offers, and the only workaround (deleting and recreating offers) is destructive —
 * FunPro refuses to do it automatically. The order here is used inside FunPro (tables, exports).
 */
import { getDb, type BackupRecord } from '@/core/db/db';
import { newId } from '@/core/util/id';
import type { Listing } from '@/shared/models';

/** Move one element; returns a new array. Indices are clamped. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = items.slice();
  if (from < 0 || from >= out.length) return out;
  const target = Math.max(0, Math.min(out.length - 1, to));
  const [x] = out.splice(from, 1);
  out.splice(target, 0, x as T);
  return out;
}

/**
 * New sortIndex values for a re-ordered SUBSET of listings (e.g. one category): the subset keeps the
 * same set of sortIndex slots it occupied before, so its position relative to other listings is
 * unchanged. Duplicate old values are spread to keep the new order strict.
 */
export function reassignSortIndexes(
  oldItems: readonly Pick<Listing, 'id' | 'sortIndex'>[],
  newOrderIds: readonly string[],
): Map<string, number> {
  const ids = new Set(oldItems.map((l) => l.id));
  if (newOrderIds.length !== ids.size || newOrderIds.some((id) => !ids.has(id)))
    throw new Error('New order must contain exactly the same listings');
  const slots = oldItems.map((l) => l.sortIndex).sort((a, b) => a - b);
  for (let i = 1; i < slots.length; i++) if (slots[i]! <= slots[i - 1]!) slots[i] = slots[i - 1]! + 1;
  const out = new Map<string, number>();
  newOrderIds.forEach((id, i) => out.set(id, slots[i]!));
  return out;
}

/** Persist a new local order with a backup (kind 'reorder') so it can be undone. */
export async function saveLocalOrder(
  newOrderIds: readonly string[],
  label: string,
  now = Date.now(),
): Promise<{ changed: number; backupId: string | null }> {
  const db = getDb();
  const rows = (await db.listings.bulkGet([...newOrderIds])).filter((x): x is Listing => !!x);
  if (rows.length !== newOrderIds.length)
    throw new Error('Some listings no longer exist — reload and try again');
  const next = reassignSortIndexes(rows, newOrderIds);
  const changedRows = rows.filter((l) => next.get(l.id) !== l.sortIndex);
  if (changedRows.length === 0) return { changed: 0, backupId: null };
  const backup: BackupRecord = {
    id: newId('bak'),
    kind: 'reorder',
    createdAt: now,
    label: label.slice(0, 200),
    listings: changedRows,
  };
  await db.transaction('rw', db.listings, db.backups, async () => {
    await db.backups.add(backup);
    for (const l of changedRows) await db.listings.update(l.id, { sortIndex: next.get(l.id)! });
  });
  return { changed: changedRows.length, backupId: backup.id };
}
