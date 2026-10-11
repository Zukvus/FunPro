import type { Cell } from '@/features/export/csv';
import type { TableExport } from '@/features/export/table';
import type { FinanceOperation } from '@/shared/models';
import { formatZoned } from '@/features/analytics/time';
import { minorToMajor } from '@/features/analytics/format';
import { orderUrl } from '@/features/orders/model';
import { opState } from './breakdown';

export const FINANCE_EXPORT_HEADERS = ['operation_id', 'at_utc', 'at_msk', 'kind', 'state', 'status_raw', 'amount', 'currency', 'description', 'order_id', 'order_url'] as const;

export function financeExportRow(op: FinanceOperation): Cell[] {
  return [
    op.id,
    op.at ?? '',
    op.at ? formatZoned(op.at) : op.rawDate,
    op.kind,
    opState(op),
    op.status,
    minorToMajor(op.amount.amountMinor),
    op.amount.currency,
    op.description,
    op.orderId ?? '',
    op.orderId ? (orderUrl(op.orderId) ?? '') : '',
  ];
}

export function financeExport(ops: readonly FinanceOperation[]): TableExport {
  return { name: 'funpro-finance', headers: [...FINANCE_EXPORT_HEADERS], rows: ops.map(financeExportRow), json: ops };
}
