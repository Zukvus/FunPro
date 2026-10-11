import { useLiveQuery } from 'dexie-react-hooks';
import { Boxes, Download, Pencil, Plus, Send, Trash2, Upload, List } from 'lucide-react';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { countByStatus } from '@/features/inventory/items';
import { ACTIVE_DELIVERY_STATUSES, type Pool } from '@/features/inventory/model';
import { deletePool, listPools } from '@/features/inventory/pools';
import { renderMaskedMessage } from '@/features/inventory/template';
import { useSettings } from '@/ui/hooks/useSettings';
import { Badge, Button, Callout, Card, ConfirmDialog, EmptyState, PageHeader, Spinner, Switch, Tabs, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { AwaitingTab, countAwaiting } from './inventory/AwaitingTab';
import { errorText, FeatureStatusPill, useFeatureStatus } from './inventory/common';
import { DeliveriesTab } from './inventory/DeliveriesTab';
import { ExportModal } from './inventory/ExportModal';
import { ImportModal } from './inventory/ImportModal';
import { ItemsModal } from './inventory/ItemsModal';
import { PoolEditor } from './inventory/PoolEditor';
import { PushModal } from './inventory/PushModal';

type Tab = 'pools' | 'deliveries' | 'awaiting';
type Dialog = { kind: 'edit'; pool: Pool | null } | { kind: 'import' | 'items' | 'export' | 'push' | 'delete'; pool: Pool } | null;

export default function InventoryPage() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('pools');
  const [dialog, setDialog] = useState<Dialog>(null);
  const auto = useFeatureStatus('autoDelivery');
  const activeCount = useLiveQuery(() => getDb().deliveries.where('status').anyOf([...ACTIVE_DELIVERY_STATUSES]).count(), [], 0);
  const awaitingCount = useLiveQuery(countAwaiting, [], 0);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('ops.inv.title')}
        description={t('ops.inv.description')}
        actions={
          <>
            <span className="flex items-center gap-2 text-xs text-muted">
              {t('ops.inv.autoDelivery')} <FeatureStatusPill feature="autoDelivery" />
            </span>
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => setDialog({ kind: 'edit', pool: null })}>
              {t('ops.inv.newPool')}
            </Button>
          </>
        }
      />
      <Callout tone="warning" title={t('ops.inv.rules.title')}>
        {t('ops.inv.rules.body')}
      </Callout>
      <Callout tone="info" title={auto?.status === 'running' ? t('ops.inv.mode.autoTitle') : t('ops.inv.mode.manualTitle')}>
        {auto?.status === 'running' ? t('ops.inv.mode.auto') : t('ops.inv.mode.manual', { reason: auto?.reason ?? '' })}
      </Callout>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'pools', label: t('ops.inv.tab.pools') },
          { value: 'deliveries', label: `${t('ops.inv.tab.deliveries')}${activeCount ? ` (${activeCount})` : ''}` },
          { value: 'awaiting', label: `${t('ops.inv.tab.awaiting')}${awaitingCount ? ` (${awaitingCount})` : ''}` },
        ]}
      />
      {tab === 'pools' && <PoolsTab onOpen={setDialog} />}
      {tab === 'deliveries' && <DeliveriesTab />}
      {tab === 'awaiting' && <AwaitingTab />}
      <InventorySettings />
      {dialog?.kind === 'edit' && <PoolEditor pool={dialog.pool} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'import' && <ImportModal pool={dialog.pool} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'items' && <ItemsModal pool={dialog.pool} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'export' && <ExportModal pool={dialog.pool} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'push' && <PushModal pool={dialog.pool} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          open
          danger
          title={t('ops.inv.pool.deleteTitle', { pool: dialog.pool.name })}
          confirmLabel={t('common.delete')}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            const id = dialog.pool.id;
            setDialog(null);
            deletePool(id)
              .then(() => toast.success(t('ops.inv.pool.deleted')))
              .catch((e: unknown) => toast.error(errorText(e, t)));
          }}
        >
          {t('ops.inv.pool.deleteBody')}
        </ConfirmDialog>
      )}
    </div>
  );
}

function PoolsTab({ onOpen }: { onOpen: (d: Dialog) => void }) {
  const t = useT();
  const data = useLiveQuery(async () => {
    const pools = await listPools();
    const counts = await Promise.all(pools.map((p) => countByStatus(p.id)));
    const listings = await getDb().listings.toArray();
    return { pools, counts, titles: new Map(listings.map((l) => [l.id, l.title])) };
  }, []);
  if (!data) return <Spinner />;
  if (data.pools.length === 0) {
    return (
      <EmptyState
        icon={<Boxes size={28} />}
        title={t('ops.inv.pool.emptyTitle')}
        action={
          <Button variant="primary" onClick={() => onOpen({ kind: 'edit', pool: null })}>
            {t('ops.inv.newPool')}
          </Button>
        }
      >
        {t('ops.inv.pool.emptyBody')}
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {data.pools.map((pool, i) => {
        const c = data.counts[i]!;
        const low = c.available <= pool.lowStockThreshold;
        return (
          <Card
            key={pool.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                {pool.name}
                {c.available === 0 ? <Badge tone="danger">{t('ops.inv.pool.empty')}</Badge> : low ? <Badge tone="warning">{t('ops.inv.pool.low')}</Badge> : null}
                {!pool.autoReserve && <Badge>{t('ops.inv.pool.manualOnly')}</Badge>}
              </span>
            }
            description={t('ops.inv.pool.summary', { listings: pool.listingIds.length, phrases: pool.matchText.length, perUnit: pool.itemsPerUnit, threshold: pool.lowStockThreshold })}
          >
            <dl className="mb-3 grid grid-cols-4 gap-2 text-center">
              {(['available', 'reserved', 'delivered', 'void'] as const).map((s) => (
                <div key={s} className="rounded-lg bg-surface-2 px-2 py-1.5">
                  <dt className="text-[11px] text-muted">{t(`ops.inv.itemStatus.${s}`)}</dt>
                  <dd className="text-lg font-semibold">{c[s]}</dd>
                </div>
              ))}
            </dl>
            {pool.listingIds.length > 0 && (
              <p className="mb-2 truncate text-xs text-muted" title={pool.listingIds.map((id) => data.titles.get(id) ?? id).join(', ')}>
                {t('ops.inv.pool.linked')}: {pool.listingIds.map((id) => data.titles.get(id) ?? `#${id}`).join(', ')}
              </p>
            )}
            <pre className="mb-3 max-h-20 overflow-hidden whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-[11px] text-muted">
              {renderMaskedMessage(pool.deliveryTemplate, pool.itemsPerUnit, { orderId: 'ABCD1234', buyer: 'buyer', quantity: 1, lot: '', category: '', price: null })}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" icon={<Upload size={14} />} onClick={() => onOpen({ kind: 'import', pool })}>
                {t('ops.inv.pool.import')}
              </Button>
              <Button size="sm" icon={<List size={14} />} onClick={() => onOpen({ kind: 'items', pool })}>
                {t('ops.inv.pool.items')}
              </Button>
              <Button size="sm" icon={<Download size={14} />} onClick={() => onOpen({ kind: 'export', pool })} disabled={c.available === 0}>
                {t('ops.inv.pool.export')}
              </Button>
              <Button size="sm" icon={<Send size={14} />} onClick={() => onOpen({ kind: 'push', pool })} disabled={c.available === 0}>
                {t('ops.inv.pool.push')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Pencil size={14} />} onClick={() => onOpen({ kind: 'edit', pool })}>
                {t('common.edit')}
              </Button>
              <Button size="sm" variant="ghost" icon={<Trash2 size={14} />} onClick={() => onOpen({ kind: 'delete', pool })}>
                {t('common.delete')}
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function InventorySettings() {
  const t = useT();
  const [settings, update] = useSettings();
  const s = settings.inventory;
  return (
    <Card title={t('ops.inv.settings.title')}>
      <Switch checked={s.autoReserve} onChange={(v) => void update({ inventory: { autoReserve: v } })} label={t('ops.inv.settings.autoReserve')} description={t('ops.inv.settings.autoReserveHelp')} />
      <Switch checked={s.prepareDrafts} onChange={(v) => void update({ inventory: { prepareDrafts: v } })} label={t('ops.inv.settings.prepareDrafts')} description={t('ops.inv.settings.prepareDraftsHelp')} />
      <Switch checked={s.notifyLowStock} onChange={(v) => void update({ inventory: { notifyLowStock: v } })} label={t('ops.inv.settings.notifyLowStock')} />
      <p className="mt-2 text-xs text-muted">{t('ops.inv.settings.autoDeliveryHint')}</p>
    </Card>
  );
}
