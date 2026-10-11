/**
 * Conflict detection: two enabled rules on the same trigger whose conditions can match the same
 * event and whose actions clash (two buyer replies, two drafts from different templates, a reply
 * plus a draft). A higher-priority rule with stopProcessing (not dry-run) prevents the clash.
 * Conditions are treated as overlapping unless they are provably disjoint.
 */
import { hhmmToMinutes } from '@/core/util/time';
import type { Condition, WorkflowRule } from '@/shared/models';
import { sortRules } from './engine';

export type ConflictKind = 'double_reply' | 'different_drafts' | 'reply_and_draft';

export interface RuleConflict {
  kind: ConflictKind;
  ruleIds: [string, string];
  trigger: WorkflowRule['trigger'];
}

type Interval = { lo: number; loIncl: boolean; hi: number; hiIncl: boolean };

function interval(c: Extract<Condition, { kind: 'number_compare' }>): Interval {
  switch (c.op) {
    case '<':
      return { lo: -Infinity, loIncl: false, hi: c.value, hiIncl: false };
    case '<=':
      return { lo: -Infinity, loIncl: false, hi: c.value, hiIncl: true };
    case '=':
      return { lo: c.value, loIncl: true, hi: c.value, hiIncl: true };
    case '>=':
      return { lo: c.value, loIncl: true, hi: Infinity, hiIncl: false };
    case '>':
      return { lo: c.value, loIncl: false, hi: Infinity, hiIncl: false };
  }
}

function contains(iv: Interval, x: number): boolean {
  const aboveLo = iv.lo < x || (iv.lo === x && iv.loIncl);
  const belowHi = iv.hi > x || (iv.hi === x && iv.hiIncl);
  return aboveLo && belowHi;
}

function intervalsOverlap(a: Interval, b: Interval): boolean {
  const lo = Math.max(a.lo, b.lo);
  const hi = Math.min(a.hi, b.hi);
  if (lo < hi) return true;
  if (lo > hi) return false;
  return contains(a, lo) && contains(b, lo);
}

function minutesSet(start: string, end: string): [number, number][] {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (s === e) return [];
  return s < e ? [[s, e]] : [[s, 1440], [0, e]];
}

function windowsOverlap(a: Extract<Condition, { kind: 'time_window' }>, b: Extract<Condition, { kind: 'time_window' }>): boolean {
  for (const [s1, e1] of minutesSet(a.start, a.end)) for (const [s2, e2] of minutesSet(b.start, b.end)) if (Math.max(s1, s2) < Math.min(e1, e2)) return true;
  return false;
}

/** False only when some pair of conditions can never hold together. */
export function conditionsMayOverlap(a: readonly Condition[], b: readonly Condition[]): boolean {
  for (const x of a) {
    for (const y of b) {
      if (x.kind === 'time_window' && y.kind === 'time_window') {
        if (!windowsOverlap(x, y)) return false;
        continue;
      }
      if (x.kind === 'time_window' || y.kind === 'time_window' || x.field !== y.field) continue;
      if (x.kind === 'equals' && y.kind === 'equals' && String(x.value).trim() !== String(y.value).trim()) return false;
      if (x.kind === 'number_compare' && y.kind === 'number_compare' && !intervalsOverlap(interval(x), interval(y))) return false;
      if (x.kind === 'equals' && y.kind === 'number_compare' && typeof x.value === 'number' && !intervalsOverlap(interval({ ...y }), { lo: x.value, loIncl: true, hi: x.value, hiIncl: true })) return false;
      if (y.kind === 'equals' && x.kind === 'number_compare' && typeof y.value === 'number' && !intervalsOverlap(interval({ ...x }), { lo: y.value, loIncl: true, hi: y.value, hiIncl: true })) return false;
    }
  }
  return true;
}

function replyActions(rule: WorkflowRule) {
  return {
    sends: rule.actions.filter((a) => a.kind === 'send_reply').map((a) => (a as { templateId: string }).templateId),
    drafts: rule.actions.filter((a) => a.kind === 'prepare_reply').map((a) => (a as { templateId: string }).templateId),
  };
}

export function detectConflicts(rules: readonly WorkflowRule[]): RuleConflict[] {
  const out: RuleConflict[] = [];
  const enabled = sortRules(rules.filter((r) => r.enabled));
  for (const r of enabled) {
    const { sends, drafts } = replyActions(r);
    if (sends.length > 1) out.push({ kind: 'double_reply', ruleIds: [r.id, r.id], trigger: r.trigger });
    if (new Set(drafts).size > 1) out.push({ kind: 'different_drafts', ruleIds: [r.id, r.id], trigger: r.trigger });
  }
  for (let i = 0; i < enabled.length; i++) {
    for (let j = i + 1; j < enabled.length; j++) {
      const a = enabled[i]!;
      const b = enabled[j]!;
      if (a.trigger !== b.trigger) continue;
      if (a.stopProcessing && !a.dryRun) continue;
      if (!conditionsMayOverlap(a.conditions, b.conditions)) continue;
      const ra = replyActions(a);
      const rb = replyActions(b);
      let kind: ConflictKind | null = null;
      if (ra.sends.length && rb.sends.length) kind = 'double_reply';
      else if ((ra.sends.length && rb.drafts.length) || (ra.drafts.length && rb.sends.length)) kind = 'reply_and_draft';
      else if (ra.drafts.length && rb.drafts.length && new Set([...ra.drafts, ...rb.drafts]).size > 1) kind = 'different_drafts';
      if (kind) out.push({ kind, ruleIds: [a.id, b.id], trigger: a.trigger });
    }
  }
  return out;
}
