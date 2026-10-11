/**
 * AI copilot. Every function returns editable text or data for the seller and has a deterministic
 * fallback (rules / templates / on-device translation) or a typed `unavailable` result. Nothing
 * here sends messages, refunds or changes orders — callers decide what to do with the output
 * (copy, edit, or save as a pending draft via `saveAiDraft`).
 */
import { redactForAi, redactForAiReversible, restorePlaceholder } from '@/adapters/ai';
import { getDb } from '@/core/db/db';
import { cleanMultiline } from '@/core/security/sanitize';
import type { Settings } from '@/core/settings/schema';
import { getSettings } from '@/core/settings/store';
import type { Listing } from '@/shared/models';
import { formatMoney, type Currency } from '@/shared/models/money';
import { customerTexts, lastCustomerMessage, transcriptForAi, type Conversation } from './conversation';
import {
  classifyByRules,
  detectAttention,
  detectLanguage,
  isQuestionCategory,
  rankTemplates,
  type AttentionResult,
  type Classification,
  type CopilotLang,
  type QuestionCategory,
} from './heuristics';
import { draftWarnings, sanitizeDraft, type DraftWarning } from './postprocess';
import { LANG_NAMES, systemPrompt, TASKS } from './prompts';
import { runAiText, type AiFailureReason, type AiRunOptions } from './run';
import {
  attentionLabel,
  categoryLabel,
  COMPLAINT_REPLY,
  GENERIC_REPLIES,
  listingTipText,
  summaryText,
  trendText,
  type ListingTipId,
} from './texts';

/** FunPay chat message limit. */
export const CHAT_MESSAGE_MAX = 2000;

export type CopilotSource = 'ai' | 'template' | 'rules' | 'local';

export interface AiFallbackInfo {
  reason: AiFailureReason;
  message: string;
}

export interface CopilotText {
  text: string;
  source: CopilotSource;
  warnings: DraftWarning[];
  /** Why AI was not used, when a fallback produced the result. */
  aiError?: AiFallbackInfo;
  templateId?: string | null;
}

export interface CopilotOptions extends AiRunOptions {
  /** Try the AI provider when it is available (default depends on the function). */
  useAi?: boolean;
  /** Language for texts FunPro writes itself when it cannot be detected from the input. */
  lang?: CopilotLang;
}

async function settingsOf(opts: CopilotOptions): Promise<Settings> {
  return opts.settings ?? (await getSettings());
}

function fail(reason: AiFailureReason, message: string): AiFallbackInfo {
  return { reason, message };
}

/** Fills common buyer-name variables of message templates; other variables stay for the seller. */
export function fillBuyerVariables(body: string, buyer: string | null): string {
  if (!buyer) return body;
  return body.replace(/\{(buyer|buyername|buyer_name|name|nick)\}/gi, buyer);
}

// ---------------------------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------------------------

export async function draftCustomerReply(
  conv: Conversation,
  opts: CopilotOptions = {},
): Promise<CopilotText> {
  const settings = await settingsOf(opts);
  const last = lastCustomerMessage(conv);
  const lang = detectLanguage(last?.text ?? '') ?? opts.lang ?? 'ru';
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false && conv.messages.length > 0) {
    const res = await runAiText(
      'draft_reply',
      {
        system: systemPrompt(TASKS.draftReply),
        user: `Conversation (oldest first):\n${transcriptForAi(conv, settings.ai.redactPersonalData)}\n\nWrite the seller's reply to the buyer's latest message.`,
        maxTokens: 600,
      },
      { ...opts, settings },
    );
    if (res.ok) {
      const s = sanitizeDraft(res.text, { maxLength: CHAT_MESSAGE_MAX, buyerName: conv.buyerName });
      if (s.text)
        return {
          text: s.text,
          source: 'ai',
          warnings: res.truncated ? [...s.warnings, 'truncated'] : s.warnings,
        };
      aiError = fail('invalid_response', 'The AI answer was empty after removing unsafe content');
    } else {
      aiError = fail(res.reason, res.message);
    }
  }
  const templates = await getDb().templates.toArray();
  const best = last ? rankTemplates(last.text, templates, 1)[0] : undefined;
  if (best) {
    const text = fillBuyerVariables(best.template.body, conv.buyerName);
    return { text, source: 'template', warnings: draftWarnings(text), aiError, templateId: best.template.id };
  }
  const category: QuestionCategory = last ? classifyByRules(last.text).category : 'other';
  return { text: GENERIC_REPLIES[category][lang], source: 'rules', warnings: [], aiError };
}

export async function draftComplaintResponse(
  conv: Conversation,
  opts: CopilotOptions = {},
): Promise<CopilotText> {
  const settings = await settingsOf(opts);
  const last = lastCustomerMessage(conv);
  const lang = detectLanguage(last?.text ?? '') ?? opts.lang ?? 'ru';
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false && conv.messages.length > 0) {
    const res = await runAiText(
      'complaint',
      {
        system: systemPrompt(TASKS.complaint),
        user: `Conversation (oldest first):\n${transcriptForAi(conv, settings.ai.redactPersonalData)}\n\nWrite the seller's reply.`,
        maxTokens: 600,
      },
      { ...opts, settings },
    );
    if (res.ok) {
      const s = sanitizeDraft(res.text, { maxLength: CHAT_MESSAGE_MAX, buyerName: conv.buyerName });
      if (s.text) return { text: s.text, source: 'ai', warnings: s.warnings };
      aiError = fail('invalid_response', 'The AI answer was empty after removing unsafe content');
    } else {
      aiError = fail(res.reason, res.message);
    }
  }
  return { text: COMPLAINT_REPLY[lang], source: 'template', warnings: [], aiError };
}

// ---------------------------------------------------------------------------------------------
// Classification & attention
// ---------------------------------------------------------------------------------------------

export interface ClassificationResult extends Classification {
  source: 'ai' | 'rules';
  aiError?: AiFallbackInfo;
}

export function parseCategoryLabel(answer: string): QuestionCategory | null {
  const a = answer.toLowerCase();
  const direct = a.match(/pre_sale|delivery|problem|refund_request|review|spam_scam|other/);
  if (direct && isQuestionCategory(direct[0])) return direct[0];
  if (/spam|scam/.test(a)) return 'spam_scam';
  if (/refund/.test(a)) return 'refund_request';
  if (/pre[-\s]?sale/.test(a)) return 'pre_sale';
  return null;
}

/** Rules always run; AI (when available and `useAi` is not false) refines the label. */
export async function classifyQuestion(
  text: string,
  opts: CopilotOptions = {},
): Promise<ClassificationResult> {
  const rules = classifyByRules(text);
  if (opts.useAi === false || !text.trim()) return { ...rules, source: 'rules' };
  // Strong scam signals are never overridden: phishing is written to look harmless to a model.
  if (rules.category === 'spam_scam' && rules.confidence >= 0.6) return { ...rules, source: 'rules' };
  const settings = await settingsOf(opts);
  const res = await runAiText(
    'classify',
    {
      system: systemPrompt(TASKS.classify),
      user: `Buyer message:\n${redactForAi(text.slice(0, 2000))}`,
      maxTokens: 20,
      temperature: 0,
    },
    { ...opts, settings },
  );
  if (!res.ok) return { ...rules, source: 'rules', aiError: fail(res.reason, res.message) };
  const label = parseCategoryLabel(res.text);
  if (!label)
    return {
      ...rules,
      source: 'rules',
      aiError: fail('invalid_response', 'The AI answer was not a known category'),
    };
  return {
    category: label,
    confidence: label === rules.category ? Math.max(0.85, rules.confidence) : 0.75,
    matched: [label, ...rules.matched.filter((c) => c !== label)],
    source: 'ai',
  };
}

export interface AttentionCheck extends AttentionResult {
  source: 'rules' | 'ai';
  /** Short reason given by the AI when it flagged the conversation. */
  aiNote?: string;
  aiError?: AiFallbackInfo;
}

/**
 * Rule-based (refund, dispute, scam, staff impersonation, off-platform, angry) — always available.
 * With `useAi: true` the AI may add a flag, but can never clear one raised by the rules.
 */
export async function needsHumanAttention(
  conv: Conversation,
  opts: CopilotOptions = {},
): Promise<AttentionCheck> {
  const rules = detectAttention(customerTexts(conv).slice(-10));
  if (!opts.useAi || conv.messages.length === 0) return { ...rules, source: 'rules' };
  const settings = await settingsOf(opts);
  const lang = opts.lang ?? 'en';
  const res = await runAiText(
    'attention',
    {
      system: systemPrompt(TASKS.attention, { lang: LANG_NAMES[lang] }),
      user: `Conversation (oldest first):\n${transcriptForAi(conv, settings.ai.redactPersonalData)}`,
      maxTokens: 80,
      temperature: 0,
    },
    { ...opts, settings },
  );
  if (!res.ok) return { ...rules, source: 'rules', aiError: fail(res.reason, res.message) };
  const m = res.text.trim().match(/^yes\b[:\s-]*(.*)$/is);
  if (!m) return { ...rules, source: 'ai' };
  return {
    needed: true,
    severity: rules.severity === 'high' ? 'high' : 'medium',
    reasons: rules.reasons,
    source: 'ai',
    aiNote: cleanMultiline(m[1] ?? '', 300) || undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

export interface TemplateSuggestion {
  templateId: string;
  name: string;
  body: string;
  score: number;
}

/** Local keyword ranking over saved templates; with `useAi: true` the AI re-orders the candidates. */
export async function suggestTemplates(
  text: string,
  opts: CopilotOptions & { limit?: number } = {},
): Promise<{ suggestions: TemplateSuggestion[]; source: 'rules' | 'ai'; aiError?: AiFallbackInfo }> {
  const limit = opts.limit ?? 3;
  const templates = await getDb().templates.toArray();
  const ranked = rankTemplates(text, templates, 8);
  const toSuggestion = (t: (typeof templates)[number], score: number): TemplateSuggestion => ({
    templateId: t.id,
    name: t.name,
    body: t.body,
    score,
  });
  const local = ranked.slice(0, limit).map((r) => toSuggestion(r.template, r.score));
  if (!opts.useAi || !text.trim() || templates.length === 0) return { suggestions: local, source: 'rules' };
  const candidates = ranked.length >= 2 ? ranked.map((r) => r.template) : templates.slice(0, 15);
  if (candidates.length < 2) return { suggestions: local, source: 'rules' };
  const list = candidates
    .map(
      (t, i) => `${i + 1}. ${redactForAi(t.name)}: ${redactForAi(t.body.replace(/\s+/g, ' ').slice(0, 160))}`,
    )
    .join('\n');
  const settings = await settingsOf(opts);
  const res = await runAiText(
    'rank_templates',
    {
      system: systemPrompt(TASKS.rankTemplates),
      user: `Buyer message:\n${redactForAi(text.slice(0, 1500))}\n\nTemplates:\n${list}`,
      maxTokens: 20,
      temperature: 0,
    },
    { ...opts, settings },
  );
  if (!res.ok) return { suggestions: local, source: 'rules', aiError: fail(res.reason, res.message) };
  const picked = [...new Set((res.text.match(/\d+/g) ?? []).map(Number))].filter(
    (n) => n >= 1 && n <= candidates.length,
  );
  if (picked.length === 0) return { suggestions: local, source: 'rules' };
  return {
    suggestions: picked.slice(0, limit).map((n, i) => toSuggestion(candidates[n - 1]!, picked.length - i)),
    source: 'ai',
  };
}

// ---------------------------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------------------------

export function summarizeByRules(conv: Conversation, lang: CopilotLang): string {
  const total = conv.messages.length;
  const fromBuyer = conv.messages.filter((m) => m.author === 'customer').length;
  const last = lastCustomerMessage(conv);
  const lines = [summaryText(lang, 'messages', { n: total, c: fromBuyer })];
  if (last) {
    const t = last.text.replace(/\s+/g, ' ').trim();
    lines.push(summaryText(lang, 'buyerLast', { text: t.length > 160 ? `${t.slice(0, 160)}…` : t }));
    lines.push(
      summaryText(lang, 'topic', { topic: categoryLabel(classifyByRules(last.text).category, lang) }),
    );
  } else {
    lines.push(summaryText(lang, 'noCustomer'));
  }
  const lastMsg = conv.messages.at(-1);
  if (lastMsg && lastMsg.author === 'self') lines.push(summaryText(lang, 'sellerLast'));
  const attention = detectAttention(customerTexts(conv).slice(-10));
  lines.push(
    attention.needed
      ? summaryText(lang, 'attention', {
          reasons: attention.reasons.map((r) => attentionLabel(r, lang)).join(', '),
        })
      : summaryText(lang, 'none'),
  );
  return lines.map((l) => `• ${l}`).join('\n');
}

export async function summarizeConversation(
  conv: Conversation,
  opts: CopilotOptions = {},
): Promise<CopilotText> {
  const lang = opts.lang ?? 'en';
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false && conv.messages.length > 0) {
    const settings = await settingsOf(opts);
    const res = await runAiText(
      'summarize',
      {
        system: systemPrompt(TASKS.summarize, { lang: LANG_NAMES[lang] }),
        user: `Conversation (oldest first):\n${transcriptForAi(conv, settings.ai.redactPersonalData)}`,
        maxTokens: 400,
      },
      { ...opts, settings },
    );
    if (res.ok) {
      const text = restorePlaceholder(cleanMultiline(res.text, 3000), '[buyer]', conv.buyerName);
      if (text) return { text, source: 'ai', warnings: [] };
      aiError = fail('invalid_response', 'The AI answer was empty');
    } else {
      aiError = fail(res.reason, res.message);
    }
  }
  return { text: summarizeByRules(conv, lang), source: 'rules', warnings: [], aiError };
}

// ---------------------------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------------------------

export type TranslateResult =
  | ({ status: 'ok' } & CopilotText)
  | { status: 'unavailable'; reason: AiFailureReason | 'unsupported' | 'empty'; message: string };

interface OnDeviceTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}
interface OnDeviceTranslatorFactory {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<OnDeviceTranslator>;
}

/** Chrome's built-in on-device Translator API (no data leaves the device), when present. */
export async function translateOnDevice(
  text: string,
  from: CopilotLang,
  to: CopilotLang,
): Promise<string | null> {
  const factory = (globalThis as { Translator?: OnDeviceTranslatorFactory }).Translator;
  if (!factory || typeof factory.create !== 'function') return null;
  try {
    const availability = await factory.availability({ sourceLanguage: from, targetLanguage: to });
    if (availability === 'unavailable') return null;
    const translator = await factory.create({ sourceLanguage: from, targetLanguage: to });
    try {
      const out = await translator.translate(text);
      return typeof out === 'string' && out.trim() ? out : null;
    } finally {
      translator.destroy?.();
    }
  } catch {
    return null;
  }
}

/** ru ↔ en ↔ uk. AI first (when allowed and available), then the browser's on-device translator. */
export async function translate(
  text: string,
  to: CopilotLang,
  opts: CopilotOptions & { from?: CopilotLang } = {},
): Promise<TranslateResult> {
  const input = text.trim();
  if (!input) return { status: 'unavailable', reason: 'empty', message: 'Nothing to translate' };
  const from = opts.from ?? detectLanguage(input) ?? undefined;
  if (from === to) return { status: 'ok', text: input, source: 'rules', warnings: [] };
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false) {
    const settings = await settingsOf(opts);
    const { text: redacted, restore } = redactForAiReversible(input.slice(0, 4000));
    const res = await runAiText(
      'translate',
      {
        system: systemPrompt(TASKS.translate, { target: LANG_NAMES[to] }),
        user: redacted,
        maxTokens: Math.min(2500, Math.ceil(redacted.length / 2) + 300),
        temperature: 0,
      },
      { ...opts, settings },
    );
    if (res.ok) {
      const out = restore(cleanMultiline(res.text, 8000));
      if (out) return { status: 'ok', text: out, source: 'ai', warnings: res.truncated ? ['truncated'] : [] };
      aiError = fail('invalid_response', 'The AI answer was empty');
    } else {
      aiError = fail(res.reason, res.message);
    }
  }
  if (from) {
    const local = await translateOnDevice(input, from, to);
    if (local) return { status: 'ok', text: local, source: 'local', warnings: [], aiError };
  }
  return {
    status: 'unavailable',
    reason: aiError?.reason ?? 'unsupported',
    message: aiError
      ? `${aiError.message}; no on-device translator is available`
      : 'No translator is available in this browser',
  };
}

// ---------------------------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------------------------

/** Deterministic clean-up: whitespace, repeated punctuation, contacts/foreign links removed. */
export function tidyDescription(text: string): { text: string; warnings: DraftWarning[] } {
  const s = sanitizeDraft(text, { maxLength: 5000 });
  let t = s.text
    .replace(/([!?.,])\1{1,}/g, '$1')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .replace(/([,.!?;:])(?=[\p{L}])/gu, '$1 ')
    .replace(/(^|[.!?]\s+|\n)(\p{Ll})/gu, (_, p: string, c: string) => p + c.toUpperCase());
  t = t.replace(/[ \t]{2,}/g, ' ').trim();
  return { text: t, warnings: s.warnings.filter((w) => w !== 'placeholder_left') };
}

export async function rewriteListingDescription(
  text: string,
  opts: CopilotOptions = {},
): Promise<CopilotText> {
  const lang = detectLanguage(text) ?? opts.lang ?? 'ru';
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false && text.trim()) {
    const settings = await settingsOf(opts);
    const res = await runAiText(
      'rewrite_listing',
      {
        system: systemPrompt(TASKS.rewriteListing, { lang: LANG_NAMES[lang] }),
        user: `Current description:\n${redactForAi(text.slice(0, 5000))}`,
        maxTokens: 1500,
      },
      { ...opts, settings },
    );
    if (res.ok) {
      const s = sanitizeDraft(res.text, { maxLength: 5000 });
      if (s.text) return { text: s.text, source: 'ai', warnings: s.warnings };
      aiError = fail('invalid_response', 'The AI answer was empty after removing unsafe content');
    } else {
      aiError = fail(res.reason, res.message);
    }
  }
  const tidy = tidyDescription(text);
  return { text: tidy.text, source: 'rules', warnings: tidy.warnings, aiError };
}

export type ListingLike = Pick<
  Listing,
  'title' | 'price' | 'amount' | 'active' | 'autoDelivery' | 'categoryName'
> &
  Partial<Pick<Listing, 'titleEn' | 'description' | 'descriptionEn'>>;

export interface MarketContext {
  /** Median buyer price of comparable offers, same currency as the listing. */
  medianPriceMinor: number;
  offers: number;
}

export interface ListingTip {
  id: ListingTipId;
  text: string;
}

export function listingTipsByRules(
  listing: ListingLike,
  lang: CopilotLang,
  market?: MarketContext | null,
): ListingTip[] {
  const tips: ListingTip[] = [];
  const add = (id: ListingTipId, vars?: Record<string, string | number>) =>
    tips.push({ id, text: listingTipText(id, lang, vars) });
  const title = listing.title.trim();
  const letters = title.replace(/[^\p{L}]/gu, '');
  if (title.length < 25) add('title_short');
  if (letters.length >= 8 && letters === letters.toUpperCase() && letters !== letters.toLowerCase())
    add('title_caps');
  if (/([!?.])\1{2,}/.test(title) || (title.match(/\p{Extended_Pictographic}/gu) ?? []).length >= 4)
    add('title_punctuation');
  if (!listing.titleEn?.trim()) add('no_english_title');
  const desc = listing.description?.trim() ?? '';
  if (desc.length < 80) add('description_short');
  if (desc && draftWarnings(desc).includes('off_platform')) add('description_contacts');
  if (!listing.autoDelivery) add('no_auto_delivery');
  if (listing.amount === 0) add('out_of_stock');
  if (!listing.active) add('inactive');
  if (market && market.offers >= 3 && market.medianPriceMinor > 0 && listing.price.amountMinor > 0) {
    const diff = Math.round(
      ((listing.price.amountMinor - market.medianPriceMinor) / market.medianPriceMinor) * 100,
    );
    if (diff >= 15) add('price_above_market', { pct: diff });
    else if (diff <= -25) add('price_below_market', { pct: Math.abs(diff) });
  }
  return tips;
}

export async function suggestListingImprovements(
  listing: ListingLike,
  opts: CopilotOptions & { market?: MarketContext | null } = {},
): Promise<{ tips: ListingTip[]; aiTips: string[]; source: 'rules' | 'ai'; aiError?: AiFallbackInfo }> {
  const lang = opts.lang ?? 'en';
  const tips = listingTipsByRules(listing, lang, opts.market);
  if (!opts.useAi) return { tips, aiTips: [], source: 'rules' };
  const settings = await settingsOf(opts);
  const facts = [
    `Category: ${listing.categoryName || 'unknown'}`,
    `Title: ${redactForAi(listing.title)}`,
    listing.titleEn ? `English title: ${redactForAi(listing.titleEn)}` : 'English title: (none)',
    `Description: ${redactForAi((listing.description ?? '').slice(0, 3000)) || '(none)'}`,
    `Price: ${listing.price.currency === 'UNKNOWN' ? 'unknown' : formatMoney(listing.price, 'en-US')}`,
    `Stock: ${listing.amount ?? 'not shown'}; auto-delivery: ${listing.autoDelivery ? 'on' : 'off'}; active: ${listing.active ? 'yes' : 'no'}`,
  ].join('\n');
  const res = await runAiText(
    'listing_tips',
    { system: systemPrompt(TASKS.listingTips, { lang: LANG_NAMES[lang] }), user: facts, maxTokens: 700 },
    { ...opts, settings },
  );
  if (!res.ok) return { tips, aiTips: [], source: 'rules', aiError: fail(res.reason, res.message) };
  const aiTips = res.text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length > 3)
    .map((l) => sanitizeDraft(l, { maxLength: 400 }).text)
    .filter(Boolean)
    .slice(0, 8);
  return { tips, aiTips, source: 'ai' };
}

// ---------------------------------------------------------------------------------------------
// Sales trend
// ---------------------------------------------------------------------------------------------

export interface SalesPeriodTotals {
  orders: number;
  revenueMinor: number;
  refunds?: number;
}

/** Numeric summary supplied by the caller (FunPro's analytics or the local helper in salesTrend.ts). */
export interface SalesTrendSummary {
  periodLabel: string;
  currency: Currency;
  current: SalesPeriodTotals;
  previous?: SalesPeriodTotals | null;
  topCategories?: { name: string; orders: number; revenueMinor: number }[];
  bestDay?: { date: string; orders: number } | null;
}

function changeLine(
  lang: CopilotLang,
  metric: string,
  from: number | null,
  to: number,
  fmt: (n: number) => string,
): string {
  if (from === null) return trendText(lang, 'flat', { metric, to: fmt(to) });
  if (from === 0)
    return to === 0
      ? trendText(lang, 'flat', { metric, to: fmt(to) })
      : trendText(lang, 'newly', { metric, to: fmt(to) });
  const pct = Math.round(((to - from) / from) * 100);
  if (Math.abs(pct) < 5) return trendText(lang, 'flat', { metric, to: fmt(to) });
  return trendText(lang, pct > 0 ? 'up' : 'down', {
    metric,
    pct: Math.abs(pct),
    from: fmt(from),
    to: fmt(to),
  });
}

export function explainTrendByRules(s: SalesTrendSummary, lang: CopilotLang): string {
  const money = (n: number) =>
    formatMoney(
      { amountMinor: n, currency: s.currency },
      lang === 'en' ? 'en-US' : lang === 'uk' ? 'uk-UA' : 'ru-RU',
    );
  const lines = [trendText(lang, 'period', { label: s.periodLabel })];
  lines.push(
    changeLine(
      lang,
      trendText(lang, 'revenue'),
      s.previous ? s.previous.revenueMinor : null,
      s.current.revenueMinor,
      money,
    ),
  );
  lines.push(
    changeLine(
      lang,
      trendText(lang, 'orders'),
      s.previous ? s.previous.orders : null,
      s.current.orders,
      String,
    ),
  );
  if (s.current.orders > 0)
    lines.push(
      trendText(lang, 'avg', { value: money(Math.round(s.current.revenueMinor / s.current.orders)) }),
    );
  const top = s.topCategories?.[0];
  if (top) lines.push(trendText(lang, 'top', { name: top.name, orders: top.orders }));
  if (s.bestDay && s.bestDay.orders > 0)
    lines.push(trendText(lang, 'best', { date: s.bestDay.date, orders: s.bestDay.orders }));
  if (s.current.refunds) lines.push(trendText(lang, 'refunds', { n: s.current.refunds }));
  return lines.join('\n');
}

export async function explainSalesTrend(
  summary: SalesTrendSummary,
  opts: CopilotOptions = {},
): Promise<CopilotText> {
  const lang = opts.lang ?? 'en';
  let aiError: AiFallbackInfo | undefined;
  if (opts.useAi !== false) {
    const settings = await settingsOf(opts);
    // Only aggregate numbers and the seller's own category names are sent.
    const payload = JSON.stringify({
      period: summary.periodLabel,
      currency: summary.currency,
      current: summary.current,
      previous: summary.previous ?? null,
      topCategories: (summary.topCategories ?? []).slice(0, 5),
      bestDay: summary.bestDay ?? null,
      note: 'Revenue values are in minor units (1/100 of the currency).',
    });
    const res = await runAiText(
      'sales_trend',
      { system: systemPrompt(TASKS.salesTrend, { lang: LANG_NAMES[lang] }), user: payload, maxTokens: 500 },
      { ...opts, settings },
    );
    if (res.ok) {
      const text = cleanMultiline(res.text, 3000);
      if (text) return { text, source: 'ai', warnings: [] };
      aiError = fail('invalid_response', 'The AI answer was empty');
    } else {
      aiError = fail(res.reason, res.message);
    }
  }
  return { text: explainTrendByRules(summary, lang), source: 'rules', warnings: [], aiError };
}

// ---------------------------------------------------------------------------------------------
// Connection test
// ---------------------------------------------------------------------------------------------

/** Sends a fixed test prompt (no user data). Works before consent so the user can check the setup. */
export async function testAiConnection(
  opts: AiRunOptions = {},
): Promise<
  | { ok: true; latencyMs: number; model: string; reply: string }
  | { ok: false; reason: AiFailureReason; message: string }
> {
  const started = Date.now();
  const res = await runAiText(
    'test',
    {
      system: 'You are a connection test. Reply with the single word OK.',
      user: 'Connection test from FunPro. Reply with OK.',
      maxTokens: 16,
      temperature: 0,
    },
    opts,
  );
  if (!res.ok) return res;
  return { ok: true, latencyMs: Date.now() - started, model: res.model, reply: res.text.slice(0, 40) };
}
