import { useLiveQuery } from 'dexie-react-hooks';
import { Bell, CheckCheck, ExternalLink, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import { getDb } from '@/core/db/db';
import { safeFunPayUrl } from '@/core/security/sanitize';
import { clearNotifications, filterNotifications, markAllNotificationsRead, markNotificationRead, NOTIFICATION_KINDS, type CenterFilter } from '@/features/notifications';
import type { NotificationItem } from '@/shared/models';
import { Badge, Button, ConfirmDialog, EmptyState, IconButton, Input, Select, Switch } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';

const KIND_TONE: Record<NotificationItem['kind'], 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info'> = {
  order: 'success',
  message: 'info',
  review: 'accent',
  bump: 'neutral',
  inventory: 'warning',
  price: 'neutral',
  failure: 'danger',
  system: 'neutral',
};

const SENSITIVE_KINDS = new Set(['order', 'message', 'review']);

function open(url: string | null): void {
  if (!url) return;
  const origin = browser.runtime.getURL('/').replace(/\/$/, '');
  if (url.startsWith(`${origin}/`)) {
    window.location.href = url;
    return;
  }
  const safe = /^https:\/\//i.test(url) ? safeFunPayUrl(url) : null;
  if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
}

export function Inbox() {
  const t = useT();
  const [filter, setFilter] = useState<CenterFilter>({ query: '', kind: 'all', unreadOnly: false });
  const [confirmClear, setConfirmClear] = useState(false);
  const items = useLiveQuery(() => getDb().notifications.orderBy('at').reverse().limit(1000).toArray(), []);
  const visible = useMemo(() => filterNotifications(items ?? [], filter), [items, filter]);
  const unread = (items ?? []).filter((n) => !n.read).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <Input type="search" placeholder={t('common.search')} value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })} />
        </div>
        <Select aria-label={t('notifPage.filter.kind')} value={filter.kind} onChange={(e) => setFilter({ ...filter, kind: e.target.value as CenterFilter['kind'] })} className="w-44">
          <option value="all">{t('notifPage.filter.allKinds')}</option>
          {NOTIFICATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`notifPage.kind.${k}`)}
            </option>
          ))}
        </Select>
        <Switch checked={filter.unreadOnly} onChange={(v) => setFilter({ ...filter, unreadOnly: v })} label={t('notifPage.filter.unread', { n: unread })} />
        <Button size="sm" icon={<CheckCheck size={14} />} onClick={() => void markAllNotificationsRead()} disabled={unread === 0}>
          {t('notifPage.markAllRead')}
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => setConfirmClear(true)} disabled={!items?.length}>
          {t('notifPage.clear')}
        </Button>
      </div>

      {items !== undefined && visible.length === 0 ? (
        <EmptyState icon={<Bell size={22} />} title={t('notifPage.empty.title')}>
          {t('notifPage.empty.body')}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-surface" role="list">
          {visible.slice(0, 300).map((n) => (
            <li key={n.id} className={cn('flex items-start gap-3 px-4 py-3', !n.read && 'bg-accent-soft/40')}>
              <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-accent')} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={KIND_TONE[n.kind]}>{t(`notifPage.kind.${n.kind}`)}</Badge>
                  <span className="text-sm font-medium">{n.title}</span>
                  <span className="text-[11px] text-muted">{new Date(n.at).toLocaleString()}</span>
                </div>
                {n.body && <p className={cn('mt-0.5 whitespace-pre-wrap break-words text-xs text-muted', SENSITIVE_KINDS.has(n.kind) && 'fp-sensitive')}>{n.body}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {n.url && (
                  <IconButton
                    label={t('notifPage.open')}
                    onClick={() => {
                      void markNotificationRead(n.id);
                      open(n.url);
                    }}
                  >
                    <ExternalLink size={14} />
                  </IconButton>
                )}
                <Button size="sm" variant="ghost" onClick={() => void markNotificationRead(n.id, !n.read)}>
                  {n.read ? t('notifPage.markUnread') : t('notifPage.markRead')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {visible.length > 300 && <p className="text-center text-xs text-muted">{t('notifPage.truncated', { n: visible.length })}</p>}

      <ConfirmDialog
        open={confirmClear}
        danger
        title={t('notifPage.clearTitle')}
        confirmLabel={t('notifPage.clear')}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          void clearNotifications(filter.kind);
          setConfirmClear(false);
        }}
      >
        {filter.kind === 'all' ? t('notifPage.clearAllBody') : t('notifPage.clearKindBody', { kind: t(`notifPage.kind.${filter.kind}`) })}
      </ConfirmDialog>
    </div>
  );
}
