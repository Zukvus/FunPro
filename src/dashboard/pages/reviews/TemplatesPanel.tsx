import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  deleteReviewTemplate,
  lintReviewReply,
  REVIEW_REPLY_MAX,
  saveReviewTemplate,
  seedDefaultReviewTemplates,
  setReviewTemplateEnabled,
} from '@/features/reviews';
import type { ReviewTemplate } from '@/shared/models';
import { Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Select, Switch, Textarea, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { Stars } from './ReviewCard';

function IssueList({ text }: { text: string }) {
  const t = useT();
  const issues = text.trim() ? lintReviewReply(text) : [];
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger" role="list">
      {issues.map((i) => (
        <li key={i}>{t(`reviews.issue.${i}`)}</li>
      ))}
    </ul>
  );
}

function TemplateRow({ tpl }: { tpl: ReviewTemplate }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(tpl.body);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = async () => {
    try {
      await saveReviewTemplate({ id: tpl.id, stars: tpl.stars, body, enabled: tpl.enabled });
      setEditing(false);
      toast.success(t('reviews.tpl.saved'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Textarea rows={3} maxLength={REVIEW_REPLY_MAX} value={body} onChange={(e) => setBody(e.target.value)} aria-label={t('reviews.tpl.body')} />
              <IssueList text={body} />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={() => void save()} disabled={!body.trim() || lintReviewReply(body).length > 0}>
                  {t('common.save')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setBody(tpl.body);
                    setEditing(false);
                  }}
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="whitespace-pre-wrap text-sm">{tpl.body}</p>
          )}
        </div>
        {!editing && (
          <div className="flex shrink-0 items-center gap-1">
            <Switch checked={tpl.enabled} onChange={(v) => void setReviewTemplateEnabled(tpl.id, v)} label={<span className="sr-only">{t('common.enabled')}</span>} />
            <IconButton label={t('common.edit')} onClick={() => setEditing(true)}>
              <Pencil size={14} />
            </IconButton>
            <IconButton label={t('common.delete')} onClick={() => setConfirmDelete(true)}>
              <Trash2 size={14} />
            </IconButton>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('reviews.tpl.deleteTitle')}
        confirmLabel={t('common.delete')}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          void deleteReviewTemplate(tpl.id);
          setConfirmDelete(false);
        }}
      >
        {tpl.body}
      </ConfirmDialog>
    </div>
  );
}

export function TemplatesPanel({ templates }: { templates: readonly ReviewTemplate[] }) {
  const t = useT();
  const lang = useLang();
  const [stars, setStars] = useState(5);
  const [body, setBody] = useState('');

  const add = async () => {
    try {
      await saveReviewTemplate({ stars, body, enabled: true });
      setBody('');
      toast.success(t('reviews.tpl.saved'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <Card title={t('reviews.tpl.addTitle')} description={t('reviews.tpl.help')}>
        <div className="grid gap-3 md:grid-cols-[120px_1fr]">
          <Field label={t('reviews.tpl.stars')}>
            <Select value={stars} onChange={(e) => setStars(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((s) => (
                <option key={s} value={s}>
                  {'★'.repeat(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('reviews.tpl.body')} help={t('reviews.tpl.variables')}>
            <Textarea rows={3} maxLength={REVIEW_REPLY_MAX} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
        </div>
        <div className="mt-2 space-y-2">
          <IssueList text={body} />
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => void add()} disabled={!body.trim() || lintReviewReply(body).length > 0}>
            {t('common.add')}
          </Button>
        </div>
      </Card>

      {templates.length === 0 ? (
        <EmptyState
          title={t('reviews.tpl.empty')}
          action={
            <Button variant="primary" onClick={() => void seedDefaultReviewTemplates(lang).then((n) => n && toast.success(t('reviews.tpl.seeded', { n })))}>
              {t('reviews.tpl.seed')}
            </Button>
          }
        >
          {t('reviews.tpl.emptyHelp')}
        </EmptyState>
      ) : (
        [5, 4, 3, 2, 1].map((s) => {
          const list = templates.filter((tpl) => tpl.stars === s);
          return (
            <Card key={s} title={<Stars value={s} />} description={list.some((tpl) => tpl.enabled) ? undefined : t('reviews.tpl.noneEnabled')}>
              <div className="space-y-2">
                {list.length === 0 ? <p className="text-xs text-muted">{t('reviews.tpl.noneForStars')}</p> : list.map((tpl) => <TemplateRow key={tpl.id} tpl={tpl} />)}
              </div>
            </Card>
          );
        })
      )}
    </div>
  );
}
