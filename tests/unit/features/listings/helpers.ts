import { defaultSettings, type Settings } from '@/core/settings/schema';
import type { Currency, Listing } from '@/shared/models';

export function makeListing(id: string, over: Partial<Listing> = {}, priceMinor = 10_000, currency: Currency = 'RUB'): Listing {
  return {
    id,
    nodeId: '501',
    gameId: '41',
    categoryName: 'Game A Accounts',
    title: `Offer ${id}`,
    price: { amountMinor: priceMinor, currency },
    amount: 5,
    active: true,
    promoted: false,
    autoDelivery: false,
    costMinor: null,
    sortIndex: Number(id) % 100_000,
    seenAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...over,
  };
}

/** Settings with live actions acknowledged; automation paused by default (bulk edits still run). */
export function liveSettings(over: (s: Settings) => void = () => undefined): Settings {
  const s = defaultSettings();
  s.automation.liveActionsAcknowledged = true;
  over(s);
  return s;
}

/** Offer-editor form as returned by the content script's getOfferForm. */
export function offerForm(offerId: string, values: { price?: string; amount?: string; active?: boolean; summaryEn?: string; descEn?: string } = {}) {
  const fields: [string, string][] = [
    ['csrf_token', 'TESTCSRF0000'],
    ['offer_id', offerId],
    ['node_id', '501'],
    ['fields[summary][ru]', 'Название'],
    ['fields[summary][en]', values.summaryEn ?? ''],
    ['fields[desc][ru]', 'Описание'],
    ['fields[desc][en]', values.descEn ?? ''],
    ['price', values.price ?? '100.00'],
    ['amount', values.amount ?? '5'],
  ];
  if (values.active ?? true) fields.push(['active', 'on']);
  return { offerId, nodeId: '501', currencyText: '₽', fields, buyerPrices: [] };
}

export class NoTabError extends Error {
  constructor() {
    super('No logged-in FunPay tab is open.');
    this.name = 'NoFunPayTabError';
  }
}
