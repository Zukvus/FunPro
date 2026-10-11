/**
 * Builds the variable map a rule's conditions and templates see:
 *   event.*, payload.* (flattened), order.*, customer.*, listing.*, inventory.*, time.*
 * Site-derived values are plain data; they are only ever rendered as text.
 */
import { getDb } from '@/core/db/db';
import { customerKey } from '@/features/sync/ingest';
import { availableCount } from '@/features/inventory/lowstock';
import { findPoolForOrder, parseOrderQuantity } from '@/features/inventory/pools';
import { privateChatId } from '@/features/inventory/template';
import type { DomainEvent } from '@/shared/models';
import type { Primitive, Vars } from './conditions';

export interface WorkflowContext {
  event: DomainEvent;
  vars: Vars;
  chatId: string | null;
  /** CRM key (`<id>` or `name:<username>`) + display name of the counterparty, when known. */
  customer: { key: string; name: string; exists: boolean } | null;
  listingIds: string[];
  baseline: boolean;
}

export function flatten(value: unknown, prefix: string, out: Vars = {}, depth = 0): Vars {
  if (value === null || value === undefined) {
    out[prefix] = null;
  } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    out[prefix] = typeof value === 'string' ? value.slice(0, 4000) : value;
  } else if (Array.isArray(value)) {
    out[`${prefix}.length`] = value.length;
    if (value.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) out[prefix] = value.slice(0, 50).join(', ');
  } else if (typeof value === 'object' && depth < 4) {
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      if (!/^[\w-]{1,40}$/.test(k)) continue;
      flatten(v, `${prefix}.${k}`, out, depth + 1);
    }
  }
  return out;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

export async function buildContext(event: DomainEvent, opts: { selfUserId: string | null; selfName?: string | null; now: Date }): Promise<WorkflowContext> {
  const db = getDb();
  const p = event.payload;
  const vars: Vars = {
    'event.type': event.type,
    'event.id': event.id,
    'event.at': event.at,
  };
  flatten(p, 'payload', vars);
  const set = (k: string, v: Primitive | undefined) => {
    vars[k] = v === undefined ? null : v;
  };

  const listingIds = new Set<string>();
  let custId = str(p['buyerId']) ?? str(p['authorId']);
  let custName = str(p['buyer']) ?? str(p['authorName']);
  let chatId = str(p['chatId']);

  const orderId = str(p['orderId']);
  const order = orderId ? await db.orders.get(orderId) : undefined;
  if (order) {
    set('order.id', order.id);
    set('order.status', order.status);
    set('order.direction', order.direction);
    set('order.description', order.description);
    set('order.category', order.categoryName);
    set('order.buyer', order.counterpartyName);
    set('order.buyerId', order.counterpartyId);
    set('order.priceMinor', order.price.amountMinor);
    set('order.price', order.price.amountMinor / 100);
    set('order.currency', order.price.currency);
    set('order.quantity', parseOrderQuantity(order.description));
    set('order.listingId', order.listingId);
    if (order.listingId) listingIds.add(order.listingId);
    custId ??= order.counterpartyId;
    custName ??= order.counterpartyName || null;
    const delivery = await db.deliveries.get(order.id);
    set('delivery.status', delivery?.status ?? null);
  }
  if (chatId && (!custId || !custName)) {
    const chat = await db.chats.get(chatId);
    if (chat) {
      custId ??= chat.partnerId;
      custName ??= chat.partnerName || null;
    }
  }

  let customer: WorkflowContext['customer'] = null;
  if (custId || custName) {
    const key = customerKey(custId, custName ?? '');
    const c = await db.customers.get(key);
    customer = { key, name: c?.name ?? custName ?? '', exists: !!c };
    set('customer.id', custId);
    set('customer.name', c?.name ?? custName);
    set('customer.tags', c ? c.tags.join(', ') : '');
    set('customer.pinned', c?.pinned ?? false);
    const orders = custId ? await db.orders.where('counterpartyId').equals(custId).filter((o) => o.direction === 'sale').count() : custName ? await db.orders.where('counterpartyName').equals(custName).filter((o) => o.direction === 'sale').count() : 0;
    set('customer.orderCount', orders);
  }
  chatId ??= privateChatId(opts.selfUserId, custId);

  const listingId = str(p['listingId']);
  if (listingId) listingIds.add(listingId);
  const nodeId = str(p['nodeId']);
  if (nodeId && event.type === 'PRICE_CHANGE_DETECTED') {
    const mine = await db.listings.where('nodeId').equals(nodeId).primaryKeys();
    for (const id of mine) listingIds.add(String(id));
  }
  const firstListing = listingId ?? order?.listingId ?? null;
  if (firstListing) {
    const l = await db.listings.get(firstListing);
    if (l) {
      set('listing.id', l.id);
      set('listing.title', l.title);
      set('listing.priceMinor', l.price.amountMinor);
      set('listing.active', l.active);
      set('listing.amount', l.amount);
      set('listing.category', l.categoryName);
    }
  }

  const poolId = str(p['poolId']);
  if (poolId) {
    set('inventory.available', await availableCount(poolId));
    set('inventory.pool', str(p['poolName']) ?? poolId);
  } else if (order) {
    const m = await findPoolForOrder(order);
    if (m.kind === 'match') {
      set('inventory.available', await availableCount(m.pool.id));
      set('inventory.pool', m.pool.name);
    }
  }

  set('time.hour', opts.now.getHours());
  set('time.weekday', opts.now.getDay());
  set('time.hhmm', `${String(opts.now.getHours()).padStart(2, '0')}:${String(opts.now.getMinutes()).padStart(2, '0')}`);
  set('self.name', opts.selfName ?? null);

  return { event, vars, chatId, customer, listingIds: [...listingIds], baseline: p['baseline'] === true };
}

const ALIASES: Record<string, readonly string[]> = {
  buyer: ['customer.name', 'order.buyer', 'payload.buyer', 'payload.authorName'],
  order_id: ['order.id', 'payload.orderId'],
  product: ['order.description', 'listing.title'],
  lot: ['order.description', 'listing.title'],
  stars: ['payload.stars'],
  message: ['payload.text'],
  text: ['payload.text'],
  seller: ['self.name'],
  pool: ['inventory.pool'],
  available: ['inventory.available'],
};

/**
 * Render `{path}` / `{alias}` placeholders. Unknown or empty placeholders are left as-is and
 * reported, so buyer-facing sends can refuse to go out half-rendered.
 */
export function renderTemplate(template: string, ctx: Pick<WorkflowContext, 'vars' | 'chatId'>, now = new Date()): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const text = template.replace(/\{([\w.]{1,60})\}/g, (whole, key: string) => {
    let value: Primitive | undefined;
    if (key === 'date') value = now.toLocaleDateString();
    else if (key === 'time') value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    else if (key === 'chat_url') value = ctx.chatId ? `https://funpay.com/chat/?node=${ctx.chatId}` : null;
    else if (key === 'price') value = typeof ctx.vars['order.price'] === 'number' ? `${ctx.vars['order.price']} ${ctx.vars['order.currency'] ?? ''}`.trim() : null;
    else if (key in ctx.vars) value = ctx.vars[key];
    else for (const path of ALIASES[key] ?? []) {
      const v = ctx.vars[path];
      if (v !== null && v !== undefined && v !== '') {
        value = v;
        break;
      }
    }
    if (value === null || value === undefined || value === '') {
      unresolved.push(key);
      return whole;
    }
    return String(value);
  });
  return { text, unresolved };
}
