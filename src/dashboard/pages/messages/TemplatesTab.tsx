import { useLiveQuery } from 'dexie-react-hooks';
import { FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { lintText } from '@/features/messages/lint';
import { deleteTemplate, saveTemplate, TemplateError } from '@/features/messages/templates';
import type { MessageTemplate } from '@/shared/models';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, Select, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { TemplateField } from './shared';

interface Draft {
  name: string;
  command: string;
  body: string;
  lang: MessageTemplate['lang'];
}

const EMPTY: Draft = { name: '', command: '', body: '', lang: 'any' };

function TemplateEditor({ template, open, onClose }: { template: MessageTemplate | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(template ? { name: template.name, command: template.command ?? '', body: template.body, lang: template.lang } : EMPTY);
    setError(null);
  }, [open, template]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveTemplate({ name: draft.name, command: draft.command || null, body: draft.body, lang: draft.lang }, template?.id);
      toast.success(t('msg.templates.saved'));
      onClose();
    } catch (e) {
      setError(e instanceof TemplateError ? t(`msg.templates.error.${e.code}`) : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={template ? t('msg.templates.edit') : t('msg.templates.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={saving} disabled={!draft.name.trim() || !draft.body.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_200px_140px]">
          <Field label={t('msg.templates.name')} htmlFor="tpl-name">
            <Input id="tpl-name" value={draft.name} maxLength={80} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('msg.templates.command')} htmlFor="tpl-cmd" help={t('msg.templates.commandHelp')}>
            <div className="flex items-center">
              <span className="mr-1 font-mono text-sm text-muted" aria-hidden>
                /
              </span>
              <Input id="tpl-cmd" value={draft.command} maxLength={33} placeholder="thanks" onChange={(e) => setDraft({ ...draft, command: e.target.value.replace(/^\/+/, '') })} />
            </div>
          </Field>
          <Field label={t('msg.templates.lang')} htmlFor="tpl-lang">
            <Select id="tpl-lang" value={draft.lang} onChange={(e) => setDraft({ ...draft, lang: e.target.value as Draft['lang'] })}>
              <option value="any">{t('msg.templates.lang.any')}</option>
              <option value="ru">Русский</option>
              <option value="en">English</option>
              <option value="uk">Українська</option>
            </Select>
          </Field>
        </div>
        <TemplateField label={t('msg.templates.body')} value={draft.body} onChange={(body) => setDraft({ ...draft, body })} rows={6} help={t('msg.templates.bodyHelp')} />
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function TemplatesTab() {
  const t = useT();
  const templates = useLiveQuery(() => getDb().templates.orderBy('name').toArray(), []);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<MessageTemplate | null>(null);
  const issues = useMemo(() => new Map((templates ?? []).map((tpl) => [tpl.id, lintText(tpl.body)])), [templates]);

  const edit = (tpl: MessageTemplate | null) => {
    setEditing(tpl);
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <Card
        title={t('msg.templates.title')}
        description={t('msg.templates.description')}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => edit(null)}>
            {t('msg.templates.new')}
          </Button>
        }
      >
        {templates === undefined ? (
          <p className="text-xs text-muted">{t('common.loading')}</p>
        ) : templates.length === 0 ? (
          <EmptyState
            icon={<FileText size={22} />}
            title={t('msg.templates.emptyTitle')}
            action={
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => edit(null)}>
                {t('msg.templates.new')}
              </Button>
            }
          >
            {t('msg.templates.emptyHelp')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((tpl) => {
              const warnings = issues.get(tpl.id) ?? [];
              return (
                <li key={tpl.id} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-fg">{tpl.name}</span>
                      {tpl.command && <code className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-accent">/{tpl.command}</code>}
                      {tpl.lang !== 'any' && <Badge tone="neutral">{tpl.lang.toUpperCase()}</Badge>}
                      {warnings.length > 0 && (
                        <Badge tone="warning" title={warnings.map((w) => t(`msg.lint.${w.id}`, { detail: w.detail ?? '' })).join('\n')}>
                          {t('msg.templates.warnings', { count: warnings.length })}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted">{tpl.body}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton label={t('common.edit')} onClick={() => edit(tpl)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={t('common.delete')} onClick={() => setDeleting(tpl)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title={t('msg.templates.howTitle')}>
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
          <li>{t('msg.templates.how1')}</li>
          <li>{t('msg.templates.how2')}</li>
          <li>{t('msg.templates.how3')}</li>
        </ul>
      </Card>
      <TemplateEditor template={editing} open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('msg.templates.deleteTitle')}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteTemplate(deleting.id).then(() => toast.success(t('msg.templates.deleted')));
          setDeleting(null);
        }}
      >
        {t('msg.templates.deleteBody', { name: deleting?.name ?? '' })}
      </ConfirmDialog>
    </div>
  );
}
