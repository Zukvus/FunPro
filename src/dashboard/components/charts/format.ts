import { formatMoney, type Currency } from '@/shared/models/money';
import type { Lang } from '@/ui/i18n';

export function localeOf(lang: Lang): string {
  return lang === 'ru' ? 'ru-RU' : lang === 'uk' ? 'uk-UA' : 'en-US';
}

export function fmtMoney(minor: number, currency: Currency, lang: Lang): string {
  return formatMoney({ amountMinor: Math.round(minor), currency }, localeOf(lang));
}

/** Money in major units with compact notation for axis ticks (e.g. "12K"). */
export function fmtCompactMajor(minor: number, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(
    minor / 100,
  );
}

export function fmtCompact(n: number, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

export function fmtInt(n: number, lang: Lang): string {
  return new Intl.NumberFormat(localeOf(lang), { maximumFractionDigits: 0 }).format(n);
}

/** 0.1234 → "12.3%". */
export function fmtRatio(v: number | null, lang: Lang, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(localeOf(lang), {
    style: 'percent',
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(v);
}

/** Signed relative change; "—" without a base. */
export function fmtDelta(v: number | null, lang: Lang): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const s = new Intl.NumberFormat(localeOf(lang), {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(v);
  return s;
}

/** Percentage-point difference of two ratios, e.g. "+1.2 pp". */
export function fmtPp(v: number | null, lang: Lang, unit: string): string {
  if (v === null || !Number.isFinite(v)) return '—';
  const s = new Intl.NumberFormat(localeOf(lang), {
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(v * 100);
  return `${s} ${unit}`;
}

export function fmtDateTime(
  ts: number | string | null | undefined,
  lang: Lang,
  opts: { time?: boolean } = {},
): string {
  if (ts === null || ts === undefined || ts === '') return '—';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '—';
  return new Intl.DateTimeFormat(localeOf(lang), {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(opts.time === false ? {} : { hour: '2-digit', minute: '2-digit' }),
  }).format(t);
}

/** Relative "x min/h/d ago" in the UI language. */
export function fmtRelative(ts: number | null | undefined, lang: Lang, now = Date.now()): string {
  if (!ts) return '—';
  const diff = ts - now;
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}
