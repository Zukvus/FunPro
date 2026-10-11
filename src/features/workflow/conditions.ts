/**
 * Workflow conditions over a flattened variable map (`payload.x`, `order.status`, `customer.tags`…).
 * Regular expressions are restricted to a "safe subset" so a rule (possibly imported from a file)
 * cannot freeze the extension with catastrophic backtracking.
 */
import { isWithinWindow } from '@/core/util/time';
import type { Condition } from '@/shared/models';

export type Primitive = string | number | boolean | null;
export type Vars = Record<string, Primitive>;

export const MAX_PATTERN_LENGTH = 200;
/** Texts are truncated before regex matching (bounds polynomial backtracking). */
export const MAX_MATCH_INPUT = 1000;
const MAX_UNBOUNDED_QUANTIFIERS = 3;

/** Returns null when the pattern is acceptable, otherwise a short reason. */
export function checkRegexSafety(pattern: string): string | null {
  if (pattern.length === 0) return 'empty pattern';
  if (pattern.length > MAX_PATTERN_LENGTH) return `longer than ${MAX_PATTERN_LENGTH} characters`;
  if (/\\[1-9]|\\k</.test(pattern)) return 'backreferences are not allowed';
  const stack: { hasQ: boolean; hasAlt: boolean }[] = [{ hasQ: false, hasAlt: false }];
  let lastGroup: { hasQ: boolean; hasAlt: boolean } | null = null;
  let unbounded = 0;
  for (let i = 0; i < pattern.length; ) {
    const ch = pattern[i]!;
    if (ch === '\\') {
      i += 2;
      lastGroup = null;
      continue;
    }
    if (ch === '[') {
      i++;
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++;
      while (i < pattern.length && pattern[i] !== ']') i += pattern[i] === '\\' ? 2 : 1;
      i++;
      lastGroup = null;
      continue;
    }
    if (ch === '(') {
      stack.push({ hasQ: false, hasAlt: false });
      i++;
      lastGroup = null;
      continue;
    }
    if (ch === ')') {
      const g = stack.length > 1 ? stack.pop()! : { hasQ: false, hasAlt: false };
      stack[stack.length - 1]!.hasQ ||= g.hasQ;
      lastGroup = g;
      i++;
      continue;
    }
    if (ch === '|') {
      stack[stack.length - 1]!.hasAlt = true;
      lastGroup = null;
      i++;
      continue;
    }
    let qLen = 0;
    let repeat = false;
    if (ch === '*' || ch === '+') {
      qLen = 1;
      repeat = true;
      unbounded++;
    } else if (ch === '?') {
      qLen = 1;
    } else if (ch === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(pattern.slice(i));
      if (m) {
        qLen = m[0].length;
        const max = m[2] === undefined ? Number(m[1]) : m[3] === '' ? Infinity : Number(m[3]);
        repeat = max > 1;
        if (max === Infinity) unbounded++;
        if (Number(m[1]) > 1000 || (Number.isFinite(max) && max > 1000)) return 'repetition counts above 1000 are not allowed';
      }
    }
    if (qLen > 0) {
      if (repeat && lastGroup && (lastGroup.hasQ || lastGroup.hasAlt)) return 'nested or alternating repetition is not allowed';
      if (repeat) stack[stack.length - 1]!.hasQ = true;
      i += qLen;
      if (pattern[i] === '?') i++; // lazy modifier
      lastGroup = null;
      continue;
    }
    lastGroup = null;
    i++;
  }
  if (unbounded > MAX_UNBOUNDED_QUANTIFIERS) return `at most ${MAX_UNBOUNDED_QUANTIFIERS} unbounded repetitions (*, +) are allowed`;
  try {
    new RegExp(pattern, 'iu');
  } catch (e) {
    return (e as Error).message.slice(0, 120);
  }
  return null;
}

const regexCache = new Map<string, RegExp | null>();

export function compileSafeRegex(pattern: string): RegExp | null {
  if (regexCache.has(pattern)) return regexCache.get(pattern)!;
  const re = checkRegexSafety(pattern) === null ? new RegExp(pattern, 'iu') : null;
  if (regexCache.size > 500) regexCache.clear();
  regexCache.set(pattern, re);
  return re;
}

export function toText(v: Primitive | undefined): string {
  if (v === null || v === undefined) return '';
  return String(v);
}

export function toNumber(v: Primitive | undefined): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' && v.trim() !== '') return Number(v.replace(',', '.'));
  return Number.NaN;
}

export interface ConditionResult {
  ok: boolean;
  /** Human-readable explanation for dry-run / test-run traces. */
  detail: string;
}

export function evaluateCondition(c: Condition, vars: Vars, now: Date): ConditionResult {
  switch (c.kind) {
    case 'text_contains': {
      const v = toText(vars[c.field]);
      const ok = v.toLowerCase().includes(c.value.toLowerCase());
      return { ok, detail: `${c.field} ${ok ? 'contains' : 'does not contain'} "${c.value}"` };
    }
    case 'text_matches': {
      const re = compileSafeRegex(c.pattern);
      if (!re) return { ok: false, detail: `pattern rejected (${checkRegexSafety(c.pattern) ?? 'invalid'})` };
      const ok = re.test(toText(vars[c.field]).slice(0, MAX_MATCH_INPUT));
      return { ok, detail: `${c.field} ${ok ? 'matches' : 'does not match'} /${c.pattern}/` };
    }
    case 'number_compare': {
      const n = toNumber(vars[c.field]);
      if (!Number.isFinite(n)) return { ok: false, detail: `${c.field} is not a number` };
      const ok = c.op === '<' ? n < c.value : c.op === '<=' ? n <= c.value : c.op === '=' ? n === c.value : c.op === '>=' ? n >= c.value : n > c.value;
      return { ok, detail: `${c.field} = ${n} ${ok ? '✓' : '✗'} ${c.op} ${c.value}` };
    }
    case 'equals': {
      const v = vars[c.field];
      let ok: boolean;
      if (typeof c.value === 'number') ok = toNumber(v) === c.value;
      else if (typeof c.value === 'boolean') ok = v === c.value || toText(v).toLowerCase() === String(c.value);
      else ok = toText(v).trim() === c.value.trim();
      return { ok, detail: `${c.field} ${ok ? '=' : '≠'} ${JSON.stringify(c.value)}` };
    }
    case 'time_window': {
      const ok = isWithinWindow(now, c.start, c.end);
      return { ok, detail: `time ${ok ? 'within' : 'outside'} ${c.start}–${c.end}` };
    }
  }
}

export function evaluateConditions(conditions: readonly Condition[], vars: Vars, now: Date): { matched: boolean; results: ConditionResult[] } {
  const results = conditions.map((c) => evaluateCondition(c, vars, now));
  return { matched: results.every((r) => r.ok), results };
}
