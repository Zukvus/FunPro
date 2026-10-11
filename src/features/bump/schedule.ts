/**
 * Auto-bump scheduling — pure functions (no I/O), fully unit-tested.
 *
 * FunPay raises offers per GAME (gameId) and enforces its own cooldown, which it reports in the
 * raise answer (`wait` seconds or "Подождите N часов…", parsed by the adapter into
 * `RaiseOutcome.waitSec`). FunPro NEVER assumes an official interval: after a successful raise
 * without a reported wait, the next check happens after the seller's configured floor
 * (`settings.bump.minIntervalMinutes`) and FunPay's answer then tells the exact remaining time.
 *
 * Timeline of one game:
 *   nextEligibleAt   — when FunPay said raising becomes possible again (or a retry time after errors)
 *   plannedAttemptAt — max(nextEligibleAt + safety margin, lastAttemptAt + floor); null = stopped
 */
import type { BumpState } from '@/core/db/db';
import type { RaiseOutcome } from '@/adapters/funpay/types';
import type { Settings } from '@/core/settings/schema';

/** Added after FunPay's reported cooldown before the next attempt. */
export const BUMP_SAFETY_MARGIN_MS = 45_000;
/** Random extra delay (0..JITTER) on the one-shot alarm, avoiding exact periodicity. */
export const BUMP_JITTER_MS = 60_000;
/** Chrome clamps one-shot alarms to ≥ 30 s in the future. */
export const MIN_ALARM_DELAY_MS = 30_000;
/** Pause between raising two different games (≥ 2 s; the content transport adds its own spacing). */
export const GAME_GAP_MS = 2_500;
/** Upper bound of the error backoff. */
export const MAX_BACKOFF_MS = 6 * 3600_000;
/** Lower bound of the error backoff base. */
export const MIN_BACKOFF_BASE_SEC = 300;
/** Manual "Raise now" for the same game at most once per minute. */
export const MANUAL_MIN_GAP_MS = 60_000;
/** While blocked by a missing FunPay tab, re-check this often (no FunPay requests are made). */
export const NO_TAB_RECHECK_MS = 2 * 60_000;

export interface BumpConfig {
  minIntervalMs: number;
  maxConsecutiveFailures: number;
  /** Node ids selected for auto-bump; empty = all discovered. */
  selectedNodeIds: readonly string[];
}

export function bumpConfig(settings: Settings): BumpConfig {
  return {
    minIntervalMs: settings.bump.minIntervalMinutes * 60_000,
    maxConsecutiveFailures: settings.bump.maxConsecutiveFailures,
    selectedNodeIds: settings.bump.nodeIds,
  };
}

export function isGameSelected(state: Pick<BumpState, 'nodeIds'>, selected: readonly string[]): boolean {
  return selected.length === 0 || state.nodeIds.some((n) => selected.includes(n));
}

/**
 * Subcategories to send as `node_ids[]`. `undefined` = all of the seller's subcategories of the game
 * (FunPay then answers with its selection modal and the adapter re-posts with every listed node).
 */
export function nodeIdsToRaise(state: Pick<BumpState, 'nodeIds'>, selected: readonly string[]): string[] | undefined {
  if (selected.length === 0) return undefined;
  const chosen = state.nodeIds.filter((n) => selected.includes(n));
  if (chosen.length === 0 || chosen.length === state.nodeIds.length) return undefined;
  return chosen;
}

export function isStopped(state: Pick<BumpState, 'consecutiveFailures'>, cfg: Pick<BumpConfig, 'maxConsecutiveFailures'>): boolean {
  return state.consecutiveFailures >= cfg.maxConsecutiveFailures;
}

/** When FunPro will next try automatically; null when stopped after too many failures. */
export function plannedAttemptAt(state: BumpState, cfg: Pick<BumpConfig, 'minIntervalMs' | 'maxConsecutiveFailures'>, marginMs = BUMP_SAFETY_MARGIN_MS): number | null {
  if (isStopped(state, cfg)) return null;
  const eligible = state.nextEligibleAt !== null ? state.nextEligibleAt + marginMs : 0;
  const floor = state.lastAttemptAt !== null ? state.lastAttemptAt + cfg.minIntervalMs : 0;
  return Math.max(eligible, floor);
}

export function isDue(state: BumpState, cfg: Pick<BumpConfig, 'minIntervalMs' | 'maxConsecutiveFailures'>, now: number): boolean {
  const at = plannedAttemptAt(state, cfg);
  return at !== null && at <= now;
}

/** Earliest planned attempt among selected, non-stopped games (null = nothing to schedule). */
export function earliestAttempt(states: readonly BumpState[], cfg: BumpConfig): number | null {
  let best: number | null = null;
  for (const s of states) {
    if (!isGameSelected(s, cfg.selectedNodeIds)) continue;
    const at = plannedAttemptAt(s, cfg);
    if (at !== null && (best === null || at < best)) best = at;
  }
  return best;
}

/** Exponential backoff after `failures` consecutive failures (1-based), from FunPay's suggested wait. */
export function failureBackoffMs(failures: number, baseSec: number): number {
  const base = Math.max(baseSec, MIN_BACKOFF_BASE_SEC) * 1000;
  return Math.min(MAX_BACKOFF_MS, base * 2 ** Math.max(0, failures - 1));
}

export type OutcomeKind = 'success' | 'cooldown' | 'failure';

export interface OutcomeEffect {
  state: BumpState;
  kind: OutcomeKind;
  /** First failure of a new streak (notify once). */
  firstFailure: boolean;
  /** This failure reached the limit: automatic bumping of the game stops now. */
  stoppedNow: boolean;
}

/** Apply a FunPay raise answer to a game's state. */
export function applyRaiseOutcome(
  prev: BumpState,
  outcome: RaiseOutcome & { nodeIds?: string[] },
  now: number,
  cfg: Pick<BumpConfig, 'maxConsecutiveFailures'>,
): OutcomeEffect {
  const nodeIds = Array.from(new Set([...prev.nodeIds, ...(outcome.nodeIds ?? [])]));
  const base: BumpState = { ...prev, nodeIds, lastAttemptAt: now };
  switch (outcome.kind) {
    case 'raised':
      return {
        state: {
          ...base,
          status: 'raised',
          lastSuccessAt: now,
          nextEligibleAt: outcome.waitSec && outcome.waitSec > 0 ? now + outcome.waitSec * 1000 : null,
          lastMessage: outcome.message,
          consecutiveFailures: 0,
        },
        kind: 'success',
        firstFailure: false,
        stoppedNow: false,
      };
    case 'cooldown':
      // A cooldown answer means the request worked: it is not a failure.
      return {
        state: { ...base, status: 'waiting', nextEligibleAt: now + Math.max(0, outcome.waitSec) * 1000, lastMessage: outcome.message, consecutiveFailures: 0 },
        kind: 'cooldown',
        firstFailure: false,
        stoppedNow: false,
      };
    case 'needs_selection':
    case 'rejected':
    case 'error': {
      const failures = prev.consecutiveFailures + 1;
      const stopped = failures >= cfg.maxConsecutiveFailures;
      const message =
        outcome.kind === 'needs_selection'
          ? 'FunPay asked which subcategories to raise but listed none'
          : outcome.message;
      const baseSec = outcome.kind === 'needs_selection' ? 3600 : outcome.waitSec;
      return {
        state: {
          ...base,
          status: outcome.kind === 'needs_selection' ? 'needs_selection' : 'error',
          nextEligibleAt: stopped ? null : now + failureBackoffMs(failures, baseSec),
          lastMessage: message,
          consecutiveFailures: failures,
        },
        kind: 'failure',
        firstFailure: failures === 1,
        stoppedNow: stopped && prev.consecutiveFailures < cfg.maxConsecutiveFailures,
      };
    }
  }
}

export type AlarmDecision = { action: 'keep' } | { action: 'clear' } | { action: 'set'; at: number };

/**
 * Idempotent alarm re-arming. An existing alarm is kept when it fires in the future and no later
 * than the target (+ jitter tolerance): an EARLY alarm is harmless (it finds nothing due and re-arms),
 * a LATE one would miss the slot. This also prevents a 1-minute tick from postponing an alarm
 * forever while the target is "now".
 */
export function decideAlarm(existingAt: number | null, desiredAt: number | null, now: number, random: () => number = Math.random): AlarmDecision {
  if (desiredAt === null) return existingAt === null ? { action: 'keep' } : { action: 'clear' };
  const target = Math.max(desiredAt, now + MIN_ALARM_DELAY_MS);
  if (existingAt !== null && existingAt > now && existingAt <= target + BUMP_JITTER_MS + 1000) return { action: 'keep' };
  return { action: 'set', at: target + Math.floor(random() * BUMP_JITTER_MS) };
}
