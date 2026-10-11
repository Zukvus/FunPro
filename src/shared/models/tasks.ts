import { z } from 'zod';

/**
 * Durable task. Tasks survive MV3 service-worker suspension and browser restarts because the
 * full state lives in IndexedDB; the worker only ever acts on what is persisted.
 */
export const TaskStatusSchema = z.enum([
  'pending',
  'running',
  'done',
  'failed',
  'cancelled',
  /** Requires an open, logged-in FunPay tab to execute. */
  'awaiting_tab',
  /** Blocked by policy (emergency stop, disabled feature, unverified capability). */
  'blocked',
]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskKindSchema = z.enum([
  'bump',
  'send_message',
  'bulk_edit',
  'deliver',
  'reprice',
  'sync_orders',
  'sync_chats',
  'sync_listings',
  'notify',
]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  kind: TaskKindSchema,
  status: TaskStatusSchema,
  /** Prevents enqueueing the same logical work twice. */
  idempotencyKey: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  nextRunAt: z.number(),
  lastError: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Task = z.infer<typeof TaskSchema>;
