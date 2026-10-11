import { z } from 'zod';

export const CustomerSchema = z.object({
  /** FunPay user id when known, otherwise `name:<username>`. */
  id: z.string().min(1),
  name: z.string(),
  tags: z.array(z.string()).default([]),
  notes: z.string().default(''),
  pinned: z.boolean().default(false),
  followUpAt: z.string().nullable().default(null),
  followUpNote: z.string().default(''),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;
