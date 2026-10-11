import { useLiveQuery } from 'dexie-react-hooks';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  FileDown,
  FileUp,
  FlaskConical,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  Workflow,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { getDb } from '@/core/db/db';
import { isFlagEnabled } from '@/core/flags/flags';
import { downloadBlob, timestampedName } from '@/features/export/download';
import { detectConflicts } from '@/features/workflow/conflicts';
import { sortRules } from '@/features/workflow/engine';
import {
  deleteRule,
  emptyRule,
  exportRules,
  importRules,
  parseRulesFile,
  saveRule,
  type ImportPreview,
  type RuleDraft,
} from '@/features/workflow/rules';
import type { WorkflowRule } from '@/shared/models';
import { useSettings } from '@/ui/hooks/useSettings';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  EmptyState,
  IconButton,
  PageHeader,
  Spinner,
  Switch,
  toast,
} from '@/ui/components';
import { useT } from '@/ui/i18n';
import { dateTime, errorText, FeatureStatusPill, useLocaleTag } from './inventory/common';
import { RuleEditor } from './rules/RuleEditor';
import { TestRunModal } from './rules/TestRunModal';

const MAX_IMPORT_BYTES = 1024 * 1024;

export default function RulesPage() {
  const t = useT();
  const locale = useLocaleTag();
  const [settings] = useSettings();
  const rules = useLiveQuery(async () => sortRules(await getDb().workflowRules.toArray()), []);
  const [editing, setEditing] = useState<WorkflowRule | RuleDraft | null>(null);
  const [testing, setTesting] = useState<WorkflowRule | null>(null);
  const [deleting, setDeleting] = useState<WorkflowRule | null>(null);
  const [logOpen, setLogOpen] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!isFlagEnabled('workflowBuilder', settings.flags)) {
    return (
      <div>
        <PageHeader title={t('ops.wf.title')} />
        <EmptyState title={t('ops.common.flagOff')}>{t('ops.common.flagOffBody')}</EmptyState>
      </div>
    );
  }
  if (!rules) return <Spinner />;
  const conflicts = detectConflicts(rules);
  const byId = new Map(rules.map((r) => [r.id, r]));

  const patch = async (r: WorkflowRule, change: Partial<RuleDraft>) => {
    try {
      await saveRule({ ...toDraft(r), ...change }, r.id);
    } catch (e) {
      toast.error(errorText(e, t));
    }
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast.error(t('ops.wf.io.tooLarge'));
      return;
    }
    try {
      setPreview(await parseRulesFile(await file.text()));
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const doImport = async () => {
    if (!preview) return;
    try {
      const n = await importRules(preview);
      toast.success(t('ops.wf.io.imported', { n }));
    } catch (e) {
      toast.error(errorText(e, t));
    }
    setPreview(null);
  };

  const doExport = () => {
    downloadBlob(exportRules(rules), timestampedName('funpro-workflow-rules', 'json'), 'application/json');
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('ops.wf.title')}
        description={t('ops.wf.description')}
        actions={
          <>
            <span className="flex items-center gap-2 text-xs text-muted">
              {t('ops.wf.feature')} <FeatureStatusPill feature="workflows" />
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void onImportFile(e.target.files?.[0])}
              aria-label={t('common.import')}
            />
            <Button icon={<FileUp size={14} />} onClick={() => fileRef.current?.click()}>
              {t('common.import')}
            </Button>
            <Button icon={<FileDown size={14} />} onClick={doExport} disabled={rules.length === 0}>
              {t('common.export')}
            </Button>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setEditing(emptyRule())}>
              {t('ops.wf.newRule')}
            </Button>
          </>
        }
      />
      <Callout tone="info" title={t('ops.wf.safety.title')}>
        {t('ops.wf.safety.body', { max: settings.workflow.maxActionsPerMinute })}
      </Callout>
      {conflicts.length > 0 && (
        <Callout tone="warning" title={t('ops.wf.conflicts.title', { n: conflicts.length })}>
          <ul className="list-disc pl-4">
            {conflicts.map((c, i) => (
              <li key={i}>
                {t(`ops.wf.conflict.${c.kind}`, {
                  a: byId.get(c.ruleIds[0])?.name ?? '?',
                  b: byId.get(c.ruleIds[1])?.name ?? '?',
                  trigger: t(`ops.wf.trigger.${c.trigger}`),
                })}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {rules.length === 0 ? (
        <EmptyState
          icon={<Workflow size={28} />}
          title={t('ops.wf.emptyTitle')}
          action={
            <Button variant="primary" onClick={() => setEditing(emptyRule())}>
              {t('ops.wf.newRule')}
            </Button>
          }
        >
          {t('ops.wf.emptyBody')}
        </EmptyState>
      ) : (
        <ol className="flex flex-col gap-3">
          {rules.map((r) => (
            <li key={r.id}>
              <Card
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {r.name}
                    <Badge tone="accent">{t(`ops.wf.trigger.${r.trigger}`)}</Badge>
                    {r.dryRun ? (
                      <Badge tone="info">{t('ops.wf.dryRun')}</Badge>
                    ) : (
                      <Badge tone="success">{t('ops.wf.live')}</Badge>
                    )}
                    {r.stopProcessing && <Badge>{t('ops.wf.stops')}</Badge>}
                  </span>
                }
                description={t('ops.wf.summary', {
                  conditions: r.conditions.length,
                  actions: r.actions.map((a) => t(`ops.wf.action.${a.kind}`)).join(', '),
                  cooldown: r.cooldownSec,
                })}
                actions={
                  <span className="flex items-center gap-1">
                    <span
                      className="mr-1 text-xs tabular-nums text-muted"
                      title={t('ops.wf.editor.priority')}
                    >
                      {t('ops.wf.priorityShort', { n: r.priority })}
                    </span>
                    <IconButton
                      label={t('ops.wf.raisePriority')}
                      onClick={() => void patch(r, { priority: Math.min(1000, r.priority + 1) })}
                    >
                      <ArrowUp size={14} />
                    </IconButton>
                    <IconButton
                      label={t('ops.wf.lowerPriority')}
                      onClick={() => void patch(r, { priority: Math.max(-1000, r.priority - 1) })}
                    >
                      <ArrowDown size={14} />
                    </IconButton>
                    <Switch
                      checked={r.enabled}
                      onChange={(v) => void patch(r, { enabled: v })}
                      label={<span className="sr-only">{t('common.enabled')}</span>}
                    />
                  </span>
                }
              >
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => setEditing(r)}>
                    {t('common.edit')}
                  </Button>
                  <Button size="sm" icon={<FlaskConical size={14} />} onClick={() => setTesting(r)}>
                    {t('ops.wf.testRun')}
                  </Button>
                  <Button
                    size="sm"
                    variant={r.dryRun ? 'outline' : 'ghost'}
                    onClick={() => void patch(r, { dryRun: !r.dryRun })}
                  >
                    {r.dryRun ? t('ops.wf.goLive') : t('ops.wf.backToDry')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<ScrollText size={14} />}
                    onClick={() => setLogOpen(logOpen === r.id ? null : r.id)}
                    aria-expanded={logOpen === r.id}
                  >
                    {t('ops.wf.log')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Copy size={14} />}
                    onClick={() =>
                      setEditing({
                        ...toDraft(r),
                        name: `${r.name} ${t('ops.wf.copySuffix')}`.slice(0, 120),
                        enabled: false,
                        dryRun: true,
                      })
                    }
                  >
                    {t('ops.wf.duplicate')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={14} />}
                    onClick={() => setDeleting(r)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
                {r.lastFiredAt && (
                  <p className="mt-2 text-xs text-muted">
                    {t('ops.wf.lastFired', { at: dateTime(r.lastFiredAt, locale) })}
                  </p>
                )}
                {logOpen === r.id && <RuleLog ruleId={r.id} />}
              </Card>
            </li>
          ))}
        </ol>
      )}
      {editing && <RuleEditor rule={editing} onClose={() => setEditing(null)} />}
      {testing && <TestRunModal rule={testing} onClose={() => setTesting(null)} />}
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('ops.wf.deleteTitle')}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteRule(deleting.id).then(() => toast.success(t('ops.wf.deleted')));
          setDeleting(null);
        }}
      >
        {t('ops.wf.deleteBody', { name: deleting?.name ?? '' })}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!preview}
        title={t('ops.wf.io.previewTitle')}
        confirmLabel={t('ops.wf.io.importN', { n: preview?.rules.length ?? 0 })}
        onCancel={() => setPreview(null)}
        onConfirm={() => void doImport()}
      >
        {preview && (
          <div className="flex flex-col gap-2 text-sm">
            <p>{t('ops.wf.io.previewBody', { n: preview.rules.length })}</p>
            {preview.rejected.length > 0 && (
              <Callout tone="warning" title={t('ops.wf.io.rejected', { n: preview.rejected.length })}>
                <ul className="list-disc pl-4">
                  {preview.rejected.map((r, i) => (
                    <li key={i}>
                      {r.name}: {r.errors.join('; ')}
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            {preview.missingTemplates.length > 0 && (
              <Callout tone="info">
                {t('ops.wf.io.missingTemplates', { n: preview.missingTemplates.length })}
              </Callout>
            )}
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}

function toDraft(r: WorkflowRule): RuleDraft {
  const { name, enabled, priority, trigger, conditions, actions, cooldownSec, dryRun, stopProcessing } = r;
  return { name, enabled, priority, trigger, conditions, actions, cooldownSec, dryRun, stopProcessing };
}

function RuleLog({ ruleId }: { ruleId: string }) {
  const t = useT();
  const locale = useLocaleTag();
  const entries = useLiveQuery(
    async () =>
      (await getDb().logs.where('source').equals(`workflow:${ruleId}`).reverse().sortBy('at')).slice(0, 40),
    [ruleId],
    [],
  );
  if (entries.length === 0) return <p className="mt-3 text-xs text-muted">{t('ops.wf.logEmpty')}</p>;
  return (
    <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-auto rounded-lg bg-surface-2 p-2 text-xs">
      {entries.map((e) => (
        <li key={e.id} className="flex gap-2">
          <span className="shrink-0 text-muted">{dateTime(e.at, locale)}</span>
          <Badge tone={e.level === 'warn' ? 'warning' : e.level === 'error' ? 'danger' : 'neutral'}>
            {e.level}
          </Badge>
          <span className="min-w-0 break-words">{e.message}</span>
        </li>
      ))}
    </ul>
  );
}
