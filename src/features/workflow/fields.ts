/**
 * Field suggestions for the rule builder, per trigger. Every event also gets the enriched
 * `customer.*`, `time.*` and (when an order is involved) `order.*` / `inventory.*` variables.
 */
import type { EventType } from '@/shared/models';

export type FieldType = 'text' | 'number' | 'boolean';
export interface FieldDef {
  path: string;
  type: FieldType;
}

const ORDER: FieldDef[] = [
  { path: 'payload.orderId', type: 'text' },
  { path: 'payload.buyer', type: 'text' },
  { path: 'payload.status', type: 'text' },
  { path: 'payload.baseline', type: 'boolean' },
  { path: 'order.description', type: 'text' },
  { path: 'order.category', type: 'text' },
  { path: 'order.price', type: 'number' },
  { path: 'order.currency', type: 'text' },
  { path: 'order.quantity', type: 'number' },
  { path: 'delivery.status', type: 'text' },
  { path: 'inventory.available', type: 'number' },
  { path: 'inventory.pool', type: 'text' },
];
const CUSTOMER: FieldDef[] = [
  { path: 'customer.name', type: 'text' },
  { path: 'customer.tags', type: 'text' },
  { path: 'customer.orderCount', type: 'number' },
  { path: 'customer.pinned', type: 'boolean' },
];
const TIME: FieldDef[] = [
  { path: 'time.hour', type: 'number' },
  { path: 'time.weekday', type: 'number' },
];

export const TRIGGER_FIELDS: Record<EventType, FieldDef[]> = {
  ORDER_DETECTED: [...ORDER, ...CUSTOMER, ...TIME],
  ORDER_PAID: [...ORDER, ...CUSTOMER, ...TIME],
  ORDER_COMPLETED: [...ORDER, ...CUSTOMER, ...TIME],
  ORDER_CANCELLED: [...ORDER, ...CUSTOMER, ...TIME],
  MESSAGE_RECEIVED: [
    { path: 'payload.text', type: 'text' },
    { path: 'payload.authorName', type: 'text' },
    { path: 'payload.chatId', type: 'text' },
    ...CUSTOMER,
    ...TIME,
  ],
  REVIEW_RECEIVED: [
    { path: 'payload.stars', type: 'number' },
    { path: 'payload.authorName', type: 'text' },
    { path: 'payload.hasReply', type: 'boolean' },
    { path: 'payload.orderId', type: 'text' },
    { path: 'order.description', type: 'text' },
    ...CUSTOMER,
    ...TIME,
  ],
  LISTING_UPDATED: [
    { path: 'payload.listingId', type: 'text' },
    { path: 'listing.title', type: 'text' },
    { path: 'listing.priceMinor', type: 'number' },
    { path: 'listing.active', type: 'boolean' },
    { path: 'listing.amount', type: 'number' },
    ...TIME,
  ],
  LISTING_BUMP_AVAILABLE: [{ path: 'payload.gameId', type: 'text' }, { path: 'payload.nodeId', type: 'text' }, ...TIME],
  PRICE_CHANGE_DETECTED: [
    { path: 'payload.nodeId', type: 'text' },
    { path: 'payload.offerId', type: 'text' },
    { path: 'payload.seller', type: 'text' },
    { path: 'payload.from', type: 'number' },
    { path: 'payload.to', type: 'number' },
    ...TIME,
  ],
  INVENTORY_LOW: [
    { path: 'payload.poolName', type: 'text' },
    { path: 'payload.available', type: 'number' },
    { path: 'payload.threshold', type: 'number' },
    { path: 'payload.bucket', type: 'text' },
    ...TIME,
  ],
  AUTOMATION_FAILED: [{ path: 'payload.feature', type: 'text' }, { path: 'payload.message', type: 'text' }, ...TIME],
  SESSION_CHANGED: [{ path: 'payload.status', type: 'text' }, ...TIME],
};

/** Placeholders usable in notification / log / reply texts. */
export const TEMPLATE_PLACEHOLDERS = ['{buyer}', '{order_id}', '{product}', '{price}', '{date}', '{time}', '{chat_url}', '{payload.text}', '{customer.tags}', '{inventory.available}'];
