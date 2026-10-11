import { z } from 'zod';
import { MoneySchema } from './money';

export const ListingSchema = z.object({
  /** FunPay offer id (string to preserve leading zeros / large ids). */
  id: z.string().min(1),
  /** FunPay subcategory ("node") id, used for raising offers and competitor lookups. */
  nodeId: z.string().nullable(),
  /** FunPay game/category id (needed by the raise endpoint). */
  gameId: z.string().nullable(),
  categoryName: z.string().default(''),
  title: z.string(),
  titleEn: z.string().optional(),
  description: z.string().optional(),
  descriptionEn: z.string().optional(),
  /** Buyer-facing price as displayed on FunPay. */
  price: MoneySchema,
  /** Stock amount if shown, null when unlimited/unknown. */
  amount: z.number().int().nullable(),
  active: z.boolean(),
  promoted: z.boolean().default(false),
  autoDelivery: z.boolean().default(false),
  /** Seller-entered cost of goods in minor units of the listing currency. */
  costMinor: z.number().int().nullable().default(null),
  /** User-defined manual ordering. */
  sortIndex: z.number().default(0),
  seenAt: z.string(),
  updatedAt: z.string(),
});
export type Listing = z.infer<typeof ListingSchema>;

/** A bulk-editable patch. Every field optional; undefined means "leave as is". */
export const ListingPatchSchema = z.object({
  title: z.string().optional(),
  titleEn: z.string().optional(),
  description: z.string().optional(),
  descriptionEn: z.string().optional(),
  priceMinor: z.number().int().positive().optional(),
  amount: z.number().int().nonnegative().nullable().optional(),
  active: z.boolean().optional(),
  costMinor: z.number().int().nonnegative().nullable().optional(),
});
export type ListingPatch = z.infer<typeof ListingPatchSchema>;
