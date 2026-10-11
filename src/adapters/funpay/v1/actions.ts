import type { ChatMessage, CompetitorOffer, OrderDirection } from '@/shared/models';
import { detectCurrency, parseLocalizedNumber, toMinor, type Currency } from '@/shared/models/money';
import { cleanText } from '@/core/security/sanitize';
import type {
  OfferForm,
  ParsedFinanceOp,
  ParsedListing,
  ParsedOrder,
  ParsedReview,
  RaiseOutcome,
  RaiseTarget,
} from '../types';
import { parserV1 } from './parser';
import type { FunPayTransport } from './transport';
import { FunPayHttpError } from './transport';

export interface CommissionQuote {
  methods: { name: string; priceMinor: number; currency: Currency }[];
  minPriceText: string | null;
  /** Derived from the cheapest method in the same currency; null when it cannot be derived. */
  commissionPct: number | null;
}

export type SendResult = { ok: true } | { ok: false; error: string; flood: boolean };

/** Checkbox-like offer fields: an empty string in `changes` removes the field (unchecks it). */
const CHECKBOX_FIELDS = new Set(['active', 'auto_delivery', 'deactivate_after_sale']);
/** Fields that FunPro never sets through generic edits. Deletion has its own explicit path. */
const PROTECTED_FIELDS = new Set(['offer_id', 'node_id', 'csrf_token', 'deleted', 'location']);

export function applyOfferChanges(
  form: OfferForm,
  changes: Record<string, string>,
  allowDelete = false,
): [string, string][] {
  for (const k of Object.keys(changes)) {
    if (PROTECTED_FIELDS.has(k) && !(allowDelete && k === 'deleted'))
      throw new Error(`Field "${k}" cannot be changed`);
  }
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const [k, v] of form.fields) {
    if (k in changes) {
      if (seen.has(k)) continue;
      seen.add(k);
      const nv = changes[k]!;
      if (CHECKBOX_FIELDS.has(k) && nv === '') continue;
      out.push([k, nv]);
    } else {
      out.push([k, v]);
    }
  }
  for (const [k, v] of Object.entries(changes)) {
    if (!seen.has(k) && !form.fields.some(([fk]) => fk === k) && !(CHECKBOX_FIELDS.has(k) && v === ''))
      out.push([k, v]);
  }
  return out;
}

const FLOOD = /слишком часто|too frequently|занадто часто/i;

/**
 * Content-script side FunPay operations. Each method returns parsed FunPro models; raw HTML never
 * leaves the content script.
 */
export class FunPayActionsV1 {
  constructor(
    private readonly transport: FunPayTransport,
    private readonly getCsrf: () => string | null,
    private readonly getUserId: () => string | null,
  ) {}

  private csrf(): string {
    const t = this.getCsrf();
    if (!t) throw new FunPayHttpError('CSRF token not found on page — reload FunPay', 0, 'logged_out');
    return t;
  }

  private doc(html: string): Document {
    return new DOMParser().parseFromString(html, 'text/html');
  }

  async raise(target: RaiseTarget, nodeIds?: string[]): Promise<RaiseOutcome & { nodeIds?: string[] }> {
    const fields: [string, string][] = [
      ['game_id', target.gameId],
      ['node_id', target.nodeId],
    ];
    for (const n of nodeIds ?? []) fields.push(['node_ids[]', n]);
    const res = await this.transport.postForm('/lots/raise', fields, this.csrf(), { csrfHeader: true });
    const outcome = parserV1.parseRaiseResponse(res.status, res.json);
    if (outcome.kind === 'needs_selection' && !nodeIds && outcome.nodeIds.length > 0) {
      // FunPay asks which subcategories of this game to raise; raise all of the seller's ones.
      const second = await this.raise(target, outcome.nodeIds);
      return { ...second, nodeIds: outcome.nodeIds };
    }
    return nodeIds ? { ...outcome, nodeIds } : outcome;
  }

  async discoverRaise(nodeId: string): Promise<{ target: RaiseTarget | null; listings: ParsedListing[] }> {
    const { html } = await this.transport.getHtml(`/lots/${nodeId}/trade`);
    const parsed = parserV1.parseOwnLotsPage(this.doc(html), nodeId);
    return { target: parsed.raise, listings: parsed.listings };
  }

  async sendMessage(chatId: string, text: string): Promise<SendResult> {
    const content = text.trim();
    if (!content) return { ok: false, error: 'Empty message', flood: false };
    const objects = [
      {
        type: 'chat_node',
        id: chatId,
        tag: '00000000',
        data: { node: chatId, last_message: -1, content: '' },
      },
    ];
    const request = { action: 'chat_message', data: { node: chatId, last_message: -1, content } };
    const res = await this.transport.postForm(
      '/runner/',
      [
        ['objects', JSON.stringify(objects)],
        ['request', JSON.stringify(request)],
      ],
      this.csrf(),
    );
    const response = (res.json as { response?: { error?: unknown } } | null)?.response;
    if (res.status !== 200 || !response)
      return { ok: false, error: `Unexpected response (HTTP ${res.status})`, flood: false };
    if (response.error) {
      const err = cleanText(String(response.error), 300);
      return { ok: false, error: err, flood: FLOOD.test(err) };
    }
    return { ok: true };
  }

  async getOfferForm(offerId: string): Promise<OfferForm> {
    const { html } = await this.transport.getHtml(`/lots/offerEdit?offer=${encodeURIComponent(offerId)}`);
    const form = parserV1.parseOfferForm(this.doc(html));
    if (!form)
      throw new FunPayHttpError('Offer edit form not found (is this your offer?)', 0, 'bad_response');
    if (form.offerId !== offerId)
      throw new FunPayHttpError('Offer id mismatch in edit form — aborting for safety', 0, 'bad_response');
    return form;
  }

  async saveOffer(
    offerId: string,
    changes: Record<string, string>,
    opts: { allowDelete?: boolean } = {},
  ): Promise<{ ok: boolean; errors: string[] }> {
    const form = await this.getOfferForm(offerId);
    const fields = applyOfferChanges(form, changes, opts.allowDelete);
    const res = await this.transport.postForm('/lots/offerSave', fields, this.csrf());
    const json = (res.json ?? {}) as { error?: unknown; errors?: unknown; msg?: unknown };
    const errors: string[] = [];
    if (Array.isArray(json.errors)) {
      for (const e of json.errors)
        errors.push(
          Array.isArray(e) ? e.map((x) => cleanText(String(x), 200)).join(': ') : cleanText(String(e), 200),
        );
    }
    if (json.error && typeof json.msg === 'string') errors.push(cleanText(json.msg, 300));
    if (res.status !== 200 && errors.length === 0) errors.push(`HTTP ${res.status}`);
    return { ok: res.status === 200 && !json.error && errors.length === 0, errors };
  }

  async calc(nodeId: string, price: number, chips = false, currency?: Currency): Promise<CommissionQuote> {
    const res = await this.transport.postForm(
      chips ? '/chips/calc' : '/lots/calc',
      [
        [chips ? 'game' : 'nodeId', nodeId],
        ['price', String(price)],
      ],
      null,
    );
    const json = (res.json ?? {}) as { methods?: unknown; minPrice?: unknown; error?: unknown };
    const methods: CommissionQuote['methods'] = [];
    if (Array.isArray(json.methods)) {
      for (const m of json.methods as { name?: unknown; price?: unknown; unit?: unknown }[]) {
        const value = parseLocalizedNumber(String(m.price ?? ''));
        if (value === null) continue;
        methods.push({
          name: cleanText(String(m.name ?? ''), 100),
          priceMinor: toMinor(value),
          currency: detectCurrency(String(m.unit ?? '')),
        });
      }
    }
    return {
      methods,
      minPriceText: typeof json.minPrice === 'string' ? cleanText(json.minPrice, 50) : null,
      commissionPct: deriveCommissionPct(price, methods, currency),
    };
  }

  async replyReview(orderId: string, text: string): Promise<{ ok: boolean; error?: string }> {
    const userId = this.getUserId();
    if (!userId) return { ok: false, error: 'Not logged in' };
    const res = await this.transport.postForm(
      '/orders/review',
      [
        ['authorId', userId],
        ['text', text],
        ['rating', ''],
        ['orderId', orderId],
      ],
      this.csrf(),
    );
    if (res.status === 200) return { ok: true };
    const msg = (res.json as { msg?: unknown } | null)?.msg;
    return { ok: false, error: typeof msg === 'string' ? cleanText(msg, 300) : `HTTP ${res.status}` };
  }

  async fetchOrders(
    direction: OrderDirection,
    query = '',
  ): Promise<{ orders: ParsedOrder[]; continueToken: string | null }> {
    const base = direction === 'sale' ? '/orders/trade' : '/orders/';
    const { html } = await this.transport.getHtml(base + query);
    return parserV1.parseOrders(this.doc(html), direction);
  }

  async fetchMoreOrders(
    direction: OrderDirection,
    continueToken: string,
  ): Promise<{ orders: ParsedOrder[]; continueToken: string | null }> {
    const base = direction === 'sale' ? '/orders/trade' : '/orders/';
    const res = await this.transport.postForm(base, [['continue', continueToken]], null);
    return parserV1.parseOrders(this.doc(res.text), direction);
  }

  async fetchChats() {
    const { html } = await this.transport.getHtml('/chat/');
    return parserV1.parseChatList(this.doc(html));
  }

  async fetchChatHistory(chatId: string): Promise<ChatMessage[]> {
    const { json } = await this.transport.getJson(
      `/chat/history?node=${encodeURIComponent(chatId)}&last_message=-1`,
    );
    return parserV1.parseChatHistoryJson(json, chatId, this.getUserId());
  }

  async fetchProfileListings(
    userId: string,
  ): Promise<{ listings: ParsedListing[]; reviews: ParsedReview[] }> {
    const { html } = await this.transport.getHtml(`/users/${userId}/`);
    const doc = this.doc(html);
    return { listings: parserV1.parseProfileOffers(doc), reviews: parserV1.parseReviews(doc) };
  }

  async fetchFinance(): Promise<ParsedFinanceOp[]> {
    const { html } = await this.transport.getHtml('/account/balance');
    return parserV1.parseFinance(this.doc(html));
  }

  async fetchPublicOffers(nodeId: string): Promise<CompetitorOffer[]> {
    const { html } = await this.transport.getHtml(`/lots/${nodeId}/`);
    return parserV1.parsePublicOffers(this.doc(html), nodeId);
  }

  /**
   * Blank offer editor for a subcategory: `GET /lots/offerEdit?node=N` renders the same form with
   * `offer_id=0` (research §D.5). Refuses anything that is not a blank form for exactly that node.
   */
  async getNewOfferForm(nodeId: string): Promise<OfferForm> {
    if (!/^\d{1,10}$/.test(nodeId)) throw new FunPayHttpError('Invalid node id', 0, 'bad_response');
    const { html } = await this.transport.getHtml(`/lots/offerEdit?node=${nodeId}`);
    const form = parserV1.parseOfferForm(this.doc(html));
    if (!form)
      throw new FunPayHttpError(
        'New offer form not found (is this category available to you?)',
        0,
        'bad_response',
      );
    if (form.offerId !== '0')
      throw new FunPayHttpError(
        'Expected a blank offer form (offer_id=0) — aborting for safety',
        0,
        'bad_response',
      );
    if (form.nodeId !== nodeId)
      throw new FunPayHttpError(
        'Category mismatch in new offer form — aborting for safety',
        0,
        'bad_response',
      );
    return form;
  }

  /**
   * Create a NEW offer (used by explicit, user-confirmed cloning). The blank form is fetched fresh
   * (offer_id=0, current CSRF token) and `changes` are applied with the same protections as edits:
   * identity fields (offer_id, node_id, csrf_token, deleted) can never be overridden.
   */
  async createOffer(
    nodeId: string,
    changes: Record<string, string>,
  ): Promise<{ ok: boolean; errors: string[]; offerId: string | null }> {
    const form = await this.getNewOfferForm(nodeId);
    const fields = applyOfferChanges(form, changes);
    const res = await this.transport.postForm('/lots/offerSave', fields, this.csrf());
    const { ok, errors } = offerSaveResult(res.status, res.json);
    const url = (res.json as { url?: unknown } | null)?.url;
    const offerId = typeof url === 'string' ? (url.match(/[?&](?:id|offer)=(\d{1,12})/)?.[1] ?? null) : null;
    return { ok, errors, offerId };
  }

  /** Dedicated, explicit deletion path (`deleted=1`). Callers must have a typed user confirmation and a backup. */
  async deleteOffer(offerId: string): Promise<{ ok: boolean; errors: string[] }> {
    return this.saveOffer(offerId, { deleted: '1' }, { allowDelete: true });
  }
}

/** Interpret a `/lots/offerSave` JSON answer: `{error?, errors?: [[field, msg], …], msg?}` (research §D.5). */
export function offerSaveResult(status: number, json: unknown): { ok: boolean; errors: string[] } {
  const rec = (json && typeof json === 'object' ? json : {}) as {
    error?: unknown;
    errors?: unknown;
    msg?: unknown;
  };
  const errors: string[] = [];
  if (Array.isArray(rec.errors)) {
    for (const e of rec.errors)
      errors.push(
        Array.isArray(e) ? e.map((x) => cleanText(String(x), 200)).join(': ') : cleanText(String(e), 200),
      );
  }
  if (rec.error && typeof rec.msg === 'string') errors.push(cleanText(rec.msg, 300));
  if (rec.error && errors.length === 0) errors.push('FunPay rejected the offer');
  if (status !== 200 && errors.length === 0) errors.push(`HTTP ${status}`);
  return { ok: status === 200 && !rec.error && errors.length === 0, errors };
}

export function deriveCommissionPct(
  sellerPrice: number,
  methods: CommissionQuote['methods'],
  currency?: Currency,
): number | null {
  if (!(sellerPrice > 0) || methods.length === 0) return null;
  currency ??= methods[0]!.currency;
  const same = methods.filter((m) => m.currency === currency).map((m) => m.priceMinor);
  const cheapest = Math.min(...same);
  if (!Number.isFinite(cheapest) || cheapest <= 0) return null;
  const pct = (cheapest / toMinor(sellerPrice) - 1) * 100;
  return pct >= 0 && pct < 100 ? Math.round(pct * 100) / 100 : null;
}
