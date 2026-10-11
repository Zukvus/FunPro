import { useLiveQuery } from 'dexie-react-hooks';
import { CalendarClock, Check, Copy, ExternalLink, Inbox, Send, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb, type DraftReply } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { approveDraft, dismissDraft, isChatDraft, isSendable, revertApproval, updateDraftText } from '@/features/messages/drafts';
import { lintText } from '@/features/messages/lint';
import { MAX_MESSAGE_LENGTH } from '@/features/messages/outbox';
import { scheduleMessage, ScheduleError, updateScheduled } from '@/features/messages/scheduled';
import type { ChatSummary, Task } from '@/shared/models';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Select, Textarea, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { fmtDateTime, funpayChatUrl, LintList, toLocalInput, useLocale } from './shared';

interface SendResult {
  taskId: string;
  status: Task['status'];
  error: string | null;
}

function draftKind(d: DraftReply): string {
  const kind = d.meta?.['kind'];
  if (typeof kind === 'string') return kind;
  return d.source;
}

function DraftCard({ d, chat, triggerText }: { d: DraftReply; chat: ChatSummary | undefined; triggerText: string | null }) {
  const t = useT();
  const locale = useLocale();
  const [text, setText] = useState(d.text);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const issues = useMemo(() => lintText(text), [text]);
  const sendable = isSendable({ ...d, text });
  const reason = typeof d.meta?.['reason'] === 'string' ? (d.meta['reason'] as string) : null;
  const orderId = typeof d.meta?.['orderId'] === 'string' ? (d.meta['orderId'] as string) : null;
  const buyer = typeof d.meta?.['buyer'] === 'string' ? (d.meta['buyer'] as string) : null;
  const dirty = text.trim() !== d.text;

  const send = async () => {
    setBusy(true);
    try {
      const approved = await approveDraft(d.id, text);
      try {
        const res = await rpc<SendResult>('ui.sendMessage', { chatId: approved.chatId, text: approved.text, draftId: approved.id });
        if (res.status === 'done') toast.success(t('msg.send.sent'));
        else if (res.status === 'failed') toast.error(res.error ?? t('msg.send.failed'));
        else if (res.status === 'awaiting_tab') toast.info(t('msg.send.awaitingTab'));
        else toast.info(t('msg.send.queued'));
      } catch (e) {
        await revertApproval(d.id);
        toast.error((e as Error).message);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('msg.drafts.copyFailed'));
    }
  };

  return (
    <li className="rounded-xl border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="accent">{t(`msg.draftKind.${draftKind(d)}`)}</Badge>
        {reason && <Badge tone={reason === 'approval_required' ? 'info' : 'warning'}>{t(`msg.draftReason.${reason}`)}</Badge>}
        <span className="fp-sensitive font-medium text-fg">{chat?.partnerName || buyer || d.chatId || t('msg.drafts.unknownChat')}</span>
        {orderId && <span className="text-muted">#{orderId}</span>}
        <span className="ml-auto text-muted">{fmtDateTime(d.createdAt, locale)}</span>
      </div>
      {triggerText && (
        <p className="fp-sensitive mb-2 rounded-lg bg-surface-2 px-2 py-1 text-xs text-muted">
          <span className="font-medium">{t('msg.drafts.trigger')}</span> {triggerText}
        </p>
      )}
      <Textarea value={text} rows={3} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setText(e.target.value)} aria-label={t('msg.drafts.textLabel')} />
      <LintList issues={issues} className="mt-1" />
      {!sendable && d.chatId === '' && <p className="mt-1 text-xs text-warning">{t('msg.drafts.unaddressable')}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {sendable ? (
          <Button size="sm" variant="primary" icon={<Send size={14} />} loading={busy} onClick={() => setConfirm(true)}>
            {t('msg.drafts.approveSend')}
          </Button>
        ) : (
          <Button size="sm" variant="outline" icon={<Copy size={14} />} onClick={() => void copy()}>
            {t('common.copy')}
          </Button>
        )}
        {dirty && (
          <Button size="sm" variant="outline" icon={<Check size={14} />} onClick={() => void updateDraftText(d.id, text).then(() => toast.success(t('msg.drafts.saved')), (e: Error) => toast.error(e.message))}>
            {t('common.save')}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={() => void dismissDraft(d.id)}>
          {t('msg.drafts.dismiss')}
        </Button>
        {d.chatId ? (
          <a href={funpayChatUrl(d.chatId)} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
            <ExternalLink size={12} aria-hidden /> {t('msg.inbox.openFunPay')}
          </a>
        ) : (
          orderId && (
            <a href={`https://funpay.com/orders/${encodeURIComponent(orderId)}/`} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
              <ExternalLink size={12} aria-hidden /> {t('msg.drafts.openOrder')}
            </a>
          )
        )}
      </div>
      <ConfirmDialog open={confirm} title={t('msg.compose.confirmTitle', { name: chat?.partnerName || d.chatId })} confirmLabel={t('msg.compose.send')} busy={busy} onCancel={() => setConfirm(false)} onConfirm={() => void send()}>
        <p className="mb-2 text-xs text-muted">{t('msg.compose.confirmBody')}</p>
        <p className="fp-sensitive whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-sm">{text.trim()}</p>
        <LintList issues={issues} className="mt-2" />
      </ConfirmDialog>
    </li>
  );
}

function ScheduleForm({ chats }: { chats: ChatSummary[] }) {
  const t = useT();
  const [chatId, setChatId] = useState('');
  const [when, setWhen] = useState(() => toLocalInput(Date.now() + 3600_000));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const issues = useMemo(() => (text.trim() ? lintText(text) : []), [text]);

  const submit = async () => {
    setError(null);
    try {
      await scheduleMessage({ chatId, text, sendAt: new Date(when).getTime() });
      setText('');
      toast.success(t('msg.scheduled.created'));
    } catch (e) {
      setError(e instanceof ScheduleError ? t(`msg.scheduled.error.${e.code}`) : (e as Error).message);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <Field label={t('msg.scheduled.chat')} htmlFor="sched-chat">
          <Select id="sched-chat" value={chatId} onChange={(e) => setChatId(e.target.value)} required>
            <option value="">{t('msg.scheduled.pickChat')}</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {c.partnerName || c.id}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('msg.scheduled.when')} htmlFor="sched-when">
          <Input id="sched-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required />
        </Field>
      </div>
      <Field label={t('msg.scheduled.text')} htmlFor="sched-text">
        <Textarea id="sched-text" rows={3} maxLength={MAX_MESSAGE_LENGTH} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <LintList issues={issues} />
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-muted">{t('msg.scheduled.note')}</p>
        <Button type="submit" variant="primary" size="sm" icon={<CalendarClock size={14} />} disabled={!chatId || !text.trim()}>
          {t('msg.scheduled.schedule')}
        </Button>
      </div>
    </form>
  );
}

type ScheduleView = 'scheduled' | 'inOutbox' | 'sent' | 'failed' | 'dismissed';

const SCHEDULE_TONE: Record<ScheduleView, 'info' | 'success' | 'danger' | 'neutral' | 'warning'> = {
  scheduled: 'info',
  inOutbox: 'warning',
  sent: 'success',
  failed: 'danger',
  dismissed: 'neutral',
};

/** Waiting scheduled messages are `approved` without a task; with a task they are in the outbox. */
function scheduleView(d: DraftReply): ScheduleView {
  if (d.status === 'approved') return typeof d.meta?.['taskId'] === 'string' ? 'inOutbox' : 'scheduled';
  return d.status === 'pending' ? 'scheduled' : d.status;
}

export function DraftsTab() {
  const t = useT();
  const locale = useLocale();
  const drafts = useLiveQuery(() => getDb().drafts.orderBy('createdAt').reverse().toArray(), []);
  const chats = useLiveQuery(() => getDb().chats.toArray(), []);
  const chatById = useMemo(() => new Map((chats ?? []).map((c) => [c.id, c])), [chats]);
  const pending = (drafts ?? []).filter((d) => isChatDraft(d) && d.source !== 'scheduled' && d.status === 'pending');
  const foreign = (drafts ?? []).filter((d) => !isChatDraft(d) && d.status === 'pending').length;
  const scheduled = (drafts ?? []).filter((d) => d.source === 'scheduled' && (d.status !== 'dismissed' || Date.now() - d.updatedAt < 86400_000)).sort((a, b) => (a.sendAt ?? 0) - (b.sendAt ?? 0));
  const triggers = useLiveQuery(async () => {
    const db = getDb();
    const keys = pending.filter((d) => d.triggerMessageId).map((d) => [d.chatId, d.triggerMessageId!] as [string, string]);
    const msgs = await db.messages.bulkGet(keys);
    return new Map(msgs.filter(Boolean).map((m) => [`${m!.chatId}:${m!.id}`, m!.text]));
  }, [pending.map((d) => d.id).join(',')]);
  const tasks = useLiveQuery(async () => {
    const ids = scheduled.map((d) => d.meta?.['taskId']).filter((x): x is string => typeof x === 'string');
    const list = await getDb().tasks.bulkGet(ids);
    return new Map(list.filter(Boolean).map((task) => [task!.id, task!]));
  }, [scheduled.map((d) => `${d.id}:${String(d.meta?.['taskId'] ?? '')}`).join(',')]);
  const sortedChats = useMemo(() => [...(chats ?? [])].sort((a, b) => (a.partnerName || a.id).localeCompare(b.partnerName || b.id)), [chats]);

  return (
    <div className="space-y-4">
      <Card title={t('msg.drafts.title')} description={t('msg.drafts.description')}>
        {drafts === undefined ? (
          <p className="text-xs text-muted">{t('common.loading')}</p>
        ) : pending.length === 0 ? (
          <EmptyState icon={<Inbox size={22} />} title={t('msg.drafts.emptyTitle')}>
            {t('msg.drafts.emptyHelp')}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {pending.map((d) => (
              <DraftCard key={`${d.id}:${d.updatedAt}`} d={d} chat={chatById.get(d.chatId)} triggerText={d.triggerMessageId ? (triggers?.get(`${d.chatId}:${d.triggerMessageId}`) ?? null) : null} />
            ))}
          </ul>
        )}
        {foreign > 0 && <p className="mt-3 text-[11px] text-muted">{t('msg.drafts.foreign', { count: foreign })}</p>}
      </Card>

      <Card title={t('msg.scheduled.title')} description={t('msg.scheduled.description')}>
        {sortedChats.length === 0 ? <p className="text-xs text-muted">{t('msg.scheduled.noChats')}</p> : <ScheduleForm chats={sortedChats} />}
        {scheduled.length > 0 && (
          <ul className="mt-4 divide-y divide-border border-t border-border">
            {scheduled.map((d) => {
              const taskId = typeof d.meta?.['taskId'] === 'string' ? (d.meta['taskId'] as string) : null;
              const task = taskId ? tasks?.get(taskId) : undefined;
              const view = scheduleView(d);
              const blocked = d.meta?.['blocked'] === 'emergency_stop';
              const error = typeof d.meta?.['error'] === 'string' ? (d.meta['error'] as string) : null;
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                  <Badge tone={SCHEDULE_TONE[view]}>{t(`msg.scheduled.status.${view}`)}</Badge>
                  <span className="font-medium text-fg">{fmtDateTime(d.sendAt, locale)}</span>
                  <span className="fp-sensitive text-muted">{chatById.get(d.chatId)?.partnerName || d.chatId}</span>
                  <span className="fp-sensitive min-w-0 flex-1 truncate text-fg">{d.text}</span>
                  {blocked && view === 'scheduled' && <Badge tone="danger">{t('msg.scheduled.blockedStop')}</Badge>}
                  {task && view === 'inOutbox' && <span className="text-muted">{t(`msg.task.${task.status}`)}{task.lastError ? ` — ${task.lastError}` : ''}</span>}
                  {d.status === 'failed' && <span className="text-danger">{error === 'missed' ? t('msg.scheduled.missed') : error}</span>}
                  {d.status === 'failed' && (
                    <Button size="sm" variant="outline" onClick={() => void updateScheduled(d.id, { sendAt: Date.now() + 60_000 }).then(() => toast.success(t('msg.scheduled.rescheduled')), (e: Error) => toast.error(e.message))}>
                      {t('msg.scheduled.retry')}
                    </Button>
                  )}
                  {(view === 'scheduled' || view === 'failed') && (
                    <Button size="sm" variant="ghost" onClick={() => void dismissDraft(d.id)}>
                      {t('common.cancel')}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
