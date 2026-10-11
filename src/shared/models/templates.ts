import { z } from 'zod';

export const MessageTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Slash command (without "/"), e.g. "thanks" → "/thanks". */
  command: z
    .string()
    .regex(/^[\p{L}\p{N}_-]{1,32}$/u)
    .nullable()
    .default(null),
  body: z.string().min(1).max(4000),
  /** Optional language tag for multilingual templates. */
  lang: z.enum(['ru', 'en', 'uk', 'any']).default('any'),
  tags: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MessageTemplate = z.infer<typeof MessageTemplateSchema>;

export const MatchModeSchema = z.enum(['contains', 'exact', 'word', 'regex']);

export const AutoReplyRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  priority: z.number().int().default(0),
  /** Keywords / phrases; any match triggers the rule. */
  patterns: z.array(z.string().min(1)).min(1),
  matchMode: MatchModeSchema.default('contains'),
  caseSensitive: z.boolean().default(false),
  /** Template body to send (supports variables). */
  reply: z.string().min(1).max(4000),
  /** Minimum seconds before this rule may fire again for the same chat. */
  cooldownSec: z.number().int().min(0).default(600),
  /** If true, the reply is prepared as a draft for approval instead of being sent. */
  requireApproval: z.boolean().default(true),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AutoReplyRule = z.infer<typeof AutoReplyRuleSchema>;

export const ReviewTemplateSchema = z.object({
  id: z.string().min(1),
  stars: z.number().int().min(1).max(5),
  body: z.string().min(1).max(1000),
  enabled: z.boolean().default(true),
});
export type ReviewTemplate = z.infer<typeof ReviewTemplateSchema>;
