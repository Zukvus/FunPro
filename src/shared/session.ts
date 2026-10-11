import { z } from 'zod';

export const SessionStatusSchema = z.enum(['logged_in', 'logged_out', 'unknown']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

/**
 * Public session information derived from the page. It intentionally contains NO credentials:
 * the CSRF token stays inside the content script that read it, and cookies are never read.
 */
export const SessionInfoSchema = z.object({
  status: SessionStatusSchema,
  userId: z.string().nullable(),
  username: z.string().nullable(),
  locale: z.enum(['ru', 'en', 'uk']).nullable(),
  /** Header badges, if present. */
  activeSales: z.number().int().nullable().default(null),
  activePurchases: z.number().int().nullable().default(null),
  unreadChats: z.number().int().nullable().default(null),
  balanceText: z.string().nullable().default(null),
  adapterVersion: z.string(),
  observedAt: z.number(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
