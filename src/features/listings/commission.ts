/**
 * Commission & net-price math. Pure functions over integer minor units (kopecks / cents).
 *
 * Model (evidence: research §B.2 "Commission", §D.5): FunPay adds its commission ON TOP of the
 * seller's editor price — `/lots/calc` answers buyer prices per payment method for a given seller
 * price, and the commission % is derived as `(cheapest buyer price / seller price − 1) × 100`.
 * Therefore:  buyer = seller × (1 + p/100)  and  seller (net) = buyer / (1 + p/100).
 *
 * Percentages are handled with 0.01 % precision (basis points) and all divisions are exact integer
 * divisions, so results never suffer from floating-point drift.
 *
 * Rounding rules (documented, tested):
 *  - `netFromBuyerPrice` / `sellerFromBuyerPrice` round DOWN → net income is never overstated and a
 *    seller price derived from a target buyer price never makes the buyer pay more than the target;
 *  - `buyerFromSellerPrice` rounds UP → the buyer price is never understated;
 *  - `profit` is exact (net − cost) and may be negative.
 *
 * The % differs per payment method on FunPay, so any net value computed from a listed price is an
 * estimate. Values are labelled as coming "from FunPay" only when the % for that subcategory was
 * derived from FunPay's own calculator (`source: 'calc'`).
 */
import type { Settings } from '@/core/settings/schema';
import { parseLocalizedNumber, toMinor } from '@/shared/models/money';

const BP_SCALE = 10_000;

/** Percent → basis points (0.01 %). */
export function pctToBp(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0 || pct >= 1000)
    throw new RangeError(`Invalid commission percentage: ${pct}`);
  return Math.round(pct * 100);
}

function assertMinor(v: number): void {
  if (!Number.isSafeInteger(v)) throw new RangeError(`Amount must be an integer number of minor units: ${v}`);
}

/** floor(num / den) for safe integers (den > 0), exact. */
export function divFloor(num: number, den: number): number {
  let q = Math.floor(num / den);
  if (q * den > num) q -= 1;
  else if ((q + 1) * den <= num) q += 1;
  return q;
}

/** ceil(num / den) for safe integers (den > 0), exact. */
export function divCeil(num: number, den: number): number {
  return -divFloor(-num, den);
}

/** round-half-up(num / den) for safe integers (den > 0), exact. */
export function divRound(num: number, den: number): number {
  return divFloor(2 * num + den, 2 * den);
}

/** What the seller receives for a buyer price, given the commission markup %. Rounds down. */
export function netFromBuyerPrice(buyerMinor: number, pct: number): number {
  assertMinor(buyerMinor);
  return divFloor(buyerMinor * BP_SCALE, BP_SCALE + pctToBp(pct));
}

/** Seller (editor) price that yields at most the given buyer price. Same rounding as net. */
export const sellerFromBuyerPrice = netFromBuyerPrice;

/** Buyer price for a seller (editor) price. Rounds up. */
export function buyerFromSellerPrice(sellerMinor: number, pct: number): number {
  assertMinor(sellerMinor);
  return divCeil(sellerMinor * (BP_SCALE + pctToBp(pct)), BP_SCALE);
}

/** Profit in minor units: net income minus cost of goods (exact, may be negative). */
export function profit(netMinor: number, costMinor: number): number {
  assertMinor(netMinor);
  assertMinor(costMinor);
  return netMinor - costMinor;
}

export type CommissionSource = 'calc' | 'manual_node' | 'category' | 'default';

export interface CommissionInfo {
  pct: number;
  source: CommissionSource;
  /** True only when the % was derived from FunPay's own calculator for this subcategory. */
  fromFunPay: boolean;
}

type Fees = Settings['fees'];

/** Lookup order: per-node entry → per-category-name entry → default. Null = unknown. */
export function resolveCommission(
  listing: { nodeId: string | null; categoryName: string },
  fees: Fees,
): CommissionInfo | null {
  const node = listing.nodeId ? fees.nodeCommission?.[listing.nodeId] : undefined;
  if (node)
    return {
      pct: node.pct,
      source: node.source === 'calc' ? 'calc' : 'manual_node',
      fromFunPay: node.source === 'calc',
    };
  const byName = listing.categoryName ? fees.categoryCommissionPct[listing.categoryName] : undefined;
  if (byName !== undefined) return { pct: byName, source: 'category', fromFunPay: false };
  if (fees.defaultCommissionPct !== null && fees.defaultCommissionPct !== undefined)
    return { pct: fees.defaultCommissionPct, source: 'default', fromFunPay: false };
  return null;
}

export interface ListingEconomics {
  commission: CommissionInfo | null;
  /** Net income for the listed price, null when the commission is unknown. */
  netMinor: number | null;
  /** Net − cost, null when either is unknown. */
  profitMinor: number | null;
  /** Everything except a FunPay-calculated % is an estimate. */
  estimate: boolean;
}

export function listingEconomics(
  listing: {
    nodeId: string | null;
    categoryName: string;
    price: { amountMinor: number };
    costMinor: number | null;
  },
  fees: Fees,
): ListingEconomics {
  const commission = resolveCommission(listing, fees);
  const price = listing.price.amountMinor;
  const netMinor = commission && price > 0 ? netFromBuyerPrice(price, commission.pct) : null;
  const profitMinor =
    netMinor !== null && listing.costMinor !== null ? profit(netMinor, listing.costMinor) : null;
  return { commission, netMinor, profitMinor, estimate: !commission?.fromFunPay };
}

/** Render minor units as the plain decimal FunPay's editor expects ("1234.50"). */
export function formatPriceField(minor: number): string {
  assertMinor(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Parse a user- or form-entered decimal ("1 234,5", "199.99") into minor units. */
export function parsePriceInput(text: string | null | undefined): number | null {
  if (text === null || text === undefined || !text.trim()) return null;
  const v = parseLocalizedNumber(text);
  if (v === null || !Number.isFinite(v)) return null;
  const minor = toMinor(v);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Percentage implied by FunPay's own buyer-price table for an editor price (cheapest method). */
export function pctFromBuyerPrices(sellerMinor: number, buyerMinors: readonly number[]): number | null {
  if (!(sellerMinor > 0)) return null;
  const valid = buyerMinors.filter((v) => Number.isSafeInteger(v) && v > 0);
  if (valid.length === 0) return null;
  const cheapest = Math.min(...valid);
  const bp = divRound((cheapest - sellerMinor) * BP_SCALE, sellerMinor);
  return bp >= 0 && bp < 100 * 100 ? bp / 100 : null;
}
