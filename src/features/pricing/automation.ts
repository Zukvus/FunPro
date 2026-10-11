/**
 * Applying prices on FunPay (manual "apply" and the opt-in automation).
 *
 * The engine works with buyer-facing prices; the offer form's `price` field is the seller price
 * (FunPay adds its commission on top). The commission is derived from the very form being saved
 * (its buyer-price table) and falls back to the seller's fee settings; without it nothing is applied.
 * Every change: one saveOffer call, a backup record (db.backups kind 'manual'), a log entry, and
 * (automatic changes) a notification.
 */
import { deriveCommissionPct } from '@/adapters/funpay';
import type { OfferForm } from '@/adapters/funpay/types';
import { evaluateFeature, type AutomationContext } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { isFlagEnabled } from '@/core/flags/flags';
import { log } from '@/core/log/logger';
import type { Settings } from '@/core/settings/schema';
import { newId } from '@/core/util/id';
import { notify } from '@/features/notifications/notify';
import { formatMoney, parseLocalizedNumber, parseMoney, toMinor } from '@/shared/models/money';
import { recommendPrice, type Recommendation } from './engine';
import { commissionFor, loadListingMarket, type ListingMarket } from './context';
import { appendChangeLog, getChangeLog, getRule, getSimulation, setEvalMark, setPendingOwnPrice, toRule } from './model';

export interface OfferExec {
  getOfferForm: (offerId: string) => Promise<OfferForm>;
  saveOffer: (offerId: string, changes: Record<string, string>) => Promise<{ ok: boolean; errors: string[] }>;
}

export interface PricingDeps {
  getSettings: () => Promise<Settings>;
  automationContext: () => Promise<AutomationContext>;
  exec: OfferExec;
  now?: () => number;
}

const nowOf = (d: { now?: () => number }) => (d.now ? d.now() : Date.now());

/** Recommendation for a listing using stored data (shared by UI and automation). */
export async function recommendationFor(market: ListingMarket, settings: Settings, now: number): Promise<Recommendation | null> {
  if (!market.rule) return null;
  const autoLog = (await getChangeLog(market.listing.id)).filter((e) => e.mode === 'auto').map((e) => e.at);
  if (market.rule.lastAppliedAt) autoLog.push(Date.parse(market.rule.lastAppliedAt));
  return recommendPrice({
    rule: market.rule,
    listing: { id: market.listing.id, title: market.listing.title },
    currentPriceMinor: market.current.minor,
    currency: market.listing.price.currency,
    costMinor: market.listing.costMinor,
    commissionPct: commissionFor(settings, market.listing),
    offers: market.offers,
    own: market.own,
    appliedAt: autoLog.filter((t) => Number.isFinite(t)),
    now,
  });
}

function formField(form: OfferForm, name: string): string | null {
  return form.fields.find(([k]) => k === name)?.[1] ?? null;
}

/** Seller (form) price for a buyer-facing target, never above the target. */
export function formPriceFor(targetMinor: number, commissionPct: number): number {
  return Math.floor(targetMinor / (1 + commissionPct / 100) + 1e-9);
}

export function formatFormPrice(minor: number, sample: string): string {
  const s = (minor / 100).toFixed(2);
  return sample.includes(',') && !sample.includes('.') ? s.replace('.', ',') : s;
}

export interface ApplyResult {
  changed: boolean;
  formFrom: string;
  formTo: string;
  commissionPct: number;
}

export async function applyPrice(listingId: string, targetMinor: number, mode: 'auto' | 'manual', deps: PricingDeps): Promise<ApplyResult> {
  const db = getDb();
  const now = nowOf(deps);
  const listing = await db.listings.get(listingId);
  if (!listing) throw new Error('Listing not found');
  if (!Number.isInteger(targetMinor) || targetMinor <= 0) throw new Error('Invalid target price');
  const settings = await deps.getSettings();
  const rule = await getRule(listingId);
  if (rule && (targetMinor < rule.minMinor || targetMinor > rule.maxMinor)) throw new Error('Target is outside the rule’s min/max range');

  const form = await deps.exec.getOfferForm(listingId);
  const priceText = formField(form, 'price');
  const formValue = priceText === null ? null : parseLocalizedNumber(priceText);
  if (priceText === null || formValue === null || formValue <= 0) throw new Error('Price field not found in the offer form');
  const methods = form.buyerPrices
    .map((b) => {
      const m = parseMoney(b.priceText, listing.price.currency);
      return m ? { name: b.method, priceMinor: m.amountMinor, currency: m.currency } : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const pct = deriveCommissionPct(formValue, methods, listing.price.currency) ?? commissionFor(settings, listing);
  if (pct === null) throw new Error('FunPay commission for this category is unknown — set it in Settings → Fees');

  let newForm = formPriceFor(targetMinor, pct);
  if (rule) {
    const minForm = Math.ceil(rule.minMinor / (1 + pct / 100) - 1e-9);
    newForm = Math.max(newForm, minForm);
  }
  if (newForm <= 0) throw new Error('Computed price is not positive');
  const oldForm = toMinor(formValue);
  const formTo = formatFormPrice(newForm, priceText);
  if (newForm === oldForm) return { changed: false, formFrom: priceText, formTo, commissionPct: pct };

  const fromMinor = listing.price.amountMinor;
  await db.backups.add({
    id: newId('bk'),
    kind: 'manual',
    createdAt: now,
    label: `Repricing (${mode}) ${listing.title.slice(0, 60)}: form price ${priceText} → ${formTo}`,
    listings: [listing],
  });
  const res = await deps.exec.saveOffer(listingId, { price: formTo });
  if (!res.ok) {
    const msg = res.errors.join('; ') || 'FunPay rejected the change';
    await log.error({ source: 'pricing', message: `Price change for listing ${listingId} rejected: ${msg}` });
    throw new Error(msg);
  }
  const at = new Date(now).toISOString();
  await appendChangeLog(listingId, { at: now, mode, fromMinor, toMinor: targetMinor, formFrom: priceText, formTo, commissionPct: pct });
  await setPendingOwnPrice(listingId, { minor: targetMinor, at: now });
  if (rule && mode === 'auto') await db.priceRules.update(listingId, { lastAppliedAt: at });
  const pretty = formatMoney({ amountMinor: targetMinor, currency: listing.price.currency });
  await log.info({ source: 'pricing', message: `Price of "${listing.title.slice(0, 80)}" set to ~${pretty} for buyers (form ${priceText} → ${formTo}, ${mode})`, details: { listingId, commissionPct: pct } });
  if (mode === 'auto') {
    await notify({ kind: 'price', title: 'Price adjusted automatically', body: `"${listing.title.slice(0, 80)}": ~${pretty} for buyers (was form price ${priceText}).`, dedupeKey: `reprice:${listingId}:${now}` });
  }
  return { changed: true, formFrom: priceText, formTo, commissionPct: pct };
}

/** Minimum time between automation evaluations of one listing. */
export const EVAL_INTERVAL_MS = 5 * 60_000;

export interface TickOutcome {
  status: string;
  applied: string[];
}

/**
 * Automation tick: evaluate enabled rules (simulated at least once) and apply at most one change.
 * Requires evaluateFeature('repricing') = running, fresh competitor data and a known commission.
 */
export async function runRepricingTick(deps: PricingDeps): Promise<TickOutcome> {
  const db = getDb();
  const now = nowOf(deps);
  const settings = await deps.getSettings();
  if (!isFlagEnabled('pricingIntelligence', settings.flags)) return { status: 'flag_off', applied: [] };
  const fs = evaluateFeature(settings, 'repricing', await deps.automationContext());
  if (fs.status !== 'running') return { status: fs.status, applied: [] };
  const rules = (await db.priceRules.toArray()).map(toRule).filter((r) => r.enabled);
  const applied: string[] = [];
  for (const rule of rules) {
    const mark = await db.kv.get(`pricing:eval:${rule.listingId}`);
    const last = (mark?.value as { at?: number } | undefined)?.at ?? 0;
    if (now - last < EVAL_INTERVAL_MS) continue;
    if (!(await getSimulation(rule.listingId))) {
      await setEvalMark(rule.listingId, { at: now, outcome: 'not_simulated' });
      continue;
    }
    const market = await loadListingMarket(rule.listingId, now);
    if (!market) {
      await setEvalMark(rule.listingId, { at: now, outcome: 'listing_missing' });
      continue;
    }
    if (market.observedAt === null || now - market.observedAt > settings.pricing.maxDataAgeMinutes * 60_000) {
      await setEvalMark(rule.listingId, { at: now, outcome: 'stale_data' });
      continue;
    }
    const rec = await recommendationFor(market, settings, now);
    if (!rec || rec.action !== 'change' || rec.targetMinor === null) {
      await setEvalMark(rule.listingId, { at: now, outcome: rec?.hold ?? 'no_rule' });
      continue;
    }
    if (rec.notes.includes('commission_unknown')) {
      await setEvalMark(rule.listingId, { at: now, outcome: 'commission_unknown' });
      continue;
    }
    if (applied.length > 0) break; // at most one FunPay edit per tick
    try {
      const res = await applyPrice(rule.listingId, rec.targetMinor, 'auto', deps);
      await setEvalMark(rule.listingId, { at: now, outcome: res.changed ? 'applied' : 'already_optimal', detail: `${res.formFrom} → ${res.formTo}` });
      if (res.changed) applied.push(rule.listingId);
    } catch (e) {
      const msg = (e as Error).message;
      await setEvalMark(rule.listingId, { at: now, outcome: 'error', detail: msg.slice(0, 200) });
      await notify({ kind: 'failure', title: 'Automatic repricing failed', body: `Listing ${rule.listingId}: ${msg.slice(0, 200)}`, dedupeKey: `reprice-fail:${rule.listingId}:${msg.slice(0, 40)}` });
    }
  }
  return { status: 'running', applied };
}
