import { z } from 'zod';

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const ActivityLogEntrySchema = z.object({
  id: z.number().int().optional(),
  at: z.number(),
  level: LogLevelSchema,
  /** Module that produced the entry, e.g. "bump", "auto-reply". */
  source: z.string(),
  message: z.string(),
  /** Actionable hint for the user, if any. */
  hint: z.string().optional(),
  /** Already-redacted structured details. */
  details: z.record(z.string(), z.unknown()).optional(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntrySchema>;

export const NotificationItemSchema = z.object({
  id: z.string(),
  at: z.number(),
  kind: z.enum(['order', 'message', 'review', 'bump', 'inventory', 'price', 'failure', 'system']),
  title: z.string(),
  body: z.string(),
  url: z.string().nullable().default(null),
  read: z.boolean().default(false),
});
export type NotificationItem = z.infer<typeof NotificationItemSchema>;
