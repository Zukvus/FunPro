import { SalesPanelPeriodSchema, type SalesPanelPeriod } from '@/core/settings/schema';
import { PRIVATE_ATTR } from '@/features/appearance/funpay-css';
import {
  SalesPanelResponseSchema,
  type PanelMoney,
  type SalesPanelData,
  type SalesPanelResponse,
  type SalesPanelTopRow,
} from '@/features/orders/sales-panel-schema';
import { formatMoney } from '@/shared/models/money';
import { panelText, type PageLang, type PanelStringKey } from './strings';

/**
 * Statistics panel on FunPay's own sales page (/orders/trade), above the order list.
 *
 * The numbers come from the background (`cs.salesPanel.stats`), computed from the sales FunPro has
 * stored; the panel says how many that is and offers to load the full history. Everything is built
 * with DOM APIs and `textContent` (never HTML strings), styled under `funpro-sales*` classes that
 * follow FunPro's funpay.com theme when it is on, and removed when the extension context goes away.
 * Buyer names and money carry `data-funpro-private`, so privacy mode blurs them like FunPay's own.
 */

export interface SalesPanelApi {
  stats(period?: SalesPanelPeriod): Promise<unknown>;
  setPrefs(prefs: { period?: SalesPanelPeriod; collapsed?: boolean; enabled?: false }): Promise<unknown>;
  importHistory(): Promise<unknown>;
  openDashboard(page: 'orders' | 'analytics'): Promise<unknown>;
}

export interface SalesPanelOptions {
  lang: PageLang;
  api: SalesPanelApi;
  /** How often to refresh while a history import runs. */
  pollMs?: number;
}

export interface SalesPanelHandle {
  root: HTMLElement;
  refresh(): Promise<void>;
  destroy(): void;
}

export const SALES_PANEL_CLASS = 'funpro-sales';
const C = SALES_PANEL_CLASS;
const STYLE_ID = 'funpro-sales-style';
const LOCALE: Record<PageLang, string> = { ru: 'ru-RU', uk: 'uk-UA', en: 'en-US' };
const MSK = 'Europe/Moscow';

const STYLE = `
.${C}{--fs-accent:var(--fpx-accent,#6845f7);--fs-bg:var(--fpx-surface,#fff);--fs-fg:var(--fpx-fg,#171a2b);--fs-muted:var(--fpx-muted,#5d6385);--fs-border:var(--fpx-border,#e1e3ee);--fs-tint:var(--fpx-accent-soft,#f1edff);box-sizing:border-box;position:relative;margin:12px 0 14px;padding:14px 16px;border:1px solid var(--fs-border);border-radius:12px;background:var(--fs-bg);color:var(--fs-fg);font-family:'Inter','Segoe UI',system-ui,-apple-system,Roboto,Arial,sans-serif;font-size:13px;line-height:1.45;text-align:left}
.${C} *,.${C} *::before,.${C} *::after{box-sizing:border-box}
.${C}__head{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between}
.${C}__brand{display:flex;align-items:center;gap:8px;min-width:0}
.${C}__mark{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:6px;background:var(--fs-accent);color:#fff;font-size:10px;font-weight:800;letter-spacing:.02em}
.${C} h2.${C}__title{margin:0;padding:0;font-size:16px;font-weight:700;line-height:1.3;color:inherit}
.${C}__controls{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.${C} select.${C}__select,.${C} button.${C}__btn{height:30px;margin:0;padding:0 10px;border:1px solid var(--fs-border);border-radius:8px;background:var(--fs-bg);color:var(--fs-fg);font:inherit;font-size:12px;font-weight:600;line-height:28px;cursor:pointer;box-shadow:none}
.${C} select.${C}__select:hover,.${C} button.${C}__btn:hover{border-color:var(--fs-accent)}
.${C} select.${C}__select:focus-visible,.${C} button.${C}__btn:focus-visible,.${C} button.${C}__link:focus-visible{outline:2px solid var(--fs-accent);outline-offset:1px}
.${C} button.${C}__btn:disabled{opacity:.55;cursor:default}
.${C} button.${C}__link{height:auto;margin:0;padding:0;border:0;background:none;color:var(--fs-accent);font:inherit;font-size:12px;font-weight:600;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.${C} button.${C}__link:disabled{color:var(--fs-muted);cursor:default;text-decoration:none}
.${C}__body{margin-top:12px}
.${C}__body[hidden]{display:none}
.${C}__cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.${C}__card{min-width:0;padding:10px 12px;border:1px solid var(--fs-border);border-radius:10px;background:var(--fs-bg)}
.${C}__card--hero{border-color:var(--fs-accent);background:var(--fs-tint)}
.${C}__label{font-size:12px;color:var(--fs-muted)}
.${C}__values{display:flex;flex-wrap:wrap;gap:0 14px;margin-top:2px;font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.${C}__card--hero .${C}__values{font-size:22px}
.${C}__sub{margin-top:2px;font-size:12px;color:var(--fs-muted)}
.${C}__chart{margin-top:12px}
.${C}__chart-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px;font-size:12px;color:var(--fs-muted)}
.${C} h3.${C}__h3{margin:0;padding:0;font-size:12px;font-weight:700;line-height:1.4;color:var(--fs-fg)}
.${C}__svg{display:block;width:100%;height:84px;margin-top:6px}
.${C}__bar{fill:var(--fs-accent);opacity:.8}
.${C}__bar:hover{opacity:1}
.${C}__base{stroke:var(--fs-border);stroke-width:1}
.${C}__axis{display:flex;justify-content:space-between;font-size:11px;color:var(--fs-muted)}
.${C}__tops{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:12px}
.${C}__top-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding-bottom:4px;border-bottom:1px solid var(--fs-border);font-size:11px;color:var(--fs-muted)}
.${C} ol.${C}__list{margin:0;padding:0;list-style:none}
.${C}__item{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 8px;padding:5px 0;border-bottom:1px dashed var(--fs-border)}
.${C}__item:last-child{border-bottom:0}
.${C}__name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:600}
.${C}__count{font-weight:700;font-variant-numeric:tabular-nums}
.${C}__amounts{grid-column:1/-1;font-size:11px;color:var(--fs-muted);font-variant-numeric:tabular-nums}
.${C}__empty{padding:6px 0;font-size:12px;color:var(--fs-muted)}
.${C}__foot{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:12px;padding-top:10px;border-top:1px solid var(--fs-border);font-size:12px;color:var(--fs-muted)}
.${C}__note{flex-basis:100%;font-size:11px}
.${C}__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-width:760px){.${C}__cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:480px){.${C}__cards{grid-template-columns:minmax(0,1fr)}}
`;

type Child = Node | string | null | undefined | false;

function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

/** Where the panel goes on a sales page: above FunPro's order toolbar, or above the order list. */
export function salesPanelAnchor(doc: Document, rowSelector: string): Element | null {
  const toolbar = doc.querySelector('.funpro-orders-toolbar');
  if (toolbar?.parentElement) return toolbar;
  const firstRow = doc.querySelector(rowSelector);
  const list = firstRow?.parentElement;
  return list?.parentElement ? list : null;
}

export function mountSalesPanel(
  doc: Document,
  before: Element,
  opts: SalesPanelOptions,
): SalesPanelHandle | null {
  const parent = before.parentElement;
  if (!parent) return null;
  const { lang, api } = opts;
  const pollMs = opts.pollMs ?? 4000;
  const t = (key: PanelStringKey, vars?: Record<string, string | number>) => panelText(lang, key, vars);
  const locale = LOCALE[lang];
  const num = (n: number) => n.toLocaleString(locale);
  const money = (m: PanelMoney) => formatMoney({ amountMinor: m.amountMinor, currency: m.currency }, locale);
  const dateText = (ts: number, opt: Intl.DateTimeFormatOptions) =>
    new Date(ts).toLocaleDateString(locale, { ...opt, timeZone: MSK });

  let addedStyle: HTMLStyleElement | null = null;
  if (!doc.getElementById(STYLE_ID)) {
    addedStyle = el(doc, 'style', { id: STYLE_ID });
    addedStyle.textContent = STYLE;
    (doc.head ?? doc.body).appendChild(addedStyle);
  }

  // ---- static frame ------------------------------------------------------------------------
  const titleId = 'funpro-sales-title';
  const bodyId = 'funpro-sales-body';
  const periodId = 'funpro-sales-period';
  const select = el(doc, 'select', { id: periodId, class: `${C}__select` });
  for (const p of SalesPanelPeriodSchema.options)
    select.append(el(doc, 'option', { value: p }, t(`period.${p}` as PanelStringKey)));
  const refreshBtn = el(doc, 'button', { type: 'button', class: `${C}__btn` }, t('refresh'));
  const collapseBtn = el(
    doc,
    'button',
    { type: 'button', class: `${C}__btn`, 'aria-controls': bodyId, 'aria-expanded': 'true' },
    t('collapse'),
  );
  const body = el(doc, 'div', { id: bodyId, class: `${C}__body` }, t('loading'));
  const live = el(doc, 'div', { class: `${C}__sr`, role: 'status', 'aria-live': 'polite' });
  const root = el(
    doc,
    'section',
    { class: C, 'aria-labelledby': titleId, 'data-funpro': 'sales-panel', 'aria-busy': 'true' },
    el(
      doc,
      'div',
      { class: `${C}__head` },
      el(
        doc,
        'div',
        { class: `${C}__brand` },
        el(doc, 'span', { class: `${C}__mark`, 'aria-hidden': 'true' }, 'FP'),
        el(doc, 'h2', { id: titleId, class: `${C}__title`, title: t('region') }, t('title')),
      ),
      el(
        doc,
        'div',
        { class: `${C}__controls` },
        el(doc, 'label', { for: periodId, class: `${C}__sr` }, t('period')),
        select,
        refreshBtn,
        collapseBtn,
      ),
    ),
    body,
    live,
  );
  parent.insertBefore(root, before);

  // ---- state -------------------------------------------------------------------------------
  let current: SalesPanelResponse | null = null;
  let period: SalesPanelPeriod | undefined;
  let destroyed = false;
  let seq = 0;
  let poll: ReturnType<typeof setTimeout> | null = null;
  let importWatched = false;

  const announce = (msg: string) => {
    live.textContent = msg;
  };

  const setCollapsed = (collapsed: boolean) => {
    body.hidden = collapsed;
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
    collapseBtn.textContent = collapsed ? t('expand') : t('collapse');
  };

  const stopPolling = () => {
    if (poll) clearTimeout(poll);
    poll = null;
  };

  async function load(p?: SalesPanelPeriod): Promise<void> {
    const mine = ++seq;
    root.setAttribute('aria-busy', 'true');
    refreshBtn.disabled = true;
    try {
      const parsed = SalesPanelResponseSchema.safeParse(await api.stats(p));
      if (destroyed || mine !== seq) return;
      if (!parsed.success) throw new Error('invalid answer');
      current = parsed.data;
      if (!current.prefs.enabled) {
        teardown();
        return;
      }
      period = current.prefs.period;
      select.value = period;
      setCollapsed(current.prefs.collapsed);
      render(current);
      watchImport(current.importStatus);
    } catch {
      if (!destroyed && mine === seq) renderUnavailable();
    } finally {
      if (!destroyed && mine === seq) {
        root.setAttribute('aria-busy', 'false');
        refreshBtn.disabled = false;
      }
    }
  }

  function watchImport(status: SalesPanelResponse['importStatus']) {
    stopPolling();
    if (status?.state === 'running') {
      importWatched = true;
      poll = setTimeout(() => void load(period), pollMs);
    } else if (importWatched && status) {
      importWatched = false;
      announce(
        status.state === 'done'
          ? t('importDone', { created: num(status.created) })
          : status.state === 'awaiting_tab'
            ? t('importNoTab')
            : t('importFailed', { reason: status.state }),
      );
    }
  }

  // ---- rendering -----------------------------------------------------------------------------
  function values(list: PanelMoney[], privateMoney = true): HTMLElement {
    const box = el(doc, 'div', { class: `${C}__values` });
    if (list.length === 0) box.append('—');
    for (const m of list)
      box.append(el(doc, 'span', privateMoney ? { [PRIVATE_ATTR]: 'money' } : {}, money(m)));
    return box;
  }

  function card(
    label: string,
    main: HTMLElement,
    sub: Child[] = [],
    opts: { hero?: boolean; help?: string } = {},
  ): HTMLElement {
    return el(
      doc,
      'div',
      {
        class: `${C}__card${opts.hero ? ` ${C}__card--hero` : ''}`,
        ...(opts.help ? { title: opts.help } : {}),
      },
      el(doc, 'div', { class: `${C}__label` }, label),
      main,
      ...sub.filter(Boolean).map((s) => el(doc, 'div', { class: `${C}__sub` }, s)),
    );
  }

  function moneyLine(list: PanelMoney[]): HTMLElement | null {
    if (list.length === 0) return null;
    const span = el(doc, 'span', { [PRIVATE_ATTR]: 'money' });
    span.textContent = list.map(money).join(' · ');
    return span;
  }

  function cards(d: SalesPanelData): HTMLElement {
    const earned = d.currencies
      .filter((c) => c.closedOrders > 0)
      .map((c) => ({ currency: c.currency, amountMinor: c.earned }));
    const average = d.currencies
      .filter((c) => c.average !== null)
      .map((c) => ({ currency: c.currency, amountMinor: c.average! }));
    const pending = d.currencies
      .filter((c) => c.pendingOrders > 0)
      .map((c) => ({ currency: c.currency, amountMinor: c.pending }));
    const refunded = d.currencies
      .filter((c) => c.refundedOrders > 0)
      .map((c) => ({ currency: c.currency, amountMinor: c.refunded }));
    const biggest = d.currencies
      .filter((c) => c.biggest !== null)
      .map((c) => ({ currency: c.currency, amountMinor: c.biggest! }));
    const count = (n: number) => el(doc, 'div', { class: `${C}__values` }, num(n));
    const rate =
      d.orders > 0
        ? (d.refunded / d.orders).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 1 })
        : '—';
    return el(
      doc,
      'div',
      { class: `${C}__cards` },
      card(t('earned'), values(earned), [t('closedOrders', { n: num(d.closed) })], {
        hero: true,
        help: t('earnedHelp'),
      }),
      card(t('orders'), count(d.orders), [t('uniqueBuyers', { n: num(d.uniqueBuyers) })]),
      card(t('average'), values(average), [], { help: t('averageHelp') }),
      card(t('pending'), count(d.pending), [moneyLine(pending)]),
      card(t('refunds'), count(d.refunded), [moneyLine(refunded), t('refundRate', { pct: rate })]),
      card(t('biggest'), values(biggest)),
    );
  }

  function bucketText(start: number, granularity: SalesPanelData['granularity']): string {
    return granularity === 'month'
      ? dateText(start, { month: 'short', year: 'numeric' })
      : dateText(start, { day: 'numeric', month: 'short' });
  }

  function chart(d: SalesPanelData): HTMLElement | null {
    if (d.series.length < 2) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const W = 600;
    const H = 84;
    const max = Math.max(...d.series.map((p) => p.orders));
    const total = d.series.reduce((n, p) => n + p.orders, 0);
    const peak = d.series.find((p) => p.orders === max)!;
    const summary = t('chartSummary', {
      total: num(total),
      max: num(max),
      when: bucketText(peak.start, d.granularity),
    });
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('class', `${C}__svg`);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', summary);
    const slot = W / d.series.length;
    const gap = Math.min(4, slot * 0.25);
    d.series.forEach((p, i) => {
      if (p.orders === 0) return;
      const h = Math.max(2, (p.orders / Math.max(1, max)) * (H - 4));
      const rect = doc.createElementNS(ns, 'rect');
      rect.setAttribute('class', `${C}__bar`);
      rect.setAttribute('x', (i * slot + gap / 2).toFixed(2));
      rect.setAttribute('y', (H - h).toFixed(2));
      rect.setAttribute('width', Math.max(1, slot - gap).toFixed(2));
      rect.setAttribute('height', h.toFixed(2));
      rect.setAttribute('rx', '2');
      const title = doc.createElementNS(ns, 'title');
      title.textContent = `${bucketText(p.start, d.granularity)}: ${num(p.orders)}`;
      rect.appendChild(title);
      svg.appendChild(rect);
    });
    const base = doc.createElementNS(ns, 'line');
    base.setAttribute('class', `${C}__base`);
    for (const [k, v] of Object.entries({ x1: '0', y1: String(H - 0.5), x2: String(W), y2: String(H - 0.5) }))
      base.setAttribute(k, v);
    svg.appendChild(base);
    return el(
      doc,
      'div',
      { class: `${C}__chart` },
      el(
        doc,
        'div',
        { class: `${C}__chart-head` },
        el(doc, 'h3', { class: `${C}__h3` }, t(`chart.${d.granularity}` as PanelStringKey)),
        el(doc, 'span', {}, summary),
      ),
      svg,
      el(
        doc,
        'div',
        { class: `${C}__axis`, 'aria-hidden': 'true' },
        el(doc, 'span', {}, bucketText(d.series[0]!.start, d.granularity)),
        el(doc, 'span', {}, bucketText(d.series.at(-1)!.start, d.granularity)),
      ),
    );
  }

  function topList(title: string, rows: SalesPanelTopRow[], privateNames: boolean): HTMLElement {
    const list = el(doc, 'ol', { class: `${C}__list` });
    for (const r of rows) {
      const name = el(
        doc,
        'span',
        { class: `${C}__name`, title: r.name, ...(privateNames ? { [PRIVATE_ATTR]: 'name' } : {}) },
        r.name,
      );
      const amounts = moneyLine(r.amounts);
      list.append(
        el(
          doc,
          'li',
          { class: `${C}__item` },
          name,
          el(doc, 'span', { class: `${C}__count` }, num(r.orders)),
          amounts ? el(doc, 'span', { class: `${C}__amounts` }, amounts) : null,
        ),
      );
    }
    return el(
      doc,
      'div',
      {},
      el(
        doc,
        'div',
        { class: `${C}__top-head` },
        el(doc, 'h3', { class: `${C}__h3` }, title),
        el(doc, 'span', {}, t('ordersCol')),
      ),
      rows.length ? list : el(doc, 'div', { class: `${C}__empty` }, t('noData')),
    );
  }

  function footer(r: SalesPanelResponse): HTMLElement {
    const d = r.data!;
    const cov = d.coverage;
    const coverage =
      cov.oldest === null
        ? t('coverage', { n: num(cov.stored) })
        : t('coverageSince', {
            n: num(cov.stored),
            date: dateText(cov.oldest, { day: 'numeric', month: 'long', year: 'numeric' }),
          });
    const running = r.importStatus?.state === 'running';
    const importBtn = el(doc, 'button', { type: 'button', class: `${C}__link` }, t('importHistory'));
    importBtn.disabled = running;
    importBtn.addEventListener('click', () => void startImport(importBtn));
    const openBtn = el(doc, 'button', { type: 'button', class: `${C}__link` }, t('openDashboard'));
    openBtn.addEventListener('click', () => void api.openDashboard('analytics').catch(() => undefined));
    const hideBtn = el(doc, 'button', { type: 'button', class: `${C}__link` }, t('hidePanel'));
    hideBtn.addEventListener('click', () => void hide());
    return el(
      doc,
      'div',
      { class: `${C}__foot` },
      el(doc, 'span', {}, coverage),
      cov.undated > 0 ? el(doc, 'span', {}, t('undated', { n: num(cov.undated) })) : null,
      running && r.importStatus
        ? el(
            doc,
            'span',
            {},
            t('importRunning', { pages: num(r.importStatus.pages), orders: num(r.importStatus.orders) }),
          )
        : importBtn,
      openBtn,
      hideBtn,
      el(doc, 'span', { class: `${C}__note` }, t('seenOnly')),
    );
  }

  function render(r: SalesPanelResponse) {
    const d = r.data;
    if (!d) {
      body.replaceChildren(el(doc, 'div', { class: `${C}__empty` }, t('noData')));
      return;
    }
    const parts: Node[] = [];
    if (d.orders === 0) parts.push(el(doc, 'div', { class: `${C}__empty` }, t('emptyPeriod')));
    else {
      parts.push(cards(d));
      const graph = chart(d);
      if (graph) parts.push(graph);
      parts.push(
        el(
          doc,
          'div',
          { class: `${C}__tops` },
          topList(t('topBuyers'), d.topBuyers, true),
          topList(t('topProducts'), d.topProducts, false),
          topList(t('topCategories'), d.topCategories, false),
        ),
      );
    }
    parts.push(footer(r));
    body.replaceChildren(...parts);
  }

  function renderUnavailable() {
    const retry = el(doc, 'button', { type: 'button', class: `${C}__link` }, t('retry'));
    retry.addEventListener('click', () => void load(period));
    body.replaceChildren(el(doc, 'div', { class: `${C}__empty` }, t('unavailable'), ' ', retry));
  }

  // ---- actions -------------------------------------------------------------------------------
  async function startImport(btn: HTMLButtonElement) {
    btn.disabled = true;
    try {
      await api.importHistory();
      importWatched = true;
      await load(period);
    } catch (e) {
      btn.disabled = false;
      const code = (e as { code?: unknown } | null)?.code;
      announce(
        code === 'busy'
          ? t('importBusy')
          : code === 'awaiting_tab'
            ? t('importNoTab')
            : t('importFailed', { reason: e instanceof Error ? e.message : String(e) }),
      );
    }
  }

  async function hide() {
    try {
      await api.setPrefs({ enabled: false });
    } catch {
      return;
    }
    stopPolling();
    root.replaceChildren(el(doc, 'div', { class: `${C}__empty`, role: 'status' }, t('hidden')));
  }

  const onPeriod = () => {
    const next = SalesPanelPeriodSchema.safeParse(select.value);
    if (!next.success) return;
    period = next.data;
    void api.setPrefs({ period: next.data }).catch(() => undefined);
    void load(next.data);
  };
  const onRefresh = () => void load(period);
  const onCollapse = () => {
    const collapsed = !body.hidden;
    setCollapsed(collapsed);
    void api.setPrefs({ collapsed }).catch(() => undefined);
  };
  select.addEventListener('change', onPeriod);
  refreshBtn.addEventListener('click', onRefresh);
  collapseBtn.addEventListener('click', onCollapse);

  function teardown() {
    destroyed = true;
    stopPolling();
    select.removeEventListener('change', onPeriod);
    refreshBtn.removeEventListener('click', onRefresh);
    collapseBtn.removeEventListener('click', onCollapse);
    root.remove();
    addedStyle?.remove();
  }

  void load();
  return {
    root,
    refresh: () => load(period),
    destroy: teardown,
  };
}
