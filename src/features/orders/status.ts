/**
 * Persistent status of background syncs and history imports (stored in Dexie `kv`, so the dashboard
 * can show it live with `useLiveQuery`). Contains no FunPay data besides counts.
 */
import { getDb } from '@/core/db/db';
import type { OrderDirection } from '@/shared/models';
import type { PaginationStop } from './pagination';
import type { ImportMode, SyncFailureKind } from './sync';

export type SyncArea = 'sales' | 'purchases' | 'finance' | 'profile';
export const SYNC_AREAS: readonly SyncArea[] = ['sales', 'purchases', 'finance', 'profile'];

export interface SyncStatusRecord {
  area: SyncArea;
  state: 'running' | 'ok' | 'skipped' | SyncFailureKind;
  lastAttemptAt: number;
  lastSuccessAt: number | null;
  message: string;
}

export const syncStatusKey = (area: SyncArea) => `orders:sync:${area}`;

export async function readSyncStatus(area: SyncArea): Promise<SyncStatusRecord | null> {
  const rec = await getDb().kv.get(syncStatusKey(area));
  return (rec?.value as SyncStatusRecord | undefined) ?? null;
}

export async function writeSyncStatus(
  area: SyncArea,
  state: SyncStatusRecord['state'],
  message = '',
  now = Date.now(),
): Promise<SyncStatusRecord> {
  const prev = await readSyncStatus(area);
  const next: SyncStatusRecord = {
    area,
    state,
    lastAttemptAt: now,
    lastSuccessAt: state === 'ok' ? now : (prev?.lastSuccessAt ?? null),
    message: message.slice(0, 300),
  };
  await getDb().kv.put({ key: syncStatusKey(area), value: next });
  return next;
}

export type ImportState = 'running' | 'done' | 'error' | 'cancelled' | 'interrupted' | SyncFailureKind;

export interface ImportJobStatus {
  direction: OrderDirection;
  mode: ImportMode;
  state: ImportState;
  startedAt: number;
  finishedAt: number | null;
  pages: number;
  orders: number;
  created: number;
  updated: number;
  stop: PaginationStop | null;
  message: string;
}

export const importStatusKey = (direction: OrderDirection) => `orders:import:${direction}`;

export async function readImportStatus(direction: OrderDirection): Promise<ImportJobStatus | null> {
  const rec = await getDb().kv.get(importStatusKey(direction));
  return (rec?.value as ImportJobStatus | undefined) ?? null;
}

export async function writeImportStatus(status: ImportJobStatus): Promise<void> {
  await getDb().kv.put({
    key: importStatusKey(status.direction),
    value: { ...status, message: status.message.slice(0, 300) },
  });
}

/**
 * After a service-worker restart no import can still be running in memory: mark such records as
 * interrupted so the UI never shows a stuck progress bar.
 */
export async function markInterruptedImports(now = Date.now()): Promise<number> {
  let n = 0;
  for (const direction of ['sale', 'purchase'] as const) {
    const s = await readImportStatus(direction);
    if (s && s.state === 'running') {
      await writeImportStatus({
        ...s,
        state: 'interrupted',
        finishedAt: now,
        message: 'The extension restarted during the import. Run it again to continue.',
      });
      n++;
    }
  }
  return n;
}
