import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { syncStatusKey, type SyncArea, type SyncStatusRecord } from '@/features/orders/status';
import { Badge, Button, toast } from '@/ui/components';
import { useLang, useT } from '@/ui/i18n';
import { fmtRelative } from '@/dashboard/components/charts';

type RpcSyncArea = 'orders' | 'chats' | 'listings' | 'finance' | 'reviews';

const TONE: Record<SyncStatusRecord['state'], 'success' | 'info' | 'warning' | 'danger' | 'neutral'> = {
  ok: 'success',
  running: 'info',
  skipped: 'neutral',
  awaiting_tab: 'warning',
  logged_out: 'warning',
  rate_limited: 'warning',
  unsupported: 'warning',
  error: 'danger',
};

export function useSyncStatuses(areas: readonly SyncArea[]): Partial<Record<SyncArea, SyncStatusRecord>> {
  return (
    useLiveQuery(async () => {
      const recs = await getDb().kv.bulkGet(areas.map(syncStatusKey));
      const out: Partial<Record<SyncArea, SyncStatusRecord>> = {};
      recs.forEach((r, i) => {
        if (r?.value) out[areas[i]!] = r.value as SyncStatusRecord;
      });
      return out;
    }, [areas.join(',')]) ?? {}
  );
}

/** Compact "last synced" line with a manual sync button. */
export function SyncStatusBar({ areas, rpcAreas }: { areas: readonly SyncArea[]; rpcAreas: RpcSyncArea[] }) {
  const t = useT();
  const lang = useLang();
  const statuses = useSyncStatuses(areas);
  const [busy, setBusy] = useState(false);
  const sync = async () => {
    setBusy(true);
    try {
      const res = await rpc<Record<string, string>>('ui.syncNow', { what: rpcAreas });
      const failed = Object.entries(res ?? {}).filter(([, v]) => v !== 'ok');
      if (failed.length === 0) toast.success(t('orders.sync.done'));
      else toast.error(failed.map(([k, v]) => `${k}: ${v}`).join('\n'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      {areas.map((a) => {
        const s = statuses[a];
        return (
          <span key={a} className="inline-flex items-center gap-1" title={s?.message || undefined}>
            <span>{t(`orders.sync.area.${a}`)}:</span>
            {s ? (
              <>
                <Badge tone={TONE[s.state]}>{t(`orders.sync.state.${s.state}`)}</Badge>
                <span>
                  {s.lastSuccessAt
                    ? t('orders.sync.lastOk', { when: fmtRelative(s.lastSuccessAt, lang) })
                    : t('orders.sync.neverOk')}
                </span>
              </>
            ) : (
              <span>{t('orders.sync.never')}</span>
            )}
          </span>
        );
      })}
      <Button
        size="sm"
        variant="outline"
        icon={<RefreshCw size={12} />}
        loading={busy}
        onClick={() => void sync()}
      >
        {t('common.syncNow')}
      </Button>
    </div>
  );
}
