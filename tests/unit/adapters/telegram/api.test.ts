import { describe, expect, it, vi } from 'vitest';
import { isValidBotToken, RateLimitedSender, TelegramApi, TelegramError } from '@/adapters/telegram/api';
import { escapeTelegramHtml, funpayLink, truncatePlain } from '@/adapters/telegram/format';

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawE';

function tgResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('TelegramApi', () => {
  it('validates the token shape', () => {
    expect(isValidBotToken(TOKEN)).toBe(true);
    expect(isValidBotToken('not-a-token')).toBe(false);
    expect(() => new TelegramApi('123:short')).toThrow(TelegramError);
  });

  it('sends HTML messages with previews disabled', async () => {
    const fetchMock = vi.fn(async () => tgResponse(200, { ok: true, result: { message_id: 1, date: 1, chat: { id: 42, type: 'private' } } }));
    const api = new TelegramApi(TOKEN, { fetch: fetchMock as unknown as typeof fetch });
    await api.sendMessage('42', '<b>Hi</b>');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(init.body as string)).toEqual({ chat_id: '42', text: '<b>Hi</b>', parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
  });

  it('short-polls getUpdates (timeout 0) with the given offset', async () => {
    const fetchMock = vi.fn(async () => tgResponse(200, { ok: true, result: [] }));
    await new TelegramApi(TOKEN, { fetch: fetchMock as unknown as typeof fetch }).getUpdates({ offset: 77 });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ timeout: 0, offset: 77, allowed_updates: ['message'] });
  });

  it('maps errors to typed codes and never exposes the token', async () => {
    const api429 = new TelegramApi(TOKEN, {
      fetch: (async () => tgResponse(429, { ok: false, error_code: 429, description: 'Too Many Requests: retry after 3', parameters: { retry_after: 3 } })) as unknown as typeof fetch,
    });
    await expect(api429.sendMessage('1', 'x')).rejects.toMatchObject({ code: 'rate_limited', retryAfterSec: 3 });

    const leaky = new TelegramApi(TOKEN, {
      fetch: (async () => tgResponse(401, { ok: false, error_code: 401, description: `Unauthorized for bot${TOKEN}` })) as unknown as typeof fetch,
    });
    const err = (await leaky.getMe().catch((e: unknown) => e)) as TelegramError;
    expect(err.code).toBe('unauthorized');
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain('AAHdqTcv');

    const offline = new TelegramApi(TOKEN, { fetch: (async () => Promise.reject(new TypeError(`Failed to fetch https://api.telegram.org/bot${TOKEN}/getMe`))) as unknown as typeof fetch });
    const err2 = (await offline.getMe().catch((e: unknown) => e)) as TelegramError;
    expect(err2.code).toBe('network');
    expect(err2.message).not.toContain(TOKEN);
  });
});

describe('RateLimitedSender', () => {
  function clock() {
    let now = 0;
    const sleeps: number[] = [];
    return {
      now: () => now,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        now += ms;
      },
      sleeps,
      advance: (ms: number) => {
        now += ms;
      },
    };
  }

  it('sends at most one message per second', async () => {
    const c = clock();
    const sender = new RateLimitedSender({ minGapMs: 1000, now: c.now, sleep: c.sleep });
    const sentAt: number[] = [];
    await Promise.all([1, 2, 3].map(() => sender.enqueue(async () => sentAt.push(c.now()))));
    expect(sentAt).toEqual([0, 1000, 2000]);
  });

  it('backs off for retry_after on 429 and then succeeds', async () => {
    const c = clock();
    const sender = new RateLimitedSender({ minGapMs: 1000, now: c.now, sleep: c.sleep });
    const send = vi
      .fn()
      .mockRejectedValueOnce(new TelegramError('Too Many Requests', 'rate_limited', 429, 5))
      .mockResolvedValueOnce('ok');
    await expect(sender.enqueue(send)).resolves.toBe('ok');
    expect(send).toHaveBeenCalledTimes(2);
    expect(c.sleeps).toContain(5000);
  });

  it('drops a message instead of blocking when retry_after is too long, and bounds the queue', async () => {
    const c = clock();
    const sender = new RateLimitedSender({ minGapMs: 1000, maxRetryAfterSec: 60, maxQueue: 2, now: c.now, sleep: c.sleep });
    await expect(sender.enqueue(async () => Promise.reject(new TelegramError('flood', 'rate_limited', 429, 600)))).rejects.toMatchObject({ code: 'rate_limited' });

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const first = sender.enqueue(() => gate);
    const second = sender.enqueue(async () => undefined);
    await expect(sender.enqueue(async () => undefined)).rejects.toThrow(/queue is full/);
    release();
    await Promise.all([first, second]);
    expect(sender.queued).toBe(0);
  });

  it('does not retry other errors', async () => {
    const sender = new RateLimitedSender({ minGapMs: 0, sleep: async () => undefined });
    const send = vi.fn().mockRejectedValue(new TelegramError('chat not found', 'bad_request', 400));
    await expect(sender.enqueue(send)).rejects.toMatchObject({ code: 'bad_request' });
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram HTML formatting', () => {
  it('escapes markup characters', () => {
    expect(escapeTelegramHtml('<b>"Tom & Jerry"</b>')).toBe('&lt;b&gt;"Tom &amp; Jerry"&lt;/b&gt;');
  });

  it('only links to funpay.com and escapes attribute values', () => {
    expect(funpayLink('Open <order>', 'https://funpay.com/orders/ABC/?a="b"')).toBe('<a href="https://funpay.com/orders/ABC/?a=%22b%22">Open &lt;order&gt;</a>');
    expect(funpayLink('Evil', 'https://evil.example/phish')).toBe('Evil');
    expect(funpayLink('Script', 'javascript:alert(1)')).toBe('Script');
  });

  it('truncates before escaping', () => {
    expect(truncatePlain('abcdef', 4)).toBe('abc…');
    expect(escapeTelegramHtml(truncatePlain('a&b&c&d', 4))).toBe('a&amp;b…');
  });
});
