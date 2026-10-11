/**
 * Local daily summary / status for Telegram, computed from FunPro's own database (no analytics
 * dependency). Contains only aggregate numbers — no names, messages or order contents.
 */
import { getDb } from '@/core/db/db';
import type { AutomationState } from '@/core/settings/schema';
import { hhmmToMinutes } from '@/core/util/time';
import { formatMoney, type Currency } from '@/shared/models/money';
import { bold, escapeTelegramHtml } from '@/adapters/telegram/format';
import { nt, type NotifyLang } from '@/features/notifications/texts';

export interface LocalSummary {
  /** Local midnight the summary starts at. */
  since: number;
  sales: number;
  revenue: Partial<Record<Currency, number>>;
  refunds: number;
  activeOrders: number;
  unreadChats: number;
  pendingDrafts: number;
  failedTasks: number;
  newReviews: number;
  averageStars: number | null;
}

export function startOfLocalDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export async function buildLocalSummary(now = new Date()): Promise<LocalSummary> {
  const db = getDb();
  const since = startOfLocalDay(now);
  const sinceIso = new Date(since).toISOString();
  const sales = await db.orders
    .where('direction')
    .equals('sale')
    .filter((o) => (o.createdAt ?? o.firstSeenAt) >= sinceIso)
    .toArray();
  const revenue: Partial<Record<Currency, number>> = {};
  let refunds = 0;
  for (const o of sales) {
    if (o.status === 'refunded') {
      refunds++;
      continue;
    }
    if (o.price.currency === 'UNKNOWN') continue;
    revenue[o.price.currency] = (revenue[o.price.currency] ?? 0) + o.price.amountMinor;
  }
  const [activeOrders, unreadChats, pendingDrafts, failedTasks, reviews] = await Promise.all([
    db.orders.where('[direction+status]').equals(['sale', 'paid']).count(),
    db.chats.filter((c) => c.unread).count(),
    db.drafts.where('status').equals('pending').count(),
    db.tasks.where('status').equals('failed').count(),
    db.reviews.where('firstSeenAt').aboveOrEqual(sinceIso).toArray(),
  ]);
  const rated = reviews.filter((r) => typeof r.stars === 'number');
  return {
    since,
    sales: sales.length - refunds,
    revenue,
    refunds,
    activeOrders,
    unreadChats,
    pendingDrafts,
    failedTasks,
    newReviews: reviews.length,
    averageStars: rated.length ? rated.reduce((s, r) => s + (r.stars ?? 0), 0) / rated.length : null,
  };
}

function revenueText(s: LocalSummary, lang: NotifyLang): string {
  const entries = Object.entries(s.revenue) as [Currency, number][];
  if (entries.length === 0) return nt(lang, 'tg.none');
  const locale = lang === 'en' ? 'en-US' : lang === 'uk' ? 'uk-UA' : 'ru-RU';
  return entries.map(([currency, amountMinor]) => formatMoney({ amountMinor, currency }, locale)).join(' · ');
}

const row = (label: string, value: string | number) => `${escapeTelegramHtml(label)}: ${escapeTelegramHtml(String(value))}`;

export function formatSummaryHtml(s: LocalSummary, lang: NotifyLang, now = new Date()): string {
  const date = now.toLocaleDateString(lang === 'en' ? 'en-GB' : lang === 'uk' ? 'uk-UA' : 'ru-RU');
  const reviews = s.newReviews ? `${s.newReviews}${s.averageStars !== null ? ` (★${s.averageStars.toFixed(1)})` : ''}` : '0';
  return [
    `📊 ${bold(`${nt(lang, 'tg.summary')} — ${date}`)}`,
    row(nt(lang, 'tg.sales'), s.sales),
    row(nt(lang, 'tg.revenue'), revenueText(s, lang)),
    row(nt(lang, 'tg.refunds'), s.refunds),
    row(nt(lang, 'tg.reviews'), reviews),
    row(nt(lang, 'tg.active'), s.activeOrders),
    row(nt(lang, 'tg.unread'), s.unreadChats),
    row(nt(lang, 'tg.drafts'), s.pendingDrafts),
  ].join('\n');
}

export function formatStatusHtml(s: LocalSummary, state: AutomationState, lang: NotifyLang): string {
  const stateKey = state === 'running' ? 'tg.state.running' : state === 'paused' ? 'tg.state.paused' : 'tg.state.stopped';
  return [
    `🔔 ${bold(nt(lang, 'tg.status'))}`,
    row(nt(lang, 'tg.automation'), nt(lang, stateKey)),
    row(nt(lang, 'tg.sales'), s.sales),
    row(nt(lang, 'tg.revenue'), revenueText(s, lang)),
    row(nt(lang, 'tg.active'), s.activeOrders),
    row(nt(lang, 'tg.unread'), s.unreadChats),
    row(nt(lang, 'tg.drafts'), s.pendingDrafts),
    row(nt(lang, 'tg.failed'), s.failedTasks),
  ].join('\n');
}

/** Next local time at HH:MM strictly after `now`. */
export function nextSummaryAt(now: Date, hhmm: string): number {
  const minutes = hhmmToMinutes(hhmm);
  const d = new Date(now);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Due once per day at/after HH:MM, within a grace window (a browser opened hours later sends it
 * late; one opened the next morning skips yesterday's).
 */
export function isSummaryDue(now: Date, hhmm: string, lastSentDay: string | null, graceMinutes = 180): boolean {
  if (lastSentDay === localDayKey(now)) return false;
  const target = hhmmToMinutes(hhmm);
  const current = now.getHours() * 60 + now.getMinutes();
  return current >= target && current < target + graceMinutes;
}
