import { ClipboardCopy, Download, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { browser } from 'wxt/browser';
import { rpc } from '@/core/messaging/client';
import { buildDiagnosticReport, diagnosticFileName, DEFAULT_LOG_LIMIT } from '@/features/diagnostics/report';
import { downloadBlob } from '@/features/export/download';
import { Button, Callout, Card, toast } from '@/ui/components';
import { Checkbox } from '@/ui/components/FormControls';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';

function manifestInfo(): { version: string; manifestVersion: number | null } {
  try {
    const m = browser.runtime.getManifest();
    return { version: m.version, manifestVersion: m.manifest_version ?? null };
  } catch {
    return { version: '0.0.0', manifestVersion: null };
  }
}

/** Builds a redacted diagnostic report (no secrets, no customer data) to download or copy. */
export function DiagnosticsCard() {
  const t = useT();
  const { status } = useDashboard();
  const [report, setReport] = useState<string | null>(null);
  const [includeLogs, setIncludeLogs] = useState(true);
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const background = await rpc('ui.diagnostics', {}).catch((e: Error) => ({ unreachable: e.message }));
      const m = manifestInfo();
      const nav = globalThis.navigator as Navigator & { userAgentData?: { platform?: string } };
      const r = await buildDiagnosticReport({
        env: {
          extensionVersion: m.version,
          manifestVersion: m.manifestVersion,
          userAgent: nav.userAgent,
          language: nav.language,
          platform: nav.userAgentData?.platform ?? null,
        },
        statuses: status?.statuses ?? null,
        background,
        logLimit: includeLogs ? DEFAULT_LOG_LIMIT : 0,
      });
      setReport(JSON.stringify(r, null, 2));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('diagnostics.copyFailed'));
    }
  };

  return (
    <Card title={t('diagnostics.title')} description={t('diagnostics.description')}>
      <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-muted">
        <li>{t('diagnostics.includes')}</li>
        <li>{t('diagnostics.excludes')}</li>
      </ul>
      <Checkbox
        checked={includeLogs}
        onChange={setIncludeLogs}
        label={t('diagnostics.includeLogs', { count: DEFAULT_LOG_LIMIT })}
        description={t('diagnostics.includeLogsHelp')}
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          variant="primary"
          icon={<Stethoscope size={14} aria-hidden />}
          loading={busy}
          onClick={() => void generate()}
        >
          {report ? t('diagnostics.regenerate') : t('diagnostics.generate')}
        </Button>
        <Button
          variant="outline"
          icon={<Download size={14} aria-hidden />}
          disabled={!report}
          onClick={() => report && downloadBlob(report, diagnosticFileName(), 'application/json')}
        >
          {t('diagnostics.download')}
        </Button>
        <Button
          variant="outline"
          icon={<ClipboardCopy size={14} aria-hidden />}
          disabled={!report}
          onClick={() => void copy()}
        >
          {t('common.copy')}
        </Button>
      </div>
      {report && (
        <div className="mt-3 space-y-2">
          <Callout tone="info">{t('diagnostics.review')}</Callout>
          <pre
            tabIndex={0}
            aria-label={t('diagnostics.previewLabel')}
            className="fp-sensitive max-h-96 overflow-auto rounded-xl border border-border bg-surface-2 p-3 font-mono text-[11px] text-fg"
          >
            {report}
          </pre>
        </div>
      )}
    </Card>
  );
}
