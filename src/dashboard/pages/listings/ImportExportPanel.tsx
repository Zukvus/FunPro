import { Download, FileUp, ListChecks, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { downloadBlob, MIME, timestampedName } from '@/features/export/download';
import {
  applyImportLocal,
  detectImportFormat,
  diffImport,
  importToBulkPlan,
  LISTINGS_IMPORT_MAX_BYTES,
  listingsToCsv,
  listingsToJson,
  listingsToXlsx,
  parseListingsImport,
  type ImportDiff,
  type ImportDiffRow,
  type ImportError,
} from '@/features/listings/import-export';
import type { Listing } from '@/shared/models';
import {
  Badge,
  Button,
  Callout,
  Card,
  ConfirmDialog,
  DataTable,
  Field,
  Select,
  toast,
  type Column,
} from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { errorText, truncate, useFormat, usePageApi } from './shared';

type Format = 'xlsx' | 'csv' | 'json';

export function ImportExportPanel({ listings }: { listings: Listing[] }) {
  const t = useT();
  const fmt = useFormat();
  const api = usePageApi();
  const [settings] = useSettings();
  const [format, setFormat] = useState<Format>('xlsx');
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [confirmLocal, setConfirmLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const existing = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);

  const doExport = () => {
    if (listings.length === 0) return;
    const sorted = [...listings].sort((a, b) => a.sortIndex - b.sortIndex);
    const name = timestampedName('funpro-listings', format);
    if (format === 'json') downloadBlob(listingsToJson(sorted), name, MIME.json);
    else if (format === 'csv') downloadBlob(listingsToCsv(sorted), name, MIME.csv);
    else downloadBlob(listingsToXlsx(sorted).slice().buffer, name, MIME.xlsx);
    toast.success(t('listings.io.exported', { count: sorted.length }));
  };

  const onFile = async (file: File | undefined) => {
    setDiff(null);
    setErrors([]);
    if (!file) return;
    setFileName(file.name);
    if (file.size > LISTINGS_IMPORT_MAX_BYTES) {
      setErrors([
        {
          row: 0,
          message: t('listings.io.tooLarge', { mb: Math.round(LISTINGS_IMPORT_MAX_BYTES / 1024 / 1024) }),
        },
      ]);
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const kind = detectImportFormat(file.name, bytes);
      if (!kind) {
        setErrors([{ row: 0, message: t('listings.io.unknownFormat') }]);
        return;
      }
      const parsed = parseListingsImport(bytes, kind);
      setErrors(parsed.errors);
      if (parsed.listings.length) setDiff(diffImport(existing, parsed.listings));
    } catch (e) {
      setErrors([{ row: 0, message: errorText(t, e) }]);
    }
  };

  const applyLocal = async () => {
    if (!diff) return;
    setBusy(true);
    try {
      const r = await applyImportLocal(diff, t('listings.io.backupLabel', { file: fileName ?? '' }));
      toast.success(t('listings.io.applied', { count: r.updated }));
      setConfirmLocal(false);
      setDiff(null);
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const toPlan = () => {
    if (!diff) return;
    const plan = importToBulkPlan(diff, existing, settings.fees, {
      now: Date.now(),
      label: t('listings.io.planLabel', { file: truncate(fileName ?? '', 60) }),
    });
    if (plan.items.length === 0) return;
    api.openPreview(plan);
  };

  const columns: Column<ImportDiffRow>[] = [
    {
      key: 'title',
      header: t('listings.col.title'),
      width: 'minmax(0,2fr)',
      render: (r) => (
        <span className="truncate" title={r.title}>
          {r.title || `#${r.id}`}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('listings.col.status'),
      width: '120px',
      render: (r) => (
        <Badge tone={r.status === 'update' ? 'accent' : r.status === 'unknown' ? 'warning' : 'neutral'}>
          {t(`listings.io.row.${r.status}`)}
        </Badge>
      ),
    },
    {
      key: 'local',
      header: t('listings.io.localChanges'),
      width: 'minmax(0,2fr)',
      render: (r) => {
        const cur = existing.get(r.id);
        const ccy = cur?.price.currency ?? 'UNKNOWN';
        const parts: string[] = [];
        if ('costMinor' in r.local)
          parts.push(
            `${t('listings.col.cost')}: ${r.local.costMinor === null || r.local.costMinor === undefined ? '—' : fmt.money(r.local.costMinor, ccy)}`,
          );
        if (r.local.sortIndex !== undefined) parts.push(`${t('listings.io.order')}: ${r.local.sortIndex}`);
        if ('titleEn' in r.local) parts.push(`EN: ${truncate(r.local.titleEn ?? '', 30) || '—'}`);
        if ('descriptionEn' in r.local) parts.push(t('listings.io.descEn'));
        return <span className="truncate text-xs">{parts.join(' · ') || '—'}</span>;
      },
    },
    {
      key: 'remote',
      header: t('listings.io.remoteChanges'),
      width: 'minmax(0,2fr)',
      render: (r) => {
        const cur = existing.get(r.id);
        const ccy = cur?.price.currency ?? 'UNKNOWN';
        const parts: string[] = [];
        if (r.remote.priceMinor)
          parts.push(
            `${fmt.money(r.remote.priceMinor.from, ccy)} → ${fmt.money(r.remote.priceMinor.to, ccy)}`,
          );
        if (r.remote.active) parts.push(r.remote.active.to ? t('listings.active') : t('listings.inactive'));
        if (r.remote.amount) parts.push(`${t('listings.col.stock')}: ${r.remote.amount.to ?? '∞'}`);
        return <span className="truncate text-xs text-muted">{parts.join(' · ') || '—'}</span>;
      },
    },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
      <Card title={t('listings.io.exportTitle')} description={t('listings.io.exportHelp')}>
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t('listings.io.format')}>
            <Select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
              <option value="xlsx">Excel (XLSX)</option>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </Select>
          </Field>
          <Button
            variant="primary"
            icon={<Download size={14} aria-hidden />}
            disabled={listings.length === 0}
            onClick={doExport}
          >
            {t('listings.io.export', { count: listings.length })}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted">{t('listings.io.roundTrip')}</p>
      </Card>

      <Card
        title={t('listings.io.importTitle')}
        description={t('listings.io.importHelp', { mb: Math.round(LISTINGS_IMPORT_MAX_BYTES / 1024 / 1024) })}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".json,.xlsx,.csv,application/json,text/csv"
          className="sr-only"
          aria-label={t('listings.io.chooseFile')}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button icon={<FileUp size={14} aria-hidden />} onClick={() => fileRef.current?.click()}>
            {t('listings.io.chooseFile')}
          </Button>
          {fileName && <span className="text-xs text-muted">{fileName}</span>}
        </div>
        {errors.length > 0 && (
          <div className="mt-3">
            <Callout
              tone={diff ? 'warning' : 'danger'}
              title={t('listings.io.errors', { count: errors.length })}
            >
              <ul className="max-h-40 list-disc overflow-auto pl-4">
                {errors.slice(0, 50).map((e, i) => (
                  <li key={i}>{e.row > 0 ? `${t('listings.io.row')} ${e.row}: ${e.message}` : e.message}</li>
                ))}
              </ul>
            </Callout>
          </div>
        )}
        {diff && (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge tone="accent">{t('listings.io.sum.update', { count: diff.updates })}</Badge>
              <Badge>{t('listings.io.sum.unchanged', { count: diff.unchanged })}</Badge>
              {diff.unknown > 0 && (
                <Badge tone="warning">{t('listings.io.sum.unknown', { count: diff.unknown })}</Badge>
              )}
              {diff.remoteChanges > 0 && (
                <Badge tone="info">{t('listings.io.sum.remote', { count: diff.remoteChanges })}</Badge>
              )}
            </div>
            <Callout tone="info">{t('listings.io.localOnly')}</Callout>
            <DataTable rows={diff.rows} columns={columns} rowKey={(r) => r.id} height={320} rowHeight={38} />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                icon={<ListChecks size={14} aria-hidden />}
                disabled={diff.remoteChanges === 0}
                onClick={toPlan}
              >
                {t('listings.io.toPlan', { count: diff.remoteChanges })}
              </Button>
              <Button
                variant="primary"
                icon={<Upload size={14} aria-hidden />}
                disabled={diff.updates === 0}
                onClick={() => setConfirmLocal(true)}
              >
                {t('listings.io.applyLocal', { count: diff.updates })}
              </Button>
            </div>
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={confirmLocal}
        title={t('listings.io.applyLocalTitle')}
        confirmLabel={t('listings.io.applyLocal', { count: diff?.updates ?? 0 })}
        busy={busy}
        onConfirm={() => void applyLocal()}
        onCancel={() => setConfirmLocal(false)}
      >
        {t('listings.io.applyLocalBody', { count: diff?.updates ?? 0 })}
      </ConfirmDialog>
    </div>
  );
}
