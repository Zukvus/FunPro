import { useLiveQuery } from 'dexie-react-hooks';
import { useId } from 'react';
import { getDb, USER_DATA_TABLES } from '@/core/db/db';
import { Card, Field, Select } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';

const PROTECTED = new Set(['secrets', 'keys', 'inventoryItems', 'assets']);
const RETENTION_PRESETS = [0, 7, 30, 90, 180, 365, 3650];

function group(name: string): 'business' | 'protected' | 'activity' {
  if ((USER_DATA_TABLES as readonly string[]).includes(name)) return 'business';
  if (PROTECTED.has(name)) return 'protected';
  return 'activity';
}

/** Row counts of every local table, grouped by what backups/exports include, plus message retention. */
export function DataInventoryCard() {
  const t = useT();
  const [settings, update] = useSettings();
  const retentionId = useId();
  const counts = useLiveQuery(async () => {
    const db = getDb();
    return Promise.all(db.tables.map(async (tb) => ({ name: tb.name, count: await tb.count() })));
  }, []);
  const groups = (['business', 'activity', 'protected'] as const).map((g) => ({ g, rows: (counts ?? []).filter((c) => group(c.name) === g) }));
  const total = (counts ?? []).reduce((n, c) => n + c.count, 0);
  const days = settings.privacy.messageRetentionDays;
  const presets = [...new Set([...RETENTION_PRESETS, days])].sort((a, b) => a - b);

  return (
    <Card title={t('privacy.data.title')} description={t('privacy.data.description', { total: total.toLocaleString() })}>
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map(({ g, rows }) => (
          <section key={g} aria-labelledby={`data-${g}`}>
            <h3 id={`data-${g}`} className="text-xs font-semibold uppercase tracking-wide text-muted">
              {t(`privacy.data.group.${g}`)}
            </h3>
            <p className="mb-2 text-[11px] text-muted">{t(`privacy.data.groupHelp.${g}`)}</p>
            <table className="w-full text-xs">
              <thead className="sr-only">
                <tr>
                  <th scope="col">{t('privacy.data.table')}</th>
                  <th scope="col">{t('privacy.data.rows')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name} className="border-b border-border/60 last:border-0">
                    <th scope="row" className="py-1 text-left font-normal text-fg">
                      {t(`privacy.table.${r.name}`)}
                    </th>
                    <td className="py-1 text-right tabular-nums text-muted">{r.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
      <div className="mt-4 max-w-sm border-t border-border pt-3">
        <Field label={t('privacy.retention.label')} htmlFor={retentionId} help={t('privacy.retention.help')}>
          <Select id={retentionId} value={String(days)} onChange={(e) => void update({ privacy: { messageRetentionDays: Number(e.target.value) } })}>
            {presets.map((d) => (
              <option key={d} value={d}>
                {d === 0 ? t('privacy.retention.none') : t('privacy.retention.days', { count: d })}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}
