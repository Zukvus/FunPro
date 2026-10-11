import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { getSettings } from '@/core/settings/store';
import { readLastSession } from '@/features/pricing/context';
import { testRunRule, type RuleTrace } from '@/features/workflow/engine';
import type { WorkflowRule } from '@/shared/models';
import { Badge, Button, Callout, Modal, Select, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { dateTime, errorText, useLocaleTag } from '../inventory/common';

const STATUS_TONE = { done: 'success', dry_run: 'info', skipped: 'warning', failed: 'danger' } as const;

export function TestRunModal({ rule, onClose }: { rule: WorkflowRule; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleTag();
  const events = useLiveQuery(async () => (await getDb().events.where('type').equals(rule.trigger).toArray()).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50), [rule.trigger], []);
  const [eventId, setEventId] = useState('');
  const [trace, setTrace] = useState<RuleTrace | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = eventId || events[0]?.id || '';

  const run = async () => {
    const ev = events.find((e) => e.id === selected);
    if (!ev) return;
    setBusy(true);
    try {
      const session = await readLastSession();
      setTrace(await testRunRule(rule, ev, { getSettings, selfUserId: async () => session?.userId ?? null, selfName: async () => session?.username ?? null }));
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open wide onClose={onClose} title={t('ops.wf.test.title', { name: rule.name })}>
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted">{t('ops.wf.test.help')}</p>
        {events.length === 0 ? (
          <Callout tone="info">{t('ops.wf.test.noEvents', { trigger: t(`ops.wf.trigger.${rule.trigger}`) })}</Callout>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select className="min-w-0 flex-1" value={selected} onChange={(e) => setEventId(e.target.value)} aria-label={t('ops.wf.test.event')}>
              {events.map((e) => (
                <option key={e.id} value={e.id}>
                  {dateTime(e.at, locale)} · {e.id.slice(0, 80)}
                  {e.payload['baseline'] === true ? ` (${t('ops.wf.test.baseline')})` : ''}
                </option>
              ))}
            </Select>
            <Button variant="primary" onClick={run} loading={busy}>
              {t('ops.wf.test.run')}
            </Button>
          </div>
        )}
        {trace && (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{trace.matched ? t('ops.wf.test.matched') : t('ops.wf.test.notMatched')}</p>
            {trace.conditions.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {trace.conditions.map((c, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge tone={c.ok ? 'success' : 'danger'}>{c.ok ? t('ops.wf.test.pass') : t('ops.wf.test.fail')}</Badge>
                    <span className="font-mono">{c.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            {trace.actions.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {trace.actions.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Badge tone={STATUS_TONE[a.status]}>{t(`ops.wf.astatus.${a.status}`)}</Badge>
                    <span className="font-medium">{t(`ops.wf.action.${a.kind}`)}</span>
                    <span className="text-muted">{a.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
