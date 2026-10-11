import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AutomationContext } from '@/core/automation/policy';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings, mergeSettings, type Settings, type SettingsPatch } from '@/core/settings/schema';
import type { AiRuntimeDeps } from '@/features/ai';
import {
  AUTO_POST_LIMIT,
  createFeedbackRequestDraft,
  draftReviewReply,
  feedbackRequestBlock,
  handleReviewForAutoReply,
  lintReviewReply,
  loadReviewRows,
  markReviewReplied,
  pickTemplate,
  privateChatId,
  renderReviewTemplate,
  saveReviewReplyDraft,
  saveReviewTemplate,
  seedDefaultReviewTemplates,
  type AutoReviewDeps,
} from '@/features/reviews';
import type { DomainEvent, Order, Review, ReviewTemplate } from '@/shared/models';

function review(
  orderId: string,
  stars: number | null,
  text = 'Всё отлично, спасибо!',
  sellerReply: string | null = null,
): Review {
  return {
    orderId,
    stars,
    text,
    authorName: 'Petya',
    at: '2024-05-01T10:00:00.000Z',
    rawDate: '',
    sellerReply,
    firstSeenAt: '2024-05-01T10:00:00.000Z',
  };
}

function order(id: string, patch: Partial<Order> = {}): Order {
  return {
    id,
    direction: 'sale',
    status: 'closed',
    counterpartyName: 'Petya',
    counterpartyId: '222',
    description: 'Steam key Elden Ring',
    categoryName: 'Steam',
    listingId: null,
    price: { amountMinor: 150000, currency: 'RUB' },
    createdAt: new Date().toISOString(),
    rawDate: '',
    firstSeenAt: new Date().toISOString(),
    updatedAt: '',
    history: [],
    ...patch,
  };
}

function template(
  stars: number,
  body: string,
  enabled = true,
  id = `t${stars}-${body.length}`,
): ReviewTemplate {
  return { id, stars, body, enabled };
}

const RUNNING: SettingsPatch = {
  automation: { state: 'running', autoReviewReply: true, liveActionsAcknowledged: true },
};
const TAB: AutomationContext = { funpayTabAvailable: true, sessionLoggedIn: true };

function settings(...patches: SettingsPatch[]): Settings {
  return patches.reduce<Settings>((s, p) => mergeSettings(s, p), defaultSettings());
}

async function reviewEvent(orderId: string, payload: Record<string, unknown> = {}): Promise<DomainEvent> {
  const ev: DomainEvent = {
    id: `REVIEW_RECEIVED:${orderId}`,
    type: 'REVIEW_RECEIVED',
    at: new Date().toISOString(),
    payload: { orderId, stars: 5, hasReply: false, baseline: false, ...payload },
    handledBy: [],
  };
  await getDb().events.put(ev);
  return ev;
}

function deps(
  s: Settings,
  over: Partial<AutoReviewDeps> = {},
): AutoReviewDeps & { postReply: ReturnType<typeof vi.fn> } {
  const postReply = vi.fn(async () => ({ ok: true }));
  return {
    getSettings: async () => s,
    automationContext: async () => TAB,
    postReply,
    lang: 'ru',
    ...over,
  } as AutoReviewDeps & { postReply: ReturnType<typeof vi.fn> };
}

const aiOn: SettingsPatch = {
  general: { localOnly: false },
  ai: {
    enabled: true,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    consentAt: 1,
    consentScope: 'openai|api.openai.com',
  },
};

function aiDeps(answer: string | null): AiRuntimeDeps {
  const fetchImpl = vi.fn(async () =>
    answer === null
      ? new Response('{}', { status: 500 })
      : new Response(JSON.stringify({ choices: [{ message: { content: answer }, finish_reason: 'stop' }] }), {
          status: 200,
        }),
  );
  return {
    getApiKey: async () => 'sk-test-1234567890',
    hasPermission: async () => true,
    http: { fetch: fetchImpl as unknown as typeof fetch, sleep: async () => undefined },
  };
}

beforeEach(() => {
  resetDbForTests();
});

describe('review templates', () => {
  it('rejects contacts, rewards and rating requests, but allows ordinary thanks', () => {
    expect(lintReviewReply('Спасибо за положительный отзыв!')).toEqual([]);
    expect(lintReviewReply('Thanks for buying the gift card and for 5 stars!')).toEqual([]);
    expect(lintReviewReply('Пишите в телеграм @shop_support')).toContain('contacts');
    expect(lintReviewReply('За отзыв дарим промокод на скидку')).toContain('reward');
    expect(lintReviewReply('Get a discount on your next order for this review')).toContain('reward');
    expect(lintReviewReply('Пожалуйста, измените оценку на 5')).toContain('rating_request');
    expect(lintReviewReply('Please change your rating')).toContain('rating_request');
    expect(lintReviewReply('Поставьте 5 звёзд')).toContain('rating_request');
    expect(lintReviewReply('')).toContain('empty');
    expect(lintReviewReply('x'.repeat(1001))).toContain('too_long');
  });

  it('refuses to save a template that breaks the rules', async () => {
    await expect(saveReviewTemplate({ stars: 5, body: 'Бонус за отзыв — промокод!' })).rejects.toThrow(
      /reward/,
    );
    await expect(saveReviewTemplate({ stars: 5, body: 'Спасибо, {buyer}!' })).resolves.toMatchObject({
      stars: 5,
      enabled: true,
    });
  });

  it('picks only enabled templates for the rating and rotates deterministically', () => {
    const list = [
      template(5, 'A', true, 'a'),
      template(5, 'B', true, 'b'),
      template(5, 'C', false, 'c'),
      template(4, 'D', true, 'd'),
    ];
    expect(pickTemplate(5, list, 'ORDER1')?.stars).toBe(5);
    expect(['a', 'b']).toContain(pickTemplate(5, list, 'ORDER1')?.id);
    expect(pickTemplate(5, list, 'ORDER1')).toBe(pickTemplate(5, list, 'ORDER1'));
    expect(pickTemplate(3, list)).toBeNull();
    expect(pickTemplate(null, list)?.id).toBe('d');
  });

  it('renders variables and seeds defaults only once', async () => {
    expect(
      renderReviewTemplate('Спасибо, {buyer}! {item} — {stars}★', { buyer: 'Petya', item: 'Key', stars: 5 }),
    ).toBe('Спасибо, Petya! Key — 5★');
    expect(renderReviewTemplate('Спасибо, {buyer}!', { buyer: null })).toBe('Спасибо!');
    expect(await seedDefaultReviewTemplates('ru')).toBe(5);
    expect(await seedDefaultReviewTemplates('ru')).toBe(0);
  });
});

describe('draftReviewReply', () => {
  it('falls back to the star template when AI is unavailable', async () => {
    const tpls = [template(5, 'Спасибо, {buyer}!')];
    const res = await draftReviewReply(review('A1', 5), order('A1'), {
      settings: settings(),
      templates: tpls,
    });
    expect(res).toMatchObject({
      source: 'template',
      text: 'Спасибо, Petya!',
      aiError: { reason: 'local_only' },
    });
  });

  it('uses the built-in default in the review language when no template exists', async () => {
    const res = await draftReviewReply(review('A1', 2, 'Long delivery, not happy'), null, {
      settings: settings(),
      templates: [],
    });
    expect(res.source).toBe('default');
    expect(res.text).toMatch(/^I am sorry/);
  });

  it('falls back to the template when the provider fails', async () => {
    const res = await draftReviewReply(review('A1', 5), order('A1'), {
      settings: settings(aiOn),
      deps: aiDeps(null),
      templates: [template(5, 'Спасибо!')],
    });
    expect(res).toMatchObject({ source: 'template', text: 'Спасибо!', aiError: { reason: 'server' } });
  });

  it('returns sanitised AI text, and rejects AI text that breaks review rules', async () => {
    const ok = await draftReviewReply(review('A1', 5), order('A1'), {
      settings: settings(aiOn),
      deps: aiDeps('Спасибо, [buyer]! Рады помочь. Пишите в t.me/shop'),
      templates: [],
    });
    expect(ok.source).toBe('ai');
    expect(ok.text).toContain('Спасибо, Petya!');
    expect(ok.text).not.toContain('t.me');

    const bad = await draftReviewReply(review('A1', 3), order('A1'), {
      settings: settings(aiOn),
      deps: aiDeps('Пожалуйста, измените оценку на 5 звёзд'),
      templates: [template(3, 'Спасибо за отзыв.')],
    });
    expect(bad).toMatchObject({ source: 'template', text: 'Спасибо за отзыв.' });
    expect(bad.aiError?.message).toMatch(/rating_request/);
  });
});

describe('automatic review replies', () => {
  beforeEach(async () => {
    await getDb().reviews.add(review('R1', 5));
    await getDb().orders.add(order('R1'));
  });

  it('ignores baseline events and reviews that already have a reply', async () => {
    const d = deps(settings(RUNNING));
    expect((await handleReviewForAutoReply(await reviewEvent('R1', { baseline: true }), d)).outcome).toBe(
      'ignored_baseline',
    );
    expect((await handleReviewForAutoReply(await reviewEvent('R1', { hasReply: true }), d)).outcome).toBe(
      'ignored_has_reply',
    );
    await getDb().reviews.update('R1', { sellerReply: 'answered on FunPay' });
    expect((await handleReviewForAutoReply(await reviewEvent('R1'), d)).outcome).toBe('ignored_has_reply');
    expect(d.postReply).not.toHaveBeenCalled();
    expect(await getDb().drafts.count()).toBe(0);
  });

  it.each([
    [
      'disabled',
      settings({ automation: { state: 'running', autoReviewReply: false, liveActionsAcknowledged: true } }),
      TAB,
      'disabled',
    ],
    ['paused', settings(RUNNING, { automation: { state: 'paused' } }), TAB, 'paused'],
    ['emergency stop', settings(RUNNING, { automation: { state: 'stopped' } }), TAB, 'blocked'],
    [
      'live actions not acknowledged',
      settings(RUNNING, { automation: { liveActionsAcknowledged: false } }),
      TAB,
      'awaiting_authorization',
    ],
    ['no FunPay tab', settings(RUNNING), { funpayTabAvailable: false, sessionLoggedIn: false }, 'blocked'],
  ] as const)('does nothing when the policy says %s', async (_label, s, ctx, status) => {
    const d = deps(s, { automationContext: async () => ctx });
    const res = await handleReviewForAutoReply(await reviewEvent('R1'), d);
    expect(res).toMatchObject({ outcome: 'not_running', status });
    expect(d.postReply).not.toHaveBeenCalled();
    expect(await getDb().drafts.count()).toBe(0);
  });

  it('creates an approval draft by default (never posts)', async () => {
    await getDb().reviewTemplates.add(template(5, 'Спасибо, {buyer}!'));
    const d = deps(settings(RUNNING));
    const res = await handleReviewForAutoReply(await reviewEvent('R1'), d);
    expect(res.outcome).toBe('drafted');
    expect(d.postReply).not.toHaveBeenCalled();
    const draft = await getDb().drafts.get(res.draftId!);
    expect(draft).toMatchObject({ source: 'review', status: 'pending', chatId: '', text: 'Спасибо, Petya!' });
    expect(draft?.meta).toMatchObject({
      kind: 'review_reply',
      orderId: 'R1',
      auto: true,
      generatedBy: 'template',
    });
    // Each event is handled once.
    expect(
      (
        await handleReviewForAutoReply(
          await getDb()
            .events.get('REVIEW_RECEIVED:R1')
            .then((e) => e!),
          d,
        )
      ).outcome,
    ).toBe('duplicate');
  });

  it('auto-posts only an enabled user template when explicitly allowed — never AI text', async () => {
    await getDb().reviewTemplates.add(template(5, 'Спасибо, {buyer}!'));
    const s = settings(RUNNING, aiOn, { ai: { autoPostReviewReplies: true, autoDraftReviews: true } });
    const d = deps(s, { aiDeps: aiDeps('AI WRITTEN TEXT') });
    const res = await handleReviewForAutoReply(await reviewEvent('R1'), d);
    expect(res.outcome).toBe('posted');
    expect(d.postReply).toHaveBeenCalledWith('R1', 'Спасибо, Petya!');
    expect((await getDb().reviews.get('R1'))?.sellerReply).toBe('Спасибо, Petya!');
    expect(await getDb().drafts.count()).toBe(0);
  });

  it('falls back to an approval draft when auto-post has no template, fails, or has no tab', async () => {
    const s = settings(RUNNING, { ai: { autoPostReviewReplies: true } });
    const noTpl = await handleReviewForAutoReply(await reviewEvent('R1'), deps(s));
    expect(noTpl.outcome).toBe('drafted');
    expect(noTpl.detail).toMatch(/No enabled template/);

    await getDb().reviews.add(review('R2', 5));
    await getDb().reviewTemplates.add(template(5, 'Спасибо!'));
    const failing = deps(s, { postReply: vi.fn(async () => ({ ok: false, error: 'Bad request' })) });
    const failed = await handleReviewForAutoReply(await reviewEvent('R2'), failing);
    expect(failed.outcome).toBe('post_failed');
    expect((await getDb().drafts.get(failed.draftId!))?.meta?.['note']).toMatch(/Bad request/);

    await getDb().reviews.add(review('R3', 5));
    const noTab = Object.assign(new Error('No logged-in FunPay tab is open'), { name: 'NoFunPayTabError' });
    const awaiting = await handleReviewForAutoReply(
      await reviewEvent('R3'),
      deps(s, { postReply: vi.fn(async () => Promise.reject(noTab)) }),
    );
    expect(awaiting.outcome).toBe('awaiting_tab');
    expect((await getDb().reviews.get('R3'))?.sellerReply).toBeNull();
  });

  it('never posts a template that breaks review rules', async () => {
    await getDb().reviewTemplates.add({
      id: 'bad',
      stars: 5,
      body: 'Спасибо! Дарим промокод на скидку за отзыв',
      enabled: true,
    });
    const d = deps(settings(RUNNING, { ai: { autoPostReviewReplies: true } }));
    const res = await handleReviewForAutoReply(await reviewEvent('R1'), d);
    expect(res.outcome).toBe('drafted');
    expect(d.postReply).not.toHaveBeenCalled();
  });

  it('rate-limits automatic posting', async () => {
    await getDb().reviewTemplates.add(template(5, 'Спасибо!'));
    const d = deps(settings(RUNNING, { ai: { autoPostReviewReplies: true } }), { now: () => 1_000_000 });
    const outcomes: string[] = [];
    for (let i = 0; i < AUTO_POST_LIMIT.max + 1; i++) {
      await getDb().reviews.put(review(`L${i}`, 5));
      outcomes.push((await handleReviewForAutoReply(await reviewEvent(`L${i}`), d)).outcome);
    }
    expect(outcomes.filter((o) => o === 'posted')).toHaveLength(AUTO_POST_LIMIT.max);
    expect(outcomes.at(-1)).toBe('drafted');
  });

  it('uses AI for the approval draft only when automatic AI drafts are allowed', async () => {
    const s = settings(RUNNING, aiOn, { ai: { autoDraftReviews: true } });
    const res = await handleReviewForAutoReply(
      await reviewEvent('R1'),
      deps(s, { aiDeps: aiDeps('Спасибо за отзыв, [buyer]!') }),
    );
    expect(res.outcome).toBe('drafted');
    expect(await getDb().drafts.get(res.draftId!)).toMatchObject({
      text: 'Спасибо за отзыв, Petya!',
      meta: { generatedBy: 'ai' },
    });
  });
});

describe('review rows, replies and buyer feedback', () => {
  it('joins orders and filters by stars, unanswered and text', async () => {
    await getDb().reviews.bulkAdd([
      review('A', 5, 'great'),
      review('B', 1, 'bad', 'sorry'),
      review('C', 1, 'awful'),
    ]);
    await getDb().orders.add(order('A'));
    const all = await loadReviewRows();
    expect(all).toHaveLength(3);
    expect(all.find((r) => r.review.orderId === 'A')?.order?.description).toBe('Steam key Elden Ring');
    expect(
      (await loadReviewRows({ stars: 1, unansweredOnly: true, query: '' })).map((r) => r.review.orderId),
    ).toEqual(['C']);
    expect(
      (await loadReviewRows({ stars: null, unansweredOnly: false, query: 'elden' })).map(
        (r) => r.review.orderId,
      ),
    ).toEqual(['A']);
  });

  it('marks a review replied and closes its drafts', async () => {
    const r = review('A', 5);
    await getDb().reviews.add(r);
    const d1 = await saveReviewReplyDraft(r, { text: 'one', source: 'template', templateId: null });
    const same = await saveReviewReplyDraft(r, { text: 'two', source: 'template', templateId: null });
    expect(same.id).toBe(d1.id);
    await markReviewReplied('A', 'two', d1.id);
    expect((await getDb().reviews.get('A'))?.sellerReply).toBe('two');
    expect((await getDb().drafts.get(d1.id))?.status).toBe('sent');
  });

  it('only allows feedback requests after a confirmed sale, as a manual chat draft', async () => {
    expect(feedbackRequestBlock(order('X', { status: 'paid' }), false)).toBe('not_confirmed');
    expect(feedbackRequestBlock(order('X', { status: 'refunded' }), false)).toBe('refunded');
    expect(feedbackRequestBlock(order('X', { direction: 'purchase' }), false)).toBe('not_sale');
    expect(feedbackRequestBlock(order('X'), true)).toBe('already_reviewed');
    expect(feedbackRequestBlock(order('X'), false)).toBeNull();
    expect(privateChatId('300', '222')).toBe('users-222-300');
    expect(privateChatId(null, '222')).toBeNull();

    const d = await createFeedbackRequestDraft(order('X'), 'Спасибо за покупку!', '300');
    expect(d).toMatchObject({
      chatId: 'users-222-300',
      status: 'pending',
      source: 'review',
      meta: { kind: 'feedback_request', orderId: 'X' },
    });
    await expect(createFeedbackRequestDraft(order('Y', { status: 'paid' }), 'hi', '300')).rejects.toThrow(
      /not_confirmed/,
    );
    expect(await getDb().tasks.count()).toBe(0);
  });
});
