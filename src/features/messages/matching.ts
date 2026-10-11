/**
 * Auto-reply rule matching.
 *
 * Modes
 *  - contains: the message contains the phrase;
 *  - exact:    the whole message is the phrase (surrounding whitespace / trailing punctuation ignored);
 *  - word:     the phrase appears as whole word(s) — Unicode-aware, works for Cyrillic;
 *  - regex:    a user regular expression, accepted only if it passes `checkRegexSafety`.
 *
 * Without `caseSensitive`, matching is case-insensitive and treats "ё" as "е" (except in regex mode,
 * where the `i` flag applies).
 *
 * Regex safety: JavaScript cannot interrupt a running regex, so catastrophic patterns are rejected
 * statically (length, nested/overlapping quantifiers, backreferences) and regexes only ever see the
 * first REGEX_LIMITS.maxInput characters of a message.
 */
import type { AutoReplyRule } from '@/shared/models';

export type MatchMode = AutoReplyRule['matchMode'];

export const REGEX_LIMITS = {
  maxLength: 200,
  /** Quantifiers that can repeat without a small bound: *, +, {n,}, {n,m} with m − n > 10. */
  maxUnbounded: 2,
  maxQuantifiers: 8,
  maxGroups: 10,
  /** Characters of the message a regex is tested against. */
  maxInput: 300,
} as const;

export type RegexRejection = 'empty' | 'too_long' | 'invalid' | 'backreference' | 'nested_quantifier' | 'too_many_quantifiers' | 'too_many_groups';
export type RegexCheck = { ok: true } | { ok: false; reason: RegexRejection };

interface Quantifier {
  len: number;
  /** Can repeat more than once. */
  repeats: boolean;
  unbounded: boolean;
}

function readQuantifier(src: string, i: number): Quantifier | null {
  const c = src[i];
  let q: Quantifier | null = null;
  if (c === '*' || c === '+') q = { len: 1, repeats: true, unbounded: true };
  else if (c === '?') q = { len: 1, repeats: false, unbounded: false };
  else if (c === '{') {
    const m = src.slice(i).match(/^\{(\d{1,4})(,(\d{0,4}))?\}/);
    if (!m) return null;
    const min = Number(m[1]);
    const hasComma = m[2] !== undefined;
    const max = hasComma ? (m[3] ? Number(m[3]) : Infinity) : min;
    q = { len: m[0].length, repeats: max > 1, unbounded: max === Infinity || max - min > 10 };
  }
  if (q && src[i + q.len] === '?') q.len += 1; // lazy modifier
  return q;
}

/**
 * Static safety analysis of a user regex. Rejects:
 *  - patterns longer than REGEX_LIMITS.maxLength, unbalanced or syntactically invalid patterns;
 *  - backreferences (\1, \k<name>);
 *  - a repeated group that itself contains a quantifier or an alternation — `(a+)+`, `(a|aa)*`,
 *    `(\w+\s?)*` — the classic exponential-backtracking shapes;
 *  - more than `maxUnbounded` unbounded quantifiers (`.*.*.*x` is polynomial but already slow).
 */
export function checkRegexSafety(src: string): RegexCheck {
  if (!src.trim()) return { ok: false, reason: 'empty' };
  if (src.length > REGEX_LIMITS.maxLength) return { ok: false, reason: 'too_long' };
  const stack: { hasQuant: boolean; hasAlt: boolean }[] = [{ hasQuant: false, hasAlt: false }];
  let unbounded = 0;
  let quantifiers = 0;
  let groups = 0;
  let i = 0;
  const top = () => stack[stack.length - 1]!;
  const applyQuant = (q: Quantifier) => {
    quantifiers++;
    if (q.unbounded) unbounded++;
    top().hasQuant = true;
  };
  while (i < src.length) {
    const c = src[i]!;
    if (c === '\\') {
      const next = src[i + 1];
      if (next === undefined) return { ok: false, reason: 'invalid' };
      if (/[1-9]/.test(next) || (next === 'k' && src[i + 2] === '<')) return { ok: false, reason: 'backreference' };
      if ((next === 'p' || next === 'P' || next === 'u') && src[i + 2] === '{') {
        const close = src.indexOf('}', i + 3);
        if (close < 0) return { ok: false, reason: 'invalid' };
        i = close + 1;
      } else {
        i += 2;
      }
    } else if (c === '[') {
      let j = i + 1;
      if (src[j] === '^') j++;
      if (src[j] === ']') j++;
      while (j < src.length && src[j] !== ']') j += src[j] === '\\' ? 2 : 1;
      if (j >= src.length) return { ok: false, reason: 'invalid' };
      i = j + 1;
    } else if (c === '(') {
      groups++;
      stack.push({ hasQuant: false, hasAlt: false });
      i++;
      if (src[i] === '?') {
        if (src[i + 1] === '<' && src[i + 2] !== '=' && src[i + 2] !== '!') {
          const close = src.indexOf('>', i + 2);
          if (close < 0) return { ok: false, reason: 'invalid' };
          i = close + 1;
        } else {
          i += src[i + 1] === '<' ? 3 : 2;
        }
      }
      continue;
    } else if (c === ')') {
      if (stack.length < 2) return { ok: false, reason: 'invalid' };
      const frame = stack.pop()!;
      i++;
      const q = readQuantifier(src, i);
      if (q) {
        if (q.repeats && (frame.hasQuant || frame.hasAlt)) return { ok: false, reason: 'nested_quantifier' };
        applyQuant(q);
        i += q.len;
      }
      if (frame.hasQuant) top().hasQuant = true;
      if (frame.hasAlt) top().hasAlt = true;
      continue;
    } else if (c === '|') {
      top().hasAlt = true;
      i++;
    } else {
      i++;
    }
    // A quantifier may follow any atom (escape, class or plain character).
    const q = readQuantifier(src, i);
    if (q) {
      applyQuant(q);
      i += q.len;
    }
  }
  if (stack.length !== 1) return { ok: false, reason: 'invalid' };
  if (groups > REGEX_LIMITS.maxGroups) return { ok: false, reason: 'too_many_groups' };
  if (unbounded > REGEX_LIMITS.maxUnbounded || quantifiers > REGEX_LIMITS.maxQuantifiers) return { ok: false, reason: 'too_many_quantifiers' };
  try {
    new RegExp(src, 'u');
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true };
}

export function compileSafeRegex(src: string, caseSensitive: boolean): RegExp | null {
  if (!checkRegexSafety(src).ok) return null;
  try {
    return new RegExp(src, caseSensitive ? 'u' : 'iu');
  } catch {
    return null;
  }
}

/** Normalise text for the plain-text modes. */
export function normalizeForMatch(text: string, caseSensitive: boolean): string {
  let t = text.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!caseSensitive) t = t.toLowerCase().replace(/ё/g, 'е');
  return t;
}

function stripEdgePunctuation(t: string): string {
  return t.replace(/^[\s.,!?…:;"'«»()-]+|[\s.,!?…:;"'«»()-]+$/gu, '');
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface PatternError {
  pattern: string;
  reason: RegexRejection;
}

export interface CompiledRule {
  rule: AutoReplyRule;
  /** Patterns that could not be used (regex mode only). */
  errors: PatternError[];
  /** Returns the first matching pattern, or null. */
  match: (text: string) => string | null;
}

export function compileRule(rule: AutoReplyRule): CompiledRule {
  const cs = rule.caseSensitive;
  const errors: PatternError[] = [];
  const testers: { pattern: string; test: (raw: string, norm: string) => boolean }[] = [];
  for (const pattern of rule.patterns) {
    if (!pattern.trim()) continue;
    switch (rule.matchMode) {
      case 'contains': {
        const p = normalizeForMatch(pattern, cs);
        testers.push({ pattern, test: (_raw, norm) => norm.includes(p) });
        break;
      }
      case 'exact': {
        const p = stripEdgePunctuation(normalizeForMatch(pattern, cs));
        testers.push({ pattern, test: (_raw, norm) => stripEdgePunctuation(norm) === p });
        break;
      }
      case 'word': {
        const p = normalizeForMatch(pattern, cs);
        const body = escapeRegex(p).replace(/ /g, '\\s+');
        const wordRe = new RegExp(`(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`, 'u');
        testers.push({ pattern, test: (_raw, norm) => wordRe.test(norm) });
        break;
      }
      case 'regex': {
        const check = checkRegexSafety(pattern);
        const rx = check.ok ? compileSafeRegex(pattern, cs) : null;
        if (!rx) {
          errors.push({ pattern, reason: check.ok ? 'invalid' : check.reason });
          break;
        }
        testers.push({ pattern, test: (raw) => rx.test(raw.slice(0, REGEX_LIMITS.maxInput)) });
        break;
      }
    }
  }
  return {
    rule,
    errors,
    match(text: string) {
      const raw = text.replace(/\s+/g, ' ').trim();
      if (!raw) return null;
      const norm = normalizeForMatch(raw, cs);
      for (const t of testers) if (t.test(raw, norm)) return t.pattern;
      return null;
    },
  };
}

/** Highest priority first; ties broken by creation time, then name — deterministic. */
export function sortRules<T extends Pick<AutoReplyRule, 'priority' | 'createdAt' | 'name'>>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name));
}

/**
 * The single rule that answers a message: the highest-priority enabled rule with a matching
 * pattern. Lower-priority rules are never used as a fallback (predictable behaviour).
 */
export function findMatchingRule(rules: readonly AutoReplyRule[], text: string): { rule: AutoReplyRule; pattern: string } | null {
  for (const rule of sortRules(rules.filter((r) => r.enabled))) {
    const pattern = compileRule(rule).match(text);
    if (pattern !== null) return { rule, pattern };
  }
  return null;
}
