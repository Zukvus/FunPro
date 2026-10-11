/**
 * Auto-reply rules CRUD (`db.autoReplyRules`). Rules are validated before they are stored:
 * regex patterns must pass the static safety check, replies must fit a FunPay message.
 */
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import { MatchModeSchema, type AutoReplyRule } from '@/shared/models';
import { checkRegexSafety, type RegexRejection } from './matching';
import { MAX_MESSAGE_LENGTH } from './outbox';

export const RuleInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(-100).max(100).default(0),
  patterns: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  matchMode: MatchModeSchema.default('contains'),
  caseSensitive: z.boolean().default(false),
  reply: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  cooldownSec: z.number().int().min(0).max(7 * 86400).default(600),
  requireApproval: z.boolean().default(true),
});
export type RuleInput = z.input<typeof RuleInputSchema>;

export class RuleError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'unsafe_pattern' | 'not_found',
    readonly detail?: { pattern: string; reason: RegexRejection },
  ) {
    super(code);
    this.name = 'RuleError';
  }
}

/** Split a multi-line editor value into unique, trimmed patterns. */
export function parsePatterns(text: string): string[] {
  return [...new Set(text.split('\n').map((p) => p.trim()).filter(Boolean))];
}

export async function saveRule(input: RuleInput, id?: string, now = new Date()): Promise<AutoReplyRule> {
  const parsed = RuleInputSchema.safeParse(input);
  if (!parsed.success) throw new RuleError('invalid_input');
  const data = parsed.data;
  if (data.matchMode === 'regex') {
    for (const pattern of data.patterns) {
      const check = checkRegexSafety(pattern);
      if (!check.ok) throw new RuleError('unsafe_pattern', { pattern, reason: check.reason });
    }
  }
  const db = getDb();
  const existing = id ? await db.autoReplyRules.get(id) : undefined;
  if (id && !existing) throw new RuleError('not_found');
  const at = now.toISOString();
  const rule: AutoReplyRule = {
    ...data,
    patterns: [...new Set(data.patterns)],
    id: existing?.id ?? newId('arr'),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
  };
  await db.autoReplyRules.put(rule);
  return rule;
}

export async function setRuleEnabled(id: string, enabled: boolean): Promise<void> {
  await getDb().autoReplyRules.update(id, { enabled, updatedAt: new Date().toISOString() });
}

export async function deleteRule(id: string): Promise<void> {
  await getDb().autoReplyRules.delete(id);
}
