import { z } from 'zod';
import { EventTypeSchema } from './events';

export const ConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text_contains'), field: z.string(), value: z.string() }),
  z.object({ kind: z.literal('text_matches'), field: z.string(), pattern: z.string() }),
  z.object({
    kind: z.literal('number_compare'),
    field: z.string(),
    op: z.enum(['<', '<=', '=', '>=', '>']),
    value: z.number(),
  }),
  z.object({ kind: z.literal('equals'), field: z.string(), value: z.union([z.string(), z.number(), z.boolean()]) }),
  z.object({ kind: z.literal('time_window'), start: z.string(), end: z.string() }),
]);
export type Condition = z.infer<typeof ConditionSchema>;

/** Only approved, non-destructive actions are available to user rules. */
export const ActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notify'), title: z.string(), body: z.string() }),
  z.object({ kind: z.literal('telegram'), text: z.string() }),
  z.object({ kind: z.literal('prepare_reply'), templateId: z.string() }),
  z.object({ kind: z.literal('send_reply'), templateId: z.string() }),
  z.object({ kind: z.literal('queue_bump') }),
  z.object({ kind: z.literal('suggest_reprice') }),
  z.object({ kind: z.literal('tag_customer'), tag: z.string() }),
  z.object({ kind: z.literal('log'), message: z.string() }),
]);
export type WorkflowAction = z.infer<typeof ActionSchema>;

export const WorkflowRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  priority: z.number().int().default(0),
  trigger: EventTypeSchema,
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
  cooldownSec: z.number().int().min(0).default(60),
  dryRun: z.boolean().default(true),
  /** Stop evaluating lower-priority rules after this one fires. */
  stopProcessing: z.boolean().default(false),
  lastFiredAt: z.number().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowRule = z.infer<typeof WorkflowRuleSchema>;
