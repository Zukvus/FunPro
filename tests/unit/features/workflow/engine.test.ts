import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, emitEvent, onEvent } from '@/core/events/bus';
import { getSettings, updateSettings } from '@/core/settings/store';
import { clearSinksForTests, registerSink } from '@/features/notifications/notify';
import { checkRegexSafety, evaluateCondition } from '@/features/workflow/conditions';
import { buildContext, flatten, renderTemplate } from '@/features/workflow/context';
import { conditionsMayOverlap, detectConflicts } from '@/features/workflow/conflicts';
import {
  handleWorkflowEvent,
  resetWorkflowRuntimeForTests,
  testRunRule,
  type WorkflowDeps,
} from '@/features/workflow/engine';
import { registerBumpHandler } from '@/features/workflow/hooks';
import {
  exportRules,
  importRules,
  parseRulesFile,
  saveRule,
  type RuleDraft,
} from '@/features/workflow/rules';
import type { DomainEvent, WorkflowRule } from '@/shared/models';

const NOW = new Date(2026, 9, 1, 14, 30).getTime();

function deps(over: Partial<WorkflowDeps> = {}): WorkflowDeps {
  return {
    getSettings,
    automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
    selfUserId: async () => '100',
    selfName: async () => 'MyShop',
    now: () => NOW,
    ...over,
  };
}

function draft(over: Partial<RuleDraft> = {}): RuleDraft {
  return {
    name: 'Rule',
    enabled: true,
    priority: 0,
    trigger: 'MESSAGE_RECEIVED',
    conditions: [],
    actions: [{ kind: 'notify', title: 'New message from {buyer}', body: '{payload.text}' }],
    cooldownSec: 0,
    dryRun: false,
    stopProcessing: false,
    ...over,
  };
}

let seq = 0;
async function messageEvent(text: string, extra: Record<string, unknown> = {}): Promise<DomainEvent> {
  const id = `MESSAGE_RECEIVED:users-100-555:${++seq}`;
  const ev: DomainEvent = {
    id,
    type: 'MESSAGE_RECEIVED',
    at: new Date(NOW).toISOString(),
    payload: {
      chatId: 'users-100-555',
      messageId: String(seq),
      authorId: '555',
      authorName: 'buyer1',
      text,
      ...extra,
    },
    handledBy: [],
  };
  await getDb().events.put(ev);
  return ev;
}

async function enableWorkflows() {
  await updateSettings({ automation: { state: 'running', workflows: true } });
}

async function addTemplate(id: string, body: string) {
  await getDb().templates.put({
    id,
    name: id,
    command: null,
    body,
    lang: 'any',
    tags: [],
    createdAt: '',
    updatedAt: '',
  });
}

async function sideEffects() {
  const db = getDb();
  return {
    notifications: await db.notifications.count(),
    drafts: await db.drafts.count(),
    tasks: await db.tasks.count(),
    customersTagged: (await db.customers.toArray()).filter((c) => c.tags.length > 0).length,
  };
}

beforeEach(() => {
  resetDbForTests();
  clearEventHandlersForTests();
  clearSinksForTests();
  resetWorkflowRuntimeForTests();
  registerBumpHandler(null);
});

describe('conditions', () => {
  const vars = {
    'payload.text': 'Hello, where is my KEY?',
    'payload.stars': 2,
    'payload.baseline': false,
    'order.status': 'paid',
  };
  const now = new Date(NOW);

  it('evaluates every condition kind', () => {
    expect(
      evaluateCondition({ kind: 'text_contains', field: 'payload.text', value: 'key' }, vars, now).ok,
    ).toBe(true);
    expect(
      evaluateCondition({ kind: 'text_contains', field: 'payload.text', value: 'refund' }, vars, now).ok,
    ).toBe(false);
    expect(
      evaluateCondition({ kind: 'text_matches', field: 'payload.text', pattern: '^hello\\b' }, vars, now).ok,
    ).toBe(true);
    expect(
      evaluateCondition({ kind: 'number_compare', field: 'payload.stars', op: '<=', value: 3 }, vars, now).ok,
    ).toBe(true);
    expect(
      evaluateCondition({ kind: 'number_compare', field: 'payload.stars', op: '>', value: 3 }, vars, now).ok,
    ).toBe(false);
    expect(
      evaluateCondition({ kind: 'number_compare', field: 'payload.text', op: '>', value: 3 }, vars, now).ok,
    ).toBe(false);
    expect(evaluateCondition({ kind: 'equals', field: 'order.status', value: 'paid' }, vars, now).ok).toBe(
      true,
    );
    expect(evaluateCondition({ kind: 'equals', field: 'payload.stars', value: 2 }, vars, now).ok).toBe(true);
    expect(evaluateCondition({ kind: 'equals', field: 'payload.baseline', value: false }, vars, now).ok).toBe(
      true,
    );
    expect(evaluateCondition({ kind: 'time_window', start: '14:00', end: '15:00' }, vars, now).ok).toBe(true);
    expect(evaluateCondition({ kind: 'time_window', start: '22:00', end: '08:00' }, vars, now).ok).toBe(
      false,
    );
  });

  it('accepts a safe regex subset only', () => {
    expect(checkRegexSafety('^(order|заказ)\\s*#?[A-Z0-9]{8}$')).toBeNull();
    expect(checkRegexSafety('(a+)+$')).toMatch(/nested/);
    expect(checkRegexSafety('(a|aa)*b')).toMatch(/alternating/);
    expect(checkRegexSafety('(\\w)\\1')).toMatch(/backreferences/);
    expect(checkRegexSafety('a.*b.*c.*d.*e')).toMatch(/unbounded/);
    expect(checkRegexSafety('x{2000}')).toMatch(/1000/);
    expect(checkRegexSafety('(')).not.toBeNull();
    expect(checkRegexSafety('x'.repeat(201))).toMatch(/longer/);
    expect(
      evaluateCondition(
        { kind: 'text_matches', field: 'payload.text', pattern: '(a+)+$' },
        vars,
        new Date(NOW),
      ),
    ).toMatchObject({ ok: false });
  });

  it('flattens payloads and renders placeholders', () => {
    const v = flatten({ a: 1, b: { c: 'x', d: [1, 2] }, e: null }, 'payload');
    expect(v).toEqual({
      'payload.a': 1,
      'payload.b.c': 'x',
      'payload.b.d.length': 2,
      'payload.b.d': '1, 2',
      'payload.e': null,
    });
    const r = renderTemplate('Hi {buyer}, re {payload.b.c} {missing}', {
      vars: { 'customer.name': 'Bob', 'payload.b.c': 'x' },
      chatId: null,
    });
    expect(r).toEqual({ text: 'Hi Bob, re x {missing}', unresolved: ['missing'] });
  });

  it('enriches with order, customer and inventory context', async () => {
    await getDb().orders.put({
      id: 'ORD1',
      direction: 'sale',
      status: 'paid',
      counterpartyName: 'buyer1',
      counterpartyId: '555',
      description: 'Key, 2 шт.',
      categoryName: 'Steam',
      listingId: null,
      price: { amountMinor: 25000, currency: 'RUB' },
      createdAt: null,
      rawDate: '',
      firstSeenAt: '',
      updatedAt: '',
      history: [],
    });
    await getDb().customers.put({
      id: '555',
      name: 'buyer1',
      tags: ['vip'],
      notes: '',
      pinned: false,
      followUpAt: null,
      followUpNote: '',
      firstSeenAt: '',
      lastSeenAt: '',
    });
    const ctx = await buildContext(
      {
        id: 'ORDER_PAID:ORD1',
        type: 'ORDER_PAID',
        at: '',
        payload: { orderId: 'ORD1', buyerId: '555', baseline: false },
        handledBy: [],
      },
      { selfUserId: '100', now: new Date(NOW) },
    );
    expect(ctx.vars).toMatchObject({
      'order.price': 250,
      'order.quantity': 2,
      'customer.tags': 'vip',
      'customer.orderCount': 1,
      'time.hour': 14,
    });
    expect(ctx.chatId).toBe('users-100-555');
    expect(ctx.customer).toMatchObject({ key: '555', exists: true });
  });
});

describe('engine', () => {
  it('runs actions only when the workflows feature is running', async () => {
    await saveRule(draft());
    const ev = await messageEvent('hi');
    const [t] = await handleWorkflowEvent(ev, deps());
    expect(t).toMatchObject({ matched: true, fired: false, skipped: 'not_running' });
    expect((await sideEffects()).notifications).toBe(0);
    await enableWorkflows();
    const [t2] = await handleWorkflowEvent(await messageEvent('hi again'), deps());
    expect(t2).toMatchObject({ fired: true });
    const n = await getDb().notifications.toArray();
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ kind: 'message', title: 'New message from buyer1', body: 'hi again' });
  });

  it('dry-run describes actions without any side effect', async () => {
    await addTemplate('t1', 'Thanks {buyer}!');
    await saveRule(
      draft({
        dryRun: true,
        actions: [
          { kind: 'notify', title: 'x', body: 'y' },
          { kind: 'telegram', text: 'tg' },
          { kind: 'prepare_reply', templateId: 't1' },
          { kind: 'send_reply', templateId: 't1' },
          { kind: 'tag_customer', tag: 'asked' },
          { kind: 'queue_bump' },
          { kind: 'log', message: 'hello' },
        ],
      }),
    );
    let bumped = 0;
    registerBumpHandler(() => {
      bumped++;
    });
    const before = await sideEffects();
    const [t] = await handleWorkflowEvent(await messageEvent('hi'), deps()); // feature disabled: dry-run still allowed
    expect(t!.fired).toBe(true);
    expect(t!.actions.map((a) => a.status)).toEqual([
      'dry_run',
      'dry_run',
      'dry_run',
      'dry_run',
      'dry_run',
      'dry_run',
      'dry_run',
    ]);
    expect(await sideEffects()).toEqual(before);
    expect(bumped).toBe(0);
    const logs = await getDb().logs.where('source').startsWith('workflow:').toArray();
    expect(logs.some((l) => l.message.startsWith('[dry-run]'))).toBe(true);
  });

  it('live actions: draft, reply with idempotency key, tag, bump hook', async () => {
    await enableWorkflows();
    await addTemplate('t1', 'Thanks {buyer}!');
    const rule = await saveRule(
      draft({
        actions: [
          { kind: 'prepare_reply', templateId: 't1' },
          { kind: 'send_reply', templateId: 't1' },
          { kind: 'tag_customer', tag: 'asked' },
          { kind: 'queue_bump' },
        ],
      }),
    );
    const seen: unknown[] = [];
    registerBumpHandler((req) => {
      seen.push(req);
    });
    const ev = await messageEvent('hi');
    const [t] = await handleWorkflowEvent(ev, deps());
    expect(t!.actions.map((a) => a.status)).toEqual(['done', 'done', 'done', 'done']);
    const draftRow = (await getDb().drafts.toArray())[0];
    expect(draftRow).toMatchObject({ source: 'workflow', chatId: 'users-100-555', text: 'Thanks buyer1!' });
    const task = (await getDb().tasks.toArray())[0];
    expect(task).toMatchObject({ idempotencyKey: `msg:wf:${rule.id}:${ev.id}` });
    expect(task!.payload).toMatchObject({ source: 'workflow', ruleId: rule.id });
    expect((await getDb().customers.get('555'))!.tags).toEqual(['asked']);
    expect(seen).toEqual([
      { ruleId: rule.id, eventId: ev.id, origin: 'workflow', depth: 1, gameId: null, nodeId: null },
    ]);
  });

  it('refuses buyer replies with unresolved placeholders or contact details', async () => {
    await enableWorkflows();
    await addTemplate('bad1', 'Your code {nonexistent}');
    await addTemplate('bad2', 'Write me in telegram @myshop_support');
    await saveRule(
      draft({
        actions: [
          { kind: 'send_reply', templateId: 'bad1' },
          { kind: 'send_reply', templateId: 'bad2' },
        ],
      }),
    );
    const [t] = await handleWorkflowEvent(await messageEvent('hi'), deps());
    expect(t!.actions.map((a) => a.status)).toEqual(['skipped', 'skipped']);
    expect(await getDb().tasks.count()).toBe(0);
  });

  it('is idempotent per event and respects cooldowns', async () => {
    await enableWorkflows();
    const rule = await saveRule(draft({ cooldownSec: 600 }));
    const ev = await messageEvent('one');
    await handleWorkflowEvent(ev, deps());
    const [again] = await handleWorkflowEvent(ev, deps({ now: () => NOW + 3600_000 }));
    expect(again!.skipped).toBe('already_handled');
    const [cool] = await handleWorkflowEvent(await messageEvent('two'), deps({ now: () => NOW + 60_000 }));
    expect(cool!.skipped).toBe('cooldown');
    const [later] = await handleWorkflowEvent(
      await messageEvent('three'),
      deps({ now: () => NOW + 601_000 }),
    );
    expect(later!.fired).toBe(true);
    expect(await getDb().notifications.count()).toBe(2);
    expect((await getDb().events.get(ev.id))!.handledBy).toEqual([rule.id]);
  });

  it('orders by priority and honours stopProcessing', async () => {
    await enableWorkflows();
    await saveRule(draft({ name: 'low', priority: 1, actions: [{ kind: 'log', message: 'low' }] }));
    await saveRule(
      draft({
        name: 'high',
        priority: 10,
        stopProcessing: true,
        actions: [{ kind: 'log', message: 'high' }],
      }),
    );
    const traces = await handleWorkflowEvent(await messageEvent('x'), deps());
    expect(traces.map((t) => t.name)).toEqual(['high']);
  });

  it('ignores baseline events for buyer-facing and notifying actions', async () => {
    await enableWorkflows();
    await addTemplate('t1', 'Thanks!');
    await saveRule(
      draft({
        trigger: 'ORDER_PAID',
        actions: [
          { kind: 'send_reply', templateId: 't1' },
          { kind: 'notify', title: 'paid', body: '' },
          { kind: 'log', message: 'seen' },
        ],
      }),
    );
    const ev: DomainEvent = {
      id: 'ORDER_PAID:B1',
      type: 'ORDER_PAID',
      at: '',
      payload: { orderId: 'B1', buyerId: '555', baseline: true },
      handledBy: [],
    };
    await getDb().events.put(ev);
    const [t] = await handleWorkflowEvent(ev, deps());
    expect(t!.actions.map((a) => a.status)).toEqual(['skipped', 'skipped', 'done']);
    expect((await sideEffects()).tasks).toBe(0);
    expect((await sideEffects()).notifications).toBe(0);
  });

  it('emergency stop halts everything, including dry-run', async () => {
    await saveRule(draft({ dryRun: true }));
    await updateSettings({ automation: { state: 'stopped', workflows: true } });
    expect(await handleWorkflowEvent(await messageEvent('x'), deps())).toEqual([]);
    expect(await getDb().logs.where('source').startsWith('workflow:').count()).toBe(0);
  });
});

describe('loop prevention', () => {
  it('ignores workflow-originated events and blocks self re-entry via hooks', async () => {
    await enableWorkflows();
    const bumpRule = await saveRule(
      draft({
        name: 'bump on message',
        actions: [{ kind: 'queue_bump' }, { kind: 'notify', title: 'n', body: '' }],
      }),
    );
    // A badly-behaved bump module that emits a MESSAGE_RECEIVED event (with and without the marker).
    let calls = 0;
    registerBumpHandler(async (req) => {
      calls++;
      await emitEvent('MESSAGE_RECEIVED', `loop-marked-${calls}`, {
        chatId: 'users-100-555',
        text: 'echo',
        origin: req.origin,
        workflowDepth: req.depth,
      });
      await emitEvent('MESSAGE_RECEIVED', `loop-unmarked-${calls}`, {
        chatId: 'users-100-555',
        text: 'echo',
      });
    });
    onEvent('MESSAGE_RECEIVED', (e) => handleWorkflowEvent(e, deps()).then(() => undefined));
    await emitEvent('MESSAGE_RECEIVED', 'root', { chatId: 'users-100-555', authorId: '555', text: 'start' });
    expect(calls).toBe(1);
    const logs = await getDb().logs.where('source').equals(`workflow:${bumpRule.id}`).toArray();
    expect(logs.some((l) => l.message.startsWith('Loop prevented'))).toBe(true);
    expect(await getDb().notifications.count()).toBe(1);
  });

  it('caps live actions per minute globally', async () => {
    await enableWorkflows();
    await updateSettings({ workflow: { maxActionsPerMinute: 3 } });
    await saveRule(draft({ actions: [{ kind: 'notify', title: 'n {payload.text}', body: '' }] }));
    for (let i = 0; i < 5; i++) await handleWorkflowEvent(await messageEvent(`m${i}`), deps());
    const n = await getDb().notifications.toArray();
    // 3 rule notifications + 1 "workflow actions paused" warning
    expect(n.filter((x) => x.title.startsWith('n m'))).toHaveLength(3);
    expect(n.filter((x) => x.kind === 'failure')).toHaveLength(1);
  });
});

describe('test run, conflicts, import/export', () => {
  it('test-runs a rule against a stored event with no side effects', async () => {
    await addTemplate('t1', 'Hi {buyer}');
    const rule = await saveRule(
      draft({
        dryRun: false,
        conditions: [{ kind: 'text_contains', field: 'payload.text', value: 'price' }],
        actions: [{ kind: 'send_reply', templateId: 't1' }],
      }),
    );
    const ev = await messageEvent('what is the price?');
    const before = await sideEffects();
    const trace = await testRunRule(rule, ev, deps());
    expect(trace).toMatchObject({ matched: true, dryRun: true });
    expect(trace.actions[0]).toMatchObject({ status: 'dry_run' });
    expect(await sideEffects()).toEqual(before);
    expect((await getDb().events.get(ev.id))!.handledBy).toEqual([]);
    expect((await getDb().workflowRules.get(rule.id))!.lastFiredAt).toBeNull();
  });

  it('detects conflicting rules on overlapping conditions', async () => {
    const base = { id: '', createdAt: '2026-01-01', updatedAt: '', lastFiredAt: null } as const;
    const mk = (id: string, over: Partial<RuleDraft>): WorkflowRule => ({ ...base, ...draft(over), id });
    const a = mk('a', { priority: 2, actions: [{ kind: 'send_reply', templateId: 't1' }] });
    const b = mk('b', { priority: 1, actions: [{ kind: 'send_reply', templateId: 't2' }] });
    const c = mk('c', {
      priority: 0,
      actions: [{ kind: 'prepare_reply', templateId: 't3' }],
      conditions: [{ kind: 'equals', field: 'payload.text', value: 'x' }],
    });
    expect(detectConflicts([a, b]).map((x) => x.kind)).toEqual(['double_reply']);
    expect(detectConflicts([a, c]).map((x) => x.kind)).toEqual(['reply_and_draft']);
    expect(detectConflicts([{ ...a, stopProcessing: true }, b])).toEqual([]);
    expect(detectConflicts([a, { ...b, trigger: 'ORDER_PAID' }])).toEqual([]);
    expect(detectConflicts([a, { ...b, enabled: false }])).toEqual([]);
    const self = mk('s', {
      actions: [
        { kind: 'send_reply', templateId: 't1' },
        { kind: 'send_reply', templateId: 't2' },
      ],
    });
    expect(detectConflicts([self]).map((x) => x.kind)).toEqual(['double_reply']);
    // Provably disjoint conditions do not conflict.
    expect(
      conditionsMayOverlap(
        [{ kind: 'equals', field: 'payload.text', value: 'a' }],
        [{ kind: 'equals', field: 'payload.text', value: 'b' }],
      ),
    ).toBe(false);
    expect(
      conditionsMayOverlap(
        [{ kind: 'number_compare', field: 'payload.stars', op: '<=', value: 2 }],
        [{ kind: 'number_compare', field: 'payload.stars', op: '>', value: 2 }],
      ),
    ).toBe(false);
    expect(
      conditionsMayOverlap(
        [{ kind: 'number_compare', field: 'payload.stars', op: '<=', value: 3 }],
        [{ kind: 'number_compare', field: 'payload.stars', op: '>=', value: 3 }],
      ),
    ).toBe(true);
    expect(
      conditionsMayOverlap(
        [{ kind: 'time_window', start: '08:00', end: '12:00' }],
        [{ kind: 'time_window', start: '22:00', end: '07:00' }],
      ),
    ).toBe(false);
    expect(
      conditionsMayOverlap(
        [{ kind: 'text_contains', field: 'payload.text', value: 'a' }],
        [{ kind: 'text_contains', field: 'payload.text', value: 'b' }],
      ),
    ).toBe(true);
  });

  it('round-trips rules through JSON; imports arrive disabled, dry-run and validated', async () => {
    await saveRule(draft({ name: 'exported', enabled: true, dryRun: false }));
    const json = exportRules(await getDb().workflowRules.toArray());
    const preview = await parseRulesFile(json);
    expect(preview.rules).toHaveLength(1);
    expect(preview.rules[0]).toMatchObject({ name: 'exported', enabled: false, dryRun: true });
    expect(await importRules(preview)).toBe(1);
    expect(await getDb().workflowRules.count()).toBe(2);

    const evil = JSON.stringify({
      format: 'funpro-workflow-rules',
      version: 1,
      rules: [
        {
          name: 'evil',
          trigger: 'MESSAGE_RECEIVED',
          conditions: [{ kind: 'text_matches', field: 'payload.text', pattern: '(a+)+$' }],
          actions: [{ kind: 'send_reply', templateId: 'nope' }],
        },
      ],
    });
    const p2 = await parseRulesFile(evil);
    expect(p2.rules).toHaveLength(0);
    expect(p2.rejected[0]!.name).toBe('evil');
    expect(p2.missingTemplates).toEqual(['nope']);
    await expect(parseRulesFile('{"format":"other"}')).rejects.toThrow();
    await expect(parseRulesFile('not json')).rejects.toThrow(/JSON/);
  });

  it('telegram actions are addressed only to the Telegram sink', async () => {
    await enableWorkflows();
    const telegram: unknown[] = [];
    const others: unknown[] = [];
    registerSink('telegram', (item, input) => {
      telegram.push([item.body, input.sinks]);
    });
    registerSink('desktop', () => {
      others.push(1);
    });
    await saveRule(draft({ actions: [{ kind: 'telegram', text: 'Order from {buyer}' }] }));
    await handleWorkflowEvent(await messageEvent('x'), deps());
    expect(telegram).toHaveLength(1);
    expect((telegram[0] as [string, string[]])[1]).toEqual(['telegram']);
    expect(others).toEqual([]);
  });
});
