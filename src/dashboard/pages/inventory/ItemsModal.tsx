import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getDb } from '@/core/db/db';
import { deleteItems, revealItem } from '@/features/inventory/items';
import type { Pool } from '@/features/inventory/model';
import { MASK } from '@/features/inventory/template';
import type { InventoryItem, InventoryItemStatus } from '@/shared/models';
import {
  Badge,
  ConfirmDialog,
  DataTable,
  IconButton,
  Modal,
  Select,
  toast,
  type Column,
} from '@/ui/components';
import { useT } from '@/ui/i18n';
import { dateTime, errorText, useLocaleTag } from './common';

const REVEAL_MS = 20_000;
const TONE: Record<InventoryItemStatus, 'success' | 'warning' | 'neutral' | 'info'> = {
  available: 'success',
  reserved: 'warning',
  delivered: 'info',
  void: 'neutral',
};

export function ItemsModal({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleTag();
  const [status, setStatus] = useState<InventoryItemStatus | 'all'>('all');
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<InventoryItem | null>(null);
  const timers = useRef<number[]>([]);
  const items = useLiveQuery(
    () => getDb().inventoryItems.where('poolId').equals(pool.id).toArray(),
    [pool.id],
    [],
  );
  const rows = status === 'all' ? items : items.filter((i) => i.status === status);

  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((id) => window.clearTimeout(id));
  }, []);

  const reveal = async (id: string) => {
    try {
      const value = await revealItem(id);
      setRevealed((r) => ({ ...r, [id]: value }));
      timers.current.push(
        window.setTimeout(() => {
          setRevealed((r) => {
            const next = { ...r };
            delete next[id];
            return next;
          });
        }, REVEAL_MS),
      );
    } catch (e) {
      toast.error(errorText(e, t));
    }
  };

  const hide = (id: string) =>
    setRevealed((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });

  const copy = async (id: string) => {
    const v = revealed[id];
    if (!v) return;
    await navigator.clipboard.writeText(v);
    toast.success(t('common.copied'));
  };

  const remove = async (item: InventoryItem) => {
    try {
      const n = await deleteItems([item.id]);
      toast.success(t('ops.inv.items.deleted', { n }));
    } catch (e) {
      toast.error(errorText(e, t));
    }
    setConfirmDelete(null);
  };

  const columns: Column<InventoryItem>[] = [
    {
      key: 'status',
      header: t('ops.inv.items.status'),
      width: '110px',
      render: (i) => <Badge tone={TONE[i.status]}>{t(`ops.inv.itemStatus.${i.status}`)}</Badge>,
    },
    {
      key: 'value',
      header: t('ops.inv.items.value'),
      render: (i) => (
        <span className={revealed[i.id] ? 'fp-sensitive font-mono text-xs' : 'font-mono text-xs text-muted'}>
          {revealed[i.id] ?? MASK}
        </span>
      ),
    },
    {
      key: 'order',
      header: t('ops.inv.items.order'),
      width: '110px',
      render: (i) => (i.orderId ? `#${i.orderId}` : '—'),
    },
    {
      key: 'created',
      header: t('ops.inv.items.added'),
      width: '140px',
      render: (i) => dateTime(i.createdAt, locale),
    },
    {
      key: 'actions',
      header: '',
      width: '110px',
      align: 'right',
      render: (i) => (
        <span className="inline-flex gap-1">
          {revealed[i.id] ? (
            <>
              <IconButton label={t('common.copy')} onClick={() => void copy(i.id)}>
                <Copy size={14} />
              </IconButton>
              <IconButton label={t('ops.inv.items.hide')} onClick={() => hide(i.id)}>
                <EyeOff size={14} />
              </IconButton>
            </>
          ) : (
            <IconButton label={t('ops.inv.items.reveal')} onClick={() => void reveal(i.id)}>
              <Eye size={14} />
            </IconButton>
          )}
          {(i.status === 'available' || i.status === 'void') && (
            <IconButton label={t('common.delete')} onClick={() => setConfirmDelete(i)}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </span>
      ),
    },
  ];

  return (
    <Modal open wide onClose={onClose} title={t('ops.inv.items.title', { pool: pool.name })}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{t('ops.inv.items.help', { sec: REVEAL_MS / 1000 })}</p>
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value as InventoryItemStatus | 'all')}
          aria-label={t('ops.inv.items.status')}
          className="w-44"
        >
          <option value="all">{t('common.all')}</option>
          {(['available', 'reserved', 'delivered', 'void'] as const).map((s) => (
            <option key={s} value={s}>
              {t(`ops.inv.itemStatus.${s}`)}
            </option>
          ))}
        </Select>
      </div>
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(i) => i.id}
        height={420}
        empty={<p className="py-8 text-center text-sm text-muted">{t('ops.inv.items.empty')}</p>}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={t('ops.inv.items.deleteTitle')}
        confirmLabel={t('common.delete')}
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void remove(confirmDelete)}
      >
        {t('ops.inv.items.deleteBody')}
      </ConfirmDialog>
    </Modal>
  );
}
