import type { BackgroundModule } from './index';
import { log } from '@/core/log/logger';
import { getSettings, watchSettings } from '@/core/settings/store';
import {
  classifySyncError,
  importOrderHistory,
  syncFinance,
  syncOrderList,
  syncProfile,
  type ExecFn,
  type ImportMode,
} from '@/features/orders/sync';
import { markInterruptedImports, readImportStatus, readSyncStatus, writeImportStatus, writeSyncStatus, type ImportJobStatus, type SyncArea } from '@/features/orders/status';
import type { OrderDirection } from '@/shared/models';
import { ensurePeriodicAlarm, onAlarm } from '../alarms';
import { registerSyncTask } from '../core-handlers';
import { handle, UserFacingError } from '../router';
import { execInFunPayTab, pickExecutionTab } from '../tabs';

/** Sales: every `settings.sync.intervalMinutes`. Purchases + finance: every 15 min. Profile (reviews/offers): every 30 min. */
export const ALARM_SALES = 'funpro:orders:sales';
export const ALARM_SLOW = 'funpro:orders:slow';
export const ALARM_PROFILE = 'funpro:orders:profile';
const SLOW_MINUTES = 15;
const PROFILE_MINUTES = 30;

const exec: ExecFn = (cmd) => execInFunPayTab(cmd);

/**
 * Run one sync step and persist its status. Manual syncs (via `ui.syncNow`) re-throw so the caller
 * sees the error; periodic syncs never throw.
 */
async function tracked(area: SyncArea, fn: () => Promise<unknown>, rethrow: boolean): Promise<void> {
  const prev = await readSyncStatus(area);
  await writeSyncStatus(area, 'running', prev?.message ?? '');
  try {
    await fn();
    await writeSyncStatus(area, 'ok');
  } catch (e) {
    const { kind, message } = classifySyncError(e);
    await writeSyncStatus(area, kind, message);
    // Log state transitions only, so a closed FunPay tab does not flood the activity log.
    if (kind !== 'awaiting_tab' && (prev?.state !== kind || prev?.message !== message)) {
      await log.warn({ source: 'orders', message: `Sync of ${area} failed: ${message}` });
    }
    if (rethrow) throw e;
  }
}

async function periodic(areas: SyncArea[]): Promise<void> {
  const settings = await getSettings();
  // The emergency stop halts every request FunPro would make on its own, including read-only polling.
  if (settings.automation.state === 'stopped') {
    for (const a of areas) await writeSyncStatus(a, 'skipped', 'Emergency stop is active');
    return;
  }
  for (const a of areas) await tracked(a, () => runArea(a), false);
}

function runArea(area: SyncArea): Promise<unknown> {
  switch (area) {
    case 'sales':
      return syncOrderList(exec, 'sale');
    case 'purchases':
      return syncOrderList(exec, 'purchase');
    case 'finance':
      return syncFinance(exec);
    case 'profile':
      return syncProfile(exec);
  }
}

// ------------------------------------------------------------------------------------------------
// Deep history import
// ------------------------------------------------------------------------------------------------

const jobs = new Map<OrderDirection, AbortController>();

async function runImport(direction: OrderDirection, mode: ImportMode, maxPages: number, ctrl: AbortController): Promise<void> {
  const base: ImportJobStatus = { direction, mode, state: 'running', startedAt: Date.now(), finishedAt: null, pages: 0, orders: 0, created: 0, updated: 0, stop: null, message: '' };
  await writeImportStatus(base);
  const result = await importOrderHistory(exec, {
    direction,
    mode,
    maxPages,
    signal: ctrl.signal,
    onProgress: (p) => writeImportStatus({ ...base, pages: p.pages, orders: p.orders, created: p.created, updated: p.updated }),
  });
  const counts = { pages: result.pages, orders: result.orders, created: result.created, updated: result.updated, stop: result.stop, finishedAt: Date.now() };
  if (result.stop === 'error') {
    const { kind, message } = classifySyncError(result.error);
    await writeImportStatus({ ...base, ...counts, state: kind, message });
    if (kind !== 'unsupported' && kind !== 'awaiting_tab') await log.warn({ source: 'orders', message: `History import (${direction}) stopped after ${result.pages} page(s): ${message}` });
  } else {
    await writeImportStatus({ ...base, ...counts, state: result.stop === 'cancelled' ? 'cancelled' : 'done', message: '' });
    await log.info({ source: 'orders', message: `History import (${direction}) finished: ${result.pages} page(s), ${result.created} new order(s), stop=${result.stop}` });
  }
}

export const ordersModule: BackgroundModule = {
  name: 'orders',
  register() {
    registerSyncTask('orders', async () => {
      await tracked('sales', () => runArea('sales'), true);
      await tracked('purchases', () => runArea('purchases'), true);
    });
    registerSyncTask('finance', () => tracked('finance', () => runArea('finance'), true));
    registerSyncTask('reviews', () => tracked('profile', () => runArea('profile'), true));

    onAlarm(ALARM_SALES, () => periodic(['sales']));
    onAlarm(ALARM_SLOW, () => periodic(['purchases', 'finance']));
    onAlarm(ALARM_PROFILE, () => periodic(['profile']));

    handle('ui.orders.importHistory', async ({ direction, mode, maxPages }) => {
      if (jobs.has(direction)) throw new UserFacingError('A history import is already running for this list.', 'busy');
      if (!(await pickExecutionTab())) throw new UserFacingError('No logged-in FunPay tab is open. Open funpay.com to let FunPro load your history.', 'awaiting_tab');
      const ctrl = new AbortController();
      jobs.set(direction, ctrl);
      void runImport(direction, mode, maxPages, ctrl)
        .catch(async (e: unknown) => {
          const { kind, message } = classifySyncError(e);
          const prev = await readImportStatus(direction);
          if (prev) await writeImportStatus({ ...prev, state: kind, message, finishedAt: Date.now() });
        })
        .finally(() => jobs.delete(direction));
      return { started: true };
    });

    handle('ui.orders.cancelImport', async ({ direction }) => {
      const ctrl = jobs.get(direction);
      if (!ctrl) return { cancelled: false };
      ctrl.abort();
      return { cancelled: true };
    });

    void (async () => {
      await markInterruptedImports();
      const settings = await getSettings();
      let interval = settings.sync.intervalMinutes;
      await ensurePeriodicAlarm(ALARM_SALES, interval);
      await ensurePeriodicAlarm(ALARM_SLOW, SLOW_MINUTES, 1);
      await ensurePeriodicAlarm(ALARM_PROFILE, PROFILE_MINUTES, 2);
      watchSettings((s) => {
        if (s.sync.intervalMinutes !== interval) {
          interval = s.sync.intervalMinutes;
          void ensurePeriodicAlarm(ALARM_SALES, interval);
        }
      });
    })().catch((e: unknown) => console.warn('[FunPro] orders module init failed', e instanceof Error ? e.message : e));
  },
};
