import { useLiveQuery } from 'dexie-react-hooks';
import { FilePlus2, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import {
  deleteTemplate,
  parseTemplateRecords,
  saveTemplate,
  TEMPLATE_FIELD_KEYS,
  TEMPLATE_PREFIX,
  type ListingTemplate,
  type TemplateFieldKey,
} from '@/features/listings/clone';
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  Textarea,
  toast,
} from '@/ui/components';
import { useT } from '@/ui/i18n';
import { errorText, truncate } from './shared';

const MULTILINE = new Set<TemplateFieldKey>([
  'fields[desc][ru]',
  'fields[desc][en]',
  'fields[payment_msg][ru]',
  'fields[payment_msg][en]',
]);

export function fieldLabelKey(k: TemplateFieldKey): string {
  return `listings.field.${k
    .replace(/[[\]]+/g, '.')
    .replace(/\.+$/, '')
    .replace(/^fields\./, '')}`;
}

export function TemplatesPanel() {
  const t = useT();
  const recs = useLiveQuery(() => getDb().kv.where('key').startsWith(TEMPLATE_PREFIX).toArray(), []);
  const templates = useMemo(() => parseTemplateRecords(recs ?? []), [recs]);
  const [editing, setEditing] = useState<ListingTemplate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ListingTemplate | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted">{t('listings.tpl.help')}</p>
        <Button
          variant="primary"
          icon={<FilePlus2 size={14} aria-hidden />}
          onClick={() => setEditing('new')}
        >
          {t('listings.tpl.new')}
        </Button>
      </div>
      {recs !== undefined && templates.length === 0 && (
        <EmptyState title={t('listings.tpl.empty.title')}>{t('listings.tpl.empty.body')}</EmptyState>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((tpl) => (
          <Card
            key={tpl.id}
            title={tpl.name}
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Pencil size={14} aria-hidden />}
                  onClick={() => setEditing(tpl)}
                >
                  {t('common.edit')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={14} aria-hidden />}
                  onClick={() => setDeleting(tpl)}
                  aria-label={`${t('common.delete')}: ${tpl.name}`}
                >
                  <span className="sr-only">{t('common.delete')}</span>
                </Button>
              </>
            }
          >
            <dl className="space-y-1 text-xs">
              {(Object.entries(tpl.fields) as [TemplateFieldKey, string][]).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="shrink-0 text-muted">{t(fieldLabelKey(k))}:</dt>
                  <dd className="truncate" title={v}>
                    {truncate(v, 80)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
      {editing && (
        <TemplateEditor template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={t('listings.tpl.deleteTitle')}
        confirmLabel={t('common.delete')}
        danger
        onConfirm={() => {
          if (deleting) void deleteTemplate(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      >
        {t('listings.tpl.deleteBody', { name: deleting?.name ?? '' })}
      </ConfirmDialog>
    </div>
  );
}

function TemplateEditor({ template, onClose }: { template: ListingTemplate | null; onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState(template?.name ?? '');
  const [fields, setFields] = useState<Partial<Record<TemplateFieldKey, string>>>(() => ({
    ...(template?.fields ?? {}),
  }));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveTemplate({ ...(template ? { id: template.id } : {}), name, fields });
      toast.success(t('listings.tpl.saved'));
      onClose();
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={template ? t('listings.tpl.edit') : t('listings.tpl.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" disabled={!name.trim()} loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Field label={t('listings.tpl.name')} htmlFor="tpl-name">
            <Input id="tpl-name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        {TEMPLATE_FIELD_KEYS.map((k) => (
          <div key={k} className={MULTILINE.has(k) ? 'md:col-span-2' : undefined}>
            <Field label={t(fieldLabelKey(k))} htmlFor={`tpl-${k}`}>
              {MULTILINE.has(k) ? (
                <Textarea
                  id={`tpl-${k}`}
                  value={fields[k] ?? ''}
                  onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                />
              ) : (
                <Input
                  id={`tpl-${k}`}
                  inputMode={k === 'price' ? 'decimal' : k === 'amount' ? 'numeric' : undefined}
                  value={fields[k] ?? ''}
                  onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))}
                />
              )}
            </Field>
          </div>
        ))}
        <p className="text-xs text-muted md:col-span-2">{t('listings.tpl.emptyFieldsNote')}</p>
      </div>
    </Modal>
  );
}
