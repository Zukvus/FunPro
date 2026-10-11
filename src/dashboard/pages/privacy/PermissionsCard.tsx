import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Badge, Button, Card, Spinner, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';

/** Why FunPro asks for each permission (manifest values → i18n key). */
const PERMISSION_KEYS: Record<string, string> = {
  storage: 'privacy.perm.storage',
  unlimitedStorage: 'privacy.perm.unlimitedStorage',
  alarms: 'privacy.perm.alarms',
  notifications: 'privacy.perm.notifications',
  offscreen: 'privacy.perm.offscreen',
  'https://funpay.com/*': 'privacy.perm.funpay',
  'https://api.telegram.org/*': 'privacy.perm.telegram',
  'https://api.openai.com/*': 'privacy.perm.openai',
  'https://api.anthropic.com/*': 'privacy.perm.anthropic',
  'https://openrouter.ai/*': 'privacy.perm.openrouter',
  'http://localhost/*': 'privacy.perm.localAi',
  'http://127.0.0.1/*': 'privacy.perm.localAi',
};

interface ManifestPermissions {
  permissions?: string[];
  host_permissions?: string[];
  optional_permissions?: string[];
  optional_host_permissions?: string[];
}

interface Row {
  value: string;
  kind: 'api' | 'host';
  optional: boolean;
}

function readManifest(): Row[] {
  let m: ManifestPermissions;
  try {
    m = browser.runtime.getManifest() as ManifestPermissions;
  } catch {
    return [];
  }
  const isOrigin = (p: string) => p.includes('://') || p === '<all_urls>';
  const rows: Row[] = [];
  for (const p of m.permissions ?? [])
    rows.push({ value: p, kind: isOrigin(p) ? 'host' : 'api', optional: false });
  for (const p of m.host_permissions ?? []) rows.push({ value: p, kind: 'host', optional: false });
  for (const p of m.optional_permissions ?? [])
    rows.push({ value: p, kind: isOrigin(p) ? 'host' : 'api', optional: true });
  for (const p of m.optional_host_permissions ?? []) rows.push({ value: p, kind: 'host', optional: true });
  return rows;
}

/** Every manifest permission with its purpose; optional ones show whether they are granted and can be revoked. */
export function PermissionsCard() {
  const t = useT();
  const [rows] = useState<Row[]>(readManifest);
  const [granted, setGranted] = useState<{ permissions: string[]; origins: string[] } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void Promise.resolve()
      .then(() => browser.permissions.getAll())
      .then((p) => setGranted({ permissions: p.permissions ?? [], origins: p.origins ?? [] }))
      .catch(() => setGranted({ permissions: [], origins: [] }));
  }, []);

  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    try {
      browser.permissions.onAdded?.addListener(onChange);
      browser.permissions.onRemoved?.addListener(onChange);
    } catch {
      /* not available */
    }
    return () => {
      try {
        browser.permissions.onAdded?.removeListener(onChange);
        browser.permissions.onRemoved?.removeListener(onChange);
      } catch {
        /* ignore */
      }
    };
  }, [refresh]);

  const isGranted = (r: Row) =>
    (r.kind === 'host' ? granted?.origins.includes(r.value) : granted?.permissions.includes(r.value)) ??
    false;

  const revoke = async (r: Row) => {
    setBusy(r.value);
    try {
      const ok = await browser.permissions.remove(
        r.kind === 'host' ? { origins: [r.value] } : { permissions: [r.value as never] },
      );
      if (ok) toast.success(t('privacy.perm.revoked', { permission: r.value }));
      else toast.error(t('privacy.perm.revokeFailed'));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const required = rows.filter((r) => !r.optional);
  const optional = rows.filter((r) => r.optional);

  return (
    <Card title={t('privacy.perm.title')} description={t('privacy.perm.description')}>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">{t('privacy.perm.unavailable')}</p>
      ) : (
        <div className="space-y-4">
          <section aria-labelledby="perm-required">
            <h3 id="perm-required" className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">
              {t('privacy.perm.required')}
            </h3>
            <ul className="divide-y divide-border">
              {required.map((r) => (
                <li
                  key={`${r.kind}:${r.value}`}
                  className="flex flex-wrap items-start justify-between gap-2 py-2"
                >
                  <div className="min-w-0">
                    <code className="font-mono text-xs text-fg">{r.value}</code>
                    <p className="text-xs text-muted">
                      {t(PERMISSION_KEYS[r.value] ?? 'privacy.perm.unknown')}
                    </p>
                  </div>
                  <Badge tone="neutral">{t('privacy.perm.always')}</Badge>
                </li>
              ))}
            </ul>
          </section>
          {optional.length > 0 && (
            <section aria-labelledby="perm-optional">
              <h3
                id="perm-optional"
                className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted"
              >
                {t('privacy.perm.optional')}
              </h3>
              <p className="mb-1 text-xs text-muted">{t('privacy.perm.optionalHelp')}</p>
              <ul className="divide-y divide-border">
                {optional.map((r) => {
                  const on = isGranted(r);
                  return (
                    <li
                      key={`${r.kind}:${r.value}`}
                      className="flex flex-wrap items-start justify-between gap-2 py-2"
                    >
                      <div className="min-w-0">
                        <code className="font-mono text-xs text-fg">{r.value}</code>
                        <p className="text-xs text-muted">
                          {t(PERMISSION_KEYS[r.value] ?? 'privacy.perm.unknown')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {granted === null ? (
                          <Spinner size={14} />
                        ) : on ? (
                          <>
                            <Badge tone="success">{t('privacy.perm.granted')}</Badge>
                            <Button
                              size="sm"
                              variant="outline"
                              loading={busy === r.value}
                              onClick={() => void revoke(r)}
                            >
                              {t('privacy.perm.revoke')}
                            </Button>
                          </>
                        ) : (
                          <Badge tone="neutral">{t('privacy.perm.notGranted')}</Badge>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      )}
    </Card>
  );
}
