import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings, mergeSettings, type Settings, type SettingsPatch } from '@/core/settings/schema';
import {
  classifyByRules,
  classifyQuestion,
  computeSalesTrendSummary,
  consentScopeFor,
  conversationFromText,
  detectAttention,
  detectLanguage,
  draftComplaintResponse,
  draftCustomerReply,
  explainSalesTrend,
  hasValidConsent,
  listingTipsByRules,
  needsHumanAttention,
  rankTemplates,
  saveAiDraft,
  sanitizeDraft,
  staticAiCheck,
  suggestTemplates,
  summarizeConversation,
  testAiConnection,
  translate,
  type AiRuntimeDeps,
  type Conversation,
} from '@/features/ai';
import type { MessageTemplate, Order } from '@/shared/models';

const KEY = 'sk-test-key-0123456789abcdef';

function aiSettings(patch: SettingsPatch = {}): Settings {
  const base = mergeSettings(defaultSettings(), {
    general: { localOnly: false },
    ai: { enabled: true, provider: 'openai', model: 'gpt-4.1-mini', consentAt: 1, consentScope: 'openai|api.openai.com', redactPersonalData: true },
  });
  return mergeSettings(base, patch);
}

function openAiAnswer(text: string): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { status: 200 });
}

function depsWith(fetchImpl: (...args: unknown[]) => Promise<Response>, over: Partial<AiRuntimeDeps> = {}): AiRuntimeDeps {
  return { getApiKey: async () => KEY, hasPermission: async () => true, http: { fetch: fetchImpl as unknown as typeof fetch, sleep: async () => undefined }, ...over };
}

function sentUserPrompt(fetchMock: ReturnType<typeof vi.fn>): string {
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  const body = JSON.parse(init.body as string) as { messages: { role: string; content: string }[] };
  return body.messages.find((m) => m.role === 'user')!.content;
}

const CONV: Conversation = {
  chatId: 'users-1-2',
  buyerName: 'Vasya',
  sellerName: 'ShopOwner',
  messages: [
    { author: 'system', text: 'Покупатель Vasya оплатил заказ #ABCD1234.', at: null, id: '1' },
    { author: 'customer', text: 'Здравствуйте, когда будет выдача товара? Мой email vasya@mail.ru', at: null, id: '2' },
  ],
};

function tpl(id: string, name: string, body: string, tags: string[] = []): MessageTemplate {
  return { id, name, command: null, body, lang: 'any', tags, createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' };
}

beforeEach(() => {
  resetDbForTests();
});

afterEach(() => {
  delete (globalThis as { Translator?: unknown }).Translator;
});

describe('heuristics', () => {
  it('detects ru / uk / en', () => {
    expect(detectLanguage('Привет, когда доставка?')).toBe('ru');
    expect(detectLanguage('Вітаю, коли буде товар? Дякую')).toBe('uk');
    expect(detectLanguage('Hi, when will I get it?')).toBe('en');
    expect(detectLanguage('12345')).toBeNull();
  });

  it.each([
    ['Есть в наличии? Сколько стоит на 2 месяца?', 'pre_sale'],
    ['Is it available? How much for two?', 'pre_sale'],
    ['Когда будет выдача? Я оплатил час назад и жду', 'delivery'],
    ["I still haven't received my order", 'delivery'],
    ['Ключ не работает, пишет ошибка активации', 'problem'],
    ['Верните деньги, хочу возврат', 'refund_request'],
    ['I want a refund, cancel my order', 'refund_request'],
    ['Поверніть гроші, будь ласка', 'refund_request'],
    ['Спасибо, оставлю отзыв', 'review'],
    ['Напиши мне в телеграм, оплачу напрямую на карту без комиссии', 'spam_scam'],
    ['Администрация FunPay: ваш аккаунт будет заблокирован, перейдите по ссылке', 'spam_scam'],
    ['Visit funpay-support.com to verify your account', 'spam_scam'],
    ['Добрый вечер', 'other'],
  ])('classifies %j as %s', (text, category) => {
    expect(classifyByRules(text).category).toBe(category);
  });

  it('flags messages that need a human', () => {
    expect(detectAttention(['Добрый день']).needed).toBe(false);
    expect(detectAttention(['Верните деньги, иначе открою спор']).reasons).toEqual(expect.arrayContaining(['refund', 'dispute']));
    expect(detectAttention(['Поддержка FunPay: срочно подтвердите аккаунт']).reasons).toContain('admin_impersonation');
    expect(detectAttention(['ВЫ МЕНЯ ОБМАНУЛИ!!! МОШЕННИК']).reasons).toContain('angry');
    expect(detectAttention(['оплачу напрямую на карту']).severity).toBe('high');
    expect(detectAttention(['пиши в t.me/someone']).reasons).toContain('off_platform');
  });

  it('ranks templates by keyword overlap (inflections, tags, language)', () => {
    const templates = [
      tpl('a', 'Сроки выдачи', 'Выдача занимает до 10 минут после оплаты.', ['delivery']),
      tpl('b', 'Возврат', 'Опишите проблему, проверю заказ.', ['refund_request']),
      tpl('c', 'Greeting', 'Hello! How can I help?'),
    ];
    const ranked = rankTemplates('Когда будет выдача товара?', templates);
    expect(ranked[0]?.template.id).toBe('a');
    expect(rankTemplates('совсем другое', templates)).toEqual([]);
  });
});

describe('availability gates', () => {
  it('requires the flag, local-only off, provider, model, enable and consent for this exact recipient', () => {
    expect(staticAiCheck(aiSettings())).toEqual({ ok: true });
    expect(staticAiCheck(aiSettings({ general: { localOnly: true } }))).toEqual({ ok: false, reason: 'local_only' });
    expect(staticAiCheck(aiSettings({ flags: { aiCopilot: false } }))).toEqual({ ok: false, reason: 'flag_off' });
    expect(staticAiCheck(aiSettings({ ai: { enabled: false } }))).toEqual({ ok: false, reason: 'disabled' });
    expect(staticAiCheck(aiSettings({ ai: { consentAt: null } }))).toEqual({ ok: false, reason: 'no_consent' });
    // Consent was given for another provider: void.
    const switched = aiSettings({ ai: { provider: 'anthropic' } });
    expect(hasValidConsent(switched.ai)).toBe(false);
    expect(consentScopeFor(switched.ai)).toBe('anthropic|api.anthropic.com');
    expect(staticAiCheck(aiSettings({ ai: { provider: 'openai_compatible', baseUrl: 'http://evil.example' } }))).toEqual({ ok: false, reason: 'invalid_base_url' });
    // The connection test works before consent, but never in local-only mode.
    expect(staticAiCheck(aiSettings({ ai: { consentAt: null, enabled: false } }), { forTest: true })).toEqual({ ok: true });
    expect(staticAiCheck(aiSettings({ general: { localOnly: true } }), { forTest: true })).toEqual({ ok: false, reason: 'local_only' });
  });
});

describe('draftCustomerReply', () => {
  it('sends a redacted transcript and sanitises the AI answer', async () => {
    const fetchMock = vi.fn(async () => openAiAnswer('Hello [buyer]! Write me on telegram @seller_contact or t.me/sellerx. I will refund you, I promise.'));
    const res = await draftCustomerReply(CONV, { settings: aiSettings(), deps: depsWith(fetchMock) });
    expect(res.source).toBe('ai');
    expect(res.text).toContain('Hello Vasya!');
    expect(res.text).not.toMatch(/@seller_contact|t\.me/);
    expect(res.warnings).toEqual(expect.arrayContaining(['contacts_removed', 'mentions_refund', 'binding_commitment']));
    const prompt = sentUserPrompt(fetchMock);
    expect(prompt).not.toMatch(/ABCD1234|vasya@mail\.ru|Vasya/);
    expect(prompt).toContain('[buyer]');
    expect(prompt).toContain('#[order]');
    expect(prompt).toContain('[email]');
  });

  it('falls back to the best template when local-only mode is on (no network)', async () => {
    await getDb().templates.add(tpl('t1', 'Сроки выдачи', 'Здравствуйте, {buyer}! Выдача занимает до 10 минут.', ['delivery']));
    const fetchMock = vi.fn();
    const res = await draftCustomerReply(CONV, { settings: aiSettings({ general: { localOnly: true } }), deps: depsWith(fetchMock) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ source: 'template', templateId: 't1', aiError: { reason: 'local_only' } });
    expect(res.text).toBe('Здравствуйте, Vasya! Выдача занимает до 10 минут.');
  });

  it.each([
    ['no consent', { ai: { consentAt: null } }, {}, 'no_consent'],
    ['disabled', { ai: { enabled: false } }, {}, 'disabled'],
    ['no key', {}, { getApiKey: async () => null }, 'no_key'],
    ['no permission', {}, { hasPermission: async () => false }, 'no_permission'],
  ] as const)('falls back to safe rules when %s', async (_label, patch, depsOver, reason) => {
    const fetchMock = vi.fn();
    const res = await draftCustomerReply(CONV, { settings: aiSettings(patch as SettingsPatch), deps: depsWith(fetchMock, depsOver as Partial<AiRuntimeDeps>) });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.source).toBe('rules');
    expect(res.aiError?.reason).toBe(reason);
    expect(res.text).toMatch(/Здравствуйте/);
    expect(res.text).not.toMatch(/верн\S*\s+(вам\s+)?(деньги|средства)|возврат|гарант/i);
  });

  it('falls back when the provider fails', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":{"message":"boom"}}', { status: 500 }));
    const res = await draftCustomerReply(CONV, { settings: aiSettings(), deps: depsWith(fetchMock) });
    expect(res.source).toBe('rules');
    expect(res.aiError?.reason).toBe('server');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('complaint fallback never promises a refund', async () => {
    const conv = conversationFromText('Товар не работает, верните деньги!');
    const res = await draftComplaintResponse(conv, { settings: aiSettings({ general: { localOnly: true } }) });
    expect(res.source).toBe('template');
    expect(res.text).not.toMatch(/верну|вернём|возврат будет|гарант/i);
  });
});

describe('classification, attention, templates, summaries', () => {
  it('uses the AI label when valid but never overrides strong scam rules', async () => {
    const fetchMock = vi.fn(async () => openAiAnswer('refund_request'));
    const res = await classifyQuestion('Не устроило, что делать?', { settings: aiSettings(), deps: depsWith(fetchMock) });
    expect(res).toMatchObject({ category: 'refund_request', source: 'ai' });

    const scamFetch = vi.fn(async () => openAiAnswer('other'));
    const scam = await classifyQuestion('Администрация FunPay: перейдите по ссылке funpay-help.ru, иначе бан', { settings: aiSettings(), deps: depsWith(scamFetch) });
    expect(scam).toMatchObject({ category: 'spam_scam', source: 'rules' });
    expect(scamFetch).not.toHaveBeenCalled();

    const offline = await classifyQuestion('Верните деньги', { settings: aiSettings({ general: { localOnly: true } }) });
    expect(offline).toMatchObject({ category: 'refund_request', source: 'rules', aiError: { reason: 'local_only' } });
  });

  it('AI can add an attention flag but never clear one raised by rules', async () => {
    const conv = conversationFromText('Верните деньги, открою спор');
    const no = await needsHumanAttention(conv, { useAi: true, settings: aiSettings(), deps: depsWith(vi.fn(async () => openAiAnswer('NO'))) });
    expect(no.needed).toBe(true);
    expect(no.severity).toBe('high');
    const calm = conversationFromText('Подскажите по настройке');
    const yes = await needsHumanAttention(calm, { useAi: true, lang: 'en', settings: aiSettings(), deps: depsWith(vi.fn(async () => openAiAnswer('YES: the buyer sounds confused'))) });
    expect(yes).toMatchObject({ needed: true, source: 'ai', aiNote: 'the buyer sounds confused' });
    const rulesOnly = await needsHumanAttention(calm);
    expect(rulesOnly).toMatchObject({ needed: false, source: 'rules' });
  });

  it('suggests templates locally and lets AI reorder them', async () => {
    await getDb().templates.bulkAdd([
      tpl('a', 'Сроки выдачи', 'Выдача до 10 минут.', ['delivery']),
      tpl('b', 'Выдача ночью', 'Ночью выдача может занять до часа.'),
      tpl('c', 'Возврат', 'Опишите проблему.'),
    ]);
    // "когда будет" marks a delivery question, so the template tagged "delivery" wins the tie.
    const local = await suggestTemplates('Когда будет выдача?');
    expect(local.source).toBe('rules');
    expect(local.suggestions.map((s) => s.templateId)).toEqual(['a', 'b']);
    const ai = await suggestTemplates('Когда будет выдача?', { useAi: true, settings: aiSettings(), deps: depsWith(vi.fn(async () => openAiAnswer('2, 1'))) });
    expect(ai.source).toBe('ai');
    expect(ai.suggestions.map((s) => s.templateId)).toEqual(['b', 'a']);
  });

  it('summarises by rules when AI is unavailable', async () => {
    const res = await summarizeConversation(CONV, { lang: 'en', settings: aiSettings({ general: { localOnly: true } }) });
    expect(res.source).toBe('rules');
    expect(res.text).toContain('2 messages (1 from the buyer)');
    expect(res.text).toContain('delivery question');
  });
});

describe('translate', () => {
  it('restores locally redacted values after AI translation', async () => {
    const fetchMock = vi.fn(async (_url: unknown, init: unknown) => {
      const body = JSON.parse((init as RequestInit).body as string) as { messages: { role: string; content: string }[] };
      const user = body.messages.find((m) => m.role === 'user')!.content;
      expect(user).not.toContain('QWER1234');
      return openAiAnswer(user.replace('Ваш заказ', 'Your order').replace('готов', 'is ready'));
    });
    const res = await translate('Ваш заказ #QWER1234 готов', 'en', { settings: aiSettings(), deps: depsWith(fetchMock) });
    expect(res).toMatchObject({ status: 'ok', source: 'ai', text: 'Your order #QWER1234 is ready' });
  });

  it('uses the on-device translator when AI is unavailable, else reports unavailable', async () => {
    const off = aiSettings({ general: { localOnly: true } });
    expect(await translate('Привет', 'en', { settings: off })).toMatchObject({ status: 'unavailable' });
    const destroy = vi.fn();
    (globalThis as { Translator?: unknown }).Translator = {
      availability: async () => 'available',
      create: async () => ({ translate: async (t: string) => `EN(${t})`, destroy }),
    };
    expect(await translate('Привет', 'en', { settings: off })).toMatchObject({ status: 'ok', source: 'local', text: 'EN(Привет)', aiError: { reason: 'local_only' } });
    expect(destroy).toHaveBeenCalled();
    expect(await translate('Hello', 'en', { settings: off })).toMatchObject({ status: 'ok', text: 'Hello' });
  });
});

describe('drafts, sanitising and misc', () => {
  it('saves copilot output as a pending AI draft (never sends)', async () => {
    const d = await saveAiDraft({ chatId: 'users-1-2', text: '  Hello!  ', triggerMessageId: '2' });
    expect(await getDb().drafts.get(d.id)).toMatchObject({ source: 'ai', status: 'pending', text: 'Hello!', chatId: 'users-1-2', triggerMessageId: '2' });
    await expect(saveAiDraft({ chatId: '', text: 'x' })).rejects.toThrow();
    expect(await getDb().tasks.count()).toBe(0);
  });

  it('removes contacts but keeps dates and prices', () => {
    const s = sanitizeDraft('"Call +7 999 123 45 67 or mail a@b.co, see https://evil.example/x and https://funpay.com/orders/A/. Order from 12.03.2024 14:05 for 1 250 ₽"', { maxLength: 2000 });
    expect(s.text).not.toMatch(/999|a@b\.co|evil\.example/);
    expect(s.text).toContain('https://funpay.com/orders/A/');
    expect(s.text).toContain('12.03.2024 14:05');
    expect(s.text).toContain('1 250 ₽');
    expect(s.warnings).toContain('contacts_removed');
    expect(sanitizeDraft('Please confirm the order now', { maxLength: 100 }).warnings).toContain('asks_confirmation');
    expect(sanitizeDraft('Leave a positive review please', { maxLength: 100 }).warnings).toContain('asks_review');
  });

  it('explains a sales trend deterministically', async () => {
    const now = Date.parse('2024-06-15T12:00:00Z');
    const mk = (id: string, daysAgo: number, amount: number, status: Order['status'] = 'closed'): Order => ({
      id,
      direction: 'sale',
      status,
      counterpartyName: 'b',
      counterpartyId: null,
      description: 'd',
      categoryName: 'Steam keys',
      listingId: null,
      price: { amountMinor: amount, currency: 'RUB' },
      createdAt: new Date(now - daysAgo * 86400_000).toISOString(),
      rawDate: '',
      firstSeenAt: new Date(now - daysAgo * 86400_000).toISOString(),
      updatedAt: '',
      history: [],
    });
    const summary = computeSalesTrendSummary([mk('a', 1, 50000), mk('b', 2, 75000), mk('c', 3, 1000, 'refunded'), mk('d', 9, 100000)], now, 7, 'last week')!;
    expect(summary.current).toEqual({ orders: 2, revenueMinor: 125000, refunds: 1 });
    expect(summary.previous).toMatchObject({ orders: 1, revenueMinor: 100000 });
    const res = await explainSalesTrend(summary, { lang: 'en', useAi: false });
    expect(res.source).toBe('rules');
    expect(res.text).toMatch(/Revenue grew by 25%/);
    expect(res.text).toMatch(/Orders grew by 100%/);
    expect(res.text).toContain('Top category: Steam keys (2 orders).');
  });

  it('suggests listing improvements by rules', () => {
    const tips = listingTipsByRules(
      { title: 'КЛЮЧ STEAM!!!', price: { amountMinor: 20000, currency: 'RUB' }, amount: 0, active: true, autoDelivery: false, categoryName: 'Steam', description: 'пиши в t.me/me' },
      'en',
      { medianPriceMinor: 10000, offers: 5 },
    ).map((t) => t.id);
    expect(tips).toEqual(expect.arrayContaining(['title_short', 'title_caps', 'title_punctuation', 'no_english_title', 'description_short', 'description_contacts', 'no_auto_delivery', 'out_of_stock', 'price_above_market']));
  });

  it('connection test sends only a fixed prompt', async () => {
    const fetchMock = vi.fn(async () => openAiAnswer('OK'));
    const res = await testAiConnection({ settings: aiSettings({ ai: { consentAt: null, enabled: false } }), deps: depsWith(fetchMock) });
    expect(res).toMatchObject({ ok: true, reply: 'OK' });
    expect(sentUserPrompt(fetchMock)).toBe('Connection test from FunPro. Reply with OK.');
  });
});
