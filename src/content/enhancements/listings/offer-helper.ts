/**
 * "Buyer price ⇄ seller price" helper on FunPay's offer editor (`/lots/offerEdit`).
 *
 * The commission % comes from the page itself when FunPay shows its buyer-price table
 * (cheapest method vs. the price field), otherwise from FunPro's saved commission for the node
 * (labelled as an estimate). The helper only fills the price INPUT when the seller clicks
 * "Use as price" — saving stays a manual action on FunPay's own form.
 *
 * Rendered in a Shadow DOM (style isolation both ways); only the buyer-price table's container is
 * observed; everything is removed on context invalidation.
 */
import { funpayParser, SEL } from '@/adapters/funpay';
import type { Settings } from '@/core/settings/schema';
import {
  buyerFromSellerPrice,
  formatPriceField,
  parsePriceInput,
  pctFromBuyerPrices,
  resolveCommission,
  sellerFromBuyerPrice,
} from '@/features/listings/commission';
import { tr, type CsLang } from './i18n';

export const HELPER_HOST_ID = 'funpro-offer-helper';

export interface HelperContext {
  onInvalidated: (cb: () => void) => unknown;
  signal: AbortSignal;
}

export interface HelperOptions {
  fees: Settings['fees'];
  lang: CsLang;
  /** Opens the FunPro dashboard for this offer (translation lives there). */
  openInDashboard?: (offerId: string) => void;
}

const CSS = `
:host{all:initial;display:block;margin:8px 0 12px}
.box{font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2330;background:#f6f4ff;border:1px solid #d9d2ff;border-radius:10px;padding:10px 12px}
.title{font-weight:600;font-size:12px;color:#5b3fd6;margin-bottom:6px}
.row{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:4px 0}
label{display:inline-flex;align-items:center;gap:6px}
input{width:110px;padding:4px 6px;border:1px solid #c9c4e6;border-radius:6px;font:inherit;color:inherit;background:#fff}
button{font:inherit;padding:4px 10px;border-radius:6px;border:1px solid #7c5cff;background:#7c5cff;color:#fff;cursor:pointer}
button[disabled]{opacity:.5;cursor:not-allowed}
button.link{background:transparent;color:#5b3fd6;border-color:transparent;padding:4px 0;text-decoration:underline}
.muted{color:#5f6475;font-size:12px}
.out{font-weight:600}
`;

interface Pct {
  pct: number;
  source: 'page' | 'settings';
}

export function mountOfferHelper(
  doc: Document,
  ctx: HelperContext,
  opts: HelperOptions,
): (() => void) | null {
  const form = doc.querySelector(SEL.offerForm);
  const priceInput = form?.querySelector<HTMLInputElement>('input[name="price"]') ?? null;
  const parsed = funpayParser.parseOfferForm(doc);
  if (!form || !priceInput || !parsed || doc.getElementById(HELPER_HOST_ID)) return null;
  const currency = parsed.currencyText || '';
  const t = (key: string, vars?: Record<string, string | number>) => tr(opts.lang, key, vars);
  const fmt = (minor: number) => `${formatPriceField(minor)}${currency ? ` ${currency}` : ''}`;

  const currentPct = (): Pct | null => {
    const seller = parsePriceInput(priceInput.value);
    const fresh = funpayParser.parseOfferForm(doc);
    const buyers = (fresh?.buyerPrices ?? [])
      .map((b) => parsePriceInput(b.priceText))
      .filter((v): v is number => v !== null);
    const fromPage = seller !== null ? pctFromBuyerPrices(seller, buyers) : null;
    if (fromPage !== null) return { pct: fromPage, source: 'page' };
    const fromSettings = resolveCommission({ nodeId: parsed.nodeId, categoryName: '' }, opts.fees);
    return fromSettings ? { pct: fromSettings.pct, source: 'settings' } : null;
  };

  // ---- build the widget (Shadow DOM, textContent only) ----
  const host = doc.createElement('div');
  host.id = HELPER_HOST_ID;
  const root = host.attachShadow({ mode: 'open' });
  const style = doc.createElement('style');
  style.textContent = CSS;
  const box = doc.createElement('div');
  box.className = 'box';
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    cls?: string,
    text?: string,
  ): HTMLElementTagNameMap[K] => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const title = el('div', 'title', t('listings.cs.helper.title'));
  const row1 = el('div', 'row');
  const label = el('label', undefined, t('listings.cs.helper.buyer'));
  const buyerInput = el('input');
  buyerInput.inputMode = 'decimal';
  buyerInput.setAttribute('aria-label', t('listings.cs.helper.buyer'));
  label.appendChild(buyerInput);
  const out = el('span', 'out', '');
  out.setAttribute('aria-live', 'polite');
  const use = el('button', undefined, t('listings.cs.helper.use'));
  use.type = 'button';
  use.disabled = true;
  row1.append(label, el('span', 'muted', '→'), out, use);
  const row2 = el('div', 'row muted', '');
  const pctLine = el('div', 'muted', '');
  box.append(title, row1, row2, pctLine);
  if (parsed.offerId && parsed.offerId !== '0' && opts.openInDashboard) {
    const link = el('button', 'link', t('listings.cs.helper.translate'));
    link.type = 'button';
    link.addEventListener('click', () => opts.openInDashboard?.(parsed.offerId), { signal: ctx.signal });
    box.appendChild(link);
  }
  root.append(style, box);

  let seller: number | null = null;
  const update = () => {
    const p = currentPct();
    const buyer = parsePriceInput(buyerInput.value);
    seller = p && buyer !== null && buyer > 0 ? sellerFromBuyerPrice(buyer, p.pct) : null;
    out.textContent =
      seller !== null
        ? t('listings.cs.helper.seller', { value: fmt(seller) })
        : t('listings.cs.helper.sellerEmpty');
    use.disabled = seller === null || seller <= 0;
    const cur = parsePriceInput(priceInput.value);
    row2.textContent =
      p && cur !== null && cur > 0
        ? t('listings.cs.helper.current', { price: fmt(cur), buyer: fmt(buyerFromSellerPrice(cur, p.pct)) })
        : '';
    pctLine.textContent = p
      ? t(p.source === 'page' ? 'listings.cs.helper.pctPage' : 'listings.cs.helper.pctSettings', {
          pct: p.pct,
        })
      : t('listings.cs.helper.unknown');
  };

  buyerInput.addEventListener('input', update, { signal: ctx.signal });
  priceInput.addEventListener('input', update, { signal: ctx.signal });
  use.addEventListener(
    'click',
    () => {
      if (seller === null) return;
      priceInput.value = formatPriceField(seller);
      // Let FunPay's own scripts recalculate their buyer-price table.
      priceInput.dispatchEvent(new Event('input', { bubbles: true }));
      priceInput.dispatchEvent(new Event('change', { bubbles: true }));
      update();
    },
    { signal: ctx.signal },
  );

  // Observe only the buyer-price table container (FunPay refreshes it when the price changes).
  let observer: MutationObserver | null = null;
  const table = doc.querySelector(SEL.buyerPricesRow)?.closest('table');
  const container = table?.parentElement ?? null;
  if (container && typeof MutationObserver !== 'undefined') {
    let scheduled = false;
    observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        update();
      });
    });
    observer.observe(container, { childList: true, subtree: true, characterData: true });
  }

  (priceInput.parentElement ?? form).insertAdjacentElement('afterend', host);
  update();

  const cleanup = () => {
    observer?.disconnect();
    host.remove();
  };
  ctx.onInvalidated(cleanup);
  return cleanup;
}
