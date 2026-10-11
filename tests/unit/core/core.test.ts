import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests, emitEvent, markHandled, onEvent, pruneEvents } from '@/core/events/bus';
import { cancelPendingTasks, claimDueTasks, completeTask, deferTask, enqueue, failTask, recoverStaleTasks, RUNNING_LEASE_MS } from '@/core/queue/queue';
import { defaultSettings, mergeSettings, parseSettings } from '@/core/settings/schema';
import { getSettings, updateSettings } from '@/core/settings/store';
import { redact, redactString } from '@/core/log/redact';
import { evaluateFeature } from '@/core/automation/policy';
import { classifySender, isFunPayUrl } from '@/core/security/sender';
import { cleanText, lintOutgoingText, safeFunPayUrl } from '@/core/security/sanitize';
import { decryptText, encryptText, resetCryptoCacheForTests, sha256Hex } from '@/core/security/crypto';
import { deleteSecret, getSecret, hasSecret, setSecret } from '@/core/security/secrets';
import { backoffDelay } from '@/core/util/async';
import { isWithinWindow, nextWindowEnd, parseHumanDate } from '@/core/util/time';
import { addMoney, convertWithRate, formatMoney, parseLocalizedNumber, parseMoney, sumByCurrency } from '@/shared/models/money';
import { canTransition } from '@/shared/models/order';
import { isFlagEnabled } from '@/core/flags/flags';

beforeEach(() => {
  resetDbForTests();
  resetCryptoCacheForTests();
  clearEventHandlersForTests();
});

describe('money', () => {
  it.each([
    ['1 234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1 250.50 ₽', 1250.5],
    ['12 345', 12345],
    ['1.234.567', 1234567],
    ['0,5', 0.5],
    ['1,234', 1234],
    ['abc', null],
  ])('parses %s', (input, expected) => {
    expect(parseLocalizedNumber(input)).toBe(expected);
  });

  it('parses currency and stores minor units', () => {
    expect(parseMoney('199.99 ₽')).toEqual({ amountMinor: 19999, currency: 'RUB' });
    expect(parseMoney('5 $')).toEqual({ amountMinor: 500, currency: 'USD' });
    expect(parseMoney('7 €')).toEqual({ amountMinor: 700, currency: 'EUR' });
    expect(parseMoney('3.10')).toEqual({ amountMinor: 310, currency: 'UNKNOWN' });
  });

  it('never mixes currencies implicitly', () => {
    expect(() => addMoney({ amountMinor: 1, currency: 'RUB' }, { amountMinor: 1, currency: 'USD' })).toThrow();
    expect(sumByCurrency([{ amountMinor: 100, currency: 'RUB' }, { amountMinor: 50, currency: 'USD' }, { amountMinor: 1, currency: 'RUB' }])).toEqual({ RUB: 101, USD: 50 });
  });

  it('converts only with an explicit rate', () => {
    const rate = { from: 'USD' as const, to: 'RUB' as const, rate: 90.5, source: 'manual', at: '2024-01-01T00:00:00Z' };
    expect(convertWithRate({ amountMinor: 1000, currency: 'USD' }, rate)).toEqual({ amountMinor: 90500, currency: 'RUB' });
    expect(() => convertWithRate({ amountMinor: 1, currency: 'EUR' }, rate)).toThrow();
  });

  it('formats', () => {
    expect(formatMoney({ amountMinor: 123456, currency: 'RUB' }, 'en-US')).toContain('1,234.56');
  });
});

describe('order state machine', () => {
  it('allows forward transitions only', () => {
    expect(canTransition('paid', 'closed')).toBe(true);
    expect(canTransition('paid', 'refunded')).toBe(true);
    expect(canTransition('closed', 'refunded')).toBe(true);
    expect(canTransition('refunded', 'paid')).toBe(false);
    expect(canTransition('closed', 'paid')).toBe(false);
  });
});

describe('time', () => {
  it('handles quiet-hour windows across midnight', () => {
    const at = (h: number, m = 0) => new Date(2024, 0, 1, h, m);
    expect(isWithinWindow(at(23, 30), '23:00', '08:00')).toBe(true);
    expect(isWithinWindow(at(7, 59), '23:00', '08:00')).toBe(true);
    expect(isWithinWindow(at(8, 0), '23:00', '08:00')).toBe(false);
    expect(isWithinWindow(at(12), '09:00', '18:00')).toBe(true);
    expect(isWithinWindow(at(12), '10:00', '10:00')).toBe(false);
    expect(nextWindowEnd(at(23, 30), '08:00').getDate()).toBe(2);
  });

  it('parses FunPay dates in Moscow time', () => {
    const now = new Date('2024-03-10T21:30:00Z'); // 00:30 on 11 March in Moscow
    expect(parseHumanDate('сегодня, 00:10', now)).toBe('2024-03-10T21:10:00.000Z');
    expect(parseHumanDate('вчера, 23:00', now)).toBe('2024-03-10T20:00:00.000Z');
    expect(parseHumanDate('12 March 2023, 14:05', now)).toBe('2023-03-12T11:05:00.000Z');
    expect(parseHumanDate('25 декабря, 10:00', now)).toBe('2023-12-25T07:00:00.000Z');
    expect(parseHumanDate('01.02.2024 10:00', now)).toBe('2024-02-01T07:00:00.000Z');
    expect(parseHumanDate('???', now)).toBeNull();
  });
});

describe('backoff', () => {
  it('grows exponentially within bounds', () => {
    const r = () => 1;
    expect(backoffDelay(1, 1000, 60000, r)).toBe(1000);
    expect(backoffDelay(3, 1000, 60000, r)).toBe(4000);
    expect(backoffDelay(20, 1000, 60000, r)).toBe(60000);
    expect(backoffDelay(3, 1000, 60000, () => 0)).toBe(2000);
  });
});

describe('settings', () => {
  it('fills defaults and keeps automation off', () => {
    const s = defaultSettings();
    expect(s.automation.state).toBe('paused');
    expect(s.automation.autoBump).toBe(false);
    expect(s.automation.liveActionsAcknowledged).toBe(false);
    expect(s.general.localOnly).toBe(true);
  });

  it('repairs invalid sections individually', () => {
    const s = parseSettings({ appearance: { theme: 'nope' }, bump: { minIntervalMinutes: 90 } });
    expect(s.appearance.theme).toBe('system');
    expect(s.bump.minIntervalMinutes).toBe(90);
  });

  it('deep-merges patches and validates', () => {
    const s = mergeSettings(defaultSettings(), { messages: { quietHours: { enabled: true } } });
    expect(s.messages.quietHours).toEqual({ enabled: true, start: '23:00', end: '08:00' });
    expect(() => mergeSettings(defaultSettings(), { bump: { minIntervalMinutes: 1 } })).toThrow();
  });

  it('persists through browser storage (theme persistence)', async () => {
    fakeBrowser.reset();
    await updateSettings({ appearance: { theme: 'forest' } });
    await updateSettings({ appearance: { density: 'compact' } });
    const s = await getSettings();
    expect(s.appearance.theme).toBe('forest');
    expect(s.appearance.density).toBe('compact');
  });
});

describe('feature flags', () => {
  it('uses overrides over defaults', () => {
    expect(isFlagEnabled('nicknameSync', {})).toBe(false);
    expect(isFlagEnabled('nicknameSync', { nicknameSync: true })).toBe(true);
  });
});

describe('redaction', () => {
  it('redacts credentials by key and by shape', () => {
    const out = redact({ token: 'abc', apiKey: 'x', nested: { golden_key: 'secret' }, text: 'golden_key=abcdef; PHPSESSID=zzz', bot: '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', ok: 1 }) as Record<string, unknown>;
    expect(out['token']).toBe('[redacted]');
    expect(out['apiKey']).toBe('[redacted]');
    expect((out['nested'] as Record<string, unknown>)['golden_key']).toBe('[redacted]');
    expect(out['text']).not.toContain('abcdef');
    expect(out['text']).not.toContain('zzz');
    expect(out['bot']).toBe('[redacted-token]');
    expect(out['ok']).toBe(1);
    expect(redactString('Bearer sk-abcdefghijklmnop')).not.toContain('sk-abc');
    expect(redactString('x'.repeat(1000)).length).toBeLessThan(600);
  });
});

describe('automation policy', () => {
  const ctx = { funpayTabAvailable: true, sessionLoggedIn: true };
  it('reports every state', () => {
    const s = defaultSettings();
    expect(evaluateFeature(s, 'autoBump', ctx).status).toBe('disabled');
    const on = mergeSettings(s, { automation: { autoBump: true } });
    expect(evaluateFeature(on, 'autoBump', ctx).status).toBe('paused');
    const running = mergeSettings(on, { automation: { state: 'running' } });
    expect(evaluateFeature(running, 'autoBump', ctx).status).toBe('awaiting_authorization');
    const ack = mergeSettings(running, { automation: { liveActionsAcknowledged: true } });
    expect(evaluateFeature(ack, 'autoBump', ctx).status).toBe('running');
    expect(evaluateFeature(ack, 'autoBump', { funpayTabAvailable: false, sessionLoggedIn: false }).status).toBe('blocked');
    const stopped = mergeSettings(ack, { automation: { state: 'stopped' } });
    expect(evaluateFeature(stopped, 'autoBump', ctx)).toMatchObject({ status: 'blocked', reason: 'Emergency stop is active' });
  });
});

describe('sender validation (permission boundaries)', () => {
  const id = 'ext-id';
  const origin = 'chrome-extension://ext-id';
  it('classifies senders', () => {
    expect(classifySender({ id, url: `${origin}/options.html` }, id, origin)).toBe('extension');
    expect(classifySender({ id }, id, origin)).toBe('extension');
    expect(classifySender({ id, url: 'https://funpay.com/chat/', tab: { id: 1, url: 'https://funpay.com/chat/' } }, id, origin)).toBe('content');
    expect(classifySender({ id: 'other', url: `${origin}/x` }, id, origin)).toBe('untrusted');
    expect(classifySender({ id, url: 'https://evil.com/', tab: { id: 2, url: 'https://evil.com/' } }, id, origin)).toBe('untrusted');
    expect(classifySender({ id, url: 'https://funpay.com.evil.com/', tab: { id: 2 } }, id, origin)).toBe('untrusted');
  });
  it('validates funpay urls strictly', () => {
    expect(isFunPayUrl('https://funpay.com/')).toBe(true);
    expect(isFunPayUrl('http://funpay.com/')).toBe(false);
    expect(isFunPayUrl('https://notfunpay.com/')).toBe(false);
  });
});

describe('sanitization', () => {
  it('cleans control and bidi characters', () => {
    expect(cleanText(`a${String.fromCharCode(0x202e)}b${String.fromCharCode(0)}c   d`)).toBe('abc d');
  });
  it('flags off-platform contacts', () => {
    expect(lintOutgoingText('write me t.me/someone')).toContain('telegram');
    expect(lintOutgoingText('discord.gg/abc')).toContain('discord');
    expect(lintOutgoingText('mail me a@b.com')).toContain('email');
    expect(lintOutgoingText('see https://example.com')).toContain('external_link');
    expect(lintOutgoingText('see https://funpay.com/orders/X/')).toEqual([]);
    expect(lintOutgoingText('Thanks for your order!')).toEqual([]);
  });
  it('only renders funpay links', () => {
    expect(safeFunPayUrl('/orders/A/')).toBe('https://funpay.com/orders/A/');
    expect(safeFunPayUrl('javascript:alert(1)')).toBeNull();
    expect(safeFunPayUrl('https://evil.com')).toBeNull();
  });
});

describe('crypto & secrets', () => {
  it('round-trips with a non-extractable device key', async () => {
    const enc = await encryptText('KEY-1234');
    expect(enc.cipher).not.toContain('KEY-1234');
    expect(await decryptText(enc)).toBe('KEY-1234');
    const k = await getDb().keys.get('device-aes-gcm-v1');
    expect(k!.key.extractable).toBe(false);
    expect(await sha256Hex('a')).toHaveLength(64);
  });
  it('stores secrets encrypted', async () => {
    await setSecret('ai.apiKey', 'sk-test-123456');
    const raw = await getDb().secrets.get('ai.apiKey');
    expect(JSON.stringify(raw)).not.toContain('sk-test');
    expect(await getSecret('ai.apiKey')).toBe('sk-test-123456');
    expect(await hasSecret('ai.apiKey')).toBe(true);
    await deleteSecret('ai.apiKey');
    expect(await getSecret('ai.apiKey')).toBeNull();
  });
});

describe('event bus', () => {
  it('dedupes events and isolates failing handlers', async () => {
    const seen: string[] = [];
    onEvent('ORDER_PAID', () => {
      throw new Error('boom');
    });
    onEvent('ORDER_PAID', (e) => {
      seen.push(e.id);
    });
    expect(await emitEvent('ORDER_PAID', 'A', {})).toBe(true);
    expect(await emitEvent('ORDER_PAID', 'A', {})).toBe(false);
    expect(seen).toEqual(['ORDER_PAID:A']);
    expect(await markHandled('ORDER_PAID:A', 'rule1')).toBe(true);
    expect(await markHandled('ORDER_PAID:A', 'rule1')).toBe(false);
  });
  it('prunes old events', async () => {
    await getDb().events.add({ id: 'old', type: 'ORDER_PAID', at: '2000-01-01T00:00:00.000Z', payload: {}, handledBy: [] });
    expect(await pruneEvents()).toBe(1);
  });
});

describe('durable queue', () => {
  it('dedupes by idempotency key', async () => {
    const a = await enqueue({ kind: 'bump', idempotencyKey: 'k1' });
    const b = await enqueue({ kind: 'bump', idempotencyKey: 'k1' });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.task.id).toBe(a.task.id);
  });

  it('claims due tasks once, retries with backoff, then fails', async () => {
    await enqueue({ kind: 'bump', idempotencyKey: 'k', maxAttempts: 2, runAt: 0 });
    const [t] = await claimDueTasks(10);
    expect(t!.status).toBe('running');
    expect(await claimDueTasks(10)).toHaveLength(0);
    const r1 = await failTask(t!.id, 'net', { now: 100 });
    expect(r1!.status).toBe('pending');
    expect(r1!.nextRunAt).toBeGreaterThan(100);
    const [t2] = await claimDueTasks(r1!.nextRunAt);
    const r2 = await failTask(t2!.id, 'net again');
    expect(r2!.status).toBe('failed');
  });

  it('defers without consuming attempts and completes', async () => {
    await enqueue({ kind: 'send_message', idempotencyKey: 'm', runAt: 0 });
    const [t] = await claimDueTasks(1);
    await deferTask(t!.id, 'awaiting_tab', 1000, 'no tab');
    const d = await getDb().tasks.get(t!.id);
    expect(d).toMatchObject({ status: 'awaiting_tab', attempts: 0 });
    await completeTask(t!.id);
    expect((await getDb().tasks.get(t!.id))!.status).toBe('done');
  });

  it('recovers after a service-worker crash without re-sending messages', async () => {
    await enqueue({ kind: 'send_message', idempotencyKey: 'msg', runAt: 0 });
    await enqueue({ kind: 'sync_orders', idempotencyKey: 'sync', runAt: 0 });
    await claimDueTasks(1);
    const now = Date.now() + RUNNING_LEASE_MS + 1000;
    const res = await recoverStaleTasks(now);
    expect(res).toEqual({ requeued: 1, uncertain: 1 });
    const msg = await getDb().tasks.where('idempotencyKey').equals('msg').first();
    expect(msg!.status).toBe('failed');
    expect(msg!.lastError).toMatch(/uncertain/i);
  });

  it('emergency stop cancels pending work', async () => {
    await enqueue({ kind: 'bump', idempotencyKey: 'a', runAt: Date.now() + 100000 });
    await enqueue({ kind: 'send_message', idempotencyKey: 'b' });
    expect(await cancelPendingTasks()).toBe(2);
    expect(await claimDueTasks(Date.now() + 1e9)).toHaveLength(0);
  });
});
