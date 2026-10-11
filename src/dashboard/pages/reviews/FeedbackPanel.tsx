import { useLiveQuery } from 'dexie-react-hooks';
import { Copy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { createFeedbackRequestDraft, FEEDBACK_REQUEST_TEMPLATES, privateChatId } from '@/features/reviews';
import { Button, Callout, Card, Field, Select, Textarea, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { useDashboard } from '../../context';

const RECENT_DAYS = 30;

export function FeedbackPanel() {
  const t = useT();
  const uiLang = useLang();
  const { status } = useDashboard();
  const selfId = status?.session?.userId ?? null;
  const [lang, setLang] = useState(uiLang);
  const [orderId, setOrderId] = useState('');
  const [text, setText] = useState('');

  const orders = useLiveQuery(async () => {
    const db = getDb();
    const since = new Date(Date.now() - RECENT_DAYS * 86400_000).toISOString();
    const closed = await db.orders
      .where('[direction+status]')
      .equals(['sale', 'closed'])
      .filter((o) => (o.createdAt ?? o.firstSeenAt) >= since)
      .toArray();
    const reviewed = new Set(
      (await db.reviews.bulkGet(closed.map((o) => o.id))).filter(Boolean).map((r) => r!.orderId),
    );
    return closed
      .filter((o) => !reviewed.has(o.id))
      .sort((a, b) => (b.createdAt ?? b.firstSeenAt).localeCompare(a.createdAt ?? a.firstSeenAt));
  }, []);
  const templates = useMemo(() => FEEDBACK_REQUEST_TEMPLATES.filter((x) => x.lang === lang), [lang]);
  const order = orders?.find((o) => o.id === orderId) ?? null;
  const chatId = order ? privateChatId(selfId, order.counterpartyId) : null;

  const create = async () => {
    if (!order) return;
    try {
      await createFeedbackRequestDraft(order, text, selfId);
      toast.success(t('reviews.feedback.created'));
      setText('');
      setOrderId('');
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('aiPage.play.copyFailed'));
    }
  };

  return (
    <div className="space-y-5">
      <Callout tone="info" title={t('reviews.feedback.limitTitle')}>
        {t('reviews.feedback.limitBody')}
      </Callout>
      <Card title={t('reviews.feedback.templatesTitle')} description={t('reviews.feedback.templatesHelp')}>
        <Field label={t('reviews.feedback.language')}>
          <Select value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} className="w-32">
            <option value="ru">Русский</option>
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </Select>
        </Field>
        <div className="mt-3 space-y-2">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-border p-3 text-sm"
            >
              <p className="whitespace-pre-wrap">{tpl.text}</p>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Copy size={14} />}
                  onClick={() => void copy(tpl.text)}
                  aria-label={t('common.copy')}
                />
                <Button size="sm" onClick={() => setText(tpl.text)}>
                  {t('reviews.feedback.use')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card
        title={t('reviews.feedback.draftTitle')}
        description={t('reviews.feedback.draftHelp', { days: RECENT_DAYS })}
      >
        <div className="grid gap-3">
          <Field
            label={t('reviews.feedback.order')}
            error={order && !chatId ? t('reviews.feedback.noChat') : undefined}
          >
            <Select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">
                {orders && orders.length === 0
                  ? t('reviews.feedback.noOrders')
                  : t('reviews.feedback.pickOrder')}
              </option>
              {(orders ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.id} — {o.counterpartyName || '—'} — {o.description.slice(0, 50)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('reviews.feedback.message')}>
            <Textarea rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div>
            <Button
              variant="primary"
              disabled={!order || !chatId || !text.trim()}
              onClick={() => void create()}
            >
              {t('reviews.feedback.create')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('reviews.feedback.rules')}</p>
        </div>
      </Card>
    </div>
  );
}
