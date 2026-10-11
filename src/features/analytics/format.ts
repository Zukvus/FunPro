/**
 * Plain-text money/number formatting for texts that leave the UI (support-ticket drafts, Telegram
 * summaries, exports). Uses ordinary ASCII spaces so pasted text never carries invisible
 * characters. UI components use `formatMoney` (Intl) instead.
 */
import type { Currency } from '@/shared/models';

export type TextLang = 'ru' | 'en' | 'uk';

const SYMBOL: Record<Currency, string> = { RUB: '₽', USD: '$', EUR: '€', UAH: '₴', UNKNOWN: '?' };
const CURRENCY_ORDER: readonly Currency[] = ['RUB', 'USD', 'EUR', 'UAH', 'UNKNOWN'];

function group(intPart: string, sep: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** 125050, RUB → "1 250,50 ₽" (ru/uk) or "1,250.50 RUB" (en). */
export function formatMinorPlain(minor: number, currency: Currency, lang: TextLang): string {
  const negative = minor < 0;
  const abs = Math.abs(Math.round(minor));
  const intPart = String(Math.floor(abs / 100));
  const frac = String(abs % 100).padStart(2, '0');
  const sign = negative ? '-' : '';
  if (lang === 'en') return `${sign}${group(intPart, ',')}.${frac} ${currency === 'UNKNOWN' ? '(unknown currency)' : currency}`;
  return `${sign}${group(intPart, ' ')},${frac} ${SYMBOL[currency]}`;
}

/** "1 250,50 ₽ · 40,00 $" — one entry per currency, never summed across currencies. */
export function formatByCurrencyPlain(amounts: Partial<Record<Currency, number>>, lang: TextLang, sep = ' · '): string {
  const parts = CURRENCY_ORDER.filter((c) => (amounts[c] ?? 0) !== 0).map((c) => formatMinorPlain(amounts[c]!, c, lang));
  return parts.length ? parts.join(sep) : '0';
}

export function formatPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Signed relative change, e.g. "+12.5%"; "—" when the base is zero/unknown. */
export function formatDeltaPct(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const pct = value * 100;
  const s = pct.toFixed(digits);
  return pct > 0 ? `+${s}%` : `${s}%`;
}

/** Major units for exports (decimal, 2 digits). */
export function minorToMajor(minor: number): number {
  return Math.round(minor) / 100;
}
