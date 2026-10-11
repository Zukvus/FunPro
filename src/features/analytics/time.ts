/**
 * Calendar arithmetic for analytics in a FIXED UTC offset.
 *
 * FunPay shows every date in Moscow time (UTC+3, no DST since 2014), so analytics group days, weeks
 * and months in Moscow time by default: "today" in FunPro means the same as "сегодня" on FunPay.
 * Everything here is integer arithmetic on epoch milliseconds (no Date objects per order), which
 * keeps aggregation over tens of thousands of orders fast.
 */
import { FUNPAY_UTC_OFFSET_MINUTES } from '@/core/util/time';

export const MSK_OFFSET_MINUTES = FUNPAY_UTC_OFFSET_MINUTES;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/** Half-open interval [from, to) in epoch milliseconds. */
export interface DateRange {
  from: number;
  to: number;
}

export type RangePreset = '7d' | '30d' | '90d' | 'thisMonth' | 'lastMonth' | 'custom';
export const RANGE_PRESETS: readonly RangePreset[] = ['7d', '30d', '90d', 'thisMonth', 'lastMonth', 'custom'];
export type Granularity = 'day' | 'week' | 'month';

export interface ZonedParts {
  year: number;
  /** 0-based month. */
  month: number;
  day: number;
  hour: number;
  /** ISO weekday index: 0 = Monday … 6 = Sunday. */
  weekday: number;
}

export function zonedParts(ts: number, offsetMinutes = MSK_OFFSET_MINUTES): ZonedParts {
  const d = new Date(ts + offsetMinutes * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    weekday: (d.getUTCDay() + 6) % 7,
  };
}

/** Epoch ms of local midnight (in the offset) for a calendar date; month/day may overflow (Date.UTC semantics). */
export function zonedMidnight(year: number, month: number, day: number, offsetMinutes = MSK_OFFSET_MINUTES): number {
  return Date.UTC(year, month, day) - offsetMinutes * 60_000;
}

export function startOfZonedDay(ts: number, offsetMinutes = MSK_OFFSET_MINUTES): number {
  const off = offsetMinutes * 60_000;
  return Math.floor((ts + off) / DAY_MS) * DAY_MS - off;
}

/** Monday 00:00 of the ISO week containing `ts`. */
export function startOfZonedWeek(ts: number, offsetMinutes = MSK_OFFSET_MINUTES): number {
  const day = startOfZonedDay(ts, offsetMinutes);
  return day - zonedParts(day, offsetMinutes).weekday * DAY_MS;
}

export function startOfZonedMonth(ts: number, offsetMinutes = MSK_OFFSET_MINUTES): number {
  const p = zonedParts(ts, offsetMinutes);
  return zonedMidnight(p.year, p.month, 1, offsetMinutes);
}

export function bucketStart(ts: number, granularity: Granularity, offsetMinutes = MSK_OFFSET_MINUTES): number {
  if (granularity === 'day') return startOfZonedDay(ts, offsetMinutes);
  if (granularity === 'week') return startOfZonedWeek(ts, offsetMinutes);
  return startOfZonedMonth(ts, offsetMinutes);
}

export function nextBucketStart(start: number, granularity: Granularity, offsetMinutes = MSK_OFFSET_MINUTES): number {
  if (granularity === 'day') return start + DAY_MS;
  if (granularity === 'week') return start + 7 * DAY_MS;
  const p = zonedParts(start, offsetMinutes);
  return zonedMidnight(p.year, p.month + 1, 1, offsetMinutes);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "YYYY-MM-DD" of the local (offset) calendar day. */
export function dayKey(ts: number, offsetMinutes = MSK_OFFSET_MINUTES): string {
  const p = zonedParts(ts, offsetMinutes);
  return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
}

/**
 * Stable, sortable key of a bucket: day → "YYYY-MM-DD", week → "YYYY-MM-DD" of its Monday,
 * month → "YYYY-MM".
 */
export function bucketKey(ts: number, granularity: Granularity, offsetMinutes = MSK_OFFSET_MINUTES): string {
  const start = bucketStart(ts, granularity, offsetMinutes);
  if (granularity === 'month') {
    const p = zonedParts(start, offsetMinutes);
    return `${p.year}-${pad(p.month + 1)}`;
  }
  return dayKey(start, offsetMinutes);
}

export interface Bucket {
  key: string;
  start: number;
  end: number;
}

/** All buckets overlapping the range, in order (used to gap-fill empty periods with zeros). */
export function enumerateBuckets(range: DateRange, granularity: Granularity, offsetMinutes = MSK_OFFSET_MINUTES, max = 2000): Bucket[] {
  const out: Bucket[] = [];
  if (!(range.to > range.from)) return out;
  let start = bucketStart(range.from, granularity, offsetMinutes);
  while (start < range.to && out.length < max) {
    const end = nextBucketStart(start, granularity, offsetMinutes);
    out.push({ key: bucketKey(start, granularity, offsetMinutes), start, end });
    start = end;
  }
  return out;
}

/** Parse "YYYY-MM-DD" (an <input type="date"> value) as local midnight in the offset. */
export function parseDayInput(value: string, offsetMinutes = MSK_OFFSET_MINUTES): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
  return zonedMidnight(y, mo, d, offsetMinutes);
}

/** Inclusive day inputs → half-open range. Swaps the ends when they are reversed. */
export function rangeFromDayInputs(fromDay: string, toDay: string, offsetMinutes = MSK_OFFSET_MINUTES): DateRange | null {
  const a = parseDayInput(fromDay, offsetMinutes);
  const b = parseDayInput(toDay, offsetMinutes);
  if (a === null || b === null) return null;
  const from = Math.min(a, b);
  const to = Math.max(a, b) + DAY_MS;
  return { from, to };
}

export interface CustomRangeInput {
  from: string;
  to: string;
}

/**
 * Resolve a preset to a concrete range. Rolling presets end at the end of "today" (Moscow), so the
 * current day is included; month presets follow calendar months.
 */
export function resolveRange(preset: RangePreset, now: number, custom?: CustomRangeInput | null, offsetMinutes = MSK_OFFSET_MINUTES): DateRange {
  const endOfToday = startOfZonedDay(now, offsetMinutes) + DAY_MS;
  switch (preset) {
    case '7d':
      return { from: endOfToday - 7 * DAY_MS, to: endOfToday };
    case '30d':
      return { from: endOfToday - 30 * DAY_MS, to: endOfToday };
    case '90d':
      return { from: endOfToday - 90 * DAY_MS, to: endOfToday };
    case 'thisMonth':
      return { from: startOfZonedMonth(now, offsetMinutes), to: endOfToday };
    case 'lastMonth': {
      const thisMonth = startOfZonedMonth(now, offsetMinutes);
      return { from: startOfZonedMonth(thisMonth - 1, offsetMinutes), to: thisMonth };
    }
    case 'custom': {
      const r = custom ? rangeFromDayInputs(custom.from, custom.to, offsetMinutes) : null;
      return r ?? { from: endOfToday - 30 * DAY_MS, to: endOfToday };
    }
  }
}

/**
 * The comparison period for period-over-period deltas.
 *  - month presets compare with the previous calendar month (month-to-date compares with the same
 *    number of days of the previous month, never more than that whole month);
 *  - every other range compares with the immediately preceding range of equal length.
 */
export function previousRange(range: DateRange, preset: RangePreset = 'custom', offsetMinutes = MSK_OFFSET_MINUTES): DateRange {
  if (preset === 'thisMonth' || preset === 'lastMonth') {
    const prevStart = startOfZonedMonth(range.from - 1, offsetMinutes);
    const prevEnd = range.from;
    return { from: prevStart, to: Math.min(prevEnd, prevStart + (range.to - range.from)) };
  }
  const len = range.to - range.from;
  return { from: range.from - len, to: range.from };
}

/** Day buckets up to ~2 months, weeks up to ~1 year, months beyond. */
export function autoGranularity(range: DateRange): Granularity {
  const days = (range.to - range.from) / DAY_MS;
  if (days <= 62) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

export function inRange(ts: number, range: DateRange): boolean {
  return ts >= range.from && ts < range.to;
}

/** ISO string of an epoch ms (for IndexedDB index ranges on ISO-string fields). */
export function iso(ts: number): string {
  return new Date(ts).toISOString();
}

/** Display label of a bucket key for charts/tables, e.g. "05.11", "05.11–11.11", "11.2024". */
export function bucketLabel(key: string, granularity: Granularity): string {
  if (granularity === 'month') {
    const [y, m] = key.split('-');
    return `${m}.${y}`;
  }
  const [y, m, d] = key.split('-');
  if (granularity === 'day') return `${d}.${m}`;
  // Week: Monday – Sunday.
  const start = Date.UTC(Number(y), Number(m) - 1, Number(d));
  const end = new Date(start + 6 * DAY_MS);
  return `${d}.${m}–${pad(end.getUTCDate())}.${pad(end.getUTCMonth() + 1)}`;
}

/** Format an epoch/ISO timestamp as "DD.MM.YYYY HH:MM" in the offset (Moscow by default). */
export function formatZoned(value: number | string | null | undefined, offsetMinutes = MSK_OFFSET_MINUTES, withTime = true): string {
  if (value === null || value === undefined || value === '') return '';
  const ts = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ts)) return '';
  const d = new Date(ts + offsetMinutes * 60_000);
  const date = `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  return withTime ? `${date} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

/** "YYYY-MM-DD" in the offset — the value format of <input type="date">. */
export function toDayInput(ts: number, offsetMinutes = MSK_OFFSET_MINUTES): string {
  return dayKey(ts, offsetMinutes);
}
