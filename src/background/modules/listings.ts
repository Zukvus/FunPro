import { browser } from 'wxt/browser';
import { z } from 'zod';
import { emitEvent } from '@/core/events/bus';
import { log } from '@/core/log/logger';
import type { ContentCommand } from '@/core/messaging/protocol';
import type { ListingsContentCommand } from '@/core/messaging/rpc/listings';
import { getSettings, watchSettings } from '@/core/settings/store';
import { getDb } from '@/core/db/db';
import { CAPABILITIES } from '@/adapters/funpay/capabilities';
import { notify } from '@/features/notifications/notify';
import {
  BUMP_ALARM,
  discoverBumpTargets,
  emitBumpAvailability,
  ensureBumpAlarm,
  resumeBump,
  runAutoBump,
  runManualBump,
  syncListingsFromProfile,
  type AlarmApi,
  type BumpDeps,
} from '@/features/bump/runner';
import {
  assertLiveActionsAllowed,
  cancelBulkPlan,
  executeBulkPlan,
  processBulkQueue,
  type BulkExecDeps,
} from '@/features/listings/bulk-exec';
import { isClonableChangeKey } from '@/features/listings/clone';
import {
  capabilityUsable,
  errorCode,
  errorMessage,
  isNoTabError,
  isUnknownCommandError,
  ListingsActionError,
} from '@/features/listings/errors';
import { OfferFormSchema, sanitizeOfferForm } from '@/features/listings/offer-form';
import { ingestListings } from '@/features/sync/ingest';
import { ListingSchema } from '@/shared/models';
import { registerBumpHandler } from '@/features/workflow/hooks';
import { clearAlarm, onAlarm, scheduleAt } from '../alarms';
import { automationContext, registerSyncTask } from '../core-handlers';
import { handle, UserFacingError } from '../router';
import { execInFunPayTab, getLastSession } from '../tabs';
import type { BackgroundModule } from './index';

/**
 * Commands owned by the listings area that are not (yet) part of `ContentCommandSchema`
 * (createOffer / deleteOffer, see `LISTINGS_CONTENT_COMMANDS`). Until the content executor
 * dispatches them it answers "Invalid command", which is reported as "unavailable in this build".
 */
function exec(cmd: ContentCommand | ListingsContentCommand): Promise<unknown> {
  return execInFunPayTab(cmd as ContentCommand);
}

const alarmApi: AlarmApi = {
  get: async (name) => {
    const a = await browser.alarms.get(name);
    return a ? { scheduledTime: a.scheduledTime } : undefined;
  },
  set: (name, when) => scheduleAt(name, when),
  clear: (name) => clearAlarm(name),
};

function bumpDeps(): BumpDeps {
  return { exec, getSettings, automationContext, notify, emit: emitEvent, log, alarms: alarmApi };
}

function bulkDeps(): BulkExecDeps {
  return { exec, getSettings, notify, log };
}

/** Map feature errors to user-facing RPC errors (not logged as internal failures). */
async function userFacing<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ListingsActionError) throw new UserFacingError(e.message, e.code);
    if (isNoTabError(e)) throw new UserFacingError(errorMessage(e), 'no_tab');
    if (isUnknownCommandError(e))
      throw new UserFacingError(
        'This FunPro build cannot do this yet (content-script command missing). Nothing was changed.',
        'unavailable_in_build',
      );
    const code = errorCode(e);
    if (
      code === 'logged_out' ||
      code === 'rate_limited' ||
      code === 'bad_response' ||
      code === 'forbidden_path' ||
      code === 'network' ||
      code === 'server'
    ) {
      throw new UserFacingError(errorMessage(e), code);
    }
    throw e;
  }
}

const QuoteSchema = z.object({
  methods: z
    .array(
      z.object({ name: z.string().max(200), priceMinor: z.number().int(), currency: z.string().max(10) }),
    )
    .max(50),
  minPriceText: z.string().max(100).nullable(),
  commissionPct: z.number().nullable(),
});
const CreateResultSchema = z.object({
  ok: z.boolean(),
  errors: z.array(z.string().max(2000)).max(50),
  offerId: z.string().max(32).nullable(),
});
const NodePageSchema = z.object({ listings: z.array(z.unknown()).max(5000) });
const ParsedListingSchema = ListingSchema.omit({
  costMinor: true,
  sortIndex: true,
  seenAt: true,
  updatedAt: true,
});

let rearmTimer: ReturnType<typeof setTimeout> | null = null;
/** Settings changes (toggle, selection, interval) re-arm the alarm; debounced. */
function scheduleRearm(): void {
  if (rearmTimer) clearTimeout(rearmTimer);
  rearmTimer = setTimeout(() => {
    rearmTimer = null;
    void ensureBumpAlarm(bumpDeps()).catch(() => undefined);
  }, 500);
}

/** Background module: listings & bumps. Registers RPC handlers, alarms and the listings sync task. */
export const listingsModule: BackgroundModule = {
  name: 'listings',
  register() {
    // ---- workflow integration -------------------------------------------------------------------
    // The workflow `queue_bump` action only *requests* a cycle: the normal alarm path then applies
    // the autoBump policy, game selection and FunPay's cooldowns (nothing is forced). The cycle's own
    // events are deduplicated per eligibility window, so a rule reacting to LISTING_BUMP_AVAILABLE
    // cannot loop.
    registerBumpHandler(async () => {
      await scheduleAt(BUMP_ALARM, Date.now());
    });

    // ---- alarms -------------------------------------------------------------------------------
    onAlarm(BUMP_ALARM, async () => {
      try {
        await runAutoBump(bumpDeps());
      } finally {
        await ensureBumpAlarm(bumpDeps());
      }
    });
    onAlarm('funpro:tick', async () => {
      await emitBumpAvailability(bumpDeps());
      await ensureBumpAlarm(bumpDeps());
      // Not awaited: a bulk run may take minutes and the shared tick must not block other modules
      // (dispatchAlarm skips a tick while the previous one is still running). The processor has
      // its own re-entrancy lock and time budget.
      void processBulkQueue(bulkDeps()).catch((e: unknown) =>
        log.warn({ source: 'bulk-edit', message: `Processing stopped: ${errorMessage(e)}` }),
      );
    });

    // ---- bump ---------------------------------------------------------------------------------
    handle('ui.bumpNow', ({ gameId }) =>
      userFacing(async () => {
        try {
          return await runManualBump(bumpDeps(), gameId);
        } finally {
          await ensureBumpAlarm(bumpDeps());
        }
      }),
    );
    handle('ui.discoverBumpTargets', () =>
      userFacing(async () => {
        const session = await getLastSession();
        const res = await discoverBumpTargets(bumpDeps(), session?.userId ?? null);
        await ensureBumpAlarm(bumpDeps());
        return res;
      }),
    );
    handle('ui.bump.resume', async ({ gameId }) => {
      const resumed = await resumeBump(gameId, Date.now());
      await log.info({
        source: 'bump',
        message: `Auto-bump resumed for ${gameId ? `game ${gameId}` : 'all games'} (${resumed} reset)`,
      });
      await ensureBumpAlarm(bumpDeps());
      return { resumed };
    });

    // ---- bulk editing -------------------------------------------------------------------------
    handle('ui.bulkEdit.execute', ({ planId }) =>
      userFacing(async () => {
        const res = await executeBulkPlan(planId, bulkDeps());
        void processBulkQueue(bulkDeps()).catch((e: unknown) =>
          log.warn({ source: 'bulk-edit', message: `Processing stopped: ${errorMessage(e)}` }),
        );
        return res;
      }),
    );
    handle('ui.bulkEdit.cancel', ({ planId }) => userFacing(() => cancelBulkPlan(planId, bulkDeps())));

    // ---- offers -------------------------------------------------------------------------------
    handle('ui.fetchOfferForm', ({ offerId }) =>
      userFacing(async () => {
        const form = OfferFormSchema.parse(await exec({ action: 'getOfferForm', offerId }));
        // The CSRF token and auto-delivery goods never leave the background.
        return sanitizeOfferForm(form);
      }),
    );
    handle('ui.calcCommission', ({ nodeId, priceMinor }) =>
      userFacing(async () => {
        const quote = QuoteSchema.parse(await exec({ action: 'calc', nodeId, price: priceMinor / 100 }));
        return { ...quote, nodeId, testedPriceMinor: priceMinor };
      }),
    );
    handle('ui.clone.create', ({ sourceOfferId, nodeId, changes }) =>
      userFacing(async () => {
        assertLiveActionsAllowed(await getSettings());
        if (!capabilityUsable(CAPABILITIES.cloneOffer))
          throw new ListingsActionError('Creating offers is not supported', 'unsupported');
        const source = await getDb().listings.get(sourceOfferId);
        if (!source) throw new ListingsActionError('Only your own synced offers can be cloned.', 'not_found');
        if (source.nodeId !== nodeId)
          throw new ListingsActionError(
            'A copy is created in the same subcategory as the original.',
            'invalid_plan',
          );
        const bad = Object.keys(changes).filter((k) => !isClonableChangeKey(k));
        if (bad.length)
          throw new ListingsActionError(
            `These fields cannot be set on a copy: ${bad.join(', ')}`,
            'invalid_plan',
          );
        const res = CreateResultSchema.parse(await exec({ action: 'createOffer', nodeId, changes }));
        if (!res.ok) {
          await log.warn({
            source: 'listings',
            message: `Cloning offer ${sourceOfferId} failed: ${res.errors.join('; ')}`,
          });
          throw new ListingsActionError(
            res.errors.join('; ') || 'FunPay rejected the new offer',
            'funpay_error',
          );
        }
        await log.info({
          source: 'listings',
          message: `Created a copy of offer ${sourceOfferId} in subcategory ${nodeId}${res.offerId ? ` (new offer ${res.offerId})` : ''}`,
        });
        // Best effort: refresh this subcategory so the copy shows up locally.
        try {
          const page = NodePageSchema.parse(await exec({ action: 'discoverRaise', nodeId }));
          const listings = page.listings
            .map((l) => ParsedListingSchema.safeParse(l))
            .flatMap((r) => (r.success ? [r.data] : []));
          await ingestListings(listings);
        } catch {
          /* the next sync picks it up */
        }
        return res;
      }),
    );

    // ---- content script -----------------------------------------------------------------------
    handle('cs.openListingInDashboard', async ({ offerId }) => {
      await browser.tabs.create({ url: browser.runtime.getURL(`/options.html#/listings?offer=${offerId}`) });
      return null;
    });

    // ---- sync -----------------------------------------------------------------------------------
    registerSyncTask('listings', async () => {
      const session = await getLastSession();
      return syncListingsFromProfile(bumpDeps(), session?.userId ?? null);
    });

    // Re-arm on settings changes and once per worker start (idempotent).
    watchSettings(() => scheduleRearm());
    void ensureBumpAlarm(bumpDeps()).catch(() => undefined);
  },
};
