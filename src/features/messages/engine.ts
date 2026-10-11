/**
 * Pure template engine (no storage, no browser APIs) — shared by the background, the dashboard and
 * the funpay.com content script.
 *
 * Syntax
 *  - `{name}` inserts one of TEMPLATE_VARIABLES (case-insensitive, e.g. `{buyer}`, `{Order_ID}`).
 *  - `{{` and `}}` produce literal `{` and `}` (so `{{buyer}}` renders as the text `{buyer}`).
 *  - Anything else, including unknown names such as `{foo}` or `{ buyer }`, is left untouched.
 *
 * Safety: there is no expression evaluation of any kind. The body is scanned once and every value
 * is inserted verbatim as plain text, so a value can never introduce another variable (a buyer
 * named "{seller}" stays "{seller}"). Values are normalised with `cleanText` (control, bidi and
 * zero-width characters removed, single line, length-capped).
 */
import { cleanText } from '@/core/security/sanitize';
import type { Money } from '@/shared/models/money';

export const TEMPLATE_VARIABLES = ['buyer', 'order_id', 'product', 'price', 'seller', 'date', 'time', 'chat_url'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
export type TemplateVars = Partial<Record<TemplateVariable, string | null | undefined>>;

const KNOWN = new Set<string>(TEMPLATE_VARIABLES);
const TOKEN = /\{\{|\}\}|\{([A-Za-z_]{1,32})\}/g;
const MAX_VALUE_LENGTH = 300;

export interface RenderResult {
  text: string;
  /** Known variables that appear in the body. */
  used: TemplateVariable[];
  /** Known variables that appear in the body but had no value. */
  missing: TemplateVariable[];
}

export interface RenderOptions {
  /**
   * What to do with a known variable that has no value:
   *  - 'empty' (default): remove it — used only after callers checked `missing`;
   *  - 'keep': leave `{name}` in place so a human notices and fills it in (quick replies).
   */
  missing?: 'empty' | 'keep';
}

export function isTemplateVariable(name: string): name is TemplateVariable {
  return KNOWN.has(name);
}

export function renderTemplate(body: string, vars: TemplateVars, opts: RenderOptions = {}): RenderResult {
  const used = new Set<TemplateVariable>();
  const missing = new Set<TemplateVariable>();
  const text = body.replace(TOKEN, (match: string, rawName: string | undefined) => {
    if (match === '{{') return '{';
    if (match === '}}') return '}';
    const name = (rawName ?? '').toLowerCase();
    if (!isTemplateVariable(name)) return match;
    used.add(name);
    const value = cleanText(vars[name] ?? '', MAX_VALUE_LENGTH);
    if (value) return value;
    missing.add(name);
    return opts.missing === 'keep' ? match : '';
  });
  return { text, used: [...used], missing: [...missing] };
}

/** Variables referenced by a body, split into recognised and unknown names (for the editor). */
export function extractVariables(body: string): { known: TemplateVariable[]; unknown: string[] } {
  const known = new Set<TemplateVariable>();
  const unknown = new Set<string>();
  for (const m of body.matchAll(TOKEN)) {
    if (m[0] === '{{' || m[0] === '}}') continue;
    const name = (m[1] ?? '').toLowerCase();
    if (isTemplateVariable(name)) known.add(name);
    else unknown.add(m[1] ?? '');
  }
  return { known: [...known], unknown: [...unknown] };
}

// ---------------------------------------------------------------------------------------------
// Value formatting
// ---------------------------------------------------------------------------------------------

const CURRENCY_SIGN: Record<Money['currency'], string> = { RUB: '₽', USD: '$', EUR: '€', UAH: '₴', UNKNOWN: '' };

/** Plain, locale-independent price such as "1250.50 ₽" or "40 $" (no grouping separators). */
export function formatPrice(price: Money | null | undefined): string | null {
  if (!price || price.currency === 'UNKNOWN') return null;
  const value = price.amountMinor / 100;
  const num = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return `${num} ${CURRENCY_SIGN[price.currency]}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** DD.MM.YYYY in the seller's local time. */
export function formatDate(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** HH:MM in the seller's local time. */
export function formatTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function chatUrl(chatId: string): string {
  return `https://funpay.com/chat/?node=${encodeURIComponent(chatId)}`;
}

/** Date/time variables for "now". */
export function clockVariables(now: Date): { date: string; time: string } {
  return { date: formatDate(now), time: formatTime(now) };
}

/** Clearly fake sample values used ONLY for previews in the editor. */
export function sampleVariables(now: Date, sellerName?: string | null): Record<TemplateVariable, string> {
  return {
    buyer: 'BuyerName',
    order_id: 'ABCD1234',
    product: 'Sample product',
    price: '100 ₽',
    seller: sellerName || 'YourShop',
    ...clockVariables(now),
    chat_url: chatUrl('users-1000001-2000001'),
  };
}

// ---------------------------------------------------------------------------------------------
// Slash commands
// ---------------------------------------------------------------------------------------------

const COMMAND_RE = /^[\p{L}\p{N}_-]{1,32}$/u;

/** Normalise user input ("/Thanks " → "thanks"); returns null when empty, throws when invalid. */
export function normalizeCommand(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/^\/+/, '').toLowerCase();
  if (!v) return null;
  if (!COMMAND_RE.test(v)) throw new TemplateError('invalid_command');
  return v;
}

/**
 * Detect an active slash query: the text before the caret must be exactly "/" followed by up to 32
 * command characters, i.e. the seller typed "/" at the very start of the message.
 */
export function parseSlashQuery(value: string, caret: number): { query: string; end: number } | null {
  const before = value.slice(0, caret);
  const m = before.match(/^\/([\p{L}\p{N}_-]{0,32})$/u);
  return m ? { query: (m[1] ?? '').toLowerCase(), end: caret } : null;
}

export interface SlashCandidate {
  id: string;
  name: string;
  command: string | null;
  body: string;
}

/** Templates for a slash query: command prefix matches first, then name/command substring matches. */
export function findSlashMatches<T extends SlashCandidate>(templates: readonly T[], query: string, limit = 8): T[] {
  const q = query.toLowerCase();
  const scored: { t: T; score: number }[] = [];
  for (const t of templates) {
    const cmd = (t.command ?? '').toLowerCase();
    const name = t.name.toLowerCase();
    let score = -1;
    if (!q) score = cmd ? 3 : 1;
    else if (cmd === q) score = 5;
    else if (cmd.startsWith(q)) score = 4;
    else if (name.startsWith(q)) score = 3;
    else if (cmd.includes(q) || name.includes(q)) score = 2;
    if (score >= 0) scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score || (a.t.command ?? a.t.name).localeCompare(b.t.command ?? b.t.name));
  return scored.slice(0, limit).map((s) => s.t);
}

export type TemplateErrorCode = 'invalid_command' | 'duplicate_command' | 'invalid_input' | 'not_found';

export class TemplateError extends Error {
  constructor(readonly code: TemplateErrorCode) {
    super(code);
    this.name = 'TemplateError';
  }
}
