/**
 * Minimal Telegram Bot API client (getMe, getUpdates, sendMessage) over plain fetch.
 *
 * The bot token is part of the request URL, so URLs are never logged and every error message is
 * scrubbed of the token before it leaves this module. Polling is short (timeout=0): FunPro never
 * holds a long-poll connection open in the service worker.
 */
import { sleep as defaultSleep } from '@/core/util/async';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';
export const TELEGRAM_PERMISSION_ORIGIN = 'https://api.telegram.org/*';
/** Telegram rejects messages longer than 4096 characters. */
export const TELEGRAM_MAX_TEXT = 4096;

export interface TgUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  username?: string;
  first_name?: string;
  last_name?: string;
  title?: string;
}

export interface TgMessage {
  message_id: number;
  date: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

export type TelegramErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'config';

export class TelegramError extends Error {
  constructor(
    message: string,
    readonly code: TelegramErrorCode,
    readonly status: number | null = null,
    readonly retryAfterSec: number | null = null,
  ) {
    super(message);
    this.name = 'TelegramError';
  }
}

/** BotFather token shape: "<digits>:<35-ish url-safe chars>". */
export const BOT_TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/;

export function isValidBotToken(token: string): boolean {
  return BOT_TOKEN_RE.test(token.trim());
}

export interface TelegramApiDeps {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function parseJsonOrNull(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function codeFor(status: number): TelegramErrorCode {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

export class TelegramApi {
  private readonly token: string;
  private readonly doFetch: typeof fetch;
  private readonly timeoutMs: number;

  constructor(token: string, deps: TelegramApiDeps = {}) {
    const t = token.trim();
    if (!isValidBotToken(t))
      throw new TelegramError('This does not look like a bot token from @BotFather', 'config');
    this.token = t;
    this.doFetch =
      deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
    this.timeoutMs = deps.timeoutMs ?? 15_000;
  }

  private scrub(text: string): string {
    return text
      .split(this.token)
      .join('[token]')
      .replace(/\d{5,15}:[A-Za-z0-9_-]{30,64}/g, '[token]');
  }

  async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, this.timeoutMs);
    let status: number;
    let text: string;
    try {
      const res = await this.doFetch(`${TELEGRAM_API_BASE}/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: ctrl.signal,
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
      });
      status = res.status;
      text = await res.text();
    } catch {
      if (timedOut) throw new TelegramError('Telegram did not answer in time', 'timeout');
      throw new TelegramError('Network error: api.telegram.org could not be reached', 'network');
    } finally {
      clearTimeout(timer);
    }
    const json = parseJsonOrNull(text) as {
      ok?: unknown;
      result?: unknown;
      description?: unknown;
      error_code?: unknown;
      parameters?: { retry_after?: unknown };
    } | null;
    if (json && json.ok === true) return json.result as T;
    const errStatus = typeof json?.error_code === 'number' ? json.error_code : status;
    const retryAfter = typeof json?.parameters?.retry_after === 'number' ? json.parameters.retry_after : null;
    const description = typeof json?.description === 'string' ? json.description : `HTTP ${status}`;
    throw new TelegramError(
      this.scrub(description).slice(0, 300),
      codeFor(errStatus),
      errStatus || null,
      retryAfter,
    );
  }

  getMe(): Promise<TgUser> {
    return this.call<TgUser>('getMe', {});
  }

  /** Short poll (no long polling). Passing `offset` acknowledges every update before it. */
  getUpdates(opts: { offset?: number; limit?: number; allowedUpdates?: string[] } = {}): Promise<TgUpdate[]> {
    const params: Record<string, unknown> = {
      timeout: 0,
      limit: opts.limit ?? 50,
      allowed_updates: opts.allowedUpdates ?? ['message'],
    };
    if (opts.offset !== undefined) params['offset'] = opts.offset;
    return this.call<TgUpdate[]>('getUpdates', params);
  }

  sendMessage(chatId: string, text: string, opts: { html?: boolean } = {}): Promise<TgMessage> {
    const params: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(0, TELEGRAM_MAX_TEXT),
      link_preview_options: { is_disabled: true },
    };
    if (opts.html !== false) params['parse_mode'] = 'HTML';
    return this.call<TgMessage>('sendMessage', params);
  }
}

export interface RateLimitedSenderOptions {
  /** Minimum gap between messages (Telegram: about one message per second per chat). */
  minGapMs?: number;
  /** Pending messages beyond this are dropped (bounded memory in the service worker). */
  maxQueue?: number;
  /** Retries after a 429 (each waits Telegram's retry_after). */
  maxRetries?: number;
  /** A 429 asking to wait longer than this drops the message instead of blocking the queue. */
  maxRetryAfterSec?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Serialises sends: ≤ 1 message per `minGapMs`, honours 429 `retry_after`, bounded queue.
 * `enqueue` resolves when the message was sent and rejects when it was dropped or failed.
 */
export class RateLimitedSender {
  private chain: Promise<unknown> = Promise.resolve();
  private pending = 0;
  private lastSentAt = -Infinity;
  private readonly minGapMs: number;
  private readonly maxQueue: number;
  private readonly maxRetries: number;
  private readonly maxRetryAfterSec: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: RateLimitedSenderOptions = {}) {
    this.minGapMs = opts.minGapMs ?? 1000;
    this.maxQueue = opts.maxQueue ?? 30;
    this.maxRetries = opts.maxRetries ?? 2;
    this.maxRetryAfterSec = opts.maxRetryAfterSec ?? 60;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => defaultSleep(ms));
  }

  get queued(): number {
    return this.pending;
  }

  enqueue<T>(send: () => Promise<T>): Promise<T> {
    if (this.pending >= this.maxQueue)
      return Promise.reject(new TelegramError('Telegram queue is full; message dropped', 'rate_limited'));
    this.pending++;
    const run = async (): Promise<T> => {
      try {
        for (let attempt = 0; ; attempt++) {
          const gap = this.lastSentAt + this.minGapMs - this.now();
          if (gap > 0) await this.sleep(gap);
          try {
            const res = await send();
            this.lastSentAt = this.now();
            return res;
          } catch (e) {
            this.lastSentAt = this.now();
            if (e instanceof TelegramError && e.code === 'rate_limited' && attempt < this.maxRetries) {
              const wait = e.retryAfterSec ?? 1;
              if (wait > this.maxRetryAfterSec) throw e;
              await this.sleep(wait * 1000);
              continue;
            }
            throw e;
          }
        }
      } finally {
        this.pending--;
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }
}
