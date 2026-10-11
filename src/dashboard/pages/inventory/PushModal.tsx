import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import type { Pool } from '@/features/inventory/model';
import { listPushes, type PushPreview, type PushResult } from '@/features/inventory/push';
import { Badge, Button, Callout, ConfirmDialog, Field, Input, Modal, Select, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { dateTime, errorText, useLocaleTag } from './common';

const PUSH_TONE = {
  pending: 'info',
  done: 'success',
  failed: 'danger',
  uncertain: 'warning',
  restored: 'neutral',
} as const;

export function PushModal({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleTag();
  const listings = useLiveQuery(
    async () => (await getDb().listings.bulkGet(pool.listingIds)).filter((l) => !!l),
    [pool.listingIds.join(',')],
    [],
  );
  const pushes = useLiveQuery(() => listPushes(pool.id), [pool.id], []);
  const [offerId, setOfferId] = useState(pool.listingIds[0] ?? '');
  const [count, setCount] = useState('10');
  const [preview, setPreview] = useState<PushPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [ack, setAck] = useState(false);
  const [restore, setRestore] = useState<string | null>(null);

  const n = Number.parseInt(count, 10);
  const valid = !!offerId && Number.isInteger(n) && n >= 1 && n <= 5000;

  const check = async () => {
    setBusy(true);
    try {
      setPreview(await rpc<PushPreview>('ui.inventory.pushPreview', { poolId: pool.id, offerId }));
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const push = async () => {
    setBusy(true);
    try {
      const res = await rpc<PushResult>('ui.inventory.push', {
        poolId: pool.id,
        offerId,
        count: n,
        confirm: true,
      });
      if (res.status === 'done') toast.success(t('ops.inv.push.done', { n: res.pushed }));
      else if (res.status === 'uncertain') toast.error(t('ops.inv.push.uncertain'));
      else toast.error(t('ops.inv.push.failed', { error: res.errors.join('; ') }));
      setPreview(null);
      setAck(false);
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  const doRestore = async (pushId: string) => {
    try {
      const res = await rpc<{ restored: number }>('ui.inventory.restorePush', { pushId, confirm: true });
      toast.success(t('ops.inv.push.restored', { n: res.restored }));
    } catch (e) {
      toast.error(errorText(e, t));
    }
    setRestore(null);
  };

  return (
    <Modal open wide onClose={onClose} title={t('ops.inv.push.title', { pool: pool.name })}>
      <div className="flex flex-col gap-3 text-sm">
        <Callout tone="warning" title={t('ops.inv.push.warnTitle')}>
          <ul className="list-disc pl-4">
            <li>{t('ops.inv.push.warnLive')}</li>
            <li>{t('ops.inv.push.warnVoid')}</li>
            <li>{t('ops.inv.rules.body')}</li>
          </ul>
        </Callout>
        <Badge tone="info" className="self-start">
          {t('ops.common.requiresLiveVerification')}
        </Badge>
        {pool.listingIds.length === 0 ? (
          <p className="text-muted">{t('ops.inv.push.noListings')}</p>
        ) : (
          <>
            <div className="grid gap-3 md:grid-cols-[1fr_140px_auto] md:items-end">
              <Field label={t('ops.inv.push.offer')} htmlFor="push-offer">
                <Select
                  id="push-offer"
                  value={offerId}
                  onChange={(e) => {
                    setOfferId(e.target.value);
                    setPreview(null);
                  }}
                >
                  {pool.listingIds.map((id) => {
                    const l = listings.find((x) => x?.id === id);
                    return (
                      <option key={id} value={id}>
                        {l ? `${l.title.slice(0, 70)} (#${id})` : `#${id}`}
                      </option>
                    );
                  })}
                </Select>
              </Field>
              <Field label={t('ops.inv.push.count')} htmlFor="push-count">
                <Input
                  id="push-count"
                  type="number"
                  min={1}
                  max={5000}
                  value={count}
                  onChange={(e) => setCount(e.target.value)}
                />
              </Field>
              <Button onClick={check} loading={busy && !preview} disabled={!offerId}>
                {t('ops.inv.push.check')}
              </Button>
            </div>
            {preview && (
              <div className="rounded-lg border border-border p-3 text-xs">
                {!preview.supported ? (
                  <p className="text-danger">{t('ops.inv.push.unsupported')}</p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    <li>{t('ops.inv.push.existing', { n: preview.existingCount })}</li>
                    <li>{preview.autoDeliveryOn ? t('ops.inv.push.autoOn') : t('ops.inv.push.autoOff')}</li>
                    <li>{t('ops.inv.push.available', { n: preview.available })}</li>
                  </ul>
                )}
              </div>
            )}
            <label className="flex items-start gap-2 text-xs">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{t('ops.inv.push.ack')}</span>
            </label>
            <Button
              variant="primary"
              className="self-start"
              disabled={!valid || !preview?.supported || !ack}
              onClick={() => setConfirm(true)}
            >
              {t('ops.inv.push.run', { n: Number.isInteger(n) ? n : 0 })}
            </Button>
          </>
        )}
        {pushes.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-semibold text-muted">{t('ops.inv.push.history')}</p>
            <ul className="flex flex-col gap-1">
              {pushes.slice(0, 10).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge tone={PUSH_TONE[p.status]}>{t(`ops.inv.pushStatus.${p.status}`)}</Badge>
                  <span>{dateTime(p.at, locale)}</span>
                  <span className="text-muted">
                    #{p.offerId} · {t('ops.inv.push.items', { n: p.itemIds.length })}
                  </span>
                  {p.error && <span className="text-muted">{p.error}</span>}
                  {p.status === 'uncertain' && (
                    <Button size="sm" variant="outline" onClick={() => setRestore(p.id)}>
                      {t('ops.inv.push.restore')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={t('ops.inv.push.confirmTitle')}
        confirmLabel={t('ops.inv.push.confirm')}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() => void push()}
      >
        {t('ops.inv.push.confirmBody', { n: Number.isInteger(n) ? n : 0, offer: offerId })}
      </ConfirmDialog>
      <ConfirmDialog
        open={!!restore}
        title={t('ops.inv.push.restoreTitle')}
        confirmLabel={t('ops.inv.push.restore')}
        danger
        onCancel={() => setRestore(null)}
        onConfirm={() => restore && void doRestore(restore)}
      >
        {t('ops.inv.push.restoreBody')}
      </ConfirmDialog>
    </Modal>
  );
}
