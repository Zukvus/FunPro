import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, ExternalLink, MessageSquare, Pin, Search, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  chatIdForCustomer,
  computeCustomerStats,
  customerOrders,
  MAX_TAGS,
  normalizeTag,
  updateCustomer,
} from '@/features/crm/customers';
import { isFollowUpNotified } from '@/features/crm/followUps';
import { formatMoney, type Currency } from '@/shared/models/money';
import type { Customer } from '@/shared/models';
import { Badge, Button, Field, Input, Modal, StatCard, Switch, Textarea, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { fmtDateTime, funpayChatUrl, toLocalInput, useLocale } from '../messages/shared';

export function formatTotals(totals: Partial<Record<Currency, number>>, locale: string): string {
  const parts = Object.entries(totals).map(([currency, amountMinor]) =>
    formatMoney({ amountMinor: amountMinor ?? 0, currency: currency as Currency }, locale),
  );
  return parts.length ? parts.join(' · ') : '—';
}

const STATUS_TONE = { paid: 'info', closed: 'success', refunded: 'danger', unknown: 'neutral' } as const;

export function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const t = useT();
  const locale = useLocale();
  const { status } = useDashboard();
  const selfUserId = status?.session?.userId ?? null;
  const orders = useLiveQuery(() => customerOrders(customer), [customer.id, customer.name]);
  const chatId = useLiveQuery(
    () => chatIdForCustomer(customer, selfUserId),
    [customer.id, customer.name, selfUserId],
  );
  const notified = useLiveQuery(
    async () => (customer.followUpAt ? isFollowUpNotified(customer.id, customer.followUpAt) : false),
    [customer.id, customer.followUpAt],
  );
  const stats = computeCustomerStats(orders ?? []);

  const [notes, setNotes] = useState(customer.notes);
  const [tagInput, setTagInput] = useState('');
  const [followAt, setFollowAt] = useState(
    customer.followUpAt ? toLocalInput(Date.parse(customer.followUpAt)) : '',
  );
  const [followNote, setFollowNote] = useState(customer.followUpNote);

  useEffect(() => {
    setNotes(customer.notes);
    setFollowAt(customer.followUpAt ? toLocalInput(Date.parse(customer.followUpAt)) : '');
    setFollowNote(customer.followUpNote);
  }, [customer.id, customer.notes, customer.followUpAt, customer.followUpNote]);

  const patch = async (p: Parameters<typeof updateCustomer>[1], ok = t('crm.saved')) => {
    try {
      await updateCustomer(customer.id, p);
      toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const addTag = () => {
    const tag = normalizeTag(tagInput);
    if (!tag) return;
    if (customer.tags.length >= MAX_TAGS) {
      toast.error(t('crm.tags.limit', { max: MAX_TAGS }));
      return;
    }
    setTagInput('');
    void patch({ tags: [...customer.tags, tag] });
  };

  return (
    <Modal open onClose={onClose} wide title={<span className="fp-sensitive">{customer.name}</span>}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {stats.repeatBuyer && <Badge tone="success">{t('crm.repeat')}</Badge>}
          {customer.pinned && (
            <Badge tone="accent">
              <Pin size={10} aria-hidden /> {t('crm.pinned')}
            </Badge>
          )}
          <span className="text-[11px] text-muted">
            {/^\d+$/.test(customer.id) ? t('crm.userId', { id: customer.id }) : t('crm.noUserId')}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {chatId && (
              <>
                <a
                  href={`#/messages?chat=${encodeURIComponent(chatId)}`}
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs hover:bg-surface-2"
                >
                  <MessageSquare size={14} aria-hidden /> {t('crm.openInbox')}
                </a>
                <a
                  href={funpayChatUrl(chatId)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs hover:bg-surface-2"
                >
                  <ExternalLink size={14} aria-hidden /> {t('msg.inbox.openFunPay')}
                </a>
              </>
            )}
            <a
              href={`#/messages?q=${encodeURIComponent(customer.name)}`}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs hover:bg-surface-2"
            >
              <Search size={14} aria-hidden /> {t('crm.searchMessages')}
            </a>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label={t('crm.col.orders')}
            value={stats.orderCount}
            hint={stats.refundedCount ? t('crm.refunded', { count: stats.refundedCount }) : undefined}
          />
          <StatCard
            label={t('crm.col.spent')}
            value={formatTotals(stats.totalSpent, locale)}
            sensitive
            hint={t('crm.spentHint')}
          />
          <StatCard
            label={t('crm.col.lastOrder')}
            value={fmtDateTime(stats.lastOrderAt, locale)}
            hint={
              stats.firstOrderAt
                ? t('crm.firstOrder', { date: fmtDateTime(stats.firstOrderAt, locale) })
                : undefined
            }
          />
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-3">
            <Switch
              checked={customer.pinned}
              onChange={(v) => void patch({ pinned: v })}
              label={t('crm.pin')}
              description={t('crm.pinHelp')}
            />
            <Field label={t('crm.notes')} htmlFor="crm-notes" help={t('crm.notesHelp')}>
              <Textarea
                id="crm-notes"
                rows={4}
                maxLength={5000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Field>
            <Button
              size="sm"
              variant="outline"
              disabled={notes === customer.notes}
              onClick={() => void patch({ notes })}
            >
              {t('crm.saveNotes')}
            </Button>
            <div>
              <p className="mb-1 text-xs font-medium text-muted" id="crm-tags-label">
                {t('crm.tags')}
              </p>
              <ul className="mb-2 flex flex-wrap gap-1" aria-labelledby="crm-tags-label">
                {customer.tags.length === 0 && <li className="text-xs text-muted">{t('crm.tags.none')}</li>}
                {customer.tags.map((tag) => (
                  <li key={tag}>
                    <Badge tone="neutral">
                      {tag}
                      <button
                        type="button"
                        className="ml-0.5 rounded hover:text-danger"
                        aria-label={t('crm.tags.remove', { tag })}
                        onClick={() => void patch({ tags: customer.tags.filter((x) => x !== tag) })}
                      >
                        <X size={10} />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ul>
              <div className="flex gap-2">
                <Input
                  value={tagInput}
                  maxLength={30}
                  placeholder={t('crm.tags.placeholder')}
                  aria-label={t('crm.tags.add')}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                />
                <Button size="sm" variant="outline" onClick={addTag} disabled={!normalizeTag(tagInput)}>
                  {t('common.add')}
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-fg">
              <Bell size={14} aria-hidden /> {t('crm.followUp')}
            </p>
            <p className="text-xs text-muted">{t('crm.followUpHelp')}</p>
            <Field label={t('crm.followUpAt')} htmlFor="crm-follow-at">
              <Input
                id="crm-follow-at"
                type="datetime-local"
                value={followAt}
                onChange={(e) => setFollowAt(e.target.value)}
              />
            </Field>
            <Field label={t('crm.followUpNote')} htmlFor="crm-follow-note">
              <Input
                id="crm-follow-note"
                maxLength={500}
                value={followNote}
                onChange={(e) => setFollowNote(e.target.value)}
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                disabled={!followAt}
                onClick={() =>
                  void patch(
                    { followUpAt: new Date(followAt).toISOString(), followUpNote: followNote },
                    t('crm.followUpSet'),
                  )
                }
              >
                {t('crm.followUpSave')}
              </Button>
              {customer.followUpAt && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void patch({ followUpAt: null, followUpNote: '' }, t('crm.followUpCleared'))}
                >
                  {t('crm.followUpClear')}
                </Button>
              )}
            </div>
            {customer.followUpAt && (
              <p className="text-xs text-muted" role="status">
                {notified
                  ? t('crm.followUpNotified', { date: fmtDateTime(customer.followUpAt, locale) })
                  : t('crm.followUpScheduled', { date: fmtDateTime(customer.followUpAt, locale) })}
              </p>
            )}
          </div>
        </div>

        <section aria-labelledby="crm-history">
          <h3 id="crm-history" className="mb-2 text-sm font-semibold text-fg">
            {t('crm.history')}
          </h3>
          {orders === undefined ? (
            <p className="text-xs text-muted">{t('common.loading')}</p>
          ) : orders.length === 0 ? (
            <p className="text-xs text-muted">{t('crm.historyEmpty')}</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-surface-2 text-[11px] uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">{t('crm.order')}</th>
                    <th className="px-3 py-2 font-semibold">{t('crm.date')}</th>
                    <th className="px-3 py-2 font-semibold">{t('crm.item')}</th>
                    <th className="px-3 py-2 font-semibold">{t('crm.status')}</th>
                    <th className="px-3 py-2 text-right font-semibold">{t('crm.price')}</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <a
                          href={`https://funpay.com/orders/${encodeURIComponent(o.id)}/`}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="fp-sensitive font-mono text-accent hover:underline"
                        >
                          #{o.id}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {fmtDateTime(o.createdAt ?? o.firstSeenAt, locale)}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2" title={o.description}>
                        {o.description || o.categoryName || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[o.status]}>{t(`crm.orderStatus.${o.status}`)}</Badge>
                      </td>
                      <td className="fp-sensitive px-3 py-2 text-right tabular-nums">
                        {o.price.currency === 'UNKNOWN' ? '—' : formatMoney(o.price, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
