/**
 * Auto-bump runner: executes raise cycles through the FunPay tab, persists `db.bumpState`, keeps a
 * single one-shot alarm armed for the earliest planned attempt, notifies, logs and emits
 * `LISTING_BUMP_AVAILABLE`. All I/O is injected (`BumpDeps`) so the logic is unit-testable.
 *
 * Gating:
 *  - automatic cycles run only when `evaluateFeature(settings, 'autoBump', ctx)` is `running`
 *    (so: enabled, automation running, live actions acknowledged, FunPay tab open, logged in);
 *  - manual "Raise now" works while automation is paused, but never during the emergency stop.
 */
import { z } from 'zod';
import type { RaiseOutcome, RaiseTarget } from '@/adapters/funpay/types';
import { evaluateFeature, type AutomationContext, type AutomationStatus } from '@/core/automation/policy';
import { getDb, type BumpState } from '@/core/db/db';
import type { LogInput } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import type { NotifyInput } from '@/features/notifications/notify';
import { ingestBumpTarget, ingestListings } from '@/features/sync/ingest';
import { ListingSchema, type EventType } from '@/shared/models';
import { errorMessage, isNoTabError, ListingsActionError } from '@/features/listings/errors';
import {
  applyRaiseOutcome,
  bumpConfig,
  decideAlarm,
  earliestAttempt,
  GAME_GAP_MS,
  isDue,
  isGameSelected,
  MANUAL_MIN_GAP_MS,
  NO_TAB_RECHECK_MS,
  nodeIdsToRaise,
  plannedAttemptAt,
} from './schedule';
import { reportAutomationFailure } from '@/core/events/failures';

export const BUMP_ALARM = 'funpro:bump';
export const BUMP_RUNTIME_KEY = 'bump:runtime';
export const BUMP_DISCOVERY_KEY = 'bump:discovery';
/** Discovery visits at most this many subcategory pages per run. */
export const DISCOVERY_MAX_NODES = 60;

export type BumpCommand =
  | { action: 'raise'; gameId: string; nodeId: string; nodeIds?: string[] }
  | { action: 'discoverRaise'; nodeId: string }
  | { action: 'fetchPage'; path: string; kind: 'profile' };

export interface BumpLogger {
  info: (i: LogInput) => Promise<void>;
  warn: (i: LogInput) => Promise<void>;
}

export interface AlarmApi {
  get: (name: string) => Promise<{ scheduledTime: number } | undefined>;
  set: (name: string, when: number) => Promise<void>;
  clear: (name: string) => Promise<void>;
}

export interface BumpDeps {
  exec: (cmd: BumpCommand) => Promise<unknown>;
  getSettings: () => Promise<Settings>;
  automationContext: () => Promise<AutomationContext>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  notify?: (input: NotifyInput) => Promise<unknown>;
  emit?: (type: EventType, dedupeKey: string, payload: Record<string, unknown>) => Promise<boolean>;
  log?: BumpLogger;
  alarms?: AlarmApi;
}

/** Small persisted runtime info for the UI (why nothing happens right now). */
export interface BumpRuntime {
  lastCycleAt: number | null;
  /** Feature status at the last automatic check. */
  status: AutomationStatus | null;
  reason: string;
  /** Set while FunPro waits for a logged-in FunPay tab. */
  awaitingTabSince: number | null;
  nextAlarmAt: number | null;
}

const RuntimeSchema = z.object({
  lastCycleAt: z.number().nullable(),
  status: z.enum(['disabled', 'running', 'paused', 'awaiting_authorization', 'blocked']).nullable(),
  reason: z.string(),
  awaitingTabSince: z.number().nullable(),
  nextAlarmAt: z.number().nullable(),
});

const EMPTY_RUNTIME: BumpRuntime = {
  lastCycleAt: null,
  status: null,
  reason: '',
  awaitingTabSince: null,
  nextAlarmAt: null,
};

export async function readRuntime(): Promise<BumpRuntime> {
  const rec = await getDb().kv.get(BUMP_RUNTIME_KEY);
  const r = RuntimeSchema.safeParse(rec?.value);
  return r.success ? r.data : { ...EMPTY_RUNTIME };
}

async function patchRuntime(patch: Partial<BumpRuntime>): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.kv, async () => {
    const rec = await db.kv.get(BUMP_RUNTIME_KEY);
    const r = RuntimeSchema.safeParse(rec?.value);
    await db.kv.put({ key: BUMP_RUNTIME_KEY, value: { ...(r.success ? r.data : EMPTY_RUNTIME), ...patch } });
  });
}

const RaiseOutcomeSchema = z.union([
  z.object({
    kind: z.literal('raised'),
    message: z.string().max(1000),
    waitSec: z.number().nullable(),
    nodeIds: z.array(z.string().max(32)).max(100).optional(),
  }),
  z.object({
    kind: z.literal('cooldown'),
    message: z.string().max(1000),
    waitSec: z.number(),
    nodeIds: z.array(z.string().max(32)).max(100).optional(),
  }),
  z.object({ kind: z.literal('needs_selection'), nodeIds: z.array(z.string().max(32)).max(100) }),
  z.object({
    kind: z.literal('rejected'),
    message: z.string().max(1000),
    waitSec: z.number(),
    nodeIds: z.array(z.string().max(32)).max(100).optional(),
  }),
  z.object({
    kind: z.literal('error'),
    message: z.string().max(1000),
    waitSec: z.number(),
    nodeIds: z.array(z.string().max(32)).max(100).optional(),
  }),
]);

const noopLog: BumpLogger = { info: async () => undefined, warn: async () => undefined };

export type GameResultKind = 'raised' | 'cooldown' | 'failed' | 'skipped' | 'no_tab';

export interface GameResult {
  gameId: string;
  categoryName: string;
  result: GameResultKind;
  message: string;
  nextEligibleAt: number | null;
  /** For skipped games: why ('cooldown' | 'too_soon'). */
  skipReason?: 'cooldown' | 'too_soon' | 'no_node';
}

export interface CycleResult {
  ran: boolean;
  status: AutomationStatus | null;
  reason: string;
  results: GameResult[];
}

function lotsUrl(state: BumpState): string | null {
  const node = state.nodeIds[0];
  return node ? `https://funpay.com/lots/${node}/trade` : null;
}

/** Games with a raise request in flight (a manual click racing the alarm never double-posts). */
const inFlight = new Set<string>();

/** One raise attempt for one game. Never throws (except programming errors). */
async function attemptRaise(
  state: BumpState,
  settings: Settings,
  deps: BumpDeps,
  manual: boolean,
): Promise<GameResult> {
  if (inFlight.has(state.gameId)) {
    return {
      gameId: state.gameId,
      categoryName: state.categoryName,
      result: 'skipped',
      skipReason: 'too_soon',
      message: state.lastMessage,
      nextEligibleAt: state.nextEligibleAt,
    };
  }
  inFlight.add(state.gameId);
  try {
    return await attemptRaiseUnlocked(state, settings, deps, manual);
  } finally {
    inFlight.delete(state.gameId);
  }
}

async function attemptRaiseUnlocked(
  state: BumpState,
  settings: Settings,
  deps: BumpDeps,
  manual: boolean,
): Promise<GameResult> {
  const now = (deps.now ?? Date.now)();
  const log = deps.log ?? noopLog;
  const cfg = bumpConfig(settings);
  // Unselected games (manual raise of one game) raise all their subcategories.
  const nodeIds = nodeIdsToRaise(state, cfg.selectedNodeIds);
  const nodeId = nodeIds?.[0] ?? state.nodeIds[0];
  const name = state.categoryName || `game ${state.gameId}`;
  if (!nodeId)
    return {
      gameId: state.gameId,
      categoryName: state.categoryName,
      result: 'skipped',
      skipReason: 'no_node',
      message: 'No subcategory known for this game',
      nextEligibleAt: state.nextEligibleAt,
    };

  let outcome: RaiseOutcome & { nodeIds?: string[] };
  try {
    const raw = await deps.exec({
      action: 'raise',
      gameId: state.gameId,
      nodeId,
      ...(nodeIds ? { nodeIds } : {}),
    });
    const parsed = RaiseOutcomeSchema.safeParse(raw);
    outcome = parsed.success
      ? parsed.data
      : { kind: 'error', message: 'Unrecognised answer from the FunPay tab', waitSec: 600 };
  } catch (e) {
    if (isNoTabError(e)) {
      await patchRuntime({ awaitingTabSince: now });
      await log.warn({
        source: 'bump',
        message: `Raise of ${name} postponed: waiting for an open, logged-in FunPay tab`,
      });
      return {
        gameId: state.gameId,
        categoryName: state.categoryName,
        result: 'no_tab',
        message: errorMessage(e),
        nextEligibleAt: state.nextEligibleAt,
      };
    }
    outcome = { kind: 'error', message: errorMessage(e).slice(0, 500), waitSec: 600 };
  }
  await patchRuntime({ awaitingTabSince: null });

  // Re-read the freshest state (discovery may have added nodes meanwhile) before applying.
  const fresh = (await getDb().bumpState.get(state.gameId)) ?? state;
  const effect = applyRaiseOutcome(fresh, outcome, now, cfg);
  await getDb().bumpState.put(effect.state);
  const s = effect.state;
  const trigger = manual ? 'manual' : 'auto';

  if (effect.kind === 'success') {
    await log.info({
      source: 'bump',
      message: `Raised offers of ${name} (${trigger})${s.nextEligibleAt ? `; FunPay allows the next raise at ${new Date(s.nextEligibleAt).toISOString()}` : ''}`,
      details: { gameId: s.gameId, message: s.lastMessage },
    });
    if (settings.bump.notifyOnSuccess) {
      await deps.notify?.({
        kind: 'bump',
        title: 'Offers raised',
        body: `${name}${s.lastMessage ? `: ${s.lastMessage}` : ''}`,
        url: lotsUrl(s),
      });
    }
    return {
      gameId: s.gameId,
      categoryName: s.categoryName,
      result: 'raised',
      message: s.lastMessage,
      nextEligibleAt: s.nextEligibleAt,
    };
  }
  if (effect.kind === 'cooldown') {
    await log.info({
      source: 'bump',
      message: `${name}: FunPay cooldown (${trigger}) — next raise possible at ${new Date(s.nextEligibleAt!).toISOString()}`,
      details: { gameId: s.gameId, message: s.lastMessage },
    });
    return {
      gameId: s.gameId,
      categoryName: s.categoryName,
      result: 'cooldown',
      message: s.lastMessage,
      nextEligibleAt: s.nextEligibleAt,
    };
  }
  await log.warn({
    source: 'bump',
    message: `Raise of ${name} failed (${trigger}, ${s.consecutiveFailures} in a row): ${s.lastMessage}`,
    hint: effect.stoppedNow
      ? 'Automatic raising of this game stopped. Check FunPay, then use "Raise now" or "Resume".'
      : undefined,
    details: { gameId: s.gameId },
  });
  if (settings.bump.notifyOnFailure && (effect.firstFailure || effect.stoppedNow)) {
    await deps.notify?.({
      kind: 'failure',
      title: effect.stoppedNow ? 'Auto-bump stopped' : 'Raising offers failed',
      body: effect.stoppedNow
        ? `${name}: stopped after ${s.consecutiveFailures} failed attempts — ${s.lastMessage}`
        : `${name}: ${s.lastMessage}`,
      url: lotsUrl(s),
      dedupeKey: `bump-fail:${s.gameId}:${effect.stoppedNow ? 'stop' : 'first'}:${s.lastAttemptAt}`,
    });
  }
  if (effect.firstFailure || effect.stoppedNow) {
    await reportAutomationFailure({
      source: 'bump',
      message: `${name}: ${s.lastMessage}`,
      key: `${s.gameId}:${effect.stoppedNow ? 'stop' : 'first'}`,
      url: lotsUrl(s),
      notified: settings.bump.notifyOnFailure,
    });
  }
  return {
    gameId: s.gameId,
    categoryName: s.categoryName,
    result: 'failed',
    message: s.lastMessage,
    nextEligibleAt: s.nextEligibleAt,
  };
}

/** Emit LISTING_BUMP_AVAILABLE for games whose FunPay cooldown has elapsed (deduplicated). */
export async function emitBumpAvailability(deps: Pick<BumpDeps, 'emit' | 'now'>): Promise<number> {
  if (!deps.emit) return 0;
  const now = (deps.now ?? Date.now)();
  let n = 0;
  for (const s of await getDb().bumpState.toArray()) {
    if (s.nextEligibleAt === null || s.nextEligibleAt > now) continue;
    if (s.status !== 'waiting' && s.status !== 'raised') continue;
    const created = await deps.emit('LISTING_BUMP_AVAILABLE', `${s.gameId}:${s.nextEligibleAt}`, {
      gameId: s.gameId,
      nodeIds: s.nodeIds,
      categoryName: s.categoryName,
      eligibleAt: s.nextEligibleAt,
    });
    if (created) n++;
  }
  return n;
}

/** Automatic cycle (alarm). Raises every selected game that is due, ≥ 2 s apart. */
export async function runAutoBump(deps: BumpDeps): Promise<CycleResult> {
  const settings = await deps.getSettings();
  const ctx = await deps.automationContext();
  const st = evaluateFeature(settings, 'autoBump', ctx);
  const now = (deps.now ?? Date.now)();
  const waitingForTab =
    st.status === 'blocked' && !ctx.funpayTabAvailable && settings.automation.state !== 'stopped';
  const rt = await readRuntime();
  await patchRuntime({
    lastCycleAt: now,
    status: st.status,
    reason: st.reason,
    awaitingTabSince: waitingForTab ? (rt.awaitingTabSince ?? now) : null,
  });
  if (st.status !== 'running') return { ran: false, status: st.status, reason: st.reason, results: [] };
  const cfg = bumpConfig(settings);
  const due = (await getDb().bumpState.toArray())
    .filter((s) => isGameSelected(s, cfg.selectedNodeIds) && isDue(s, cfg, now))
    .sort((a, b) => (plannedAttemptAt(a, cfg) ?? 0) - (plannedAttemptAt(b, cfg) ?? 0));
  await emitBumpAvailability(deps);
  const results: GameResult[] = [];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < due.length; i++) {
    if (i > 0) await sleep(GAME_GAP_MS);
    // The emergency stop (or pause / toggle off) may happen during a long cycle.
    if (i > 0) {
      const cur = await deps.getSettings();
      if (cur.automation.state !== 'running' || !cur.automation.autoBump) break;
    }
    const r = await attemptRaise(due[i]!, settings, deps, false);
    results.push(r);
    if (r.result === 'no_tab') break;
  }
  return { ran: true, status: st.status, reason: st.reason, results };
}

/**
 * Manual one-click raise ("Raise now"). Allowed while automation is paused or auto-bump is off;
 * refused during the emergency stop. Without `gameId` it raises every selected game that is not in
 * a known FunPay cooldown; a specific game is always attempted (FunPay enforces its own cooldown),
 * at most once per minute.
 */
export async function runManualBump(deps: BumpDeps, gameId?: string): Promise<CycleResult> {
  const settings = await deps.getSettings();
  if (settings.automation.state === 'stopped')
    throw new ListingsActionError(
      'Emergency stop is active — raising is disabled until you resume.',
      'emergency_stop',
    );
  const now = (deps.now ?? Date.now)();
  const cfg = bumpConfig(settings);
  const all = await getDb().bumpState.toArray();
  let games: BumpState[];
  if (gameId) {
    const g = all.find((s) => s.gameId === gameId);
    if (!g) throw new ListingsActionError('Unknown game — run "Discover categories" first.', 'not_found');
    games = [g];
  } else {
    games = all.filter((s) => isGameSelected(s, cfg.selectedNodeIds));
  }
  if (games.length === 0)
    throw new ListingsActionError(
      'No categories known yet. Open your lots page on FunPay or run "Discover categories".',
      'no_targets',
    );
  const results: GameResult[] = [];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let attempted = 0;
  for (const g of games) {
    // A cooldown reported by FunPay (after a cooldown answer or a successful raise) is respected.
    if (
      !gameId &&
      (g.status === 'waiting' || g.status === 'raised') &&
      g.nextEligibleAt !== null &&
      g.nextEligibleAt > now
    ) {
      results.push({
        gameId: g.gameId,
        categoryName: g.categoryName,
        result: 'skipped',
        skipReason: 'cooldown',
        message: g.lastMessage,
        nextEligibleAt: g.nextEligibleAt,
      });
      continue;
    }
    if (g.lastAttemptAt !== null && now - g.lastAttemptAt < MANUAL_MIN_GAP_MS) {
      results.push({
        gameId: g.gameId,
        categoryName: g.categoryName,
        result: 'skipped',
        skipReason: 'too_soon',
        message: g.lastMessage,
        nextEligibleAt: g.nextEligibleAt,
      });
      continue;
    }
    if (attempted++ > 0) await sleep(GAME_GAP_MS);
    const r = await attemptRaise(g, settings, deps, true);
    results.push(r);
    if (r.result === 'no_tab')
      throw new ListingsActionError(
        'No logged-in FunPay tab is open. Open funpay.com and try again.',
        'no_tab',
      );
  }
  return { ran: true, status: null, reason: 'manual', results };
}

/** Reset the failure streak so automatic raising resumes. Never moves a FunPay cooldown earlier. */
export async function resumeBump(gameId: string | undefined, now: number): Promise<number> {
  const db = getDb();
  const states = gameId
    ? [await db.bumpState.get(gameId)].filter((x): x is BumpState => !!x)
    : await db.bumpState.toArray();
  let n = 0;
  for (const s of states) {
    if (s.consecutiveFailures === 0 && s.status !== 'error' && s.status !== 'needs_selection') continue;
    await db.bumpState.put({
      ...s,
      consecutiveFailures: 0,
      status: 'idle',
      nextEligibleAt: s.nextEligibleAt !== null && s.nextEligibleAt > now ? s.nextEligibleAt : null,
      lastMessage: s.lastMessage,
    });
    n++;
  }
  return n;
}

/** Keep exactly one one-shot alarm for the earliest planned attempt (idempotent; safe on every start). */
export async function ensureBumpAlarm(
  deps: BumpDeps,
): Promise<{ action: 'keep' | 'set' | 'clear'; at: number | null }> {
  const alarms = deps.alarms;
  if (!alarms) return { action: 'keep', at: null };
  const settings = await deps.getSettings();
  const ctx = await deps.automationContext();
  const st = evaluateFeature(settings, 'autoBump', ctx);
  const now = (deps.now ?? Date.now)();
  let desired: number | null = null;
  const states = await getDb().bumpState.toArray();
  if (st.status === 'running') {
    desired = earliestAttempt(states, bumpConfig(settings));
  } else if (st.status === 'blocked' && settings.automation.state !== 'stopped') {
    // Tab missing / logged out: re-check periodically without contacting FunPay.
    const e = earliestAttempt(states, bumpConfig(settings));
    desired = e === null ? null : Math.max(e, now + NO_TAB_RECHECK_MS);
  }
  const existing = (await alarms.get(BUMP_ALARM))?.scheduledTime ?? null;
  const d = decideAlarm(existing, desired, now, deps.random);
  if (d.action === 'set') await alarms.set(BUMP_ALARM, d.at);
  else if (d.action === 'clear') await alarms.clear(BUMP_ALARM);
  const at = d.action === 'set' ? d.at : d.action === 'clear' ? null : existing;
  await patchRuntime({ nextAlarmAt: at });
  return { action: d.action, at };
}

// ---------------------------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------------------------

const ParsedListingSchema = ListingSchema.omit({
  costMinor: true,
  sortIndex: true,
  seenAt: true,
  updatedAt: true,
});
const TargetSchema = z.object({
  gameId: z.string().regex(/^\d{1,10}$/),
  nodeId: z.string().regex(/^\d{1,10}$/),
});
const ProfileSchema = z.object({ listings: z.array(z.unknown()).max(5000) });
const NodePageSchema = z.object({
  target: TargetSchema.nullable(),
  listings: z.array(z.unknown()).max(5000),
});

function validListings(items: unknown[]): z.output<typeof ParsedListingSchema>[] {
  const out: z.output<typeof ParsedListingSchema>[] = [];
  for (const i of items) {
    const r = ParsedListingSchema.safeParse(i);
    if (r.success) out.push(r.data);
  }
  return out;
}

export interface DiscoveryProgress {
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  total: number;
  done: number;
  games: number;
  listings: number;
  errors: string[];
}

async function writeDiscovery(p: DiscoveryProgress): Promise<void> {
  await getDb().kv.put({ key: BUMP_DISCOVERY_KEY, value: p });
}

/** Light sync: own profile only (one request) → local listings. */
export async function syncListingsFromProfile(
  deps: BumpDeps,
  userId: string | null,
): Promise<{ listings: number }> {
  const raw = await deps.exec({ action: 'fetchPage', kind: 'profile', path: `/users/${userId ?? '0'}/` });
  const profile = ProfileSchema.safeParse(raw);
  if (!profile.success) throw new Error('Unexpected profile answer from the FunPay tab');
  const listings = validListings(profile.data.listings);
  await ingestListings(listings);
  return { listings: listings.length };
}

/**
 * Discover raise targets: own profile → every subcategory with own offers (plus locally known
 * ones, which include subcategories whose offers are all inactive) → `/lots/{node}/trade` raise
 * button (gameId). Read-only on FunPay; requests are spaced by the content transport.
 */
export async function discoverBumpTargets(deps: BumpDeps, userId: string | null): Promise<DiscoveryProgress> {
  const now = (deps.now ?? Date.now)();
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const log = deps.log ?? noopLog;
  const progress: DiscoveryProgress = {
    status: 'running',
    startedAt: now,
    finishedAt: null,
    total: 0,
    done: 0,
    games: 0,
    listings: 0,
    errors: [],
  };
  await writeDiscovery(progress);
  const db = getDb();
  try {
    const nodes = new Map<string, string>();
    try {
      const raw = await deps.exec({ action: 'fetchPage', kind: 'profile', path: `/users/${userId ?? '0'}/` });
      const profile = ProfileSchema.safeParse(raw);
      if (profile.success) {
        const listings = validListings(profile.data.listings);
        await ingestListings(listings);
        progress.listings += listings.length;
        for (const l of listings) if (l.nodeId && !nodes.has(l.nodeId)) nodes.set(l.nodeId, l.categoryName);
      }
    } catch (e) {
      if (isNoTabError(e)) throw e;
      progress.errors.push(`profile: ${errorMessage(e)}`);
    }
    for (const l of await db.listings.toArray())
      if (l.nodeId && !nodes.has(l.nodeId)) nodes.set(l.nodeId, l.categoryName);
    for (const s of await db.bumpState.toArray())
      for (const n of s.nodeIds) if (!nodes.has(n)) nodes.set(n, s.categoryName);
    const list = [...nodes.entries()].slice(0, DISCOVERY_MAX_NODES);
    progress.total = list.length;
    await writeDiscovery(progress);
    const games = new Set<string>();
    for (const [nodeId, name] of list) {
      if (progress.done > 0) await sleep(GAME_GAP_MS);
      try {
        const raw = await deps.exec({ action: 'discoverRaise', nodeId });
        const page = NodePageSchema.safeParse(raw);
        if (!page.success) throw new Error('Unexpected answer');
        const listings = validListings(page.data.listings);
        await ingestListings(listings);
        progress.listings += listings.length;
        if (page.data.target) {
          const target: RaiseTarget = page.data.target;
          await ingestBumpTarget(target, listings[0]?.categoryName || name);
          games.add(target.gameId);
        }
      } catch (e) {
        if (isNoTabError(e)) throw e;
        progress.errors.push(`${nodeId}: ${errorMessage(e)}`.slice(0, 300));
      }
      progress.done++;
      progress.games = games.size;
      await writeDiscovery(progress);
    }
    progress.status = 'done';
  } catch (e) {
    progress.status = 'failed';
    progress.errors.push(errorMessage(e));
    if (isNoTabError(e)) {
      progress.finishedAt = (deps.now ?? Date.now)();
      await writeDiscovery(progress);
      throw new ListingsActionError(
        'No logged-in FunPay tab is open. Open funpay.com and try again.',
        'no_tab',
      );
    }
  }
  progress.finishedAt = (deps.now ?? Date.now)();
  progress.errors = progress.errors.slice(0, 20);
  await writeDiscovery(progress);
  await log.info({
    source: 'bump',
    message: `Discovery finished: ${progress.done}/${progress.total} subcategories, ${progress.games} game(s), ${progress.listings} offer row(s)${progress.errors.length ? `, ${progress.errors.length} error(s)` : ''}`,
  });
  return progress;
}
