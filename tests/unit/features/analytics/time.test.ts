import { describe, expect, it } from 'vitest';
import {
  autoGranularity,
  bucketKey,
  bucketLabel,
  DAY_MS,
  enumerateBuckets,
  formatZoned,
  parseDayInput,
  previousRange,
  rangeFromDayInputs,
  resolveRange,
  startOfZonedDay,
  startOfZonedMonth,
  startOfZonedWeek,
  zonedParts,
} from '@/features/analytics/time';

const T = (iso: string) => Date.parse(iso);
const NOW = T('2024-11-05T12:00:00.000Z'); // Tue 5 Nov 2024, 15:00 MSK

describe('Moscow-time calendar arithmetic', () => {
  it('splits days at Moscow midnight (21:00 UTC)', () => {
    expect(startOfZonedDay(T('2024-10-31T21:00:00.000Z'))).toBe(T('2024-10-31T21:00:00.000Z'));
    expect(startOfZonedDay(T('2024-10-31T20:59:59.999Z'))).toBe(T('2024-10-30T21:00:00.000Z'));
    // 01:30 MSK on 6 Nov is still 5 Nov in UTC.
    expect(startOfZonedDay(T('2024-11-05T22:30:00.000Z'))).toBe(T('2024-11-05T21:00:00.000Z'));
  });

  it('reports wall-clock parts with Monday = 0', () => {
    expect(zonedParts(T('2024-10-31T21:00:00.000Z'))).toEqual({ year: 2024, month: 10, day: 1, hour: 0, weekday: 4 });
    expect(zonedParts(T('2024-11-03T09:30:00.000Z')).weekday).toBe(6);
  });

  it('starts weeks on Monday and months on the 1st (Moscow)', () => {
    expect(startOfZonedWeek(T('2024-11-03T09:30:00.000Z'))).toBe(T('2024-10-27T21:00:00.000Z'));
    expect(startOfZonedMonth(NOW)).toBe(T('2024-10-31T21:00:00.000Z'));
    expect(bucketKey(T('2024-11-03T09:30:00.000Z'), 'week')).toBe('2024-10-28');
    expect(bucketKey(T('2024-11-03T09:30:00.000Z'), 'month')).toBe('2024-11');
    expect(bucketKey(T('2024-10-31T20:59:00.000Z'), 'day')).toBe('2024-10-31');
  });

  it('enumerates gap-free buckets covering the range', () => {
    const range = { from: T('2024-10-31T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') };
    expect(enumerateBuckets(range, 'day').map((b) => b.key)).toEqual(['2024-11-01', '2024-11-02', '2024-11-03', '2024-11-04', '2024-11-05']);
    expect(enumerateBuckets(range, 'week').map((b) => b.key)).toEqual(['2024-10-28', '2024-11-04']);
    expect(enumerateBuckets(range, 'month').map((b) => b.key)).toEqual(['2024-11']);
    const months = enumerateBuckets({ from: T('2023-12-31T21:00:00.000Z'), to: T('2024-03-31T21:00:00.000Z') }, 'month');
    expect(months.map((b) => b.key)).toEqual(['2024-01', '2024-02', '2024-03']);
    expect(months[1]!.end - months[1]!.start).toBe(29 * DAY_MS); // leap February
  });

  it('labels buckets', () => {
    expect(bucketLabel('2024-11-05', 'day')).toBe('05.11');
    expect(bucketLabel('2024-10-28', 'week')).toBe('28.10–03.11');
    expect(bucketLabel('2024-11', 'month')).toBe('11.2024');
  });

  it('formats timestamps in Moscow time', () => {
    expect(formatZoned('2024-11-05T07:15:00.000Z')).toBe('05.11.2024 10:15');
    expect(formatZoned(null)).toBe('');
  });
});

describe('range presets', () => {
  it('rolling presets include today (Moscow) and end at the end of today', () => {
    expect(resolveRange('7d', NOW)).toEqual({ from: T('2024-10-29T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(resolveRange('30d', NOW).to - resolveRange('30d', NOW).from).toBe(30 * DAY_MS);
    expect(resolveRange('90d', NOW).to - resolveRange('90d', NOW).from).toBe(90 * DAY_MS);
  });

  it('month presets follow calendar months', () => {
    expect(resolveRange('thisMonth', NOW)).toEqual({ from: T('2024-10-31T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(resolveRange('lastMonth', NOW)).toEqual({ from: T('2024-09-30T21:00:00.000Z'), to: T('2024-10-31T21:00:00.000Z') });
  });

  it('custom ranges use inclusive Moscow days and fall back to 30 days when invalid', () => {
    expect(resolveRange('custom', NOW, { from: '2024-11-01', to: '2024-11-05' })).toEqual({ from: T('2024-10-31T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(rangeFromDayInputs('2024-11-05', '2024-11-01')).toEqual({ from: T('2024-10-31T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') });
    expect(parseDayInput('2024-13-01')).toBeNull();
    expect(resolveRange('custom', NOW, { from: 'x', to: '' })).toEqual(resolveRange('30d', NOW));
  });

  it('previous period: same length before, or the previous calendar month', () => {
    const r = { from: T('2024-10-31T21:00:00.000Z'), to: T('2024-11-05T21:00:00.000Z') };
    expect(previousRange(r)).toEqual({ from: T('2024-10-26T21:00:00.000Z'), to: r.from });
    // Month-to-date (5 days of November) vs the first 5 days of October.
    expect(previousRange(resolveRange('thisMonth', NOW), 'thisMonth')).toEqual({ from: T('2024-09-30T21:00:00.000Z'), to: T('2024-10-05T21:00:00.000Z') });
    // Last month (October, 31 days) vs September (30 days) — clamped to September.
    expect(previousRange(resolveRange('lastMonth', NOW), 'lastMonth')).toEqual({ from: T('2024-08-31T21:00:00.000Z'), to: T('2024-09-30T21:00:00.000Z') });
    // March vs a leap February.
    const march = { from: T('2024-02-29T21:00:00.000Z'), to: T('2024-03-31T21:00:00.000Z') };
    expect(previousRange(march, 'lastMonth')).toEqual({ from: T('2024-01-31T21:00:00.000Z'), to: T('2024-02-29T21:00:00.000Z') });
  });

  it('chooses a sensible granularity', () => {
    expect(autoGranularity(resolveRange('30d', NOW))).toBe('day');
    expect(autoGranularity(resolveRange('90d', NOW))).toBe('week');
    expect(autoGranularity({ from: 0, to: 400 * DAY_MS })).toBe('month');
  });
});
