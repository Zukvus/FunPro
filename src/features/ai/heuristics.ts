/**
 * Deterministic, offline heuristics used by the copilot: language detection, question
 * classification, "needs human attention" detection and template ranking. They always work —
 * with AI disabled, in local-only mode, or when a provider fails.
 */
import { lintOutgoingText } from '@/core/security/sanitize';
import type { MessageTemplate } from '@/shared/models';

export type CopilotLang = 'en' | 'ru' | 'uk';

export const QUESTION_CATEGORIES = ['pre_sale', 'delivery', 'problem', 'refund_request', 'review', 'spam_scam', 'other'] as const;
export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];

export function isQuestionCategory(v: string): v is QuestionCategory {
  return (QUESTION_CATEGORIES as readonly string[]).includes(v);
}

/** Ukrainian-only letters decide uk; other Cyrillic → ru; Latin → en; null when there is no text. */
export function detectLanguage(text: string): CopilotLang | null {
  if (/[іїєґІЇЄҐ]/.test(text)) return 'uk';
  const cyr = (text.match(/[а-яё]/gi) ?? []).length;
  const lat = (text.match(/[a-z]/gi) ?? []).length;
  if (cyr === 0 && lat === 0) return null;
  return cyr >= lat ? 'ru' : 'en';
}

interface Rule {
  category: Exclude<QuestionCategory, 'other'>;
  weight: number;
  re: RegExp;
}

/** Look-alike FunPay domains used in phishing (funpay.com and sfunpay.com themselves are excluded). */
const LOOKALIKE_DOMAIN = /\b(?!(?:s?funpay)\.com\b)(?:f[uyv]n+-?p[aeо]y|funpau|funpai|fumpay)[a-z0-9-]*\.[a-z]{2,}\b/i;
const ADMIN_CLAIM = /(администрац|поддержк|модератор|служб[\p{L}\p{N}_]*\s+безопасност|арбитр|адміністрац|підтримк|support\s+team|administration|moderator|admin\b|security\s+team)/iu;
const FUNPAY_WORD = /(funpay|фанпей|фанпэй|фп(?![\p{L}\p{N}_]))/iu;
const PRESSURE = /(заблокир|блокировк|бан(?![\p{L}\p{N}_])|забан|срочно|немедленно|в\s+течени[\p{L}\p{N}_]*\s+\d+|перейдите\s+по\s+ссылке|подтвердите\s+(аккаунт|личност|данные)|verify\s+your\s+account|account\s+(will\s+be\s+)?(blocked|suspended|banned)|click\s+(the|this)\s+link|заблоку|терміново)/iu;
const OFF_PLATFORM_PAY = /(опла[тч][\p{L}\p{N}_]*\s+(напрямую|на\s+карт|вне|минуя)|перев[ео]д[\p{L}\p{N}_]*\s+(на\s+карт|деньги\s+на|напрямую)|pay\s+(me\s+|you\s+)?directly|outside\s+(of\s+)?funpay|без\s+комисси|в\s+обход|напряму\s+на\s+карт)/iu;

const RULES: Rule[] = [
  { category: 'spam_scam', weight: 4, re: OFF_PLATFORM_PAY },
  { category: 'spam_scam', weight: 4, re: LOOKALIKE_DOMAIN },
  { category: 'spam_scam', weight: 3, re: /(t\.me\/|discord\.gg|whatsapp|ватсап|viber|вайбер|telegram|телеграм|телеграмм|дискорд|discord)/i },
  { category: 'spam_scam', weight: 2, re: /(заработ[\p{L}\p{N}_]*\s+(от|до)\s+\d|earn\s+\$?\d+|casino|казино|ставк[\p{L}\p{N}_]*\s+на\s+спорт|инвестиц)/iu },
  { category: 'refund_request', weight: 4, re: /(возврат|верн[\p{L}\p{N}_]*\s+(мне\s+)?(деньги|средства|оплату)|вернуть\s+деньги|refund|money\s+back|chargeback|повернен|поверн[\p{L}\p{N}_]*\s+(мені\s+)?(гроші|кошти)|отмен[\p{L}\p{N}_]*\s+заказ|cancel\s+(the\s+|my\s+)?order|скасу[\p{L}\p{N}_]*\s+замовлен)/iu },
  { category: 'refund_request', weight: 2, re: /(арбитраж|спор(?![\p{L}\p{N}_])|dispute|жалоб|complaint|скарг)/iu },
  { category: 'problem', weight: 3, re: /(не\s+работает|не\s+работают|не\s+заходит|не\s+подходит|не\s+активир|ошибк|проблем|сломал|не\s+могу\s+(войти|зайти|активир)|невалид|забанен|бан\s+аккаунт|doesn'?t\s+work|does\s+not\s+work|not\s+working|error|problem|issue|broken|invalid|can'?t\s+(log\s*in|login|activate)|не\s+працює|помилк|проблем|не\s+можу)/i },
  { category: 'delivery', weight: 3, re: /(когда\s+(будет|получу|отправ|выдад|придет|придёт)|где\s+(мой\s+)?(товар|заказ|ключ|аккаунт)|не\s+(получил|пришел|пришёл|пришло|выдали)|долго|жду|ожидаю|отправьте|выдайте|скиньте|доставк|when\s+(will|do)\s+i\s+(get|receive)|haven'?t\s+(got|received)|didn'?t\s+(get|receive)|where\s+is\s+my|delivery|still\s+waiting|коли\s+(буде|отримаю)|не\s+отримав|чекаю|доставк)/i },
  { category: 'pre_sale', weight: 2, re: /(есть\s+в\s+наличии|в\s+наличии|наличи|сколько\s+(стоит|будет)|цен[аыу]|скидк|а\s+можно|подойд[её]т\s+ли|работает\s+ли|есть\s+ли|можно\s+ли|хочу\s+купить|перед\s+покупкой|available|in\s+stock|how\s+much|price|discount|does\s+it\s+work|is\s+it\s+possible|can\s+i\s+buy|before\s+(i\s+)?buy|є\s+в\s+наявност|наявн|скільки\s+кошту|ціна|знижк|чи\s+можна)/i },
  { category: 'review', weight: 3, re: /(отзыв|оценк|звезд|звёзд|review|feedback|rating|stars?\b|відгук|оцінк|зірк)/iu },
];

export interface Classification {
  category: QuestionCategory;
  /** 0..1, rough. */
  confidence: number;
  /** Categories that matched, strongest first. */
  matched: QuestionCategory[];
}

const PRIORITY: QuestionCategory[] = ['spam_scam', 'refund_request', 'problem', 'delivery', 'pre_sale', 'review', 'other'];

export function classifyByRules(text: string): Classification {
  const scores = new Map<QuestionCategory, number>();
  for (const r of RULES) if (r.re.test(text)) scores.set(r.category, (scores.get(r.category) ?? 0) + r.weight);
  if (isAdminImpersonation(text)) scores.set('spam_scam', (scores.get('spam_scam') ?? 0) + 5);
  if (scores.size === 0) return { category: 'other', confidence: 0.3, matched: [] };
  const matched = [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || PRIORITY.indexOf(a[0]) - PRIORITY.indexOf(b[0]))
    .map(([c]) => c);
  const best = matched[0]!;
  const top = scores.get(best)!;
  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  return { category: best, confidence: Math.min(0.95, 0.4 + (top / total) * 0.4 + Math.min(top, 6) * 0.03), matched };
}

/** A buyer claiming to be FunPay staff (genuine admin messages come as system messages, not from buyers). */
export function isAdminImpersonation(text: string): boolean {
  if (LOOKALIKE_DOMAIN.test(text)) return true;
  return ADMIN_CLAIM.test(text) && (FUNPAY_WORD.test(text) || PRESSURE.test(text));
}

export type AttentionReason = 'refund' | 'dispute' | 'scam' | 'admin_impersonation' | 'off_platform' | 'angry';

const ANGRY = /(обман|обманул|кинул|кидал|мошенни|развод|разводил|ужас|отвратит|позор|бесит|идиот|дебил|урод|твар|сука|бля|хуй|хуе|пизд|ебан|scam+er|scam\b|fraud|worst|terrible|disgust|furious|wtf|fuck|idiot|stupid|liar|report\s+you|шахра|ошука|жахлив|брехун)/iu;
const DISPUTE = /(арбитраж|открою\s+спор|спор(?![\p{L}\p{N}_])|dispute|chargeback|жалоб[\p{L}\p{N}_]*\s+(в\s+)?(поддержк|администрац)|напишу\s+в\s+поддержку|report\s+(you|to\s+support)|скарг)/iu;

export interface AttentionResult {
  needed: boolean;
  severity: 'none' | 'medium' | 'high';
  reasons: AttentionReason[];
}

function shouting(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length < 12) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
  return upper / letters.length > 0.7;
}

/** Rule-based check over the buyer's messages. */
export function detectAttention(customerTexts: readonly string[]): AttentionResult {
  const reasons = new Set<AttentionReason>();
  for (const text of customerTexts) {
    if (!text.trim()) continue;
    const cls = classifyByRules(text);
    if (cls.matched.includes('refund_request') && /(возврат|верн|refund|money\s+back|chargeback|повернен|поверн|отмен|cancel|скасу)/i.test(text)) reasons.add('refund');
    if (DISPUTE.test(text)) reasons.add('dispute');
    if (isAdminImpersonation(text)) reasons.add('admin_impersonation');
    if (OFF_PLATFORM_PAY.test(text) || LOOKALIKE_DOMAIN.test(text)) reasons.add('scam');
    if (lintOutgoingText(text).length > 0) reasons.add('off_platform');
    if (ANGRY.test(text) || shouting(text) || /!{3,}/.test(text)) reasons.add('angry');
  }
  const list = [...reasons];
  const high = list.some((r) => r === 'refund' || r === 'dispute' || r === 'scam' || r === 'admin_impersonation');
  return { needed: list.length > 0, severity: list.length === 0 ? 'none' : high ? 'high' : 'medium', reasons: list };
}

// ---------------------------------------------------------------------------------------------
// Template ranking
// ---------------------------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the', 'and', 'for', 'you', 'are', 'can', 'this', 'that', 'with', 'have', 'what', 'how', 'please', 'hello', 'hi', 'thanks',
  'что', 'как', 'это', 'для', 'вас', 'мне', 'меня', 'или', 'так', 'уже', 'еще', 'ещё', 'здравствуйте', 'привет', 'добрый', 'день', 'пожалуйста', 'спасибо',
  'що', 'як', 'для', 'мені', 'вітаю', 'будь', 'ласка', 'дякую',
]);

/** Lower-cased word stems (first 5 letters) — crude but effective for inflected RU/UK words. */
export function stems(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const out = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w)) continue;
    out.add(w.slice(0, 5));
  }
  return [...out];
}

export interface RankedTemplate {
  template: MessageTemplate;
  score: number;
}

export function rankTemplates(message: string, templates: readonly MessageTemplate[], limit = 5): RankedTemplate[] {
  const query = stems(message);
  if (query.length === 0 || templates.length === 0) return [];
  const lang = detectLanguage(message);
  const category = classifyByRules(message).category;
  const ranked: RankedTemplate[] = [];
  for (const t of templates) {
    const strong = new Set([...stems(t.name), ...stems(t.command ?? ''), ...t.tags.flatMap((tag) => stems(tag))]);
    const weak = new Set(stems(t.body));
    let score = 0;
    for (const q of query) {
      if (strong.has(q)) score += 3;
      else if (weak.has(q)) score += 1;
    }
    if (score === 0) continue;
    if (t.tags.some((tag) => tag.toLowerCase() === category)) score += 2;
    if (lang && t.lang !== 'any') score += t.lang === lang ? 1 : -1;
    ranked.push({ template: t, score });
  }
  return ranked.sort((a, b) => b.score - a.score || a.template.name.localeCompare(b.template.name)).slice(0, limit);
}
