import type { OfferForm } from '@/adapters/funpay/types';
import { onEvent } from '@/core/events/bus';
import { isFlagEnabled } from '@/core/flags/flags';
import { log } from '@/core/log/logger';
import { getSettings } from '@/core/settings/store';
import {
  handleOrderCancelled,
  handleOrderPaid,
  markDeliveredManually,
  prepareDelivery,
  releaseByUser,
  reserveAndPrepare,
  syncDeliveryOutcomes,
  type DeliveryDeps,
} from '@/features/inventory/delivery';
import { checkLowStock, rearmLowStock } from '@/features/inventory/lowstock';
import { getPool, listPools } from '@/features/inventory/pools';
import { previewPush, pushToFunPay, restorePush, type PushExec } from '@/features/inventory/push';
import { getDelivery } from '@/features/inventory/reservation';
import { handlePriceChange } from '@/features/pricing/alerts';
import { applyPrice, runRepricingTick, type PricingDeps } from '@/features/pricing/automation';
import { fetchCompetitorsForNode, nextNodeDue } from '@/features/pricing/fetch';
import { handleWorkflowEvent, type WorkflowDeps } from '@/features/workflow/engine';
import { EventTypeSchema } from '@/shared/models';
import { onAlarm } from '../alarms';
import { automationContext } from '../core-handlers';
import { handle, UserFacingError } from '../router';
import { execInFunPayTab, getLastSession, NoFunPayTabError, pickExecutionTab } from '../tabs';
import type { BackgroundModule } from './index';
import { processOutbox } from './outbox';

/**
 * Background module: inventory & fulfillment, pricing intelligence, workflow rules.
 *
 * Event handlers (registered in this order so workflow rules see post-reservation stock):
 *   ORDER_PAID → reserve + prepare delivery · ORDER_CANCELLED → release · PRICE_CHANGE_DETECTED →
 *   undercut alert · every event → workflow engine.
 * Tick (1 min): delivery outcome watcher, repricing automation, opt-in competitor fetch, low-stock scan.
 */

const selfUserId = async () => (await getLastSession())?.userId ?? null;

const offerExec: PushExec & PricingDeps['exec'] = {
  getOfferForm: (offerId) => execInFunPayTab<OfferForm>({ action: 'getOfferForm', offerId }),
  saveOffer: (offerId, changes) =>
    execInFunPayTab<{ ok: boolean; errors: string[] }>({ action: 'saveOffer', offerId, changes }),
};

const deliveryDeps: DeliveryDeps = { getSettings, automationContext, selfUserId };
const pricingDeps: PricingDeps = { getSettings, automationContext, exec: offerExec };
const workflowDeps: WorkflowDeps = {
  getSettings,
  automationContext,
  selfUserId,
  selfName: async () => (await getLastSession())?.username ?? null,
};

const fetchPublicNode = (nodeId: string) =>
  execInFunPayTab<unknown>({ action: 'fetchPage', kind: 'public_node', path: `/lots/${nodeId}/` });

/** Expected failures are returned to the UI without being logged as internal errors. */
async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserFacingError) throw e;
    if (e instanceof NoFunPayTabError) throw new UserFacingError(e.message, 'no_tab');
    throw new UserFacingError(e instanceof Error ? e.message : String(e), 'failed');
  }
}

async function safely(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    await log.warn({
      source: 'operations',
      message: `${name} failed: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

const LOW_STOCK_SCAN_MS = 15 * 60_000;
let lastLowStockScan = 0;

async function tick(): Promise<void> {
  await safely('Delivery watcher', () => syncDeliveryOutcomes());
  await safely('Repricing', () => runRepricingTick(pricingDeps));
  await safely('Competitor fetch', async () => {
    const settings = await getSettings();
    if (!isFlagEnabled('pricingIntelligence', settings.flags)) return;
    const nodeId = await nextNodeDue(settings);
    // Without a logged-in FunPay tab the job simply waits (no failed attempt is recorded).
    if (!nodeId || !(await pickExecutionTab())) return;
    await fetchCompetitorsForNode(nodeId, fetchPublicNode, { manual: false });
  });
  if (Date.now() - lastLowStockScan >= LOW_STOCK_SCAN_MS) {
    lastLowStockScan = Date.now();
    await safely('Low-stock scan', async () => {
      const settings = await getSettings();
      if (!isFlagEnabled('inventory', settings.flags)) return;
      for (const pool of await listPools())
        await checkLowStock(pool, { notify: settings.inventory.notifyLowStock });
    });
  }
}

export const operationsModule: BackgroundModule = {
  name: 'operations',
  register() {
    onEvent('ORDER_PAID', async (e) => {
      await handleOrderPaid(e, deliveryDeps);
    });
    onEvent('ORDER_CANCELLED', async (e) => {
      await handleOrderCancelled(e);
    });
    onEvent('PRICE_CHANGE_DETECTED', async (e) => {
      await handlePriceChange(e, getSettings);
    });
    for (const type of EventTypeSchema.options) {
      onEvent(type, async (e) => {
        await handleWorkflowEvent(e, workflowDeps);
      });
    }

    onAlarm('funpro:tick', tick);

    handle('ui.deliverOrder', ({ orderId, mode, confirmUncertain }) =>
      userFacing(async () => {
        if (!(await getDelivery(orderId))) {
          const res = await reserveAndPrepare(orderId, { auto: false }, deliveryDeps);
          if (res.kind === 'no_pool')
            throw new UserFacingError(
              'No inventory pool matches this order — reserve it from Inventory',
              'no_pool',
            );
          if (res.kind === 'ambiguous')
            throw new UserFacingError(
              'Several pools match this order — choose one in Inventory',
              'ambiguous',
            );
          if (res.kind === 'out_of_stock')
            throw new UserFacingError('Not enough stock for this order', 'out_of_stock');
          if (mode === 'draft') return getDelivery(orderId);
        }
        const res = await prepareDelivery(orderId, mode, deliveryDeps, { confirmUncertain });
        if (res.status === 'manual' && res.reason)
          throw new UserFacingError(`Delivery needs manual action (${res.reason})`, `manual:${res.reason}`);
        if (mode === 'send') {
          await processOutbox();
          await syncDeliveryOutcomes();
        }
        return getDelivery(orderId);
      }),
    );

    handle('ui.inventory.reserve', ({ orderId, poolId, refill }) =>
      userFacing(async () => {
        const res = await reserveAndPrepare(orderId, { auto: false, poolId, refill }, deliveryDeps);
        return {
          kind: res.kind,
          delivery: 'delivery' in res ? res.delivery : null,
          poolIds: res.kind === 'ambiguous' ? res.poolIds : [],
        };
      }),
    );

    handle('ui.inventory.markDelivered', ({ orderId }) => userFacing(() => markDeliveredManually(orderId)));

    handle('ui.inventory.release', ({ orderId, confirmUncertain }) =>
      userFacing(async () => {
        const released = await releaseByUser(orderId, { confirmUncertain });
        const d = await getDelivery(orderId);
        const pool = d ? await getPool(d.poolId) : null;
        if (pool) await rearmLowStock(pool);
        return { released };
      }),
    );

    handle('ui.inventory.pushPreview', ({ poolId, offerId }) =>
      userFacing(() => previewPush(poolId, offerId, offerExec)),
    );

    handle('ui.inventory.push', ({ poolId, offerId, count }) =>
      userFacing(async () => {
        const res = await pushToFunPay(poolId, offerId, count, offerExec);
        const settings = await getSettings();
        await checkLowStock(poolId, { notify: settings.inventory.notifyLowStock });
        return res;
      }),
    );

    handle('ui.inventory.restorePush', ({ pushId }) =>
      userFacing(async () => ({ restored: await restorePush(pushId) })),
    );

    handle('ui.fetchCompetitors', ({ nodeId }) =>
      userFacing(() => fetchCompetitorsForNode(nodeId, fetchPublicNode, { manual: true })),
    );

    handle('ui.pricing.apply', ({ listingId, targetMinor }) =>
      userFacing(() => applyPrice(listingId, targetMinor, 'manual', pricingDeps)),
    );
  },
};
