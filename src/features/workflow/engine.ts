/**
 * Workflow engine: on every domain event, evaluate the enabled rules for that trigger in priority
 * order (higher first) and run their actions.
 *
 * Safety:
 *  - emergency stop halts everything (including dry-run evaluation);
 *  - live actions require evaluateFeature('workflows') = running; dry-run rules only describe;
 *  - idempotent per (event, rule) via markHandled; per-rule cooldown; stopProcessing;
 *  - loop prevention: events marked as workflow-originated are ignored, a rule cannot re-enter
 *    itself while its actions run, and a global cap limits live actions per minute;
 *  - baseline (historical) events never contact buyers or notify (see actions.ts).
 */
import { evaluateFeature, type AutomationContext, type FeatureStatus } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { markHandled } from '@/core/events/bus';
import { isFlagEnabled } from '@/core/flags/flags';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { notify } from '@/features/notifications/notify';
import type { DomainEvent, WorkflowRule } from '@/shared/models';
import { runAction, type ActionOutcome } from './actions';
import { evaluateConditions, type ConditionResult } from './conditions';
import { buildContext, type WorkflowContext } from './context';
import { isWorkflowOrigin } from './hooks';

export interface WorkflowDeps {
  getSettings: () => Promise<Settings>;
  automationContext: () => Promise<AutomationContext>;
  selfUserId: () => Promise<string | null>;
  selfName?: () => Promise<string | null>;
  now?: () => number;
}

export type SkipReason = 'cooldown' | 'not_running' | 'already_handled' | 'loop';

export interface RuleTrace {
  ruleId: string;
  name: string;
  dryRun: boolean;
  matched: boolean;
  fired: boolean;
  skipped: SkipReason | null;
  skipDetail?: string;
  conditions: ConditionResult[];
  actions: ActionOutcome[];
}

// ---- in-memory runtime guards (reset when the service worker restarts) ----------------------
const actionTimes: number[] = [];
const activeRules = new Set<string>();
let lastRateWarning = 0;

export function resetWorkflowRuntimeForTests(): void {
  actionTimes.length = 0;
  activeRules.clear();
  lastRateWarning = 0;
}

function takeActionSlot(now: number, maxPerMinute: number): boolean {
  while (actionTimes.length && now - actionTimes[0]! >= 60_000) actionTimes.shift();
  if (actionTimes.length >= maxPerMinute) return false;
  actionTimes.push(now);
  return true;
}

export function sortRules(rules: readonly WorkflowRule[]): WorkflowRule[] {
  return [...rules].sort(
    (a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
}

const nowOf = (deps: Pick<WorkflowDeps, 'now'>) => (deps.now ? deps.now() : Date.now());

export async function handleWorkflowEvent(event: DomainEvent, deps: WorkflowDeps): Promise<RuleTrace[]> {
  const settings = await deps.getSettings();
  if (!isFlagEnabled('workflowBuilder', settings.flags)) return [];
  if (settings.automation.state === 'stopped') return [];
  if (isWorkflowOrigin(event.payload)) return [];
  const db = getDb();
  const rules = sortRules(
    (await db.workflowRules.where('trigger').equals(event.type).toArray()).filter((r) => r.enabled),
  );
  if (rules.length === 0) return [];
  const nowMs = nowOf(deps);
  const now = new Date(nowMs);
  const ctx = await buildContext(event, {
    selfUserId: await deps.selfUserId(),
    selfName: deps.selfName ? await deps.selfName() : null,
    now,
  });
  const feature = evaluateFeature(settings, 'workflows', await deps.automationContext());
  const traces: RuleTrace[] = [];
  for (const rule of rules) {
    // Re-read: an earlier rule (or a concurrent event) may have changed the stop state.
    if ((await deps.getSettings()).automation.state === 'stopped') break;
    const trace = await processRule(rule, ctx, { settings, feature, now, nowMs });
    traces.push(trace);
    if (trace.fired && !rule.dryRun && rule.stopProcessing) break;
  }
  return traces;
}

async function processRule(
  rule: WorkflowRule,
  ctx: WorkflowContext,
  env: { settings: Settings; feature: FeatureStatus; now: Date; nowMs: number },
): Promise<RuleTrace> {
  const { matched, results } = evaluateConditions(rule.conditions, ctx.vars, env.now);
  const trace: RuleTrace = {
    ruleId: rule.id,
    name: rule.name,
    dryRun: rule.dryRun,
    matched,
    fired: false,
    skipped: null,
    conditions: results,
    actions: [],
  };
  if (!matched) return trace;
  const source = `workflow:${rule.id}`;
  if (rule.lastFiredAt !== null && env.nowMs - rule.lastFiredAt < rule.cooldownSec * 1000) {
    trace.skipped = 'cooldown';
    await log.debug({ source, message: `Matched ${ctx.event.type} but skipped: cooldown` });
    return trace;
  }
  const live = !rule.dryRun;
  if (live && env.feature.status !== 'running') {
    trace.skipped = 'not_running';
    trace.skipDetail = `${env.feature.status}: ${env.feature.reason}`;
    await log.info({
      source,
      message: `Matched ${ctx.event.type} but not executed — workflows ${env.feature.status} (${env.feature.reason})`,
    });
    return trace;
  }
  if (activeRules.has(rule.id)) {
    trace.skipped = 'loop';
    await log.warn({
      source,
      message: `Loop prevented: the rule was triggered again while its own actions were running (${ctx.event.type})`,
    });
    return trace;
  }
  if (!(await markHandled(ctx.event.id, live ? rule.id : `${rule.id}:dry`))) {
    trace.skipped = 'already_handled';
    return trace;
  }
  activeRules.add(rule.id);
  try {
    for (const [index, action] of rule.actions.entries()) {
      if (
        live &&
        action.kind !== 'log' &&
        !takeActionSlot(env.nowMs, env.settings.workflow.maxActionsPerMinute)
      ) {
        trace.actions.push({
          kind: action.kind,
          status: 'skipped',
          message: 'global workflow action limit reached',
        });
        if (env.nowMs - lastRateWarning > 60_000) {
          lastRateWarning = env.nowMs;
          await log.warn({
            source,
            message: `Workflow action limit (${env.settings.workflow.maxActionsPerMinute}/min) reached — actions skipped`,
          });
          await notify({
            kind: 'failure',
            title: 'Workflow actions paused',
            body: `More than ${env.settings.workflow.maxActionsPerMinute} workflow actions in a minute. Check your rules for loops.`,
            dedupeKey: `wf-rate:${Math.floor(env.nowMs / 600_000)}`,
          });
        }
        continue;
      }
      try {
        trace.actions.push(
          await runAction(action, { rule, ctx, live, settings: env.settings, now: env.now, index }),
        );
      } catch (e) {
        trace.actions.push({
          kind: action.kind,
          status: 'failed',
          message: (e as Error).message.slice(0, 200),
        });
      }
    }
  } finally {
    activeRules.delete(rule.id);
  }
  trace.fired = true;
  await getDb().workflowRules.update(rule.id, { lastFiredAt: env.nowMs });
  const summary = trace.actions.map((a) => `${a.kind}: ${a.message}`).join(' | ');
  await log.info({
    source,
    message: `${live ? 'Fired' : '[dry-run] Matched'} on ${ctx.event.type}: ${summary}`.slice(0, 1000),
    details: { eventId: ctx.event.id, statuses: trace.actions.map((a) => a.status) },
  });
  return trace;
}

/**
 * Evaluate one rule against a stored event in forced dry-run (rules page "test run").
 * No side effects at all: no markHandled, no lastFiredAt, no logs.
 */
export async function testRunRule(
  rule: WorkflowRule,
  event: DomainEvent,
  deps: Pick<WorkflowDeps, 'getSettings' | 'selfUserId' | 'selfName' | 'now'>,
): Promise<RuleTrace> {
  const settings = await deps.getSettings();
  const now = new Date(nowOf(deps));
  const ctx = await buildContext(event, {
    selfUserId: await deps.selfUserId(),
    selfName: deps.selfName ? await deps.selfName() : null,
    now,
  });
  const { matched, results } = evaluateConditions(rule.conditions, ctx.vars, now);
  const trace: RuleTrace = {
    ruleId: rule.id,
    name: rule.name,
    dryRun: true,
    matched,
    fired: false,
    skipped: null,
    conditions: results,
    actions: [],
  };
  if (!matched) return trace;
  const dryRule = { ...rule, dryRun: true };
  for (const [index, action] of rule.actions.entries()) {
    try {
      trace.actions.push(await runAction(action, { rule: dryRule, ctx, live: false, settings, now, index }));
    } catch (e) {
      trace.actions.push({
        kind: action.kind,
        status: 'failed',
        message: (e as Error).message.slice(0, 200),
      });
    }
  }
  trace.fired = true;
  return trace;
}
