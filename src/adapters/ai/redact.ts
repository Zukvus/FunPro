/**
 * Data minimisation for text sent to an AI provider. Always removes: FunPay order ids and links,
 * FunPay user ids / profile and chat links, e-mail addresses, phone and card-like numbers and
 * anything that looks like a credential, key or token. Optionally replaces known names (buyer,
 * seller) with placeholders — controlled by `settings.ai.redactPersonalData`.
 *
 * Placeholders are bracketed English words ("[order]", "[buyer]") so prompts can tell the model to
 * keep them verbatim. `redactForAiReversible` uses numbered references instead and restores the
 * originals locally (e.g. after translating the seller's own reply) — the provider never sees them.
 */
import { redactString } from '@/core/log/redact';

export interface NamePlaceholder {
  name: string;
  placeholder: string;
}

export interface RedactForAiOptions {
  /** Names to replace (applied when the user enabled personal-data redaction). */
  names?: readonly NamePlaceholder[];
}

const FUNPAY_LINK = /\bhttps?:\/\/(?:[a-z0-9-]+\.)*s?funpay\.com\/[^\s<>"')\]]*/gi;
const RELATIVE_FUNPAY_PATH = /(?<![\w.])\/(?:(?:en|uk)\/)?(?:orders|users|chat)\/[^\s<>"')\]]*/gi;
const CHAT_NODE = /\busers-\d+-\d+\b/g;
const USER_ID_LABEL = /(?<![\p{L}\p{N}_])(?:user\s*id|id|айди|ид)\s*[:#№]?\s*\d{4,}(?!\d)/giu;
const ORDER_ID = /#[A-Z0-9]{8}\b/g;
/** login:password / email:password pairs (left side needs a Latin letter, so times like 12:30 survive). */
const CREDENTIAL_PAIR = /(?<![\w/@.:-])[A-Za-z0-9._%+@-]*[A-Za-z][A-Za-z0-9._%+@-]*:(?!\/\/|[#[])\S{4,}/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** Digit runs (with spaces, dashes, dots or brackets) long enough to be phones or card numbers. */
const LONG_NUMBER = /(?<![\w])\+?\d[\d\s().-]{8,}\d(?![\w])/g;
const DATE_INSIDE = /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/;
/** Activation-key shapes such as ABCD1-EFGH2-IJKL3 (upper-case groups only, to spare prose). */
const KEY_LIKE = /\b[A-Z0-9]{4,}(?:-[A-Z0-9]{4,}){2,}\b/g;
const MIXED_TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g;

function classifyFunPayLink(url: string): string {
  if (/\/orders\//i.test(url)) return '[order-link]';
  if (/\/users\//i.test(url)) return '[user-link]';
  if (/\/chat\//i.test(url)) return '[chat-link]';
  return '[funpay-link]';
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `placeholder` is the generic label; the replacer decides what actually goes into the text. */
type Replacer = (placeholder: string, original: string) => string;

function redactWith(input: string, opts: RedactForAiOptions, replace: Replacer): string {
  let text = input;
  text = text.replace(FUNPAY_LINK, (m) => replace(classifyFunPayLink(m), m));
  text = text.replace(RELATIVE_FUNPAY_PATH, (m) => replace(classifyFunPayLink(m), m));
  text = text.replace(CHAT_NODE, (m) => replace('[chat]', m));
  text = text.replace(ORDER_ID, (m) => replace('#[order]', m));
  text = text.replace(CREDENTIAL_PAIR, (m) => replace('[credentials]', m));
  text = text.replace(EMAIL, (m) => replace('[email]', m));
  text = text.replace(USER_ID_LABEL, (m) => replace('[user-id]', m));
  text = text.replace(LONG_NUMBER, (m) => {
    if (DATE_INSIDE.test(m)) return m;
    const digits = m.replace(/\D/g, '').length;
    if (digits < 10) return m;
    return replace(digits >= 16 ? '[number]' : '[phone]', m);
  });
  text = text.replace(KEY_LIKE, (m) => replace('[key]', m));
  text = text.replace(MIXED_TOKEN, (m) => replace('[token]', m));
  // Generic secret shapes (bot tokens, sk- keys, bearer tokens, long hex) — never restored.
  text = redactString(text, Number.MAX_SAFE_INTEGER);
  for (const { name, placeholder } of opts.names ?? []) {
    const n = name.trim();
    if (n.length < 2) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegExp(n)}(?![\\p{L}\\p{N}_])`, 'giu');
    text = text.replace(re, (m) => replace(placeholder, m));
  }
  return text;
}

export function redactForAi(input: string, opts: RedactForAiOptions = {}): string {
  return redactWith(input, opts, (placeholder) => placeholder);
}

/**
 * Like `redactForAi`, but each removed value becomes a numbered reference (`[ref1]`, `[ref2]`, …)
 * that `restore` puts back locally. Credentials/keys/tokens are still never restored.
 */
export function redactForAiReversible(
  input: string,
  opts: RedactForAiOptions = {},
): { text: string; restore: (s: string) => string } {
  const originals: string[] = [];
  const NEVER_RESTORE = new Set(['[credentials]', '[key]', '[token]']);
  const text = redactWith(input, opts, (placeholder, original) => {
    if (NEVER_RESTORE.has(placeholder)) return placeholder;
    originals.push(original);
    return `[ref${originals.length}]`;
  });
  return {
    text,
    restore: (s: string) => s.replace(/\[ref(\d+)\]/g, (m, n: string) => originals[Number(n) - 1] ?? m),
  };
}

/** Puts a locally known name back into a draft that used the placeholder. */
export function restorePlaceholder(
  text: string,
  placeholder: string,
  value: string | null | undefined,
): string {
  if (!value) return text;
  return text.split(placeholder).join(value);
}
