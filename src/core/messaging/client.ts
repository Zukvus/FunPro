import { browser } from 'wxt/browser';
import type { RpcMethod, RpcParams, RpcResult } from './protocol';

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/** Call a background RPC method. Throws RpcError on failure. */
export async function rpc<T = unknown>(
  method: RpcMethod,
  params: RpcParams<typeof method> = {} as never,
): Promise<T> {
  let res: RpcResult<T> | undefined;
  try {
    res = (await browser.runtime.sendMessage({ __funpro: 1, method, params })) as RpcResult<T> | undefined;
  } catch (e) {
    throw new RpcError(e instanceof Error ? e.message : 'Extension background is unavailable', 'unavailable');
  }
  if (!res) throw new RpcError('No response from background', 'no_response');
  if (!res.ok) throw new RpcError(res.error, res.code);
  return res.data;
}
