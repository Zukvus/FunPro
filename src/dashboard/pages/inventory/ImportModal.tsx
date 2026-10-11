import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { decryptExport, importItems, isEncryptedExport, itemsFromCsv, MAX_IMPORT_FILE_BYTES, MAX_ITEMS_PER_IMPORT, splitLines, type EncryptedExport, type ImportResult } from '@/features/inventory/items';
import { rearmLowStock } from '@/features/inventory/lowstock';
import { toDelivery, type Pool } from '@/features/inventory/model';
import { Button, Callout, Field, Input, Modal, Tabs, Textarea, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { errorText } from './common';

export function ImportModal({ pool, onClose }: { pool: Pool; onClose: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<'paste' | 'file'>('paste');
  const [text, setText] = useState('');
  const [fileItems, setFileItems] = useState<string[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [encrypted, setEncrypted] = useState<EncryptedExport | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const waiting = useLiveQuery(
    async () => (await getDb().deliveries.where('status').equals('manual').toArray()).map(toDelivery).filter((d) => d.poolId === pool.id && d.itemIds.length === 0),
    [pool.id],
    [],
  );

  const lines = mode === 'paste' ? splitLines(text) : (fileItems ?? []);
  const count = lines.filter((l) => l.trim()).length;

  const onFile = async (file: File | undefined) => {
    setResult(null);
    setFileItems(null);
    setEncrypted(null);
    if (!file) return;
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      toast.error(t('ops.inv.import.tooLarge'));
      return;
    }
    setFileName(file.name);
    const content = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.json')) {
      try {
        const parsed: unknown = JSON.parse(content);
        if (isEncryptedExport(parsed)) setEncrypted(parsed);
        else toast.error(t('ops.inv.import.badJson'));
      } catch {
        toast.error(t('ops.inv.import.badJson'));
      }
      return;
    }
    setFileItems(lower.endsWith('.csv') ? itemsFromCsv(content) : splitLines(content));
  };

  const unlock = async () => {
    if (!encrypted) return;
    setBusy(true);
    try {
      setFileItems(await decryptExport(encrypted, passphrase));
      setEncrypted(null);
      setPassphrase('');
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    setBusy(true);
    try {
      const res = await importItems(pool.id, lines);
      await rearmLowStock(pool);
      setResult(res);
      // Plaintext does not stay in the page state after import.
      setText('');
      setFileItems(null);
      setFileName('');
    } catch (e) {
      toast.error(errorText(e, t));
    } finally {
      setBusy(false);
    }
  };

  const reserveWaiting = async () => {
    setBusy(true);
    let ok = 0;
    for (const d of waiting) {
      try {
        const res = await rpc<{ kind: string }>('ui.inventory.reserve', { orderId: d.orderId, poolId: pool.id, refill: true });
        if (res.kind === 'reserved') ok++;
      } catch (e) {
        toast.error(`#${d.orderId}: ${errorText(e, t)}`);
      }
    }
    setBusy(false);
    toast.success(t('ops.inv.import.reservedWaiting', { n: ok }));
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('ops.inv.import.title', { pool: pool.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button variant="primary" onClick={run} loading={busy} disabled={count === 0 || !!encrypted}>
            {t('ops.inv.import.run', { n: count })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs text-muted">{t('ops.inv.import.help', { max: MAX_ITEMS_PER_IMPORT })}</p>
        <Tabs
          value={mode}
          onChange={(m) => {
            setMode(m);
            setResult(null);
          }}
          items={[
            { value: 'paste', label: t('ops.inv.import.paste') },
            { value: 'file', label: t('ops.inv.import.file') },
          ]}
        />
        {mode === 'paste' ? (
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} placeholder={t('ops.inv.import.placeholder')} aria-label={t('ops.inv.import.paste')} className="font-mono fp-sensitive" spellCheck={false} autoComplete="off" />
        ) : (
          <div className="flex flex-col gap-2">
            <input type="file" accept=".txt,.csv,.json,text/plain,text/csv,application/json" onChange={(e) => void onFile(e.target.files?.[0])} aria-label={t('ops.inv.import.file')} className="text-sm" />
            <p className="text-xs text-muted">{t('ops.inv.import.fileHelp')}</p>
            {fileName && fileItems && <p className="text-xs text-fg">{t('ops.inv.import.fileLoaded', { name: fileName, n: count })}</p>}
            {encrypted && (
              <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                <Field label={t('ops.inv.import.passphrase')} htmlFor="imp-pass">
                  <Input id="imp-pass" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="off" />
                </Field>
                <Button onClick={unlock} loading={busy} disabled={!passphrase}>
                  {t('ops.inv.import.unlock')}
                </Button>
              </div>
            )}
          </div>
        )}
        {result && (
          <Callout tone={result.added > 0 ? 'success' : 'warning'} title={t('ops.inv.import.done', { n: result.added })}>
            <ul className="list-disc pl-4">
              {result.duplicatesInBatch > 0 && <li>{t('ops.inv.import.dupBatch', { n: result.duplicatesInBatch })}</li>}
              {result.duplicatesExisting > 0 && <li>{t('ops.inv.import.dupExisting', { n: result.duplicatesExisting })}</li>}
              {result.empty > 0 && <li>{t('ops.inv.import.empty', { n: result.empty })}</li>}
              {result.tooLong > 0 && <li>{t('ops.inv.import.tooLong', { n: result.tooLong })}</li>}
              {result.skippedOverLimit > 0 && <li>{t('ops.inv.import.overLimit', { n: result.skippedOverLimit })}</li>}
            </ul>
          </Callout>
        )}
        {waiting.length > 0 && (
          <Callout tone="info" title={t('ops.inv.import.waitingTitle', { n: waiting.length })}>
            <p className="mb-2">{t('ops.inv.import.waitingBody')}</p>
            <Button size="sm" onClick={reserveWaiting} loading={busy}>
              {t('ops.inv.import.reserveWaiting')}
            </Button>
          </Callout>
        )}
      </div>
    </Modal>
  );
}
