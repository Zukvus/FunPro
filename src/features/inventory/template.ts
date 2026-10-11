/**
 * Delivery message rendering. `{item}` is replaced with the decrypted goods (one per line when an
 * order needs several items). Rendering happens in memory only; the masked variant is what FunPro
 * keeps for history and previews.
 */
import { formatMoney, type Money } from '@/shared/models/money';

export const MASK = '••••••';

export interface DeliveryVars {
  orderId: string;
  buyer: string;
  quantity: number;
  lot: string;
  category: string;
  price: Money | null;
}

export const DELIVERY_VARIABLES = ['item', 'order_id', 'buyer', 'quantity', 'lot', 'category', 'price'] as const;

export function renderDeliveryMessage(template: string, items: readonly string[], vars: DeliveryVars): string {
  const values: Record<string, string> = {
    item: items.join('\n'),
    items: items.join('\n'),
    order_id: vars.orderId,
    order: vars.orderId,
    buyer: vars.buyer,
    quantity: String(vars.quantity),
    lot: vars.lot,
    category: vars.category,
    price: vars.price && vars.price.currency !== 'UNKNOWN' ? formatMoney(vars.price) : '',
  };
  let usedItem = false;
  const out = template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (key === 'item' || key === 'items') usedItem = true;
    return key in values ? values[key]! : whole;
  });
  // A template without {item} would deliver nothing: append the goods so the buyer always gets them.
  return usedItem ? out : `${out}\n${values['item']}`;
}

/** The same message with every item masked — safe to store and display. */
export function renderMaskedMessage(template: string, itemCount: number, vars: DeliveryVars): string {
  return renderDeliveryMessage(template, Array.from({ length: Math.max(1, itemCount) }, () => MASK), vars);
}

/** Private chat id convention: `users-{min}-{max}` (numeric FunPay user ids). */
export function privateChatId(selfId: string | null | undefined, buyerId: string | null | undefined): string | null {
  if (!selfId || !buyerId || !/^\d{1,15}$/.test(selfId) || !/^\d{1,15}$/.test(buyerId) || selfId === buyerId) return null;
  const a = Number(selfId);
  const b = Number(buyerId);
  return `users-${Math.min(a, b)}-${Math.max(a, b)}`;
}
