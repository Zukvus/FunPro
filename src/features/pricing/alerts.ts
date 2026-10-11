/**
 * PRICE_CHANGE_DETECTED → "a competitor undercut you" notification (settings.pricing.alertOnUndercut).
 * Own offers and non-comparable offers (other currency, outside the price band, ignored sellers)
 * never alert.
 */
import { getDb } from '@/core/db/db';
import type { Settings } from '@/core/settings/schema';
import { notify } from '@/features/notifications/notify';
import type { DomainEvent } from '@/shared/models';
import { formatMoney } from '@/shared/models/money';
import { loadListingMarket } from './context';
import { classifyOffers } from './market';

export async function handlePriceChange(event: DomainEvent, getSettings: () => Promise<Settings>, now = Date.now()): Promise<string[]> {
  const p = event.payload;
  const nodeId = typeof p['nodeId'] === 'string' ? p['nodeId'] : null;
  const offerId = typeof p['offerId'] === 'string' ? p['offerId'] : null;
  const to = typeof p['to'] === 'number' ? p['to'] : null;
  const from = typeof p['from'] === 'number' ? p['from'] : null;
  if (!nodeId || !offerId || to === null) return [];
  const settings = await getSettings();
  if (!settings.pricing.alertOnUndercut) return [];
  const db = getDb();
  const mine = await db.listings.where('nodeId').equals(nodeId).toArray();
  const alerted: string[] = [];
  for (const l of mine) {
    if (l.id === offerId || !l.active) continue;
    const market = await loadListingMarket(l.id, now);
    if (!market) continue;
    const offer = market.offers.find((o) => o.offerId === offerId);
    if (!offer) continue;
    const [c] = classifyOffers([offer], {
      title: l.title,
      currency: l.price.currency,
      currentPriceMinor: market.current.minor,
      own: market.own,
      ignoreSellers: market.rule?.ignoreSellers ?? [],
      minSimilarity: market.rule?.minSimilarity ?? 0,
      priceBandPct: market.rule?.priceBandPct ?? 50,
    });
    if (!c || c.excluded) continue;
    const mineNow = market.current.minor;
    const wasAtOrAbove = from === null || from >= mineNow;
    if (to < mineNow && wasAtOrAbove) {
      const money = (m: number) => formatMoney({ amountMinor: m, currency: l.price.currency });
      await notify({
        kind: 'price',
        title: `Undercut: ${l.title.slice(0, 60)}`,
        body: `${offer.sellerName || 'A competitor'} now sells at ${money(to)} (your price ${money(mineNow)}).`,
        dedupeKey: `undercut:${l.id}:${offerId}:${to}`,
      });
      alerted.push(l.id);
    }
  }
  return alerted;
}
