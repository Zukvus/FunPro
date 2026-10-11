import { browser } from 'wxt/browser';
import { log } from '@/core/log/logger';
import { RPC, RpcEnvelopeSchema, type RpcMethod, type RpcResult } from '@/core/messaging/protocol';
import { classifySender, type SenderLike } from '@/core/security/sender';
import type { z } from 'zod';

type Params<M extends RpcMethod> = z.output<(typeof RPC)[M]['params']>;
export interface HandlerContext {
  sender: SenderLike;
  tabId: number | null;
}
type Handler<M extends RpcMethod> = (params: Params<M>, ctx: HandlerContext) => Promise<unknown> | unknown;

const handlers = new Map<RpcMethod, Handler<RpcMethod>>();

export function handle<M extends RpcMethod>(method: M, fn: Handler<M>): void {
  handlers.set(method, fn as unknown as Handler<RpcMethod>);
}

export class UserFacingError extends Error {
  constructor(
    message: string,
    readonly code = 'error',
  ) {
    super(message);
  }
}

/**
 * Validate and dispatch a runtime message. Returns `undefined` for messages that are not FunPro RPC
 * envelopes (so other listeners can handle them).
 */
export async function dispatch(message: unknown, sender: SenderLike): Promise<RpcResult | undefined> {
  const env = RpcEnvelopeSchema.safeParse(message);
  if (!env.success) return undefined;
  const method = env.data.method as RpcMethod;
  const def = RPC[method];
  if (!def) return { ok: false, error: 'Unknown method', code: 'unknown_method' };
  const origin = classifySender(sender, browser.runtime.id, browser.runtime.getURL('/').replace(/\/$/, ''));
  if (origin === 'untrusted' || origin !== def.from) {
    void log.warn({ source: 'security', message: `Rejected ${method} from ${origin} sender` });
    return { ok: false, error: 'Forbidden', code: 'forbidden' };
  }
  const parsed = def.params.safeParse(env.data.params ?? {});
  if (!parsed.success) return { ok: false, error: 'Invalid parameters', code: 'invalid_params' };
  const fn = handlers.get(method);
  if (!fn) return { ok: false, error: 'Not implemented', code: 'not_implemented' };
  try {
    const data = await fn(parsed.data as never, { sender, tabId: sender.tab?.id ?? null });
    return { ok: true, data: data ?? null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!(e instanceof UserFacingError))
      void log.error({ source: 'rpc', message: `${method} failed: ${msg}` });
    return { ok: false, error: msg, code: e instanceof UserFacingError ? e.code : 'internal' };
  }
}

export function registeredMethods(): RpcMethod[] {
  return [...handlers.keys()];
}
