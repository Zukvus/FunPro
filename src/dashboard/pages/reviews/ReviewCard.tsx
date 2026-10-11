import { ExternalLink, MessageSquareReply, Sparkles, Star } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@/core/messaging/client';
import { draftWarnings, type AiFallbackInfo } from '@/features/ai';
import {
  dismissReviewDraft,
  draftReviewReply,
  lintReviewReply,
  REVIEW_REPLY_MAX,
  saveReviewReplyDraft,
  templateReplyFor,
  type ReviewRow,
} from '@/features/reviews';
import type { ReviewTemplate } from '@/shared/models';
import { formatMoney } from '@/shared/models/money';
import { Badge, Button, ConfirmDialog, Textarea, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { AiErrorNote, WarningList, type AiStatus } from '../ai/shared';

export function Stars({ value }: { value: number | null }) {
  const n = value ?? 0;
  return (
    <span className="inline-flex items-center gap-0.5 text-warning" aria-label={value ? `${value} / 5` : '—'}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={13} fill={i <= n ? 'currentColor' : 'none'} aria-hidden />
      ))}
    </span>
  );
}

export function ReviewCard({
  row,
  templates,
  aiStatus,
}: {
  row: ReviewRow;
  templates: readonly ReviewTemplate[];
  aiStatus: AiStatus;
}) {
  const t = useT();
  const lang = useLang();
  const { review, order, draft } = row;
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(draft?.text ?? '');
  const [busy, setBusy] = useState<'ai' | 'send' | 'save' | null>(null);
  const [aiNote, setAiNote] = useState<AiFallbackInfo | undefined>();
  const [confirm, setConfirm] = useState(false);
  const aiReady = aiStatus?.ok === true;
  const issues = text.trim() ? lintReviewReply(text) : [];
  const warnings = text.trim() ? draftWarnings(text).filter((w) => w !== 'off_platform') : [];
  const orderUrl = `https://funpay.com/orders/${encodeURIComponent(review.orderId)}/`;
  const date = review.at ? new Date(review.at).toLocaleString() : review.rawDate;

  const useTemplate = () => {
    const r = templateReplyFor(review, order, templates, lang);
    setText(r.text);
    setAiNote(undefined);
  };

  const aiDraft = async () => {
    setBusy('ai');
    try {
      const r = await draftReviewReply(review, order, { lang, useAi: aiReady, templates });
      setText(r.text);
      setAiNote(r.aiError);
      if (r.aiError) toast.info(t('reviews.reply.fallback'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveDraft = async () => {
    setBusy('save');
    try {
      await saveReviewReplyDraft(
        review,
        { text: text.trim(), source: 'template', templateId: null },
        { edited: true },
      );
      toast.success(t('reviews.reply.draftSaved'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    setBusy('send');
    try {
      await rpc('ui.replyReview', { orderId: review.orderId, text: text.trim(), draftId: draft?.id });
      toast.success(t('reviews.reply.sent'));
      setConfirm(false);
      setOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <article className="rounded-xl border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Stars value={review.stars} />
          <span className="fp-sensitive font-medium">{review.authorName || '—'}</span>
          <span className="text-xs text-muted">{date}</span>
          {!review.sellerReply && <Badge tone="warning">{t('reviews.unanswered')}</Badge>}
          {draft && (
            <Badge tone="info">
              {t(draft.meta?.['auto'] ? 'reviews.draft.auto' : 'reviews.draft.pending')}
            </Badge>
          )}
        </div>
        <a
          href={orderUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="fp-sensitive inline-flex items-center gap-1 text-xs text-accent hover:underline"
        >
          #{review.orderId} <ExternalLink size={12} aria-hidden />
        </a>
      </header>

      <div className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">
        {order ? (
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className="text-fg">{order.description || order.categoryName || '—'}</span>
            {order.categoryName && order.description && <span>{order.categoryName}</span>}
            {order.price.currency !== 'UNKNOWN' && (
              <span className="fp-balance">{formatMoney(order.price)}</span>
            )}
            <span>
              {t('reviews.buyer')}: <span className="fp-sensitive">{order.counterpartyName || '—'}</span>
            </span>
            {order.createdAt && <span>{new Date(order.createdAt).toLocaleDateString()}</span>}
            <span>{t(`reviews.orderStatus.${order.status}`)}</span>
          </div>
        ) : (
          <span>{t('reviews.noOrder')}</span>
        )}
      </div>

      <p className={cn('mt-3 whitespace-pre-wrap text-sm', !review.text.trim() && 'italic text-muted')}>
        {review.text.trim() || t('reviews.noText')}
      </p>

      {review.sellerReply && (
        <div className="mt-3 border-l-2 border-accent pl-3 text-sm">
          <p className="text-xs font-semibold text-muted">{t('reviews.yourReply')}</p>
          <p className="whitespace-pre-wrap">{review.sellerReply}</p>
        </div>
      )}

      {draft && typeof draft.meta?.['note'] === 'string' && (
        <p className="mt-2 text-xs text-muted">{String(draft.meta['note'])}</p>
      )}

      {!review.sellerReply && (
        <div className="mt-3">
          {!open ? (
            <Button
              size="sm"
              variant={draft ? 'primary' : 'outline'}
              icon={<MessageSquareReply size={14} />}
              onClick={() => {
                setOpen(true);
                if (!text && draft) setText(draft.text);
              }}
            >
              {draft ? t('reviews.reply.review') : t('reviews.reply.open')}
            </Button>
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={useTemplate}>
                  {t('reviews.reply.template', { stars: review.stars ?? '?' })}
                </Button>
                <Button
                  size="sm"
                  icon={<Sparkles size={14} />}
                  onClick={() => void aiDraft()}
                  loading={busy === 'ai'}
                  title={aiReady ? undefined : t('reviews.reply.aiOff')}
                >
                  {aiReady ? t('reviews.reply.ai') : t('reviews.reply.aiFallback')}
                </Button>
              </div>
              <AiErrorNote error={aiNote} />
              <Textarea
                value={text}
                maxLength={REVIEW_REPLY_MAX}
                rows={4}
                onChange={(e) => setText(e.target.value)}
                aria-label={t('reviews.reply.label')}
              />
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>{t('reviews.reply.public')}</span>
                <span>
                  {text.length}/{REVIEW_REPLY_MAX}
                </span>
              </div>
              {issues.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger" role="list">
                  {issues.map((i) => (
                    <li key={i}>{t(`reviews.issue.${i}`)}</li>
                  ))}
                </ul>
              )}
              <WarningList warnings={warnings} />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!text.trim() || issues.length > 0}
                  onClick={() => setConfirm(true)}
                >
                  {t('reviews.reply.send')}
                </Button>
                <Button
                  size="sm"
                  disabled={!text.trim() || issues.length > 0}
                  loading={busy === 'save'}
                  onClick={() => void saveDraft()}
                >
                  {t('reviews.reply.saveDraft')}
                </Button>
                {draft && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void dismissReviewDraft(draft.id).then(() => setText(''))}
                  >
                    {t('reviews.reply.dismiss')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                  {t('common.close')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirm}
        title={t('reviews.confirm.title')}
        confirmLabel={t('reviews.confirm.button')}
        busy={busy === 'send'}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void send()}
      >
        <p className="mb-2">{t('reviews.confirm.body')}</p>
        <blockquote className="fp-sensitive mb-2 whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-sm">
          {text.trim()}
        </blockquote>
        <p className="text-xs text-muted">{t('reviews.confirm.unverified')}</p>
      </ConfirmDialog>
    </article>
  );
}
