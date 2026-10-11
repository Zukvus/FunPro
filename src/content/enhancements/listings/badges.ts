/**
 * Net-price / estimated-profit / promo badges next to prices on the seller's OWN pages
 * (`/lots/{node}/trade` and the own profile). Rows are parsed with the adapter's parser (no
 * selectors outside the adapter except the documented row/price containers), DOM reads happen
 * before writes, and everything FunPro adds carries `funpro-*` classes and is removed on
 * context invalidation. Site text is never inserted as HTML.
 */
import { funpayParser, SEL, type ParsedListing } from '@/adapters/funpay';
import type { Settings } from '@/core/settings/schema';
import { listingEconomics } from '@/features/listings/commission';
import { formatMoney } from '@/shared/models/money';
import { tr, type CsLang } from './i18n';

export const BADGE_ROOT_CLASS = 'funpro-lst-badges';
export const STYLE_ID = 'funpro-listings-style';

const CSS = `
.${BADGE_ROOT_CLASS}{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;margin-top:2px;font:500 11px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:0;text-transform:none}
.funpro-lst-badge{display:inline-block;padding:0 6px;border-radius:9999px;background:rgba(124,92,255,.12);color:#5b3fd6;white-space:nowrap}
.funpro-lst-badge--profit{background:rgba(22,163,74,.12);color:#15803d}
.funpro-lst-badge--loss{background:rgba(220,38,38,.12);color:#b91c1c}
.funpro-lst-badge--promo{background:rgba(234,179,8,.18);color:#a16207}
`;

export type OwnPage = { kind: 'own_lots'; nodeId: string } | { kind: 'profile' };

export interface RowInfo {
  row: Element;
  priceEl: Element | null;
  listing: ParsedListing;
}

/** Parse a single row by wrapping a clone (the parser works on containers of rows). */
function parseRow(row: Element, nodeId: string): ParsedListing | null {
  const doc = row.ownerDocument;
  const wrap = doc.createElement('div');
  wrap.appendChild(row.cloneNode(true));
  return funpayParser.parseOwnLotsPage(wrap, nodeId).listings[0] ?? null;
}

/** Read phase: own offers on the page with their row and price elements. */
export function collectRows(doc: Document, page: OwnPage): RowInfo[] {
  const pageListings = page.kind === 'own_lots' ? funpayParser.parseOwnLotsPage(doc, page.nodeId).listings : funpayParser.parseProfileOffers(doc);
  const byId = new Map(pageListings.map((l) => [l.id, l]));
  const out: RowInfo[] = [];
  for (const row of Array.from(doc.querySelectorAll(SEL.row))) {
    const parsed = parseRow(row, page.kind === 'own_lots' ? page.nodeId : '');
    const listing = parsed ? byId.get(parsed.id) : undefined;
    if (!listing) continue;
    out.push({ row, priceEl: row.querySelector(SEL.rowPrice), listing });
  }
  return out;
}

export interface BadgeOptions {
  fees: Settings['fees'];
  costs: Readonly<Record<string, number | null>>;
  /** Privacy mode: never show profit on the page. */
  hideProfit: boolean;
  lang: CsLang;
}

function badge(doc: Document, cls: string, text: string, title: string): HTMLElement {
  const s = doc.createElement('span');
  s.className = `funpro-lst-badge ${cls}`.trim();
  s.textContent = text;
  s.title = title;
  return s;
}

export function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}

/** Write phase. Idempotent: existing FunPro badges in a row are replaced. Returns rows decorated. */
export function renderPriceBadges(doc: Document, rows: readonly RowInfo[], opts: BadgeOptions): number {
  const locale = opts.lang === 'en' ? 'en-US' : opts.lang === 'uk' ? 'uk-UA' : 'ru-RU';
  // Build all nodes first (no layout reads interleaved with writes).
  const plans: { host: Element; box: HTMLElement }[] = [];
  for (const { row, priceEl, listing } of rows) {
    const cost = opts.costs[listing.id] ?? null;
    const econ = listingEconomics({ ...listing, costMinor: cost }, opts.fees);
    const box = doc.createElement('span');
    box.className = BADGE_ROOT_CLASS;
    box.setAttribute('data-funpro', 'listings');
    const money = (minor: number) => formatMoney({ amountMinor: minor, currency: listing.price.currency }, locale);
    if (econ.netMinor !== null && econ.commission) {
      const label = econ.estimate ? tr(opts.lang, 'listings.cs.netEstimate', { value: money(econ.netMinor) }) : tr(opts.lang, 'listings.cs.net', { value: money(econ.netMinor) });
      box.appendChild(badge(doc, '', label, tr(opts.lang, 'listings.cs.netHint', { pct: econ.commission.pct })));
    }
    if (!opts.hideProfit && econ.profitMinor !== null) {
      box.appendChild(badge(doc, econ.profitMinor < 0 ? 'funpro-lst-badge--loss' : 'funpro-lst-badge--profit', tr(opts.lang, 'listings.cs.profit', { value: money(econ.profitMinor) }), tr(opts.lang, 'listings.cs.profitHint')));
    }
    if (listing.promoted) box.appendChild(badge(doc, 'funpro-lst-badge--promo', tr(opts.lang, 'listings.cs.promo'), tr(opts.lang, 'listings.cs.promoHint')));
    if (box.childNodes.length) plans.push({ host: priceEl ?? row, box });
    else row.querySelectorAll(`.${BADGE_ROOT_CLASS}`).forEach((n) => n.remove());
  }
  if (plans.length) ensureStyle(doc);
  for (const { host, box } of plans) {
    host.querySelectorAll(`.${BADGE_ROOT_CLASS}`).forEach((n) => n.remove());
    host.appendChild(box);
  }
  return plans.length;
}

export function removePriceBadges(doc: Document): void {
  doc.querySelectorAll(`.${BADGE_ROOT_CLASS}`).forEach((n) => n.remove());
  doc.getElementById(STYLE_ID)?.remove();
}
