import { Download, FileUp, LockKeyhole, Upload } from 'lucide-react';
import { useId, useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import { backupFileName, createBackup } from '@/features/backup/backup';
import { BackupError, MAX_BACKUP_BYTES, MIN_PASSPHRASE_LENGTH, type BackupEnvelope } from '@/features/backup/format';
import { openBackup, parseBackupText, restoreBackup, type RestoreMode, type RestorePlan } from '@/features/backup/restore';
import { downloadBlob } from '@/features/export/download';
import { Badge, Button, Callout, Card, ConfirmDialog, Field, Input, toast } from '@/ui/components';
import { Checkbox, Segmented } from '@/ui/components/FormControls';
import { useT, type TFunction } from '@/ui/i18n';

function appVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

function errorText(t: TFunction, e: unknown): string {
  if (e instanceof BackupError) return t(`backup.error.${e.code}`, { min: MIN_PASSPHRASE_LENGTH, max: MAX_BACKUP_BYTES / 1024 / 1024 });
  return e instanceof Error ? e.message : String(e);
}

function ExportSection() {
  const t = useT();
  const ids = { pass: useId(), confirm: useId() };
  const [encrypt, setEncrypt] = useState(true);
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [inventory, setInventory] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tooShort = encrypt && pass.length > 0 && pass.length < MIN_PASSPHRASE_LENGTH;
  const mismatch = encrypt && confirm.length > 0 && pass !== confirm;
  const canExport = !encrypt || (pass.length >= MIN_PASSPHRASE_LENGTH && pass === confirm);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const now = new Date();
      const res = await createBackup({ appVersion: appVersion(), passphrase: encrypt ? pass : undefined, includeInventoryItems: encrypt && inventory, now });
      downloadBlob(res.json, backupFileName(encrypt, now), 'application/json');
      const rows = Object.values(res.counts).reduce((a, b) => a + b, 0);
      toast.success(t('backup.export.done', { rows: rows.toLocaleString() }));
      if (res.skippedInventoryItems > 0) toast.error(t('backup.export.skippedInventory', { count: res.skippedInventoryItems }));
      setPass('');
      setConfirm('');
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="backup-export" className="space-y-3">
      <h3 id="backup-export" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Download size={15} aria-hidden /> {t('backup.export.title')}
      </h3>
      <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
        <li>{t('backup.export.includes')}</li>
        <li>{t('backup.export.excludes')}</li>
      </ul>
      <Checkbox checked={encrypt} onChange={setEncrypt} label={t('backup.export.encrypt')} description={t('backup.export.encryptHelp')} />
      {encrypt && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('backup.passphrase')} htmlFor={ids.pass} error={tooShort ? t('backup.error.weak_passphrase', { min: MIN_PASSPHRASE_LENGTH }) : undefined}>
            <Input id={ids.pass} type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
          <Field label={t('backup.passphraseConfirm')} htmlFor={ids.confirm} error={mismatch ? t('backup.passphraseMismatch') : undefined}>
            <Input id={ids.confirm} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        </div>
      )}
      <Checkbox
        checked={encrypt && inventory}
        disabled={!encrypt}
        onChange={setInventory}
        label={t('backup.export.inventory')}
        description={encrypt ? t('backup.export.inventoryHelp') : t('backup.export.inventoryNeedsEncryption')}
      />
      {!encrypt && <Callout tone="warning">{t('backup.export.plainWarning')}</Callout>}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <Button variant="primary" icon={<Download size={14} aria-hidden />} disabled={!canExport} loading={busy} onClick={() => void run()}>
        {t('backup.export.button')}
      </Button>
    </section>
  );
}

function PlanPreview({ plan }: { plan: RestorePlan }) {
  const t = useT();
  const entries = Object.entries(plan.report);
  const invalid = entries.reduce((n, [, r]) => n + r.invalid, 0);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone="accent">{t('backup.import.created', { date: new Date(plan.header.createdAt).toLocaleString() })}</Badge>
        <Badge tone="neutral">{t('backup.import.version', { version: plan.header.appVersion })}</Badge>
        {plan.header.encrypted && (
          <Badge tone="success">
            <LockKeyhole size={10} aria-hidden /> {t('backup.import.encrypted')}
          </Badge>
        )}
        {plan.settings && <Badge tone="info">{t('backup.import.hasSettings')}</Badge>}
      </div>
      <div className="max-h-56 overflow-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-1 text-left font-semibold">
                {t('privacy.data.table')}
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                {t('backup.import.rows')}
              </th>
              <th scope="col" className="py-1 text-right font-semibold">
                {t('backup.import.invalid')}
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, r]) => (
              <tr key={name} className="border-t border-border/60">
                <th scope="row" className="py-1 text-left font-normal text-fg">
                  {t(`privacy.table.${name}`)}
                </th>
                <td className="py-1 text-right tabular-nums">{r.valid.toLocaleString()}</td>
                <td className={`py-1 text-right tabular-nums ${r.invalid ? 'text-danger' : 'text-muted'}`}>{r.invalid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {invalid > 0 && <Callout tone="warning">{t('backup.import.invalidRows', { count: invalid })}</Callout>}
      {plan.unknownTables.length > 0 && <p className="text-xs text-muted">{t('backup.import.unknownTables', { tables: plan.unknownTables.join(', ') })}</p>}
      {!plan.inventoryItems && <p className="text-xs text-muted">{t('backup.import.noInventory')}</p>}
    </div>
  );
}

function ImportSection() {
  const t = useT();
  const fileId = useId();
  const passId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [envelope, setEnvelope] = useState<BackupEnvelope | null>(null);
  const [pass, setPass] = useState('');
  const [plan, setPlan] = useState<RestorePlan | null>(null);
  const [mode, setMode] = useState<RestoreMode>('merge');
  const [withSettings, setWithSettings] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const reset = () => {
    setFileName(null);
    setEnvelope(null);
    setPlan(null);
    setPass('');
    setError(null);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    reset();
    setFileName(file.name);
    setBusy(true);
    try {
      if (file.size > MAX_BACKUP_BYTES) throw new BackupError('too_large');
      const env = parseBackupText(await file.text());
      setEnvelope(env);
      if (!env.encrypted) setPlan(await openBackup(env));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!envelope) return;
    setBusy(true);
    setError(null);
    try {
      setPlan(await openBackup(envelope, pass));
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const res = await restoreBackup(plan, { mode, restoreSettings: withSettings });
      const rows = Object.values(res.restored).reduce((a, b) => a + b, 0);
      toast.success(t('backup.import.done', { rows: rows.toLocaleString() }));
      if (res.settingsRestored) toast.info(t('backup.import.settingsRestored'));
      reset();
    } catch (err) {
      setError(t('backup.import.failed', { error: errorText(t, err) }));
    } finally {
      setBusy(false);
      setConfirmReplace(false);
    }
  };

  return (
    <section aria-labelledby="backup-import" className="space-y-3">
      <h3 id="backup-import" className="flex items-center gap-2 text-sm font-semibold text-fg">
        <Upload size={15} aria-hidden /> {t('backup.import.title')}
      </h3>
      <p className="text-xs text-muted">{t('backup.import.description')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={inputRef} id={fileId} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => void onFile(e)} />
        <Button variant="outline" icon={<FileUp size={14} aria-hidden />} loading={busy && !envelope} onClick={() => inputRef.current?.click()}>
          {t('backup.import.choose')}
        </Button>
        {fileName && <span className="truncate text-xs text-muted">{fileName}</span>}
      </div>

      {envelope?.encrypted && !plan && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <Field label={t('backup.passphrase')} htmlFor={passId}>
            <Input id={passId} type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </Field>
          <Button type="submit" variant="primary" disabled={!pass} loading={busy}>
            {t('backup.import.unlock')}
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {plan && (
        <div className="space-y-3">
          <PlanPreview plan={plan} />
          <div>
            <p className="mb-1.5 text-sm font-medium text-fg">{t('backup.import.mode')}</p>
            <Segmented<RestoreMode>
              label={t('backup.import.mode')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'merge', label: t('backup.import.merge') },
                { value: 'replace', label: t('backup.import.replace') },
              ]}
            />
            <p className="mt-1 text-xs text-muted">{t(mode === 'merge' ? 'backup.import.mergeHelp' : 'backup.import.replaceHelp')}</p>
          </div>
          <Checkbox checked={withSettings} disabled={!plan.settings} onChange={setWithSettings} label={t('backup.import.restoreSettings')} description={t('backup.import.restoreSettingsHelp')} />
          <div className="flex flex-wrap gap-2">
            <Button variant={mode === 'replace' ? 'danger' : 'primary'} loading={busy} onClick={() => (mode === 'replace' ? setConfirmReplace(true) : void restore())}>
              {t('backup.import.restore')}
            </Button>
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmReplace}
        danger
        busy={busy}
        title={t('backup.import.replaceConfirmTitle')}
        confirmLabel={t('backup.import.replace')}
        onCancel={() => setConfirmReplace(false)}
        onConfirm={() => void restore()}
      >
        {t('backup.import.replaceConfirm')}
      </ConfirmDialog>
    </section>
  );
}

/** Backup (optionally passphrase-encrypted) and restore with preview, merge or replace. */
export function BackupCard() {
  const t = useT();
  return (
    <Card title={t('backup.title')} description={t('backup.description')}>
      <div className="grid gap-6 lg:grid-cols-2">
        <ExportSection />
        <ImportSection />
      </div>
    </Card>
  );
}
