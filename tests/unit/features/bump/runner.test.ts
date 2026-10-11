import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { NotifyInput } from '@/features/notifications/notify';
import type { AutomationContext } from '@/core/automation/policy';
import { getDb, resetDbForTests, type BumpState } from '@/core/db/db';
import { clearEventHandlersForTests, emitEvent } from '@/core/events/bus';
import { defaultSettings, type Settings } from '@/core/settings/schema';
import {
  BUMP_DISCOVERY_KEY,
  discoverBumpTargets,
  emitBumpAvailability,
  ensureBumpAlarm,
  readRuntime,
  resumeBump,
  runAutoBump,
  runManualBump,
  type AlarmApi,
  type BumpCommand,
  type BumpDeps,
} from '@/features/bump/runner';
import { BUMP_SAFETY_MARGIN_MS, GAME_GAP_MS, MIN_ALARM_DELAY_MS, NO_TAB_RECHECK_MS } from '@/features/bump/schedule';
import { makeListing, NoTabError } from '../listings/helpers';

const NOW = Date.parse('2026-10-11T12:00:00Z');
const H = 3600_000;

let settings: Settings;
let ctx: AutomationContext;
let clock: number;
let calls: BumpCommand[];
let answers: Map<string, unknown | (() => unknown)>;
let sleeps: number[];
let notify: Mock<(input: NotifyInput) => Promise<unknown>>;
let alarm: { scheduledTime: number } | undefined;
let alarmSets: number;

const alarms: AlarmApi = {
  get: async () => alarm,
  set: async (_n, when) => {
    alarmSets++;
    alarm = { scheduledTime: when };
  },
  clear: async () => {
    alarm = undefined;
  },
};

function deps(over: Partial<BumpDeps> = {}): BumpDeps {
  return {
    exec: async (cmd) => {
      calls.push(cmd);
      const key = cmd.action === 'raise' ? `raise:${cmd.gameId}` : cmd.action === 'discoverRaise' ? `node:${cmd.nodeId}` : 'profile';
      const a = answers.get(key);
      if (a === undefined) throw new Error(`no answer for ${key}`);
      return typeof a === 'function' ? (a as () => unknown)() : a;
    },
    getSettings: async () => settings,
    automationContext: async () => ctx,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    random: () => 0,
    notify,
    emit: emitEvent,
    alarms,
    ...over,
  };
}

function game(gameId: string, over: Partial<BumpState> = {}): BumpState {
  return { gameId, nodeIds: [`${gameId}01`], categoryName: `Game ${gameId}`, status: 'idle', lastAttemptAt: null, lastSuccessAt: null, nextEligibleAt: null, lastMessage: '', consecutiveFailures: 0, ...over };
}

function running(over: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  s.automation.state = 'running';
  s.automation.autoBump = true;
  s.automation.liveActionsAcknowledged = true;
  over(s);
  return s;
}

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  settings = running();
  ctx = { funpayTabAvailable: true, sessionLoggedIn: true };
  clock = NOW;
  calls = [];
  answers = new Map();
  sleeps = [];
  notify = vi.fn<(input: NotifyInput) => Promise<unknown>>(async () => null);
  alarm = undefined;
  alarmSets = 0;
});

describe('automatic cycle gating', () => {
  it.each([
    ['emergency stop', (s: Settings) => (s.automation.state = 'stopped'), 'blocked'],
    ['paused', (s: Settings) => (s.automation.state = 'paused'), 'paused'],
    ['auto-bump off', (s: Settings) => (s.automation.autoBump = false), 'disabled'],
    ['live actions not acknowledged', (s: Settings) => (s.automation.liveActionsAcknowledged = false), 'awaiting_authorization'],
  ])('does nothing when %s', async (_name, mutate, status) => {
    await getDb().bumpState.add(game('41'));
    settings = running(mutate);
    const r = await runAutoBump(deps());
    expect(r).toMatchObject({ ran: false, status });
    expect(calls).toEqual([]);
    expect((await readRuntime()).status).toBe(status);
  });

  it('waits for a FunPay tab and records it', async () => {
    await getDb().bumpState.add(game('41'));
    ctx = { funpayTabAvailable: false, sessionLoggedIn: false };
    const r = await runAutoBump(deps());
    expect(r).toMatchObject({ ran: false, status: 'blocked' });
    expect((await readRuntime()).awaitingTabSince).toBe(NOW);
    clock += 60_000;
    await runAutoBump(deps());
    expect((await readRuntime()).awaitingTabSince).toBe(NOW); // "since" is kept
  });
});

describe('automatic cycle', () => {
  it('raises only due, selected games, ≥ 2 s apart, and parses cooldowns into nextEligibleAt', async () => {
    await getDb().bumpState.bulkAdd([
      game('1'),
      game('2', { status: 'waiting', lastAttemptAt: NOW - 2 * H, nextEligibleAt: NOW - 60_000 }),
      game('3', { status: 'waiting', lastAttemptAt: NOW - 10 * 60_000, nextEligibleAt: NOW + H }),
      game('4', { nodeIds: ['999'] }),
    ]);
    settings = running((s) => (s.bump.nodeIds = ['101', '201', '301']));
    answers.set('raise:1', { kind: 'raised', message: 'Предложения подняты', waitSec: null });
    answers.set('raise:2', { kind: 'cooldown', message: 'Подождите 2 часа.', waitSec: 5400 });
    const r = await runAutoBump(deps());
    expect(r.ran).toBe(true);
    expect(calls.map((c) => (c as { gameId: string }).gameId)).toEqual(['1', '2']);
    expect(calls[0]).toEqual({ action: 'raise', gameId: '1', nodeId: '101' });
    expect(sleeps).toEqual([GAME_GAP_MS]);
    expect(GAME_GAP_MS).toBeGreaterThanOrEqual(2000);
    const g1 = (await getDb().bumpState.get('1'))!;
    expect(g1).toMatchObject({ status: 'raised', lastSuccessAt: NOW, nextEligibleAt: null, consecutiveFailures: 0 });
    const g2 = (await getDb().bumpState.get('2'))!;
    expect(g2).toMatchObject({ status: 'waiting', lastAttemptAt: NOW + GAME_GAP_MS, nextEligibleAt: NOW + GAME_GAP_MS + 5400_000, lastMessage: 'Подождите 2 часа.' });
    // the eligibility event for game 2 was emitted once
    const events = await getDb().events.where('type').equals('LISTING_BUMP_AVAILABLE').toArray();
    expect(events.map((e) => e.payload['gameId'])).toEqual(['2']);
  });

  it('sends node_ids[] for a partially selected game', async () => {
    await getDb().bumpState.add(game('7', { nodeIds: ['701', '702', '703'] }));
    settings = running((s) => (s.bump.nodeIds = ['702', '703']));
    answers.set('raise:7', { kind: 'raised', message: '', waitSec: null });
    await runAutoBump(deps());
    expect(calls[0]).toEqual({ action: 'raise', gameId: '7', nodeId: '702', nodeIds: ['702', '703'] });
  });

  it('backs off on failures, stops after N and notifies once per streak', async () => {
    await getDb().bumpState.add(game('1'));
    settings = running((s) => (s.bump.maxConsecutiveFailures = 2));
    answers.set('raise:1', { kind: 'error', message: 'FunPay server error (HTTP 502)', waitSec: 600 });
    await runAutoBump(deps());
    let g = (await getDb().bumpState.get('1'))!;
    expect(g).toMatchObject({ status: 'error', consecutiveFailures: 1, nextEligibleAt: NOW + 600_000 });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'failure', title: 'Raising offers failed' }));
    clock = NOW + 2 * H; // past backoff and the 60-min floor
    await runAutoBump(deps());
    g = (await getDb().bumpState.get('1'))!;
    expect(g).toMatchObject({ consecutiveFailures: 2, nextEligibleAt: null });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Auto-bump stopped' }));
    clock = NOW + 100 * H;
    calls = [];
    await runAutoBump(deps());
    expect(calls).toEqual([]); // stopped: no more automatic attempts
  });

  it('treats exceptions as failures and a missing tab as "waiting" (no failure counted)', async () => {
    await getDb().bumpState.bulkAdd([game('1'), game('2')]);
    answers.set('raise:1', () => {
      throw new NoTabError();
    });
    const r = await runAutoBump(deps());
    expect(r.results.map((x) => x.result)).toEqual(['no_tab']);
    expect(calls).toHaveLength(1); // stops the cycle: no point trying other games
    expect((await getDb().bumpState.get('1'))!.consecutiveFailures).toBe(0);
    expect((await readRuntime()).awaitingTabSince).toBe(NOW);
    answers.set('raise:1', () => {
      throw new Error('FunPay tab did not respond (reload the tab)');
    });
    answers.set('raise:2', { kind: 'raised', message: 'ok', waitSec: 3600 });
    await runAutoBump(deps());
    expect((await getDb().bumpState.get('1'))!).toMatchObject({ status: 'error', consecutiveFailures: 1, lastMessage: 'FunPay tab did not respond (reload the tab)' });
    expect((await readRuntime()).awaitingTabSince).toBeNull();
  });

  it('notifies on success only when enabled', async () => {
    await getDb().bumpState.add(game('1'));
    answers.set('raise:1', { kind: 'raised', message: 'ok', waitSec: null });
    await runAutoBump(deps());
    expect(notify).not.toHaveBeenCalled();
    settings = running((s) => (s.bump.notifyOnSuccess = true));
    clock = NOW + 2 * H;
    await runAutoBump(deps());
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'bump', title: 'Offers raised' }));
  });

  it('rejects unrecognised answers instead of trusting them', async () => {
    await getDb().bumpState.add(game('1'));
    answers.set('raise:1', { kind: 'raised', message: 42 });
    await runAutoBump(deps());
    expect((await getDb().bumpState.get('1'))!).toMatchObject({ status: 'error', lastMessage: 'Unrecognised answer from the FunPay tab' });
  });
});

describe('manual raise', () => {
  it('works while automation is paused (or auto-bump is off) but never during the emergency stop', async () => {
    await getDb().bumpState.add(game('1'));
    answers.set('raise:1', { kind: 'raised', message: 'ok', waitSec: null });
    settings = running((s) => {
      s.automation.state = 'paused';
      s.automation.autoBump = false;
    });
    const r = await runManualBump(deps());
    expect(r.results.map((x) => x.result)).toEqual(['raised']);
    settings = running((s) => (s.automation.state = 'stopped'));
    await expect(runManualBump(deps())).rejects.toMatchObject({ code: 'emergency_stop' });
  });

  it('skips known cooldowns when raising all, but tries a specific game; at most once per minute', async () => {
    await getDb().bumpState.bulkAdd([game('1', { status: 'waiting', lastAttemptAt: NOW - H, nextEligibleAt: NOW + H }), game('2')]);
    answers.set('raise:1', { kind: 'cooldown', message: 'Подождите 1 час.', waitSec: 1800 });
    answers.set('raise:2', { kind: 'raised', message: 'ok', waitSec: null });
    const all = await runManualBump(deps());
    expect(all.results.map((x) => [x.gameId, x.result, x.skipReason ?? null])).toEqual([
      ['1', 'skipped', 'cooldown'],
      ['2', 'raised', null],
    ]);
    const one = await runManualBump(deps(), '1');
    expect(one.results[0]).toMatchObject({ result: 'cooldown' });
    const again = await runManualBump(deps(), '1');
    expect(again.results[0]).toMatchObject({ result: 'skipped', skipReason: 'too_soon' });
    await expect(runManualBump(deps(), 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('explains when nothing is known yet or no tab is open', async () => {
    await expect(runManualBump(deps())).rejects.toMatchObject({ code: 'no_targets' });
    await getDb().bumpState.add(game('1'));
    answers.set('raise:1', () => {
      throw new NoTabError();
    });
    await expect(runManualBump(deps())).rejects.toMatchObject({ code: 'no_tab' });
  });

  it('never posts twice for a game while a raise is in flight (manual click racing the alarm)', async () => {
    await getDb().bumpState.add(game('1'));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    answers.set('raise:1', async () => {
      await gate;
      return { kind: 'raised', message: 'ok', waitSec: null };
    });
    const auto = runAutoBump(deps());
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    const manual = await runManualBump(deps(), '1');
    expect(manual.results[0]).toMatchObject({ result: 'skipped', skipReason: 'too_soon' });
    release();
    expect((await auto).results[0]).toMatchObject({ result: 'raised' });
    expect(calls).toHaveLength(1);
  });

  it('a manual success resumes a stopped game', async () => {
    await getDb().bumpState.add(game('1', { status: 'error', consecutiveFailures: 5, lastAttemptAt: NOW - H }));
    answers.set('raise:1', { kind: 'raised', message: 'ok', waitSec: 7200 });
    await runManualBump(deps(), '1');
    expect((await getDb().bumpState.get('1'))!).toMatchObject({ status: 'raised', consecutiveFailures: 0, nextEligibleAt: NOW + 2 * H });
  });
});

describe('resumeBump', () => {
  it('resets failure streaks without moving a FunPay cooldown earlier', async () => {
    await getDb().bumpState.bulkAdd([
      game('1', { status: 'error', consecutiveFailures: 5, nextEligibleAt: null }),
      game('2', { status: 'error', consecutiveFailures: 1, nextEligibleAt: NOW + H }),
      game('3', { status: 'raised' }),
    ]);
    expect(await resumeBump(undefined, NOW)).toBe(2);
    expect((await getDb().bumpState.get('1'))!).toMatchObject({ consecutiveFailures: 0, status: 'idle', nextEligibleAt: null });
    expect((await getDb().bumpState.get('2'))!).toMatchObject({ consecutiveFailures: 0, nextEligibleAt: NOW + H });
  });
});

describe('alarm arming', () => {
  it('arms one alarm for the earliest planned attempt and is idempotent', async () => {
    await getDb().bumpState.bulkAdd([
      game('1', { status: 'waiting', lastAttemptAt: NOW - 2 * H, nextEligibleAt: NOW + 3 * H }),
      game('2', { status: 'waiting', lastAttemptAt: NOW - 2 * H, nextEligibleAt: NOW + 2 * H }),
    ]);
    const first = await ensureBumpAlarm(deps());
    expect(first).toEqual({ action: 'set', at: NOW + 2 * H + BUMP_SAFETY_MARGIN_MS });
    clock += 60_000; // e.g. the next worker start / tick
    expect(await ensureBumpAlarm(deps())).toEqual({ action: 'keep', at: NOW + 2 * H + BUMP_SAFETY_MARGIN_MS });
    expect(alarmSets).toBe(1);
    expect((await readRuntime()).nextAlarmAt).toBe(NOW + 2 * H + BUMP_SAFETY_MARGIN_MS);
  });

  it('clears the alarm when auto-bump is off, paused or stopped', async () => {
    await getDb().bumpState.add(game('1'));
    await ensureBumpAlarm(deps());
    expect(alarm).toBeDefined();
    for (const mutate of [(s: Settings) => (s.automation.autoBump = false), (s: Settings) => (s.automation.state = 'paused'), (s: Settings) => (s.automation.state = 'stopped')]) {
      await ensureBumpAlarm(deps());
      settings = running(mutate);
      expect((await ensureBumpAlarm(deps())).action).toBe('clear');
      expect(alarm).toBeUndefined();
      settings = running();
    }
  });

  it('re-checks every few minutes while waiting for a FunPay tab, without contacting FunPay', async () => {
    await getDb().bumpState.add(game('1'));
    ctx = { funpayTabAvailable: false, sessionLoggedIn: false };
    expect(await ensureBumpAlarm(deps())).toEqual({ action: 'set', at: NOW + NO_TAB_RECHECK_MS });
    expect(calls).toEqual([]);
    ctx = { funpayTabAvailable: true, sessionLoggedIn: true };
    // a due game with a tab: the existing earlier-or-equal alarm is kept / or set ≥ 30 s ahead
    alarm = undefined;
    expect(await ensureBumpAlarm(deps())).toEqual({ action: 'set', at: NOW + MIN_ALARM_DELAY_MS });
  });
});

describe('availability events', () => {
  it('emits LISTING_BUMP_AVAILABLE once per eligibility window', async () => {
    await getDb().bumpState.bulkAdd([game('1', { status: 'waiting', nextEligibleAt: NOW - 1 }), game('2', { status: 'waiting', nextEligibleAt: NOW + H }), game('3', { status: 'error', nextEligibleAt: NOW - 1 })]);
    expect(await emitBumpAvailability(deps())).toBe(1);
    expect(await emitBumpAvailability(deps())).toBe(0);
  });
});

describe('discovery', () => {
  it('walks profile → subcategory pages, caches raise targets and ingests listings', async () => {
    await getDb().listings.add(makeListing('9000009', { nodeId: '777', categoryName: 'Only inactive offers here', active: false }));
    answers.set('profile', {
      listings: [
        { id: '9000001', nodeId: '501', gameId: null, categoryName: 'Game A Accounts', title: 'Starter', price: { amountMinor: 21040, currency: 'RUB' }, amount: null, active: true, promoted: false, autoDelivery: false },
        { id: 'bad' },
      ],
      reviews: [],
    });
    answers.set('node:501', { target: { gameId: '41', nodeId: '501' }, listings: [{ id: '9000001', nodeId: '501', gameId: '41', categoryName: 'Game A — Accounts', title: 'Starter', price: { amountMinor: 19999, currency: 'RUB' }, amount: 5, active: true, promoted: false, autoDelivery: true }] });
    answers.set('node:777', { target: { gameId: '41', nodeId: '777' }, listings: [] });
    const p = await discoverBumpTargets(deps(), '1000001');
    expect(p).toMatchObject({ status: 'done', total: 2, done: 2, games: 1, errors: [] });
    expect(calls[0]).toEqual({ action: 'fetchPage', kind: 'profile', path: '/users/1000001/' });
    expect(sleeps).toEqual([GAME_GAP_MS]);
    const g = (await getDb().bumpState.get('41'))!;
    expect(g.nodeIds.sort()).toEqual(['501', '777']);
    expect(g.categoryName).toBe('Game A — Accounts');
    expect((await getDb().listings.get('9000001'))!).toMatchObject({ gameId: '41', autoDelivery: true, amount: 5 });
    expect((await getDb().kv.get(BUMP_DISCOVERY_KEY))!.value).toMatchObject({ status: 'done' });
  });

  it('continues after a failing subcategory and aborts cleanly without a tab', async () => {
    await getDb().listings.bulkAdd([makeListing('1', { nodeId: '501' }), makeListing('2', { nodeId: '502' })]);
    answers.set('profile', { listings: [], reviews: [] });
    answers.set('node:501', () => {
      throw new Error('HTTP 500');
    });
    answers.set('node:502', { target: null, listings: [] });
    const p = await discoverBumpTargets(deps(), null);
    expect(p).toMatchObject({ status: 'done', done: 2, games: 0 });
    expect(p.errors).toEqual(['501: HTTP 500']);
    answers.set('profile', () => {
      throw new NoTabError();
    });
    await expect(discoverBumpTargets(deps(), null)).rejects.toMatchObject({ code: 'no_tab' });
    expect((await getDb().kv.get(BUMP_DISCOVERY_KEY))!.value).toMatchObject({ status: 'failed' });
  });
});

