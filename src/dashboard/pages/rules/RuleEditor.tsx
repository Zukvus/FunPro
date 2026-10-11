import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { getDb } from '@/core/db/db';
import { checkRegexSafety } from '@/features/workflow/conditions';
import { TEMPLATE_PLACEHOLDERS, TRIGGER_FIELDS } from '@/features/workflow/fields';
import { saveRule, validateRule, type RuleDraft } from '@/features/workflow/rules';
import { EventTypeSchema, type Condition, type EventType, type WorkflowAction, type WorkflowRule } from '@/shared/models';
import { Button, Callout, Field, IconButton, Input, Modal, Select, Switch, toast } from '@/ui/components';
import { useT, type TFunction } from '@/ui/i18n';
import { errorText } from '../inventory/common';

const CONDITION_KINDS: Condition['kind'][] = ['text_contains', 'text_matches', 'number_compare', 'equals', 'time_window'];
const ACTION_KINDS: WorkflowAction['kind'][] = ['notify', 'telegram', 'prepare_reply', 'send_reply', 'queue_bump', 'suggest_reprice', 'tag_customer', 'log'];

function blankCondition(kind: Condition['kind'], trigger: EventType): Condition {
  const field = TRIGGER_FIELDS[trigger][0]?.path ?? 'payload.text';
  switch (kind) {
    case 'text_contains':
      return { kind, field, value: '' };
    case 'text_matches':
      return { kind, field, pattern: '' };
    case 'number_compare':
      return { kind, field: TRIGGER_FIELDS[trigger].find((f) => f.type === 'number')?.path ?? field, op: '>=', value: 0 };
    case 'equals':
      return { kind, field, value: '' };
    case 'time_window':
      return { kind, start: '09:00', end: '18:00' };
  }
}

function blankAction(kind: WorkflowAction['kind']): WorkflowAction {
  switch (kind) {
    case 'notify':
      return { kind, title: '', body: '' };
    case 'telegram':
      return { kind, text: '' };
    case 'prepare_reply':
    case 'send_reply':
      return { kind, templateId: '' };
    case 'queue_bump':
      return { kind };
    case 'suggest_reprice':
      return { kind };
    case 'tag_customer':
      return { kind, tag: '' };
    case 'log':
      return { kind, message: '' };
  }
}

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function RuleEditor({ rule, onClose }: { rule: WorkflowRule | RuleDraft; onClose: () => void }) {
  const t = useT();
  const id = 'id' in rule ? rule.id : undefined;
  const [draft, setDraft] = useState<RuleDraft>(() => {
    const { name, enabled, priority, trigger, conditions, actions, cooldownSec, dryRun, stopProcessing } = rule;
    return { name, enabled, priority, trigger, conditions, actions, cooldownSec, dryRun, stopProcessing };
  });
  const [busy, setBusy] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const templates = useLiveQuery(() => getDb().templates.toArray(), [], []);
  const listId = useId();
  const errors = validateRule(draft);
  const set = (patch: Partial<RuleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setCond = (i: number, c: Condition) => set({ conditions: draft.conditions.map((x, k) => (k === i ? c : x)) });
  const setAction = (i: number, a: WorkflowAction) => set({ actions: draft.actions.map((x, k) => (k === i ? a : x)) });
  const hasSend = draft.actions.some((a) => a.kind === 'send_reply');

  const save = async () => {
    setShowErrors(true);
    if (errors.length) return;
    setBusy(true);
    try {
      await saveRule(draft, id);
      toast.success(t('ops.wf.editor.saved'));
      onClose();
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={id ? t('ops.wf.editor.editTitle') : t('ops.wf.editor.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <datalist id={listId}>
        {TRIGGER_FIELDS[draft.trigger].map((f) => (
          <option key={f.path} value={f.path} />
        ))}
      </datalist>
      <div className="flex flex-col gap-4">
        <Field label={t('ops.wf.editor.name')} error={showErrors && errors.includes('name') ? t('ops.common.required') : undefined} htmlFor="wf-name">
          <Input id="wf-name" value={draft.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <section aria-labelledby="wf-when" className="rounded-xl border border-border p-3">
          <h3 id="wf-when" className="mb-2 text-xs font-bold uppercase tracking-wider text-accent">
            {t('ops.wf.editor.when')}
          </h3>
          <Select value={draft.trigger} onChange={(e) => set({ trigger: e.target.value as EventType })} aria-label={t('ops.wf.editor.trigger')}>
            {EventTypeSchema.options.map((ty) => (
              <option key={ty} value={ty}>
                {t(`ops.wf.trigger.${ty}`)}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-xs text-muted">{t(`ops.wf.triggerHelp.${draft.trigger}`)}</p>
        </section>

        <section aria-labelledby="wf-if" className="rounded-xl border border-border p-3">
          <h3 id="wf-if" className="mb-2 text-xs font-bold uppercase tracking-wider text-accent">
            {t('ops.wf.editor.if')}
          </h3>
          {draft.conditions.length === 0 && <p className="mb-2 text-xs text-muted">{t('ops.wf.editor.noConditions')}</p>}
          <div className="flex flex-col gap-2">
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2 rounded-lg bg-surface-2 p-2">
                <Select className="w-44" value={c.kind} onChange={(e) => setCond(i, blankCondition(e.target.value as Condition['kind'], draft.trigger))} aria-label={t('ops.wf.editor.conditionKind')}>
                  {CONDITION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`ops.wf.cond.${k}`)}
                    </option>
                  ))}
                </Select>
                <ConditionInputs c={c} listId={listId} onChange={(nc) => setCond(i, nc)} t={t} />
                <IconButton label={t('common.delete')} onClick={() => set({ conditions: draft.conditions.filter((_, k) => k !== i) })}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="mt-2" icon={<Plus size={14} />} onClick={() => set({ conditions: [...draft.conditions, blankCondition('text_contains', draft.trigger)] })} disabled={draft.conditions.length >= 20}>
            {t('ops.wf.editor.addCondition')}
          </Button>
          <p className="mt-2 text-[11px] text-muted">{t('ops.wf.editor.conditionsHelp')}</p>
        </section>

        <section aria-labelledby="wf-then" className="rounded-xl border border-border p-3">
          <h3 id="wf-then" className="mb-2 text-xs font-bold uppercase tracking-wider text-accent">
            {t('ops.wf.editor.then')}
          </h3>
          <div className="flex flex-col gap-2">
            {draft.actions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2 rounded-lg bg-surface-2 p-2">
                <Select className="w-48" value={a.kind} onChange={(e) => setAction(i, blankAction(e.target.value as WorkflowAction['kind']))} aria-label={t('ops.wf.editor.actionKind')}>
                  {ACTION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`ops.wf.action.${k}`)}
                    </option>
                  ))}
                </Select>
                <ActionInputs a={a} templates={templates.map((x) => ({ id: x.id, name: x.name }))} onChange={(na) => setAction(i, na)} t={t} />
                <span className="ml-auto inline-flex">
                  <IconButton label={t('ops.wf.editor.moveUp')} onClick={() => set({ actions: move(draft.actions, i, -1) })}>
                    <ArrowUp size={14} />
                  </IconButton>
                  <IconButton label={t('ops.wf.editor.moveDown')} onClick={() => set({ actions: move(draft.actions, i, 1) })}>
                    <ArrowDown size={14} />
                  </IconButton>
                  <IconButton label={t('common.delete')} onClick={() => set({ actions: draft.actions.filter((_, k) => k !== i) })} disabled={draft.actions.length <= 1}>
                    <Trash2 size={14} />
                  </IconButton>
                </span>
              </div>
            ))}
          </div>
          <Button size="sm" variant="outline" className="mt-2" icon={<Plus size={14} />} onClick={() => set({ actions: [...draft.actions, blankAction('log')] })} disabled={draft.actions.length >= 10}>
            {t('ops.wf.editor.addAction')}
          </Button>
          <p className="mt-2 text-[11px] text-muted">{t('ops.wf.editor.placeholders', { list: TEMPLATE_PLACEHOLDERS.join(' ') })}</p>
          {hasSend && (
            <Callout tone="warning" title={t('ops.wf.editor.sendWarnTitle')}>
              {t('ops.wf.editor.sendWarn')}
            </Callout>
          )}
        </section>

        <div className="grid gap-3 md:grid-cols-2">
          <Field label={t('ops.wf.editor.priority')} help={t('ops.wf.editor.priorityHelp')} htmlFor="wf-prio">
            <Input id="wf-prio" type="number" min={-1000} max={1000} value={draft.priority} onChange={(e) => set({ priority: Math.max(-1000, Math.min(1000, Math.trunc(Number(e.target.value) || 0))) })} />
          </Field>
          <Field label={t('ops.wf.editor.cooldown')} help={t('ops.wf.editor.cooldownHelp')} htmlFor="wf-cool">
            <Input id="wf-cool" type="number" min={0} max={604800} value={draft.cooldownSec} onChange={(e) => set({ cooldownSec: Math.max(0, Math.min(604800, Math.trunc(Number(e.target.value) || 0))) })} />
          </Field>
        </div>
        <div className="grid gap-x-6 md:grid-cols-3">
          <Switch checked={draft.dryRun} onChange={(v) => set({ dryRun: v })} label={t('ops.wf.editor.dryRun')} description={t('ops.wf.editor.dryRunHelp')} />
          <Switch checked={draft.stopProcessing} onChange={(v) => set({ stopProcessing: v })} label={t('ops.wf.editor.stop')} description={t('ops.wf.editor.stopHelp')} />
          <Switch checked={draft.enabled} onChange={(v) => set({ enabled: v })} label={t('common.enabled')} />
        </div>
        {showErrors && errors.length > 0 && (
          <Callout tone="danger" title={t('ops.wf.editor.invalid')}>
            {errors.join('; ')}
          </Callout>
        )}
      </div>
    </Modal>
  );
}

function ConditionInputs({ c, listId, onChange, t }: { c: Condition; listId: string; onChange: (c: Condition) => void; t: TFunction }) {
  if (c.kind === 'time_window') {
    return (
      <span className="flex items-center gap-2">
        <Input type="time" className="w-28" value={c.start} onChange={(e) => onChange({ ...c, start: e.target.value || c.start })} aria-label={t('ops.wf.editor.from')} />
        <span className="text-xs text-muted">–</span>
        <Input type="time" className="w-28" value={c.end} onChange={(e) => onChange({ ...c, end: e.target.value || c.end })} aria-label={t('ops.wf.editor.to')} />
      </span>
    );
  }
  const field = <Input className="w-52 font-mono text-xs" list={listId} value={c.field} onChange={(e) => onChange({ ...c, field: e.target.value.trim() })} aria-label={t('ops.wf.editor.field')} placeholder="payload.text" />;
  switch (c.kind) {
    case 'text_contains':
      return (
        <>
          {field}
          <Input className="min-w-40 flex-1" value={c.value} onChange={(e) => onChange({ ...c, value: e.target.value })} aria-label={t('ops.wf.editor.value')} placeholder={t('ops.wf.editor.textPlaceholder')} />
        </>
      );
    case 'text_matches': {
      const why = c.pattern ? checkRegexSafety(c.pattern) : null;
      return (
        <>
          {field}
          <span className="flex min-w-40 flex-1 flex-col gap-1">
            <Input className="font-mono text-xs" value={c.pattern} onChange={(e) => onChange({ ...c, pattern: e.target.value })} aria-label={t('ops.wf.editor.pattern')} placeholder="^(price|цена)" />
            {why && <span className="text-[11px] text-danger">{t('ops.wf.editor.unsafeRegex', { why })}</span>}
          </span>
        </>
      );
    }
    case 'number_compare':
      return (
        <>
          {field}
          <Select className="w-20" value={c.op} onChange={(e) => onChange({ ...c, op: e.target.value as typeof c.op })} aria-label={t('ops.wf.editor.operator')}>
            {(['<', '<=', '=', '>=', '>'] as const).map((op) => (
              <option key={op} value={op}>
                {op}
              </option>
            ))}
          </Select>
          <Input type="number" className="w-28" value={c.value} onChange={(e) => onChange({ ...c, value: Number(e.target.value) || 0 })} aria-label={t('ops.wf.editor.value')} />
        </>
      );
    case 'equals': {
      const type = typeof c.value === 'number' ? 'number' : typeof c.value === 'boolean' ? 'boolean' : 'text';
      return (
        <>
          {field}
          <Select className="w-28" value={type} onChange={(e) => onChange({ ...c, value: e.target.value === 'number' ? 0 : e.target.value === 'boolean' ? true : '' })} aria-label={t('ops.wf.editor.valueType')}>
            <option value="text">{t('ops.wf.editor.typeText')}</option>
            <option value="number">{t('ops.wf.editor.typeNumber')}</option>
            <option value="boolean">{t('ops.wf.editor.typeBoolean')}</option>
          </Select>
          {type === 'boolean' ? (
            <Select className="w-28" value={String(c.value)} onChange={(e) => onChange({ ...c, value: e.target.value === 'true' })} aria-label={t('ops.wf.editor.value')}>
              <option value="true">{t('ops.wf.editor.yes')}</option>
              <option value="false">{t('ops.wf.editor.no')}</option>
            </Select>
          ) : (
            <Input type={type === 'number' ? 'number' : 'text'} className="min-w-32 flex-1" value={String(c.value)} onChange={(e) => onChange({ ...c, value: type === 'number' ? Number(e.target.value) || 0 : e.target.value })} aria-label={t('ops.wf.editor.value')} />
          )}
        </>
      );
    }
  }
}

function ActionInputs({ a, templates, onChange, t }: { a: WorkflowAction; templates: { id: string; name: string }[]; onChange: (a: WorkflowAction) => void; t: TFunction }) {
  switch (a.kind) {
    case 'notify':
      return (
        <span className="flex min-w-60 flex-1 flex-col gap-1">
          <Input value={a.title} onChange={(e) => onChange({ ...a, title: e.target.value })} placeholder={t('ops.wf.editor.notifyTitle')} aria-label={t('ops.wf.editor.notifyTitle')} maxLength={200} />
          <Input value={a.body} onChange={(e) => onChange({ ...a, body: e.target.value })} placeholder={t('ops.wf.editor.notifyBody')} aria-label={t('ops.wf.editor.notifyBody')} maxLength={1000} />
        </span>
      );
    case 'telegram':
      return <Input className="min-w-60 flex-1" value={a.text} onChange={(e) => onChange({ ...a, text: e.target.value })} placeholder={t('ops.wf.editor.telegramText')} aria-label={t('ops.wf.editor.telegramText')} maxLength={1000} />;
    case 'prepare_reply':
    case 'send_reply':
      return (
        <Select className="min-w-60 flex-1" value={a.templateId} onChange={(e) => onChange({ ...a, templateId: e.target.value })} aria-label={t('ops.wf.editor.template')}>
          <option value="">{templates.length ? t('ops.wf.editor.chooseTemplate') : t('ops.wf.editor.noTemplates')}</option>
          {templates.map((tp) => (
            <option key={tp.id} value={tp.id}>
              {tp.name}
            </option>
          ))}
        </Select>
      );
    case 'tag_customer':
      return <Input className="w-48" value={a.tag} onChange={(e) => onChange({ ...a, tag: e.target.value })} placeholder={t('ops.wf.editor.tag')} aria-label={t('ops.wf.editor.tag')} maxLength={32} />;
    case 'log':
      return <Input className="min-w-60 flex-1" value={a.message} onChange={(e) => onChange({ ...a, message: e.target.value })} placeholder={t('ops.wf.editor.logMessage')} aria-label={t('ops.wf.editor.logMessage')} maxLength={500} />;
    case 'queue_bump':
      return <span className="self-center text-xs text-muted">{t('ops.wf.editor.bumpHelp')}</span>;
    case 'suggest_reprice':
      return <span className="self-center text-xs text-muted">{t('ops.wf.editor.repriceHelp')}</span>;
  }
}
