import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { downloadBlob, timestampedName } from '@/features/export/download';
import { exportEncrypted, exportPlain, MIN_PASSPHRASE_LENGTH } from '@/features/inventory/items';
import type { Pool } from '@/features/inventory/model';
import { Button, Callout, Field, Input, Modal, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { errorText } from './common';

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'pool'
  );
}

export function ExportModal({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const t = useT();
  const [format, setFormat] = useState<'encrypted' | 'plain'>('encrypted');
  const [ack, setAck] = useState(false);
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [busy, setBusy] = useState(false);
  const available = useLiveQuery(
    () => getDb().inventoryItems.where('[poolId+status]').equals([pool.id, 'available']).count(),
    [pool.id],
    0,
  );

  const passOk = pass.length >= MIN_PASSPHRASE_LENGTH && pass === pass2;
  const canExport = available > 0 && (format === 'plain' ? ack : passOk);

  const run = async () => {
    setBusy(true);
    try {
      if (format === 'plain') {
        const { text } = await exportPlain(pool.id);
        downloadBlob(text, timestampedName(`funpro-${slug(pool.name)}`, 'txt'), 'text/plain;charset=utf-8');
      } else {
        const file = await exportEncrypted(pool.id, pass);
        downloadBlob(
          JSON.stringify(file, null, 2),
          timestampedName(`funpro-${slug(pool.name)}-encrypted`, 'json'),
          'application/json',
        );
      }
      setPass('');
      setPass2('');
      toast.success(t('ops.inv.export.done', { n: available }));
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
      onClose={onClose}
      title={t('ops.inv.export.title', { pool: pool.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={format === 'plain' ? 'danger' : 'primary'}
            onClick={run}
            loading={busy}
            disabled={!canExport}
          >
            {t('ops.inv.export.run', { n: available })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-xs text-muted">{t('ops.inv.export.help')}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">{t('ops.inv.export.format')}</legend>
          <label className="flex items-start gap-2">
            <input
              type="radio"
              name="fmt"
              checked={format === 'encrypted'}
              onChange={() => setFormat('encrypted')}
            />
            <span>
              <span className="font-medium">{t('ops.inv.export.encrypted')}</span>
              <span className="block text-xs text-muted">{t('ops.inv.export.encryptedHelp')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="fmt" checked={format === 'plain'} onChange={() => setFormat('plain')} />
            <span>
              <span className="font-medium">{t('ops.inv.export.plain')}</span>
              <span className="block text-xs text-muted">{t('ops.inv.export.plainHelp')}</span>
            </span>
          </label>
        </fieldset>
        {format === 'encrypted' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('ops.inv.export.passphrase')}
              help={t('ops.inv.export.passphraseHelp', { n: MIN_PASSPHRASE_LENGTH })}
              htmlFor="exp-pass"
            >
              <Input
                id="exp-pass"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
            <Field
              label={t('ops.inv.export.passphrase2')}
              error={pass2 && pass !== pass2 ? t('ops.inv.export.mismatch') : undefined}
              htmlFor="exp-pass2"
            >
              <Input
                id="exp-pass2"
                type="password"
                value={pass2}
                onChange={(e) => setPass2(e.target.value)}
                autoComplete="new-password"
              />
            </Field>
          </div>
        ) : (
          <Callout tone="danger" title={t('ops.inv.export.plainWarnTitle')}>
            <label className="mt-1 flex items-start gap-2">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>{t('ops.inv.export.plainAck')}</span>
            </label>
          </Callout>
        )}
      </div>
    </Modal>
  );
}
