import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, ExternalLink, FileText, MessageSquare, Star, User } from 'lucide-react';
import type { ReactNode } from 'react';
import { getDb } from '@/core/db/db';
import { chatUrl, orderTime, orderUrl, privateChatId, splitQuantity, userUrl } from '@/features/orders/model';
import { ticketEligibility } from '@/features/orders/ticket';
import { HOUR_MS } from '@/features/analytics/time';
import type { Order } from '@/shared/models';
import { Badge, Button } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useLang, useT } from '@/ui/i18n';
import { Amount, fmtDateTime } from '@/dashboard/components/charts';
import { useDashboard } from '@/dashboard/context';
import { Drawer } from './Drawer';
import { OrderStatusBadge, useCopy } from './shared';

function Row({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </div>
  );
}

const linkCls = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-fg hover:bg-surface-2';

export function OrderDrawer({ order, onClose, onDraftTicket }: { order: Order | null; onClose: () => void; onDraftTicket: (o: Order) => void }) {
  const t = useT();
  const lang = useLang();
  const copy = useCopy();
  const [settings] = useSettings();
  const { status } = useDashboard();
  const selfId = status?.session?.userId ?? null;
  const orderId = order?.id ?? null;
  const review = useLiveQuery(() => (orderId ? getDb().reviews.get(orderId) : undefined), [orderId]);
  const credits = useLiveQuery(() => (orderId ? getDb().financeOps.filter((op) => op.orderId === orderId).toArray() : []), [orderId], []);

  if (!order)
    return (
      <Drawer open={false} onClose={onClose} title="">
        {null}
      </Drawer>
    );

  const url = orderUrl(order.id);
  const chat = chatUrl(privateChatId(selfId, order.counterpartyId));
  const profile = userUrl(order.counterpartyId);
  const { quantity } = splitQuantity(order.description);
  const time = orderTime(order);
  const eligibility = ticketEligibility(order, Date.now(), settings.analytics.supportTicketAfterHours);
  const isSale = order.direction === 'sale';
  const ageHours = Math.floor((Date.now() - time.ts) / HOUR_MS);

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <span className="flex items-center gap-2">
          <span className="font-mono fp-sensitive">#{order.id}</span>
          <OrderStatusBadge status={order.status} direction={order.direction} />
        </span>
      }
      footer={
        <>
          <Button size="sm" variant="outline" icon={<Copy size={14} />} onClick={() => void copy(order.id, t('orders.copy.idCopied', { id: order.id }))}>
            {t('orders.action.copyId')}
          </Button>
          {url && (
            <a className={linkCls} href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink size={14} aria-hidden /> {t('orders.action.openOrder')}
            </a>
          )}
        </>
      }
    >
      <dl className="mb-4">
        <Row label={t('orders.col.amount')}>
          <Amount minor={order.price.amountMinor} currency={order.price.currency} className="font-semibold" />
        </Row>
        <Row label={t('orders.detail.created')}>
          {order.createdAt ? fmtDateTime(order.createdAt, lang) : <span className="text-muted">{t('orders.detail.unknownDate', { raw: order.rawDate || '—' })}</span>}
          {order.createdAt && <span className="ml-1 text-xs text-muted">({t('orders.msk')})</span>}
        </Row>
        <Row label={isSale ? t('orders.col.buyer') : t('orders.col.seller')}>
          <span className="fp-sensitive">{order.counterpartyName || '—'}</span>
          {profile && (
            <a href={profile} target="_blank" rel="noopener noreferrer" className="ml-2 inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <User size={12} aria-hidden /> {t('orders.action.profile')}
            </a>
          )}
        </Row>
        <Row label={t('orders.col.description')}>{order.description || '—'}</Row>
        <Row label={t('orders.col.category')}>{order.categoryName || '—'}</Row>
        <Row label={t('orders.detail.quantity')}>{quantity}</Row>
        <Row label={t('orders.detail.firstSeen')}>{fmtDateTime(order.firstSeenAt, lang)}</Row>
      </dl>

      <section className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('orders.detail.actions')}</h3>
        <div className="flex flex-wrap gap-2">
          {chat ? (
            <a className={linkCls} href={chat} target="_blank" rel="noopener noreferrer">
              <MessageSquare size={14} aria-hidden /> {t('orders.action.openChat')}
            </a>
          ) : (
            <span className="text-xs text-muted">{selfId ? t('orders.action.chatUnknownBuyer') : t('orders.action.chatUnknownSelf')}</span>
          )}
          {isSale && order.status === 'paid' && (
            <Button size="sm" variant="outline" icon={<FileText size={14} />} disabled={eligibility !== null} title={eligibility === 'too_recent' ? t('orders.ticket.reason.too_recent', { hours: settings.analytics.supportTicketAfterHours }) : undefined} onClick={() => onDraftTicket(order)}>
              {t('orders.action.draftTicket')}
            </Button>
          )}
        </div>
        {isSale && order.status === 'paid' && eligibility === 'too_recent' && (
          <p className="mt-1 text-xs text-muted">{t('orders.detail.ticketLater', { age: ageHours, hours: settings.analytics.supportTicketAfterHours })}</p>
        )}
      </section>

      <section className="mb-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('orders.detail.timeline')}</h3>
        <ol className="relative ml-2 border-l border-border pl-4">
          {order.createdAt && (
            <li className="mb-3">
              <span aria-hidden className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-accent" />
              <p className="text-sm text-fg">{t('orders.detail.createdOnFunPay')}</p>
              <p className="text-xs text-muted">{fmtDateTime(order.createdAt, lang)}</p>
            </li>
          )}
          {order.history.map((h, i) => (
            <li key={i} className="mb-3">
              <span aria-hidden className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-border" />
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={h.status} direction={order.direction} />
                <span className="text-xs text-muted">{t(`orders.detail.source.${h.source}`)}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted">{fmtDateTime(h.at, lang)}</p>
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-muted">{t('orders.detail.timelineNote')}</p>
      </section>

      {(credits.length > 0 || review) && (
        <section className="mb-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('orders.detail.related')}</h3>
          <ul className="space-y-2 text-sm">
            {credits.map((op) => (
              <li key={op.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <span>{t(`finance.kind.${op.kind}`)}</span>
                <span className="flex items-center gap-2">
                  <Amount minor={op.amount.amountMinor} currency={op.amount.currency} privacy="balance" />
                  <span className="text-xs text-muted">{op.at ? fmtDateTime(op.at, lang) : op.rawDate}</span>
                </span>
              </li>
            ))}
            {review && (
              <li className="rounded-lg bg-surface-2 px-3 py-2">
                <p className="flex items-center gap-1 text-xs text-muted">
                  <Star size={12} aria-hidden /> {t('orders.detail.review')}
                  {review.stars !== null && <Badge tone={review.stars >= 4 ? 'success' : review.stars <= 2 ? 'danger' : 'warning'}>{t('orders.detail.stars', { n: review.stars })}</Badge>}
                </p>
                {review.text && <p className="mt-1 whitespace-pre-wrap text-sm fp-sensitive">{review.text}</p>}
              </li>
            )}
          </ul>
        </section>
      )}
    </Drawer>
  );
}
