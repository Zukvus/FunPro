import { CheckCircle2, CircleDollarSign, HelpCircle, Undo2 } from 'lucide-react';
import { useCallback } from 'react';
import type { OrderStatus } from '@/shared/models';
import { Badge, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';

/** Copy to the clipboard from an extension page (user gesture), with a legacy fallback. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/** Returns `copy(text, successMessage)` which copies and shows a toast. */
export function useCopy(): (text: string, message: string) => Promise<void> {
  const t = useT();
  return useCallback(
    async (text: string, message: string) => {
      if (await copyText(text)) toast.success(message);
      else toast.error(t('orders.copy.failed'));
    },
    [t],
  );
}

const STATUS_TONE: Record<OrderStatus, 'info' | 'success' | 'danger' | 'neutral'> = {
  paid: 'info',
  closed: 'success',
  refunded: 'danger',
  unknown: 'neutral',
};
const STATUS_ICON: Record<OrderStatus, typeof CheckCircle2> = {
  paid: CircleDollarSign,
  closed: CheckCircle2,
  refunded: Undo2,
  unknown: HelpCircle,
};

/** Status badge: colour + icon + text, so the state never relies on colour alone. */
export function OrderStatusBadge({
  status,
  direction = 'sale',
}: {
  status: OrderStatus;
  direction?: 'sale' | 'purchase';
}) {
  const t = useT();
  const Icon = STATUS_ICON[status];
  return (
    <Badge tone={STATUS_TONE[status]} title={t(`orders.status.${status}.hint.${direction}`)}>
      <Icon size={11} aria-hidden />
      {t(`orders.status.${status}`)}
    </Badge>
  );
}
