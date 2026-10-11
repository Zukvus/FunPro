/**
 * JSON-over-HTTPS helper shared by the AI provider adapters: per-attempt timeout (AbortController),
 * bounded retries on 429 / 5xx / network errors (honouring Retry-After), typed errors whose
 * messages never contain the API key.
 */
import { redactString } from '@/core/log/redact';
import { sleep as defaultSleep } from '@/core/util/async';
import { AiError, type AiErrorCode } from './types';

export interface HttpDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
}

export interface PostJsonOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  /** Retries after the first attempt (429 / 408 / 5xx / network). Timeouts are not retried. */
  maxRetries?: number;
  signal?: AbortSignal;
  deps?: HttpDeps;
  /** Values that must never appear in error messages (API keys). */
  secrets?: readonly string[];
}

export const DEFAULT_TIMEOUT_MS = 45_000;
export const DEFAULT_MAX_RETRIES = 2;
/** Longest Retry-After we are willing to wait inside one request; longer waits fail fast. */
const MAX_RETRY_WAIT_SEC = 20;

export function codeForStatus(status: number): AiErrorCode {
  if (status === 401 || status === 403) return 'auth';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

/** Seconds from `retry-after-ms` / `retry-after` (seconds or HTTP date). */
export function parseRetryAfter(headers: Headers, now = Date.now()): number | null {
  const ms = headers.get('retry-after-ms');
  if (ms && /^\d+(\.\d+)?$/.test(ms.trim())) return Math.ceil(Number(ms) / 1000);
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const v = raw.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.ceil(Number(v));
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - now) / 1000)) : null;
}

/** Extracts a provider error message from OpenAI / Anthropic / OpenRouter style error bodies. */
export function providerErrorMessage(status: number, json: unknown): string {
  let detail = '';
  if (json && typeof json === 'object') {
    const obj = json as { error?: unknown; message?: unknown };
    if (typeof obj.error === 'string') detail = obj.error;
    else if (obj.error && typeof obj.error === 'object' && typeof (obj.error as { message?: unknown }).message === 'string') {
      detail = (obj.error as { message: string }).message;
    } else if (typeof obj.message === 'string') detail = obj.message;
  }
  return detail ? `HTTP ${status}: ${detail.slice(0, 300)}` : `HTTP ${status}`;
}

/** Removes secrets and key-like strings from text that may be shown or logged. */
export function scrubSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  // Providers sometimes echo a masked key ("sk-proj-****abcd"); drop it entirely.
  out = out.replace(/\bsk-[^\s"',]+/g, '[redacted-key]');
  return redactString(out, 400);
}

export function parseJsonOrNull(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function backoffMs(attempt: number, random: () => number): number {
  return Math.round(1000 * 2 ** attempt + random() * 500);
}

export async function postJson(opts: PostJsonOptions): Promise<unknown> {
  const doFetch = opts.deps?.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const wait = opts.deps?.sleep ?? defaultSleep;
  const random = opts.deps?.random ?? Math.random;
  const maxRetries = Math.max(0, opts.maxRetries ?? DEFAULT_MAX_RETRIES);
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const secrets = opts.secrets ?? [];

  const pause = async (ms: number) => {
    try {
      await wait(ms, opts.signal);
    } catch {
      throw new AiError('Request cancelled', 'aborted');
    }
  };

  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new AiError('Request cancelled', 'aborted');
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    };

    let status: number;
    let headers: Headers;
    let bodyText: string;
    try {
      const res = await doFetch(opts.url, {
        method: 'POST',
        headers: opts.headers,
        body: JSON.stringify(opts.body),
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      status = res.status;
      headers = res.headers;
      bodyText = await res.text();
    } catch {
      cleanup();
      if (timedOut) throw new AiError(`The provider did not answer within ${Math.round(timeoutMs / 1000)} s`, 'timeout');
      if (opts.signal?.aborted) throw new AiError('Request cancelled', 'aborted');
      if (attempt < maxRetries) {
        await pause(backoffMs(attempt, random));
        continue;
      }
      throw new AiError('Network error: the provider could not be reached', 'network');
    }
    cleanup();

    const json = parseJsonOrNull(bodyText);

    if (status >= 200 && status < 300) {
      if (json === null || typeof json !== 'object') throw new AiError('The provider returned an invalid response', 'invalid_response', status);
      return json;
    }

    const retryAfter = parseRetryAfter(headers);
    const retryable = status === 429 || status === 408 || status >= 500;
    if (retryable && attempt < maxRetries && (retryAfter === null || retryAfter <= MAX_RETRY_WAIT_SEC)) {
      await pause(retryAfter !== null ? retryAfter * 1000 : backoffMs(attempt, random));
      continue;
    }
    throw new AiError(scrubSecrets(providerErrorMessage(status, json), secrets), codeForStatus(status), status, retryAfter);
  }
}
