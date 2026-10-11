import { z } from 'zod';

export const ReviewSchema = z.object({
  /** Order id the review belongs to (FunPay reviews are tied to orders). */
  orderId: z.string().min(1),
  stars: z.number().int().min(1).max(5).nullable(),
  text: z.string(),
  authorName: z.string(),
  at: z.string().nullable(),
  rawDate: z.string().default(''),
  sellerReply: z.string().nullable().default(null),
  firstSeenAt: z.string(),
});
export type Review = z.infer<typeof ReviewSchema>;
