/**
 * Export rows for orders (CSV / XLSX / JSON through `features/export/table`).
 * Amounts are decimal major units with an explicit currency column — never converted or summed.
 */
import type { Cell } from '@/features/export/csv';
import type { TableExport } from '@/features/export/table';
import type { Order, OrderDirection } from '@/shared/models';
import { formatZoned } from '@/features/analytics/time';
import { minorToMajor } from '@/features/analytics/format';
import { orderUrl, splitQuantity } from './model';

export const ORDER_EXPORT_HEADERS = [
  'order_id',
  'direction',
  'status',
  'created_at_utc',
  'created_at_msk',
  'counterparty',
  'counterparty_id',
  'description',
  'category',
  'quantity',
  'amount',
  'currency',
  'order_url',
  'first_seen_at',
  'status_history',
] as const;

export function orderExportRow(o: Order): Cell[] {
  return [
    o.id,
    o.direction,
    o.status,
    o.createdAt ?? '',
    o.createdAt ? formatZoned(o.createdAt) : '',
    o.counterpartyName,
    o.counterpartyId ?? '',
    o.description,
    o.categoryName,
    splitQuantity(o.description).quantity,
    minorToMajor(o.price.amountMinor),
    o.price.currency,
    orderUrl(o.id) ?? '',
    o.firstSeenAt,
    o.history.map((h) => `${h.status}@${h.at}`).join('; '),
  ];
}

export function ordersExport(orders: readonly Order[], direction: OrderDirection): TableExport {
  return {
    name: direction === 'sale' ? 'funpro-sales' : 'funpro-purchases',
    headers: [...ORDER_EXPORT_HEADERS],
    rows: orders.map(orderExportRow),
    json: orders.map((o) => ({ ...o, url: orderUrl(o.id) })),
  };
}
