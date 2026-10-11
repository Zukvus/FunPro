import { z } from 'zod';
import { MoneySchema } from './money';

export const FinanceKindSchema = z.enum(['income', 'expense', 'withdrawal', 'deposit', 'refund', 'other']);
export type FinanceKind = z.infer<typeof FinanceKindSchema>;

export const FinanceOperationSchema = z.object({
  id: z.string().min(1),
  kind: FinanceKindSchema,
  /** Positive amount; direction is expressed by `kind`. */
  amount: MoneySchema,
  at: z.string().nullable(),
  rawDate: z.string().default(''),
  description: z.string().default(''),
  status: z.string().default(''),
  orderId: z.string().nullable().default(null),
  firstSeenAt: z.string(),
});
export type FinanceOperation = z.infer<typeof FinanceOperationSchema>;

export const BalanceSchema = z.object({
  balances: z.array(MoneySchema),
  at: z.string(),
});
export type Balance = z.infer<typeof BalanceSchema>;
