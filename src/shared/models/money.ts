import { z } from 'zod';

/**
 * Money is stored in integer minor units (kopecks / cents) to avoid floating-point drift.
 * Currencies are never converted implicitly — see `convertWithRate` which requires an explicit,
 * timestamped rate supplied by the user or a verified source.
 */
export const CurrencySchema = z.enum(['RUB', 'USD', 'EUR', 'UAH', 'UNKNOWN']);
export type Currency = z.infer<typeof CurrencySchema>;

export const MoneySchema = z.object({
  amountMinor: z.number().int(),
  currency: CurrencySchema,
});
export type Money = z.infer<typeof MoneySchema>;

const SYMBOLS: Record<string, Currency> = {
  '₽': 'RUB',
  руб: 'RUB',
  rub: 'RUB',
  $: 'USD',
  usd: 'USD',
  '€': 'EUR',
  eur: 'EUR',
  '₴': 'UAH',
  грн: 'UAH',
  uah: 'UAH',
};

export function detectCurrency(text: string): Currency {
  const lower = text.toLowerCase();
  for (const [sym, cur] of Object.entries(SYMBOLS)) {
    if (lower.includes(sym)) return cur;
  }
  return 'UNKNOWN';
}

/**
 * Parse a localized number such as "1 234,56", "1,234.56", "1234.5", "12 345" (with NBSP / thin spaces).
 * Returns null when the text does not contain a parseable number.
 */
export function parseLocalizedNumber(text: string): number | null {
  const cleaned = text.replace(/[\s\u00a0\u202f\u2009]/g, '').replace(/[^\d.,-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // The right-most separator is the decimal separator.
    const decimalSep = lastComma > lastDot ? ',' : '.';
    const thousandSep = decimalSep === ',' ? '.' : ',';
    normalized = cleaned.split(thousandSep).join('').replace(decimalSep, '.');
  } else if (lastComma >= 0) {
    const decimals = cleaned.length - lastComma - 1;
    const commaCount = cleaned.split(',').length - 1;
    // "1,234" with exactly three trailing digits and a single comma is ambiguous; FunPay uses
    // comma as a decimal separator in RU locale and spaces for thousands, so treat a single comma
    // with 1–2 decimals as decimal, otherwise as thousands.
    normalized =
      commaCount === 1 && decimals > 0 && decimals <= 2
        ? cleaned.replace(',', '.')
        : cleaned.split(',').join('');
  } else {
    const dotCount = cleaned.split('.').length - 1;
    normalized = dotCount > 1 ? cleaned.split('.').join('') : cleaned;
  }
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

export function toMinor(value: number): number {
  return Math.round(value * 100);
}

export function fromMinor(minor: number): number {
  return minor / 100;
}

export function parseMoney(text: string, fallbackCurrency: Currency = 'UNKNOWN'): Money | null {
  const value = parseLocalizedNumber(text);
  if (value === null) return null;
  const currency = detectCurrency(text);
  return { amountMinor: toMinor(value), currency: currency === 'UNKNOWN' ? fallbackCurrency : currency };
}

const CURRENCY_CODES: Record<Currency, string | null> = {
  RUB: 'RUB',
  USD: 'USD',
  EUR: 'EUR',
  UAH: 'UAH',
  UNKNOWN: null,
};

export function formatMoney(money: Money, locale = 'ru-RU'): string {
  const code = CURRENCY_CODES[money.currency];
  const value = fromMinor(money.amountMinor);
  if (!code) return `${value.toLocaleString(locale, { maximumFractionDigits: 2 })} ?`;
  return value.toLocaleString(locale, { style: 'currency', currency: code, maximumFractionDigits: 2 });
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} and ${b.currency} without an explicit exchange rate`);
  }
  return { amountMinor: a.amountMinor + b.amountMinor, currency: a.currency };
}

/** Sum amounts grouped by currency. Never mixes currencies. */
export function sumByCurrency(items: readonly Money[]): Partial<Record<Currency, number>> {
  const out: Partial<Record<Currency, number>> = {};
  for (const m of items) out[m.currency] = (out[m.currency] ?? 0) + m.amountMinor;
  return out;
}

export const ExchangeRateSchema = z.object({
  from: CurrencySchema,
  to: CurrencySchema,
  rate: z.number().positive(),
  source: z.string().min(1),
  /** ISO timestamp when the rate was observed. */
  at: z.string(),
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

export function convertWithRate(money: Money, rate: ExchangeRate): Money {
  if (money.currency !== rate.from) throw new Error('Exchange rate does not match source currency');
  return { amountMinor: Math.round(money.amountMinor * rate.rate), currency: rate.to };
}
