/** Returns minutes since midnight for "HH:MM". */
export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map((x) => Number.parseInt(x, 10));
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when `date` (local time) falls inside [start, end), supporting windows that cross midnight. */
export function isWithinWindow(date: Date, start: string, end: string): boolean {
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  const cur = date.getHours() * 60 + date.getMinutes();
  if (s === e) return false;
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

/** Next Date (strictly after `from`) at which the window [start, end) ends. */
export function nextWindowEnd(from: Date, end: string): Date {
  const e = hhmmToMinutes(end);
  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setHours(Math.floor(e / 60), e % 60);
  if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
  return d;
}

const RU_MONTHS: Record<string, number> = {
  января: 0, февраля: 1, марта: 2, апреля: 3, мая: 4, июня: 5, июля: 6, августа: 7, сентября: 8, октября: 9, ноября: 10, декабря: 11,
  январь: 0, февраль: 1, март: 2, апрель: 3, май: 4, июнь: 5, июль: 6, август: 7, сентябрь: 8, октябрь: 9, ноябрь: 10, декабрь: 11,
};
const EN_MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};
const UK_MONTHS: Record<string, number> = {
  січня: 0, лютого: 1, березня: 2, квітня: 3, травня: 4, червня: 5, липня: 6, серпня: 7, вересня: 8, жовтня: 9, листопада: 10, грудня: 11,
};

/** FunPay displays dates in Moscow time (UTC+3, no DST since 2014). */
export const FUNPAY_UTC_OFFSET_MINUTES = 180;

/**
 * Parse FunPay-style human dates such as:
 *  "12 марта 2024, 14:05", "11 августа 2022 в 18:12", "сегодня, 14:05", "вчера, 09:00", "14:05",
 *  "12 March 2024, 14:05", "Today, 14:05", "12.03.2024 14:05", "12.03.24".
 * The text is interpreted in the given UTC offset (FunPay: Moscow). Returns an ISO string or null.
 * `now` is injectable for deterministic tests.
 */
export function parseHumanDate(
  raw: string,
  now: Date = new Date(),
  utcOffsetMinutes: number = FUNPAY_UTC_OFFSET_MINUTES,
): string | null {
  const text = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;
  const offsetMs = utcOffsetMinutes * 60_000;
  // "now" as wall-clock time in the target zone, read through getUTC* accessors.
  const local = new Date(now.getTime() + offsetMs);
  const timeMatch = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  const hh = timeMatch ? Number(timeMatch[1]) : 0;
  const mm = timeMatch ? Number(timeMatch[2]) : 0;
  const ss = timeMatch?.[3] ? Number(timeMatch[3]) : 0;
  const build = (y: number, mo: number, d: number) => new Date(Date.UTC(y, mo, d, hh, mm, ss) - offsetMs).toISOString();
  const ly = local.getUTCFullYear();
  const lm = local.getUTCMonth();
  const ld = local.getUTCDate();

  if (/^(сегодня|today|сьогодні)/.test(text)) return build(ly, lm, ld);
  if (/^(вчера|yesterday|вчора)/.test(text)) return build(ly, lm, ld - 1);
  const numeric = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (numeric) {
    const year = Number(numeric[3]!.length === 2 ? `20${numeric[3]}` : numeric[3]);
    return build(year, Number(numeric[2]) - 1, Number(numeric[1]));
  }
  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return build(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  const named = text.match(/(\d{1,2}) ([\p{L}]+)\.?(?: (\d{4}))?/u);
  if (named) {
    const monthName = named[2]!;
    const month = RU_MONTHS[monthName] ?? EN_MONTHS[monthName] ?? UK_MONTHS[monthName];
    if (month !== undefined) {
      let year = named[3] ? Number(named[3]) : ly;
      // Dates without a year that would lie in the future belong to the previous year.
      if (!named[3] && Date.UTC(year, month, Number(named[1])) > Date.UTC(ly, lm, ld)) year -= 1;
      return build(year, month, Number(named[1]));
    }
  }
  if (timeMatch && text.length <= 8) return build(ly, lm, ld);
  return null;
}

export function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
