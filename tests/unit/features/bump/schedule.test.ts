import { describe, expect, it } from 'vitest';
import type { BumpState } from '@/core/db/db';
import {
  applyRaiseOutcome,
  BUMP_JITTER_MS,
  BUMP_SAFETY_MARGIN_MS,
  decideAlarm,
  earliestAttempt,
  failureBackoffMs,
  isDue,
  isGameSelected,
  MAX_BACKOFF_MS,
  MIN_ALARM_DELAY_MS,
  nodeIdsToRaise,
  plannedAttemptAt,
} from '@/features/bump/schedule';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const H = 3600_000;
const cfg = { minIntervalMs: 60 * 60_000, maxConsecutiveFailures: 3, selectedNodeIds: [] as string[] };

function state(over: Partial<BumpState> = {}): BumpState {
  return { gameId: '41', nodeIds: ['501', '502'], categoryName: 'Game A', status: 'idle', lastAttemptAt: null, lastSuccessAt: null, nextEligibleAt: null, lastMessage: '', consecutiveFailures: 0, ...over };
}

describe('selection', () => {
  it('selects every game when no node is chosen, otherwise games with a chosen node', () => {
    expect(isGameSelected(state(), [])).toBe(true);
    expect(isGameSelected(state(), ['502'])).toBe(true);
    expect(isGameSelected(state(), ['777'])).toBe(false);
  });

  it('sends node_ids[] only for a strict subset of the game', () => {
    expect(nodeIdsToRaise(state(), [])).toBeUndefined();
    expect(nodeIdsToRaise(state(), ['501', '502', '777'])).toBeUndefined();
    expect(nodeIdsToRaise(state(), ['502', '777'])).toEqual(['502']);
    expect(nodeIdsToRaise(state(), ['777'])).toBeUndefined();
  });
});

describe('eligibility', () => {
  it('is due immediately for a never-attempted game', () => {
    expect(plannedAttemptAt(state(), cfg)).toBe(0);
    expect(isDue(state(), cfg, NOW)).toBe(true);
  });

  it('waits for FunPay\'s cooldown plus a safety margin', () => {
    const s = state({ status: 'waiting', lastAttemptAt: NOW - 2 * H, nextEligibleAt: NOW + 10 * 60_000 });
    expect(plannedAttemptAt(s, cfg)).toBe(NOW + 10 * 60_000 + BUMP_SAFETY_MARGIN_MS);
    expect(isDue(s, cfg, NOW + 10 * 60_000)).toBe(false);
    expect(isDue(s, cfg, NOW + 10 * 60_000 + BUMP_SAFETY_MARGIN_MS)).toBe(true);
  });

  it('respects the configured floor between attempts (never an assumed official interval)', () => {
    const s = state({ status: 'raised', lastAttemptAt: NOW, nextEligibleAt: null });
    expect(plannedAttemptAt(s, cfg)).toBe(NOW + H);
    const shortCooldown = state({ status: 'waiting', lastAttemptAt: NOW, nextEligibleAt: NOW + 60_000 });
    expect(plannedAttemptAt(shortCooldown, cfg)).toBe(NOW + H);
  });

  it('stops after the maximum number of consecutive failures', () => {
    expect(plannedAttemptAt(state({ consecutiveFailures: 3 }), cfg)).toBeNull();
    expect(isDue(state({ consecutiveFailures: 3 }), cfg, NOW + 100 * H)).toBe(false);
  });

  it('finds the earliest attempt among selected games', () => {
    const a = state({ gameId: 'a', nodeIds: ['1'], lastAttemptAt: NOW, nextEligibleAt: NOW + 3 * H });
    const b = state({ gameId: 'b', nodeIds: ['2'], lastAttemptAt: NOW, nextEligibleAt: NOW + 2 * H });
    const stopped = state({ gameId: 'c', nodeIds: ['3'], consecutiveFailures: 9 });
    expect(earliestAttempt([a, b, stopped], cfg)).toBe(NOW + 2 * H + BUMP_SAFETY_MARGIN_MS);
    expect(earliestAttempt([a, b, stopped], { ...cfg, selectedNodeIds: ['1'] })).toBe(NOW + 3 * H + BUMP_SAFETY_MARGIN_MS);
    expect(earliestAttempt([stopped], cfg)).toBeNull();
  });
});

describe('applyRaiseOutcome', () => {
  it('success resets failures and uses FunPay\'s wait when reported', () => {
    const e = applyRaiseOutcome(state({ consecutiveFailures: 2, status: 'error' }), { kind: 'raised', message: 'Предложения подняты', waitSec: 3 * 3600 }, NOW, cfg);
    expect(e.kind).toBe('success');
    expect(e.state).toMatchObject({ status: 'raised', lastAttemptAt: NOW, lastSuccessAt: NOW, nextEligibleAt: NOW + 3 * H, consecutiveFailures: 0, lastMessage: 'Предложения подняты' });
    const noWait = applyRaiseOutcome(state(), { kind: 'raised', message: '', waitSec: null }, NOW, cfg);
    expect(noWait.state.nextEligibleAt).toBeNull();
  });

  it('cooldown sets nextEligibleAt from the parsed wait and is not a failure', () => {
    const e = applyRaiseOutcome(state({ consecutiveFailures: 1 }), { kind: 'cooldown', message: 'Подождите 3 часа.', waitSec: 9000 }, NOW, cfg);
    expect(e).toMatchObject({ kind: 'cooldown', firstFailure: false, stoppedNow: false });
    expect(e.state).toMatchObject({ status: 'waiting', nextEligibleAt: NOW + 9000_000, consecutiveFailures: 0 });
  });

  it('merges subcategories reported by FunPay\'s selection modal', () => {
    const e = applyRaiseOutcome(state({ nodeIds: ['501'] }), { kind: 'raised', message: 'ok', waitSec: null, nodeIds: ['501', '503'] }, NOW, cfg);
    expect(e.state.nodeIds).toEqual(['501', '503']);
  });

  it('backs off exponentially on errors and stops after N consecutive failures', () => {
    let s = state();
    const err = { kind: 'error' as const, message: 'FunPay server error (HTTP 502)', waitSec: 600 };
    const e1 = applyRaiseOutcome(s, err, NOW, cfg);
    expect(e1).toMatchObject({ kind: 'failure', firstFailure: true, stoppedNow: false });
    expect(e1.state).toMatchObject({ status: 'error', consecutiveFailures: 1, nextEligibleAt: NOW + 600_000 });
    s = e1.state;
    const e2 = applyRaiseOutcome(s, err, NOW, cfg);
    expect(e2.state.nextEligibleAt).toBe(NOW + 1_200_000);
    expect(e2.firstFailure).toBe(false);
    const e3 = applyRaiseOutcome(e2.state, err, NOW, cfg);
    expect(e3).toMatchObject({ stoppedNow: true });
    expect(e3.state).toMatchObject({ consecutiveFailures: 3, nextEligibleAt: null });
    const e4 = applyRaiseOutcome(e3.state, err, NOW, cfg);
    expect(e4.stoppedNow).toBe(false); // notified only once
  });

  it('treats rejections and an empty selection modal as failures', () => {
    expect(applyRaiseOutcome(state(), { kind: 'rejected', message: 'redirect', waitSec: 7200 }, NOW, cfg).state).toMatchObject({ status: 'error', nextEligibleAt: NOW + 7200_000 });
    expect(applyRaiseOutcome(state(), { kind: 'needs_selection', nodeIds: [] }, NOW, cfg).state).toMatchObject({ status: 'needs_selection', consecutiveFailures: 1 });
  });

  it('caps the backoff', () => {
    expect(failureBackoffMs(1, 10)).toBe(300_000); // minimum base 5 min
    expect(failureBackoffMs(20, 600)).toBe(MAX_BACKOFF_MS);
  });
});

describe('decideAlarm (idempotent re-arming)', () => {
  const r = () => 0.5;

  it('sets the alarm at the target plus jitter, never earlier than Chrome allows', () => {
    expect(decideAlarm(null, NOW + H, NOW, r)).toEqual({ action: 'set', at: NOW + H + BUMP_JITTER_MS / 2 });
    expect(decideAlarm(null, NOW - H, NOW, r)).toEqual({ action: 'set', at: NOW + MIN_ALARM_DELAY_MS + BUMP_JITTER_MS / 2 });
  });

  it('keeps a pending alarm that fires no later than the target (repeated calls are no-ops)', () => {
    const first = decideAlarm(null, NOW + H, NOW, r) as { at: number };
    expect(decideAlarm(first.at, NOW + H, NOW + 60_000, r)).toEqual({ action: 'keep' });
    // the 1-minute tick must not postpone an alarm while the target is "now"
    const due = decideAlarm(null, NOW, NOW, r) as { at: number };
    expect(decideAlarm(due.at, NOW, NOW + 20_000, r)).toEqual({ action: 'keep' });
    // an early alarm is harmless and kept
    expect(decideAlarm(NOW + 10 * 60_000, NOW + H, NOW, r)).toEqual({ action: 'keep' });
  });

  it('re-arms an alarm that would fire too late or is stale, and clears when nothing is due', () => {
    expect(decideAlarm(NOW + 5 * H, NOW + H, NOW, r)).toMatchObject({ action: 'set' });
    expect(decideAlarm(NOW - 1000, NOW + H, NOW, r)).toMatchObject({ action: 'set' });
    expect(decideAlarm(NOW + H, null, NOW, r)).toEqual({ action: 'clear' });
    expect(decideAlarm(null, null, NOW, r)).toEqual({ action: 'keep' });
  });
});
