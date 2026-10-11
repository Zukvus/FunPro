import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { funpayParser, SEL, type PageSession } from '@/adapters/funpay';
import type { OrderDirection } from '@/shared/models';
import { pageText, type PageLang } from './orders/strings';

/**
 * funpay.com helpers on the sales (/orders/trade) and purchases (/orders/) lists:
 *  - a small copy button next to every order number (the row link is NOT followed);
 *  - a "Copy unconfirmed IDs" button above the list (orders FunPay shows as paid, i.e. not yet
 *    confirmed), newline-separated.
 *
 * Everything FunPro adds carries `funpro-orders-*` classes and is removed when the extension
 * context is invalidated. The only observer watches the order list container (direct children),
 * so rows FunPay appends via "show more" get a button too — no page-wide observers.
 */

const CLS = {
  copy: 'funpro-orders-copy',
  copied: 'funpro-orders-copied',
  toolbar: 'funpro-orders-toolbar',
  toolbarBtn: 'funpro-orders-toolbar-btn',
  live: 'funpro-orders-live',
  style: 'funpro-orders-style',
} as const;

const STYLE = `
.${CLS.copy}{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-left:4px;padding:0;border:1px solid transparent;border-radius:4px;background:transparent;color:inherit;opacity:.55;cursor:pointer;vertical-align:middle}
.${CLS.copy}:hover,.${CLS.copy}:focus-visible{opacity:1;border-color:currentColor}
.${CLS.copy}.${CLS.copied}{opacity:1;color:#1a9b58}
.${CLS.toolbar}{display:flex;gap:8px;align-items:center;margin:8px 0}
.${CLS.toolbarBtn}{font:inherit;font-size:12px;padding:4px 10px;border:1px solid #c9ccd8;border-radius:6px;background:#fff;color:#171a2b;cursor:pointer}
.${CLS.toolbarBtn}:hover{background:#f0f1f7}
.${CLS.toolbarBtn}:disabled{opacity:.6;cursor:default}
.${CLS.live}{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

const ORDER_ID = /#?([A-Z0-9]{6,12})/;

export function ordersPageDirection(pathname: string): OrderDirection | null {
  const path = pathname.replace(/^\/(en|uk)(?=\/)/, '');
  if (path === '/orders/trade') return 'sale';
  if (path === '/orders/') return 'purchase';
  return null;
}

async function writeClipboard(doc: Document, text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      doc.body.appendChild(ta);
      ta.select();
      const ok = doc.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

function copyIcon(doc: Document): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = doc.createElementNS(ns, 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('aria-hidden', 'true');
  const rect = doc.createElementNS(ns, 'rect');
  for (const [k, v] of Object.entries({ x: '9', y: '9', width: '13', height: '13', rx: '2' }))
    rect.setAttribute(k, v);
  const path = doc.createElementNS(ns, 'path');
  path.setAttribute('d', 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1');
  svg.append(rect, path);
  return svg;
}

export interface DecorateOptions {
  lang: PageLang;
  direction: OrderDirection;
  /** Injected for tests. */
  copy?: (text: string) => Promise<boolean>;
}

/**
 * Decorate the order list in `doc`. Returns a cleanup function that removes every element and
 * listener FunPro added. Safe to call when the page has no orders (no-op).
 */
export function decorateOrdersPage(doc: Document, opts: DecorateOptions): () => void {
  const copy = opts.copy ?? ((text: string) => writeClipboard(doc, text));
  const added: Element[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let observer: MutationObserver | null = null;

  const live = doc.createElement('div');
  live.className = CLS.live;
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('role', 'status');
  doc.body.appendChild(live);
  added.push(live);
  const announce = (msg: string) => {
    live.textContent = msg;
  };

  if (!doc.getElementById(CLS.style)) {
    const style = doc.createElement('style');
    style.id = CLS.style;
    style.textContent = STYLE;
    (doc.head ?? doc.body).appendChild(style);
    added.push(style);
  }

  const flash = (btn: HTMLElement, label: string, restore: string) => {
    btn.classList.add(CLS.copied);
    btn.setAttribute('title', label);
    const timer = setTimeout(() => {
      btn.classList.remove(CLS.copied);
      btn.setAttribute('title', restore);
      timers.delete(timer);
    }, 1500);
    timers.add(timer);
  };

  const decorateCell = (cell: Element) => {
    if (cell.querySelector(`.${CLS.copy}`)) return;
    const id = (cell.textContent ?? '').match(ORDER_ID)?.[1];
    if (!id) return;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = CLS.copy;
    const label = pageText(opts.lang, 'copyId', { id });
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.appendChild(copyIcon(doc));
    // The order row is a link: never let our click navigate or reach FunPay's row handlers.
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    btn.addEventListener('mousedown', (e) => e.stopPropagation());
    btn.addEventListener('click', (e) => {
      stop(e);
      void copy(id).then((ok) => {
        const msg = ok ? pageText(opts.lang, 'copied') : pageText(opts.lang, 'copyFailed');
        flash(btn, msg, label);
        announce(ok ? `${msg}: ${id}` : msg);
      });
    });
    cell.appendChild(btn);
    added.push(btn);
  };

  const decorateAll = () => {
    for (const cell of Array.from(doc.querySelectorAll(SEL.rowOrder))) decorateCell(cell);
  };

  const rows = Array.from(doc.querySelectorAll(SEL.row)).filter((r) => r.querySelector(SEL.rowOrder));
  if (rows.length === 0) return () => added.forEach((el) => el.remove());
  decorateAll();

  // Toolbar above the list.
  const list = rows[0]!.parentElement;
  if (list?.parentElement) {
    const bar = doc.createElement('div');
    bar.className = CLS.toolbar;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', pageText(opts.lang, 'toolbarLabel'));
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = CLS.toolbarBtn;
    const unconfirmedIds = () =>
      funpayParser
        .parseOrders(doc, opts.direction)
        .orders.filter((o) => o.status === 'paid')
        .map((o) => o.id);
    const refreshLabel = () => {
      const n = unconfirmedIds().length;
      btn.textContent = pageText(opts.lang, 'copyUnconfirmed', { count: n });
      btn.disabled = n === 0;
      btn.title = n === 0 ? pageText(opts.lang, 'noUnconfirmed') : '';
    };
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const ids = [...new Set(unconfirmedIds())];
      if (ids.length === 0) {
        announce(pageText(opts.lang, 'noUnconfirmed'));
        return;
      }
      void copy(ids.join('\n')).then((ok) =>
        announce(
          ok
            ? pageText(opts.lang, 'copiedUnconfirmed', { count: ids.length })
            : pageText(opts.lang, 'copyFailed'),
        ),
      );
    });
    refreshLabel();
    bar.appendChild(btn);
    list.parentElement.insertBefore(bar, list);
    added.push(bar);

    // Rows appended by FunPay's "show more" are direct children of the same list.
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(() => {
        decorateAll();
        refreshLabel();
      });
      observer.observe(list, { childList: true });
    }
  }

  return () => {
    observer?.disconnect();
    for (const t of timers) clearTimeout(t);
    timers.clear();
    for (const el of added) el.remove();
    added.length = 0;
  };
}

/** funpay.com page enhancements for: orders. Must clean up via ctx (observers, listeners, DOM). */
export async function mountOrdersEnhancements(
  ctx: ContentScriptContext,
  getSession: () => PageSession,
): Promise<void> {
  const direction = ordersPageDirection(location.pathname);
  if (!direction) return;
  const locale = getSession().locale;
  const lang: PageLang = locale === 'en' || locale === 'uk' ? locale : 'ru';
  const cleanup = decorateOrdersPage(document, { lang, direction });
  ctx.onInvalidated(cleanup);
}
