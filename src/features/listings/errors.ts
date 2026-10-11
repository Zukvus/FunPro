import type { Capability } from '@/adapters/funpay/capabilities';

/**
 * Errors with stable codes that the background maps to user-facing RPC errors and the dashboard
 * maps to translated messages (`listings.err.<code>`).
 */
export type ListingsErrorCode =
  | 'emergency_stop'
  | 'awaiting_authorization'
  | 'not_found'
  | 'invalid_plan'
  | 'too_large'
  | 'confirmation_required'
  | 'already_started'
  | 'unsupported'
  | 'no_tab'
  | 'unavailable_in_build'
  | 'no_targets'
  | 'funpay_error';

export class ListingsActionError extends Error {
  constructor(
    message: string,
    readonly code: ListingsErrorCode,
  ) {
    super(message);
    this.name = 'ListingsActionError';
  }
}

/** `NoFunPayTabError` lives in the background runtime; features detect it by name to stay decoupled. */
export function isNoTabError(e: unknown): boolean {
  return e instanceof Error && e.name === 'NoFunPayTabError';
}

/** Error code attached by `execInFunPayTab` (content-script error codes such as 'invalid', 'logged_out'). */
export function errorCode(e: unknown): string | undefined {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' ? c : undefined;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The content script rejected a command it does not know: this build has not wired it yet. */
export function isUnknownCommandError(e: unknown): boolean {
  return errorCode(e) === 'invalid';
}

/** A capability FunPro may use (evidenced or verified); `unsupported` ones are refused. */
export function capabilityUsable(c: Capability): boolean {
  return c.status !== 'unsupported';
}
