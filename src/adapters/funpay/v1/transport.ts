/**
 * Network half of the FunPay adapter. Runs ONLY inside the content script on https://funpay.com,
 * so requests are same-origin and authenticated by the browser exactly like the site's own
 * requests. FunPro never reads, stores or transmits session cookies (golden_key / PHPSESSID).
 *
 * Endpoints (evidence in docs/research-notes-raw.md §D; none live-verified by FunPro):
 *   POST /lots/raise, POST /runner/, GET /lots/offerEdit, POST /lots/offerSave, POST /lots/calc,
 *   POST /orders/review, GET /chat/history.
 */
import { backoffDelay, sleep } from '@/core/util/async';

export class FunPayHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'logged_out' | 'rate_limited' | 'server' | 'forbidden_path' | 'network' | 'bad_response',
  ) {
    super(message);
    this.name = 'FunPayHttpError';
  }
}

/**
 * Allow-list of paths FunPro may request. Money-moving or account-changing endpoints (withdrawals,
 * refunds, currency switching, logout, wallet details) are deliberately absent.
 */
const ALLOWED_GET = [
  /^\/(en\/|uk\/)?$/,
  /^\/(en\/|uk\/)?orders\/(trade)?(\?[\w=&%.-]*)?$/,
  /^\/(en\/|uk\/)?orders\/[A-Z0-9]{6,12}\/$/,
  /^\/(en\/|uk\/)?chat\/(\?node=[\w-]{1,64})?$/,
  /^\/(en\/|uk\/)?chat\/history\?node=[\w-]{1,64}&last_message=-?\d{1,20}$/,
  /^\/(en\/|uk\/)?lots\/\d{1,10}\/(trade)?$/,
  /^\/(en\/|uk\/)?chips\/\d{1,10}\/(trade)?$/,
  /^\/(en\/|uk\/)?lots\/offerEdit\?(node=\d{1,10}&)?offer=\d{1,12}$/,
  /^\/(en\/|uk\/)?users\/\d{1,12}\/$/,
  /^\/(en\/|uk\/)?account\/balance$/,
];
const ALLOWED_POST = [
  /^\/lots\/raise$/,
  /^\/runner\/$/,
  /^\/lots\/offerSave$/,
  /^\/lots\/calc$/,
  /^\/chips\/calc$/,
  /^\/orders\/review$/,
  /^\/orders\/trade$/,
  /^\/orders\/$/,
  /^\/users\/transactions$/,
  /^\/users\/reviews$/,
];

export function isAllowedPath(method: 'GET' | 'POST', path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  return (method === 'GET' ? ALLOWED_GET : ALLOWED_POST).some((re) => re.test(path));
}

export interface TransportOptions {
  origin?: string;
  minGapMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class FunPayTransport {
  private readonly origin: string;
  private readonly minGapMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleepImpl: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private nextSlot = 0;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(opts: TransportOptions = {}) {
    this.origin = opts.origin ?? 'https://funpay.com';
    this.minGapMs = opts.minGapMs ?? 2500;
    this.maxRetries = opts.maxRetries ?? 3;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.sleepImpl = opts.sleepImpl ?? ((ms) => sleep(ms));
    this.now = opts.now ?? Date.now;
  }

  /** Requests are serialised and spaced by `minGapMs` to stay well below FunPay's limits. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(async () => {
      const wait = this.nextSlot - this.now();
      if (wait > 0) await this.sleepImpl(wait);
      try {
        return await fn();
      } finally {
        this.nextSlot = this.now() + this.minGapMs;
      }
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async send(method: 'GET' | 'POST', path: string, body?: URLSearchParams, extraHeaders: Record<string, string> = {}): Promise<Response> {
    if (!isAllowedPath(method, path)) throw new FunPayHttpError(`Path not allowed: ${method} ${path.split('?')[0]}`, 0, 'forbidden_path');
    let attempt = 0;
    for (;;) {
      attempt++;
      let res: Response;
      try {
        res = await this.fetchImpl(this.origin + path, {
          method,
          credentials: 'include',
          redirect: 'follow',
          headers: {
            'x-requested-with': 'XMLHttpRequest',
            ...(body ? { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
            ...extraHeaders,
          },
          ...(body ? { body: body.toString() } : {}),
        });
      } catch (e) {
        if (attempt > this.maxRetries) throw new FunPayHttpError(e instanceof Error ? e.message : 'Network error', 0, 'network');
        await this.sleepImpl(backoffDelay(attempt, 2000, 30_000));
        continue;
      }
      if (res.url && /\/account\/login/.test(res.url)) throw new FunPayHttpError('Not logged in to FunPay', 401, 'logged_out');
      if (res.status === 429 || res.status >= 500) {
        if (attempt > this.maxRetries) {
          throw new FunPayHttpError(`FunPay responded with HTTP ${res.status}`, res.status, res.status === 429 ? 'rate_limited' : 'server');
        }
        const retryAfter = Number(res.headers.get('retry-after'));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 60_000) : backoffDelay(attempt, 2000, 30_000);
        await this.sleepImpl(delay);
        continue;
      }
      return res;
    }
  }

  getHtml(path: string): Promise<{ html: string; status: number; url: string }> {
    return this.schedule(async () => {
      const res = await this.send('GET', path);
      if (res.status === 401 || res.status === 403) throw new FunPayHttpError('Not logged in to FunPay', res.status, 'logged_out');
      return { html: await res.text(), status: res.status, url: res.url };
    });
  }

  getJson(path: string): Promise<{ json: unknown; status: number }> {
    return this.schedule(async () => {
      const res = await this.send('GET', path);
      return { json: await safeJson(res), status: res.status };
    });
  }

  postForm(path: string, fields: [string, string][], csrfToken: string | null, opts: { csrfHeader?: boolean } = {}): Promise<{ json: unknown; status: number; text: string }> {
    return this.schedule(async () => {
      const body = new URLSearchParams();
      for (const [k, v] of fields) body.append(k, v);
      if (csrfToken && !fields.some(([k]) => k === 'csrf_token')) body.append('csrf_token', csrfToken);
      const res = await this.send('POST', path, body, opts.csrfHeader && csrfToken ? { 'x-csrf-token': csrfToken } : {});
      const textBody = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(textBody);
      } catch {
        json = null;
      }
      return { json, status: res.status, text: textBody };
    });
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
