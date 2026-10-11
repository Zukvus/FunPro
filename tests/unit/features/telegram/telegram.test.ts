import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TgUpdate } from '@/adapters/telegram/api';
import { getDb, resetDbForTests } from '@/core/db/db';
import { sha256Hex } from '@/core/security/crypto';
import { defaultSettings, mergeSettings, type Settings, type SettingsPatch } from '@/core/settings/schema';
import type { NotifyInput } from '@/features/notifications';
import {
  buildLocalSummary,
  buildTelegramAlert,
  createTelegramSink,
  formatSummaryHtml,
  isAuthorizedUpdate,
  isSummaryDue,
  localDayKey,
  nextSummaryAt,
  parseCommand,
  processTelegramUpdates,
  sanitizeForTelegram,
  startCandidates,
  STOP_CONFIRM_WINDOW_SEC,
  telegramReady,
  telegramWantsKind,
  type CommandDeps,
} from '@/features/telegram';
import type { NotificationItem } from '@/shared/models';

const CHAT = '424242';
const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawE';
const AI_KEY = 'sk-ant-api03-SECRETSECRETSECRET';

function settings(patch: SettingsPatch = {}): Settings {
  const connected = mergeSettings(defaultSettings(), {
    general: { localOnly: false, language: 'en' },
    telegram: { enabled: true, chatId: CHAT, consentAt: 1, botUsername: 'my_shop_bot' },
  });
  return mergeSettings(connected, patch);
}

function update(id: number, text: string, chatId = Number(CHAT), date = 1_000_000, over: Partial<NonNullable<TgUpdate['message']>> = {}): TgUpdate {
  return { update_id: id, message: { message_id: id, date, chat: { id: chatId, type: 'private', username: 'owner' }, from: { id: chatId, is_bot: false, first_name: 'Owner' }, text, ...over } };
}

function commandDeps(over: Partial<CommandDeps> = {}) {
  let stopAt: number | null = null;
  const replies: string[] = [];
  const emergencyStop = vi.fn(async () => undefined);
  const deps: CommandDeps = {
    settings: settings({ telegram: { remoteCommands: true } }),
    reply: async (html) => void replies.push(html),
    emergencyStop,
    statusHtml: async () => 'STATUS',
    texts: { stopAsk: 'ASK', stopDone: 'DONE', stopExpired: 'EXPIRED' },
    getStopRequestedAt: async () => stopAt,
    setStopRequestedAt: async (at) => {
      stopAt = at;
    },
    nowSec: () => 1_000_050,
    ...over,
  };
  return { deps, replies, emergencyStop };
}

function item(kind: NotificationItem['kind'], title: string, body: string): NotificationItem {
  return { id: `n_${kind}`, at: 1, kind, title, body, url: null, read: false };
}

beforeEach(() => {
  resetDbForTests();
});

describe('commands and authorization', () => {
  it('parses commands, including the @bot suffix', () => {
    expect(parseCommand('/status')).toEqual({ name: 'status', args: '' });
    expect(parseCommand('/stop@my_shop_bot CONFIRM')).toEqual({ name: 'stop', args: 'CONFIRM' });
    expect(parseCommand('hello')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });

  it('accepts only private messages from the confirmed chat and user', () => {
    expect(isAuthorizedUpdate(update(1, '/status'), CHAT)).toBe(true);
    expect(isAuthorizedUpdate(update(1, '/status', 999), CHAT)).toBe(false);
    expect(isAuthorizedUpdate(update(1, '/status', Number(CHAT), 1, { chat: { id: Number(CHAT), type: 'group' } }), CHAT)).toBe(false);
    expect(isAuthorizedUpdate(update(1, '/status', Number(CHAT), 1, { from: { id: 777, is_bot: false, first_name: 'x' } }), CHAT)).toBe(false);
    expect(isAuthorizedUpdate(update(1, '/status', Number(CHAT), 1, { from: { id: Number(CHAT), is_bot: true, first_name: 'bot' } }), CHAT)).toBe(false);
    expect(isAuthorizedUpdate(update(1, '/status'), '')).toBe(false);
  });

  it('answers /status only for the authorised chat and ignores foreign chat ids', async () => {
    const { deps, replies } = commandDeps();
    const res = await processTelegramUpdates([update(5, '/status', 31337), update(6, '/status')], deps);
    expect(replies).toEqual(['STATUS']);
    expect(res).toMatchObject({ nextOffset: 7, handled: ['status'], ignored: 1 });
  });

  it('requires /stop then /stop CONFIRM within the window before the emergency stop', async () => {
    const { deps, replies, emergencyStop } = commandDeps();
    await processTelegramUpdates([update(1, '/stop', Number(CHAT), 1_000_000)], deps);
    expect(emergencyStop).not.toHaveBeenCalled();
    expect(replies).toEqual(['ASK']);
    await processTelegramUpdates([update(2, '/stop confirm', Number(CHAT), 1_000_030)], deps);
    expect(emergencyStop).toHaveBeenCalledTimes(1);
    expect(emergencyStop).toHaveBeenCalledWith('Telegram /stop');
    expect(replies).toEqual(['ASK', 'DONE']);
    // The confirmation is consumed: a second CONFIRM does nothing.
    await processTelegramUpdates([update(3, '/stop CONFIRM', Number(CHAT), 1_000_040)], deps);
    expect(emergencyStop).toHaveBeenCalledTimes(1);
    expect(replies.at(-1)).toBe('EXPIRED');
  });

  it('rejects CONFIRM without /stop, after the window, or from another chat', async () => {
    const a = commandDeps();
    await processTelegramUpdates([update(1, '/stop CONFIRM')], a.deps);
    expect(a.emergencyStop).not.toHaveBeenCalled();
    expect(a.replies).toEqual(['EXPIRED']);

    const b = commandDeps({ nowSec: () => 1_000_500 });
    await processTelegramUpdates([update(1, '/stop', Number(CHAT), 1_000_000), update(2, '/stop CONFIRM', Number(CHAT), 1_000_000 + STOP_CONFIRM_WINDOW_SEC + 1)], b.deps);
    expect(b.emergencyStop).not.toHaveBeenCalled();

    const c = commandDeps();
    await processTelegramUpdates([update(1, '/stop'), update(2, '/stop CONFIRM', 999)], c.deps);
    expect(c.emergencyStop).not.toHaveBeenCalled();
  });

  it('ignores stale and unknown commands', async () => {
    const { deps, replies } = commandDeps({ nowSec: () => 2_000_000 });
    const res = await processTelegramUpdates([update(1, '/status', Number(CHAT), 1_000_000), update(2, '/resume'), update(3, 'hi')], deps);
    expect(replies).toEqual([]);
    expect(res.ignored).toBe(3);
  });

  it('finds /start chats for the connect flow (private chats only)', () => {
    const res = startCandidates([
      update(10, '/start', 111, 5, { chat: { id: 111, type: 'private', username: 'alice' } }),
      update(11, '/start', 222, 6, { chat: { id: 222, type: 'group', title: 'g' } }),
      update(12, 'hello', 333, 7),
      update(13, '/start', 444, 8, { chat: { id: 444, type: 'private', first_name: 'Bob' }, from: { id: 444, is_bot: false, first_name: 'Bob' } }),
    ]);
    expect(res.lastUpdateId).toBe(13);
    expect(res.candidates.map((c) => [c.chatId, c.label])).toEqual([
      ['444', 'Bob'],
      ['111', '@alice'],
    ]);
  });
});

describe('alert formatting', () => {
  it('escapes HTML in every dynamic value and links only to FunPay', () => {
    const html = buildTelegramAlert(
      'order',
      { title: 't', body: 'b', item: '<script>alert(1)</script> & co', price: '100 ₽', buyer: '<b>Evil</b>', orderId: 'ABCD1234' },
      { includePreviews: true, lang: 'en' },
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; co');
    expect(html).toContain('Buyer: &lt;b&gt;Evil&lt;/b&gt;');
    expect(html).toContain('<a href="https://funpay.com/orders/ABCD1234/">Open order #ABCD1234</a>');
    expect(html).not.toContain('<script>');
  });

  it('hides buyer names and previews unless the user enabled them', () => {
    const msg = buildTelegramAlert('message', { title: '', body: '', buyer: 'Petya', preview: 'my password is hunter2', chatId: 'users-1-2' }, { includePreviews: false, lang: 'en' });
    expect(msg).not.toMatch(/Petya|hunter2/);
    expect(msg).toContain('https://funpay.com/chat/?node=users-1-2');
  });
});

describe('telegram sink', () => {
  async function run(s: Settings, it: NotificationItem, input: Partial<NotifyInput> = {}) {
    const send = vi.fn(async () => undefined);
    const sink = createTelegramSink({ getSettings: async () => s, send, knownSecrets: async () => [BOT_TOKEN, AI_KEY] });
    await sink(it, { kind: it.kind, title: it.title, body: it.body, ...input });
    return send;
  }

  it('sends only when fully authorised and the kind is enabled', async () => {
    const order = item('order', 'New order', 'x');
    expect(await run(settings(), order, { meta: { orderId: 'ABCD1234', item: 'Key' } })).toHaveBeenCalledWith(CHAT, expect.stringContaining('New order'));
    for (const patch of [{ general: { localOnly: true } }, { telegram: { enabled: false } }, { telegram: { consentAt: null } }, { telegram: { chatId: '' } }, { telegram: { notifyOrders: false } }, { flags: { telegram: false } }] as SettingsPatch[]) {
      expect(await run(settings(patch), order)).not.toHaveBeenCalled();
    }
    expect(await run(settings(), item('price', 'p', 'p'))).not.toHaveBeenCalled();
    expect(await run(settings(), order, { meta: { test: true } })).not.toHaveBeenCalled();
    expect(telegramReady(settings())).toBe(true);
    expect(telegramWantsKind(settings(), 'system')).toBe(false);
  });

  it('never forwards inventory items, tokens, keys or credentials', async () => {
    const secretItem = 'mysteamlogin hunter2-password-xyz';
    await getDb().inventoryItems.add({ id: 'i1', poolId: 'p', cipher: 'c', iv: 'v', fingerprint: await sha256Hex(secretItem), status: 'delivered', orderId: 'A', reservedAt: null, deliveredAt: null, createdAt: '' });
    const body = [`Delivery failed for order A. Item:`, secretItem, `bot ${BOT_TOKEN}`, `key ${AI_KEY}`, 'code ABCD1-EFGH2-IJKL3', 'login steam:p4ssw0rd!'].join('\n');
    const send = await run(settings(), item('failure', 'Delivery failed', body));
    const sent = (send.mock.calls[0] as unknown as [string, string])[1];
    expect(sent).toContain('Delivery failed');
    for (const leak of [secretItem, 'hunter2', BOT_TOKEN, 'AAHdqTcv', AI_KEY, 'SECRETSECRET', 'ABCD1-EFGH2', 'p4ssw0rd']) expect(sent).not.toContain(leak);
  });

  it('sanitises previews too when they are enabled', async () => {
    const send = await run(settings({ telegram: { includePreviews: true } }), item('message', 'New message', 'x'), {
      meta: { chatId: 'users-1-2', buyer: 'Petya', preview: 'my mail is p@x.io and phone +7 999 123 45 67' },
    });
    const sent = (send.mock.calls[0] as unknown as [string, string])[1];
    expect(sent).toContain('Petya');
    expect(sent).not.toMatch(/p@x\.io|999/);
  });

  it('sanitizeForTelegram strips known secrets verbatim', async () => {
    expect(await sanitizeForTelegram(`token=${BOT_TOKEN}`, [BOT_TOKEN])).not.toContain(BOT_TOKEN);
  });
});

describe('daily summary', () => {
  it('schedules once per day within a grace window', () => {
    const at = (h: number, m: number) => new Date(2024, 5, 15, h, m);
    expect(isSummaryDue(at(20, 59), '21:00', null)).toBe(false);
    expect(isSummaryDue(at(21, 0), '21:00', null)).toBe(true);
    expect(isSummaryDue(at(23, 30), '21:00', null)).toBe(true);
    expect(isSummaryDue(at(21, 5), '21:00', localDayKey(at(21, 5)))).toBe(false);
    expect(isSummaryDue(at(9, 0), '21:00', null)).toBe(false);
    expect(new Date(nextSummaryAt(at(21, 0), '21:00')).getDate()).toBe(16);
    expect(new Date(nextSummaryAt(at(20, 0), '21:00')).getHours()).toBe(21);
  });

  it('builds a numbers-only summary from local data', async () => {
    const today = new Date();
    const iso = today.toISOString();
    const base = { counterpartyName: 'Secret Buyer', counterpartyId: null, description: 'Secret item', categoryName: 'c', listingId: null, rawDate: '', firstSeenAt: iso, updatedAt: iso, history: [] };
    await getDb().orders.bulkAdd([
      { ...base, id: 'A', direction: 'sale', status: 'paid', price: { amountMinor: 10000, currency: 'RUB' }, createdAt: iso },
      { ...base, id: 'B', direction: 'sale', status: 'closed', price: { amountMinor: 5000, currency: 'RUB' }, createdAt: iso },
      { ...base, id: 'C', direction: 'sale', status: 'refunded', price: { amountMinor: 700, currency: 'RUB' }, createdAt: iso },
      { ...base, id: 'D', direction: 'purchase', status: 'paid', price: { amountMinor: 999, currency: 'RUB' }, createdAt: iso },
    ]);
    const s = await buildLocalSummary(today);
    expect(s).toMatchObject({ sales: 2, refunds: 1, activeOrders: 1, revenue: { RUB: 15000 } });
    const html = formatSummaryHtml(s, 'en', today);
    expect(html).toContain('Sales today: 2');
    expect(html).not.toMatch(/Secret/);
  });
});
