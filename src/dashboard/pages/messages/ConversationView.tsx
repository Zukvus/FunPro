import { useLiveQuery } from 'dexie-react-hooks';
import { Download, ExternalLink, Pin, PinOff, Send, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { RpcError, rpc } from '@/core/messaging/client';
import { cancelTask } from '@/core/queue/queue';
import { chatMessages, chatVariables, otherUserIdFromChatId } from '@/features/messages/context';
import { renderTemplate } from '@/features/messages/engine';
import { setChatPinned } from '@/features/messages/inbox';
import { lintText } from '@/features/messages/lint';
import { MAX_MESSAGE_LENGTH } from '@/features/messages/outbox';
import { automatedTexts, isAutomatedSelfMessage } from '@/features/messages/state';
import type { ChatMessage, Task } from '@/shared/models';
import { Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Select, Textarea, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { useDashboard } from '../../context';
import { fmtDateTime, fmtTime, funpayChatUrl, LintList, useLocale } from './shared';

interface SendResult {
  taskId: string;
  status: Task['status'];
  error: string | null;
}

function MessageItem({ m, automated }: { m: ChatMessage; automated: boolean }) {
  const t = useT();
  const locale = useLocale();
  const time = fmtTime(m.at, locale);
  if (m.kind === 'system') {
    return (
      <li className="mx-auto max-w-[90%] rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2 text-center text-xs text-muted">
        <span className="font-semibold text-fg">{t('msg.inbox.funpay')}</span>
        {time && <span> · {time}</span>}
        <p className="fp-sensitive mt-0.5 whitespace-pre-wrap break-words">{m.text || t('msg.inbox.noBody')}</p>
      </li>
    );
  }
  const self = m.kind === 'self';
  return (
    <li className={cn('flex', self ? 'justify-end' : 'justify-start')}>
      <div className={cn('max-w-[80%] rounded-2xl px-3 py-2 text-sm', self ? 'rounded-br-md bg-accent-soft text-fg' : 'rounded-bl-md border border-border bg-surface text-fg')}>
        <div className="mb-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
          <span className="fp-sensitive font-medium">{self ? t('msg.inbox.you') : m.authorName || t('msg.inbox.buyer')}</span>
          {automated && (
            <Badge tone="info" title={t('msg.inbox.autoTitle')}>
              {t('msg.inbox.auto')}
            </Badge>
          )}
          {time && <span>{time}</span>}
        </div>
        <p className="fp-sensitive whitespace-pre-wrap break-words">{m.text || t('msg.inbox.noBody')}</p>
      </div>
    </li>
  );
}

const TASK_TONE: Partial<Record<Task['status'], 'neutral' | 'warning' | 'danger' | 'success' | 'info'>> = {
  pending: 'info',
  running: 'info',
  awaiting_tab: 'warning',
  blocked: 'warning',
  failed: 'danger',
  done: 'success',
  cancelled: 'neutral',
};

export function ConversationView({ chatId }: { chatId: string }) {
  const t = useT();
  const locale = useLocale();
  const { status } = useDashboard();
  const selfUserId = status?.session?.userId ?? null;
  const sellerName = status?.session?.username ?? null;
  const chat = useLiveQuery(() => getDb().chats.get(chatId), [chatId]);
  const messages = useLiveQuery(() => chatMessages(chatId), [chatId]);
  const automated = useLiveQuery(() => automatedTexts(chatId), [chatId]);
  const outgoing = useLiveQuery(
    () =>
      getDb()
        .tasks.where('kind')
        .equals('send_message')
        .filter((task) => task.payload['chatId'] === chatId && (!['done', 'cancelled'].includes(task.status) || Date.now() - task.updatedAt < 86400_000))
        .toArray(),
    [chatId],
  );
  const customer = useLiveQuery(async () => {
    const db = getDb();
    const other = otherUserIdFromChatId(chatId, selfUserId);
    if (other) {
      const c = await db.customers.get(other);
      if (c) return c;
    }
    const name = (await db.chats.get(chatId))?.partnerName;
    return name ? db.customers.where('name').equalsIgnoreCase(name).first() : undefined;
  }, [chatId, selfUserId]);
  const templates = useLiveQuery(() => getDb().templates.orderBy('name').toArray(), []);

  const [text, setText] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const issues = useMemo(() => (text.trim() ? lintText(text) : []), [text]);
  const name = chat?.partnerName || chatId;

  const loadHistory = async () => {
    setLoading(true);
    try {
      const res = await rpc<{ stored: number }>('ui.messaging.fetchHistory', { chatId });
      toast.success(t('msg.inbox.historyLoaded', { count: res.stored }));
    } catch (e) {
      toast.error(e instanceof RpcError && e.code === 'no_tab' ? t('msg.sync.blocked') : (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const insertTemplate = async (id: string) => {
    const tpl = templates?.find((x) => x.id === id);
    if (!tpl) return;
    const { vars } = await chatVariables({ chatId, selfUserId, sellerName, now: new Date() });
    const body = renderTemplate(tpl.body, vars, { missing: 'keep' }).text;
    setText((prev) => (prev.trim() ? `${prev.trimEnd()}\n${body}` : body));
  };

  const send = async () => {
    setSending(true);
    try {
      const res = await rpc<SendResult>('ui.sendMessage', { chatId, text: text.trim() });
      if (res.status === 'done') toast.success(t('msg.send.sent'));
      else if (res.status === 'failed') toast.error(res.error ?? t('msg.send.failed'));
      else if (res.status === 'awaiting_tab') toast.info(t('msg.send.awaitingTab'));
      else toast.info(t('msg.send.queued'));
      if (res.status !== 'failed') setText('');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      setConfirm(false);
    }
  };

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_MESSAGE_LENGTH;

  return (
    <Card className="flex flex-col">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="fp-sensitive truncate text-base font-semibold text-fg">{name}</h2>
          <p className="text-[11px] text-muted">{chatId}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {customer && (
            <a href={`#/customers?id=${encodeURIComponent(customer.id)}`} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-accent hover:bg-surface-2">
              <UserRound size={14} aria-hidden /> {t('msg.inbox.customerCard')}
            </a>
          )}
          {chat && (
            <IconButton label={chat.pinned ? t('msg.inbox.unpin') : t('msg.inbox.pin')} onClick={() => void setChatPinned(chatId, !chat.pinned)}>
              {chat.pinned ? <PinOff size={16} /> : <Pin size={16} />}
            </IconButton>
          )}
          <Button size="sm" variant="outline" icon={<Download size={14} />} loading={loading} onClick={() => void loadHistory()}>
            {t('msg.inbox.loadHistory')}
          </Button>
          <a href={funpayChatUrl(chatId)} target="_blank" rel="noreferrer noopener" className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-3 text-xs text-fg hover:bg-surface-2">
            <ExternalLink size={14} aria-hidden /> {t('msg.inbox.openFunPay')}
          </a>
        </div>
      </header>

      <div className="max-h-[480px] min-h-[160px] overflow-y-auto pr-1">
        {messages === undefined ? (
          <p className="text-xs text-muted">{t('common.loading')}</p>
        ) : messages.length === 0 ? (
          <EmptyState title={t('msg.inbox.noMessagesTitle')}>{t('msg.inbox.noMessagesHelp')}</EmptyState>
        ) : (
          <ol aria-label={t('msg.inbox.conversation', { name })} className="space-y-2">
            {messages.map((m) => (
              <MessageItem key={m.id} m={m} automated={m.kind === 'self' && !!automated && isAutomatedSelfMessage(m, automated)} />
            ))}
          </ol>
        )}
      </div>

      {outgoing && outgoing.length > 0 && (
        <section className="mt-3 rounded-lg border border-border p-2" aria-label={t('msg.inbox.outgoing')}>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{t('msg.inbox.outgoing')}</p>
          <ul className="space-y-1">
            {outgoing.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
                <Badge tone={TASK_TONE[task.status] ?? 'neutral'}>{t(`msg.task.${task.status}`)}</Badge>
                <Badge tone="neutral">{t(`msg.source.${String(task.payload['source'])}`)}</Badge>
                <span className="fp-sensitive min-w-0 flex-1 truncate text-fg">{String(task.payload['text'] ?? '')}</span>
                <span className="text-muted">{fmtDateTime(task.status === 'pending' ? task.nextRunAt : task.updatedAt, locale)}</span>
                {task.lastError && <span className="w-full text-[11px] text-muted">{task.lastError}</span>}
                {(task.status === 'pending' || task.status === 'awaiting_tab' || task.status === 'blocked') && (
                  <Button size="sm" variant="ghost" onClick={() => void cancelTask(task.id)}>
                    {t('common.cancel')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        className="mt-3 space-y-2 border-t border-border pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed && !tooLong) setConfirm(true);
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="msg-compose" className="text-xs font-medium text-muted">
            {t('msg.compose.label')}
          </label>
          {templates && templates.length > 0 && (
            <Select
              value=""
              onChange={(e) => {
                if (e.target.value) void insertTemplate(e.target.value);
              }}
              aria-label={t('msg.compose.insertTemplate')}
              className="ml-auto h-8 w-56 text-xs"
            >
              <option value="">{t('msg.compose.insertTemplate')}</option>
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>
                  {tpl.command ? `/${tpl.command} · ` : ''}
                  {tpl.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <Textarea id="msg-compose" value={text} rows={3} maxLength={MAX_MESSAGE_LENGTH} onChange={(e) => setText(e.target.value)} placeholder={t('msg.compose.placeholder')} />
        <LintList issues={issues} />
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] text-muted">{t('msg.compose.note')}</p>
          <Button type="submit" variant="primary" icon={<Send size={14} />} disabled={!trimmed || tooLong}>
            {t('msg.compose.send')}
          </Button>
        </div>
      </form>

      <ConfirmDialog open={confirm} title={t('msg.compose.confirmTitle', { name })} confirmLabel={t('msg.compose.send')} busy={sending} onCancel={() => setConfirm(false)} onConfirm={() => void send()}>
        <p className="mb-2 text-xs text-muted">{t('msg.compose.confirmBody')}</p>
        <p className="fp-sensitive whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-3 text-sm">{trimmed}</p>
        <LintList issues={issues} className="mt-2" />
      </ConfirmDialog>
    </Card>
  );
}
