/**
 * Workflow rule storage + JSON import/export (zod-validated). Imported rules always arrive
 * disabled and in dry-run, with fresh ids — they never start acting on their own.
 */
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import { newId } from '@/core/util/id';
import {
  ActionSchema,
  ConditionSchema,
  EventTypeSchema,
  WorkflowRuleSchema,
  type WorkflowRule,
} from '@/shared/models';
import { checkRegexSafety } from './conditions';

export type RuleDraft = Omit<WorkflowRule, 'id' | 'createdAt' | 'updatedAt' | 'lastFiredAt'>;

export function emptyRule(): RuleDraft {
  return {
    name: '',
    enabled: false,
    priority: 0,
    trigger: 'MESSAGE_RECEIVED',
    conditions: [],
    actions: [{ kind: 'notify', title: '', body: '' }],
    cooldownSec: 60,
    dryRun: true,
    stopProcessing: false,
  };
}

/** Validation beyond the schema: safe regex patterns, non-empty texts. Returns error messages. */
export function validateRule(rule: RuleDraft): string[] {
  const errors: string[] = [];
  if (!rule.name.trim()) errors.push('name');
  rule.conditions.forEach((c, i) => {
    if (c.kind === 'text_matches') {
      const why = checkRegexSafety(c.pattern);
      if (why) errors.push(`condition ${i + 1}: ${why}`);
    }
    if (c.kind !== 'time_window' && !c.field.trim()) errors.push(`condition ${i + 1}: field`);
  });
  rule.actions.forEach((a, i) => {
    if ((a.kind === 'prepare_reply' || a.kind === 'send_reply') && !a.templateId)
      errors.push(`action ${i + 1}: template`);
    if (a.kind === 'notify' && !a.title.trim()) errors.push(`action ${i + 1}: title`);
    if (a.kind === 'telegram' && !a.text.trim()) errors.push(`action ${i + 1}: text`);
    if (a.kind === 'tag_customer' && !a.tag.trim()) errors.push(`action ${i + 1}: tag`);
    if (a.kind === 'log' && !a.message.trim()) errors.push(`action ${i + 1}: message`);
  });
  if (rule.actions.length === 0) errors.push('actions');
  return errors;
}

export async function saveRule(draft: RuleDraft, id?: string, now = new Date()): Promise<WorkflowRule> {
  const errors = validateRule(draft);
  if (errors.length) throw new Error(`Invalid rule: ${errors.join('; ')}`);
  const db = getDb();
  const existing = id ? await db.workflowRules.get(id) : undefined;
  const at = now.toISOString();
  const rule = WorkflowRuleSchema.parse({
    ...draft,
    name: draft.name.trim().slice(0, 120),
    id: existing?.id ?? newId('wf'),
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    lastFiredAt: existing?.lastFiredAt ?? null,
  });
  await db.workflowRules.put(rule);
  return rule;
}

export async function deleteRule(id: string): Promise<void> {
  await getDb().workflowRules.delete(id);
}

export async function listRules(): Promise<WorkflowRule[]> {
  return getDb().workflowRules.toArray();
}

// ---------------------------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------------------------

export const RULES_FORMAT = 'funpro-workflow-rules';

const PortableRuleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(false),
  priority: z.number().int().min(-1000).max(1000).default(0),
  trigger: EventTypeSchema,
  conditions: z.array(ConditionSchema).max(20).default([]),
  actions: z.array(ActionSchema).min(1).max(10),
  cooldownSec: z
    .number()
    .int()
    .min(0)
    .max(7 * 86400)
    .default(60),
  dryRun: z.boolean().default(true),
  stopProcessing: z.boolean().default(false),
});

export const RulesFileSchema = z.object({
  format: z.literal(RULES_FORMAT),
  version: z.literal(1),
  rules: z.array(PortableRuleSchema).max(200),
});

export function exportRules(rules: readonly WorkflowRule[], now = new Date()): string {
  return JSON.stringify(
    {
      format: RULES_FORMAT,
      version: 1,
      exportedAt: now.toISOString(),
      rules: rules.map((r) => ({
        name: r.name,
        enabled: r.enabled,
        priority: r.priority,
        trigger: r.trigger,
        conditions: r.conditions,
        actions: r.actions,
        cooldownSec: r.cooldownSec,
        dryRun: r.dryRun,
        stopProcessing: r.stopProcessing,
      })),
    },
    null,
    2,
  );
}

export interface ImportPreview {
  rules: RuleDraft[];
  /** Per-rule problems that block import (unsafe regex, missing fields). */
  rejected: { name: string; errors: string[] }[];
  /** Referenced templates that do not exist locally. */
  missingTemplates: string[];
}

/** Parse and validate an exported file. Throws on malformed JSON or a schema mismatch. */
export async function parseRulesFile(text: string): Promise<ImportPreview> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON');
  }
  const parsed = RulesFileSchema.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `Not a FunPro rules file: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`.trim(),
    );
  const rules: RuleDraft[] = [];
  const rejected: ImportPreview['rejected'] = [];
  const templateIds = new Set<string>();
  for (const r of parsed.data.rules) {
    // Safety: imported rules never start enabled or live.
    const draft: RuleDraft = { ...r, enabled: false, dryRun: true };
    const errors = validateRule(draft);
    if (errors.length) rejected.push({ name: r.name, errors });
    else rules.push(draft);
    for (const a of r.actions)
      if (a.kind === 'prepare_reply' || a.kind === 'send_reply') templateIds.add(a.templateId);
  }
  const known = new Set((await getDb().templates.toCollection().primaryKeys()).map(String));
  return { rules, rejected, missingTemplates: [...templateIds].filter((id) => !known.has(id)) };
}

export async function importRules(preview: ImportPreview, now = new Date()): Promise<number> {
  let n = 0;
  for (const r of preview.rules) {
    await saveRule(r, undefined, now);
    n++;
  }
  return n;
}
