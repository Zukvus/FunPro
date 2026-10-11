import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { renderTemplate, sampleVariables } from '@/features/messages/engine';
import { hasBlockingIssue, lintText } from '@/features/messages/lint';
import { checkRegexSafety, compileRule, findMatchingRule, sortRules } from '@/features/messages/matching';
import { AUTO_SEND_LIMIT } from '@/features/messages/outbox';
import { deleteRule, parsePatterns, RuleError, saveRule, setRuleEnabled } from '@/features/messages/rules';
import type { AutoReplyRule } from '@/shared/models';
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, Field, IconButton, Input, Modal, Select, Switch, Textarea, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { FeatureToggle, TemplateField } from './shared';

type Mode = AutoReplyRule['matchMode'];

interface RuleDraft {
  name: string;
  patterns: string;
  matchMode: Mode;
  caseSensitive: boolean;
  priority: number;
  cooldownMin: number;
  requireApproval: boolean;
  reply: string;
  enabled: boolean;
}

const EMPTY: RuleDraft = { name: '', patterns: '', matchMode: 'contains', caseSensitive: false, priority: 0, cooldownMin: 10, requireApproval: true, reply: '', enabled: true };

function RuleEditor({ rule, open, onClose }: { rule: AutoReplyRule | null; open: boolean; onClose: () => void }) {
  const t = useT();
  const [d, setD] = useState<RuleDraft>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(
      rule
        ? {
            name: rule.name,
            patterns: rule.patterns.join('\n'),
            matchMode: rule.matchMode,
            caseSensitive: rule.caseSensitive,
            priority: rule.priority,
            cooldownMin: Math.round(rule.cooldownSec / 60),
            requireApproval: rule.requireApproval,
            reply: rule.reply,
            enabled: rule.enabled,
          }
        : EMPTY,
    );
  }, [open, rule]);

  const patternErrors = useMemo(() => {
    if (d.matchMode !== 'regex') return [];
    return parsePatterns(d.patterns)
      .map((p) => ({ p, check: checkRegexSafety(p) }))
      .filter((x) => !x.check.ok)
      .map((x) => ({ pattern: x.p, reason: x.check.ok ? '' : x.check.reason }));
  }, [d.patterns, d.matchMode]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveRule(
        {
          name: d.name,
          patterns: parsePatterns(d.patterns),
          matchMode: d.matchMode,
          caseSensitive: d.caseSensitive,
          priority: Math.trunc(d.priority) || 0,
          cooldownSec: Math.max(0, Math.round(d.cooldownMin * 60)),
          requireApproval: d.requireApproval,
          reply: d.reply,
          enabled: d.enabled,
        },
        rule?.id,
      );
      toast.success(t('msg.rules.saved'));
      onClose();
    } catch (e) {
      if (e instanceof RuleError && e.code === 'unsafe_pattern' && e.detail) setError(t('msg.rules.error.unsafe', { pattern: e.detail.pattern, reason: t(`msg.regex.${e.detail.reason}`) }));
      else setError(e instanceof RuleError ? t(`msg.rules.error.${e.code}`) : (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const canSave = d.name.trim() && parsePatterns(d.patterns).length > 0 && d.reply.trim() && patternErrors.length === 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={rule ? t('msg.rules.edit') : t('msg.rules.new')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={saving} disabled={!canSave} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_160px_120px]">
          <Field label={t('msg.rules.name')} htmlFor="rule-name">
            <Input id="rule-name" value={d.name} maxLength={80} onChange={(e) => setD({ ...d, name: e.target.value })} autoFocus />
          </Field>
          <Field label={t('msg.rules.mode')} htmlFor="rule-mode" help={t(`msg.rules.mode.${d.matchMode}.help`)}>
            <Select id="rule-mode" value={d.matchMode} onChange={(e) => setD({ ...d, matchMode: e.target.value as Mode })}>
              {(['contains', 'word', 'exact', 'regex'] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`msg.rules.mode.${m}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('msg.rules.priority')} htmlFor="rule-priority" help={t('msg.rules.priorityHelp')}>
            <Input id="rule-priority" type="number" min={-100} max={100} value={d.priority} onChange={(e) => setD({ ...d, priority: Number(e.target.value) })} />
          </Field>
        </div>
        <Field
          label={t('msg.rules.patterns')}
          htmlFor="rule-patterns"
          help={d.matchMode === 'regex' ? t('msg.rules.patternsRegexHelp') : t('msg.rules.patternsHelp')}
          error={patternErrors.length ? patternErrors.map((x) => `${x.pattern}: ${t(`msg.regex.${x.reason}`)}`).join(' · ') : undefined}
        >
          <Textarea id="rule-patterns" rows={3} value={d.patterns} onChange={(e) => setD({ ...d, patterns: e.target.value })} placeholder={t('msg.rules.patternsPlaceholder')} className="font-mono text-xs" />
        </Field>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Switch checked={d.caseSensitive} onChange={(v) => setD({ ...d, caseSensitive: v })} label={t('msg.rules.caseSensitive')} description={t('msg.rules.caseSensitiveHelp')} />
          <Switch checked={d.requireApproval} onChange={(v) => setD({ ...d, requireApproval: v })} label={t('msg.rules.requireApproval')} description={t('msg.rules.requireApprovalHelp')} />
          <Field label={t('msg.rules.cooldown')} htmlFor="rule-cooldown" help={t('msg.rules.cooldownHelp')}>
            <Input id="rule-cooldown" type="number" min={0} max={10080} value={d.cooldownMin} onChange={(e) => setD({ ...d, cooldownMin: Number(e.target.value) })} />
          </Field>
          <Switch checked={d.enabled} onChange={(v) => setD({ ...d, enabled: v })} label={t('msg.rules.enabled')} />
        </div>
        <TemplateField label={t('msg.rules.reply')} value={d.reply} onChange={(reply) => setD({ ...d, reply })} help={t('msg.rules.replyHelp')} />
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

function RuleTester({ rules }: { rules: AutoReplyRule[] }) {
  const t = useT();
  const { status } = useDashboard();
  const [text, setText] = useState('');
  const result = useMemo(() => (text.trim() ? findMatchingRule(rules, text) : null), [rules, text]);
  const preview = result ? renderTemplate(result.rule.reply, sampleVariables(new Date(), status?.session?.username)).text : '';
  const blocking = result ? hasBlockingIssue(lintText(preview, { checkVariables: false })) : false;
  return (
    <Card title={t('msg.rules.testTitle')} description={t('msg.rules.testDescription')}>
      <Field label={t('msg.rules.testLabel')} htmlFor="rule-test">
        <Input id="rule-test" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('msg.rules.testPlaceholder')} />
      </Field>
      {text.trim() && (
        <div className="mt-3 text-sm" role="status" aria-live="polite">
          {result ? (
            <div className="space-y-1">
              <p>
                {t('msg.rules.testMatched', { name: result.rule.name, pattern: result.pattern })}{' '}
                <Badge tone={result.rule.requireApproval || blocking ? 'info' : 'success'}>{result.rule.requireApproval || blocking ? t('msg.rules.badge.draft') : t('msg.rules.badge.auto')}</Badge>
              </p>
              <p className="whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs">{preview}</p>
              <p className="text-[11px] text-muted">{t('msg.rules.testNote')}</p>
            </div>
          ) : (
            <p className="text-muted">{t('msg.rules.testNoMatch')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export function AutoRepliesTab() {
  const t = useT();
  const [settings] = useSettings();
  const rules = useLiveQuery(async () => sortRules(await getDb().autoReplyRules.toArray()), []);
  const [editing, setEditing] = useState<AutoReplyRule | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<AutoReplyRule | null>(null);
  const list = rules ?? [];
  const enabledRules = list.filter((r) => r.enabled);
  const direct = enabledRules.filter((r) => !r.requireApproval).length;
  const m = settings.messages;

  const edit = (r: AutoReplyRule | null) => {
    setEditing(r);
    setOpen(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <FeatureToggle
          feature="autoReply"
          title={t('msg.rules.featureTitle')}
          description={t('msg.rules.featureDescription')}
          confirmTitle={t('msg.rules.confirmTitle')}
          confirmBody={
            <div className="space-y-2">
              <p>{t('msg.rules.confirmSummary', { rules: enabledRules.length, direct, drafts: enabledRules.length - direct })}</p>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                <li>{t('msg.rules.confirmOnlyCustomers')}</li>
                <li>{t('msg.rules.confirmLimits', { perHour: m.maxAutoRepliesPerChatPerHour, max: AUTO_SEND_LIMIT.max, minutes: AUTO_SEND_LIMIT.windowMs / 60_000 })}</li>
                <li>{t('msg.rules.confirmPause', { minutes: m.pauseAfterManualReplyMin })}</li>
                <li>{t('msg.rules.confirmRules')}</li>
              </ul>
            </div>
          }
        />
      </Card>

      <Card
        title={t('msg.rules.title')}
        description={t('msg.rules.description')}
        actions={
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => edit(null)}>
            {t('msg.rules.new')}
          </Button>
        }
      >
        {rules === undefined ? (
          <p className="text-xs text-muted">{t('common.loading')}</p>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Bot size={22} />}
            title={t('msg.rules.emptyTitle')}
            action={
              <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => edit(null)}>
                {t('msg.rules.new')}
              </Button>
            }
          >
            {t('msg.rules.emptyHelp')}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {list.map((r) => {
              const compiled = compileRule(r);
              const warnings = lintText(r.reply);
              return (
                <li key={r.id} className="flex items-start gap-3 py-3">
                  <div className="pt-0.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4 cursor-pointer"
                      checked={r.enabled}
                      onChange={(e) => void setRuleEnabled(r.id, e.target.checked)}
                      aria-label={t('msg.rules.enabledFor', { name: r.name })}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={r.enabled ? 'text-sm font-medium text-fg' : 'text-sm font-medium text-muted line-through'}>{r.name}</span>
                      <Badge tone="neutral">{t(`msg.rules.mode.${r.matchMode}`)}</Badge>
                      {r.priority !== 0 && <Badge tone="neutral">{t('msg.rules.priorityBadge', { value: r.priority })}</Badge>}
                      <Badge tone={r.requireApproval ? 'info' : 'success'}>{r.requireApproval ? t('msg.rules.badge.draft') : t('msg.rules.badge.auto')}</Badge>
                      <span className="text-[11px] text-muted">{t('msg.rules.cooldownBadge', { minutes: Math.round(r.cooldownSec / 60) })}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {r.patterns.map((p) => (
                        <code key={p} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg">
                          {p}
                        </code>
                      ))}
                    </div>
                    <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-xs text-muted">{r.reply}</p>
                    {compiled.errors.length > 0 && <p className="mt-1 text-xs text-danger">{t('msg.rules.patternErrors', { count: compiled.errors.length })}</p>}
                    {warnings.length > 0 && <p className="mt-1 text-xs text-warning">{warnings.map((w) => t(`msg.lint.${w.id}`, { detail: w.detail ?? '' })).join(' ')}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <IconButton label={t('common.edit')} onClick={() => edit(r)}>
                      <Pencil size={15} />
                    </IconButton>
                    <IconButton label={t('common.delete')} onClick={() => setDeleting(r)}>
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {list.length > 0 && <RuleTester rules={list} />}

      <Callout tone="info" title={t('msg.rules.safetyTitle')}>
        <ul className="list-disc space-y-1 pl-4">
          <li>{t('msg.rules.safety1')}</li>
          <li>{t('msg.rules.safety2')}</li>
          <li>{t('msg.rules.safety3')}</li>
          <li>{t('msg.rules.safety4')}</li>
        </ul>
        <p className="mt-2">
          <FlaskConical size={12} className="mr-1 inline" aria-hidden />
          {t('msg.rules.regexNote')}
        </p>
      </Callout>

      <RuleEditor rule={editing} open={open} onClose={() => setOpen(false)} />
      <ConfirmDialog
        open={!!deleting}
        danger
        title={t('msg.rules.deleteTitle')}
        confirmLabel={t('common.delete')}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void deleteRule(deleting.id).then(() => toast.success(t('msg.rules.deleted')));
          setDeleting(null);
        }}
      >
        {t('msg.rules.deleteBody', { name: deleting?.name ?? '' })}
      </ConfirmDialog>
    </div>
  );
}
