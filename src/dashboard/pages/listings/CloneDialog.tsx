import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { RU_SUMMARY } from '@/features/listings/bulk-plan';
import { buildCloneChanges, parseTemplateRecords, TEMPLATE_PREFIX, type CloneWarning } from '@/features/listings/clone';
import type { SanitizedOfferForm } from '@/features/listings/offer-form';
import type { Listing } from '@/shared/models';
import { Badge, Button, Callout, Field, Input, Modal, Select, Spinner, Switch, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { CheckboxField, LiveGateNotice, errorText, offerUrl, truncate, useLiveGate } from './shared';

const WARN_TONE: Record<CloneWarning, 'info' | 'warning'> = {
  secrets_not_copied: 'warning',
  auto_delivery_off: 'warning',
  inactive_copy: 'info',
  multi_value_skipped: 'warning',
  template_applied: 'info',
};

export function CloneDialog({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const t = useT();
  const gate = useLiveGate();
  const [form, setForm] = useState<SanitizedOfferForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activate, setActivate] = useState(false);
  const [templateId, setTemplateId] = useState('');
  const [titleRu, setTitleRu] = useState<string | null>(null);
  const [price, setPrice] = useState<string | null>(null);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const templateRecs = useLiveQuery(() => getDb().kv.where('key').startsWith(TEMPLATE_PREFIX).toArray(), []);
  const templates = useMemo(() => parseTemplateRecords(templateRecs ?? []), [templateRecs]);
  const template = templates.find((x) => x.id === templateId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setForm(await rpc<SanitizedOfferForm>('ui.fetchOfferForm', { offerId: listing.id }));
    } catch (e) {
      setLoadError(errorText(t, e));
    } finally {
      setLoading(false);
    }
  }, [listing.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = useMemo(() => {
    if (!form) return null;
    const overrides: Record<string, string> = {};
    if (titleRu !== null) overrides[RU_SUMMARY] = titleRu;
    if (price !== null) overrides['price'] = price;
    return buildCloneChanges(form.fields, { activate, template, overrides }, form.hasSecrets);
  }, [form, activate, template, titleRu, price]);

  const create = async () => {
    if (!plan || !listing.nodeId) return;
    setBusy(true);
    try {
      const res = await rpc<{ ok: boolean; offerId: string | null }>('ui.clone.create', { sourceOfferId: listing.id, nodeId: listing.nodeId, changes: plan.changes, confirm: true });
      toast.success(res.offerId ? t('listings.clone.createdId', { id: res.offerId }) : t('listings.clone.created'));
      onClose();
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  const fields = plan ? Object.entries(plan.changes) : [];

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${t('listings.clone.title')}: ${truncate(listing.title, 60)}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={<Copy size={14} aria-hidden />} disabled={!plan || !understood || !gate.ok || !listing.nodeId} loading={busy} onClick={() => void create()}>
            {t('listings.clone.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Callout tone="warning" title={t('listings.clone.evidenced.title')}>
          {t('listings.clone.evidenced.body')}
        </Callout>
        {!listing.nodeId && <Callout tone="danger">{t('listings.clone.noNode')}</Callout>}
        {loading && (
          <p className="flex items-center gap-2 text-muted">
            <Spinner /> {t('listings.clone.loading')}
          </p>
        )}
        {loadError && (
          <Callout tone="danger" title={t('listings.clone.loadFailed')}>
            <p>{loadError}</p>
            <Button className="mt-2" size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void load()}>
              {t('listings.retry')}
            </Button>
          </Callout>
        )}
        {form && plan && (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label={t('listings.clone.titleRu')}>
                <Input value={titleRu ?? plan.changes[RU_SUMMARY] ?? ''} onChange={(e) => setTitleRu(e.target.value)} />
              </Field>
              <Field label={t('listings.clone.price')} help={form.currencyText ? t('listings.clone.priceHelp', { currency: form.currencyText }) : undefined}>
                <Input inputMode="decimal" value={price ?? plan.changes['price'] ?? ''} onChange={(e) => setPrice(e.target.value)} />
              </Field>
              <Field label={t('listings.clone.template')} help={templates.length ? undefined : t('listings.clone.noTemplates')}>
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} disabled={templates.length === 0}>
                  <option value="">{t('common.none')}</option>
                  {templates.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Switch checked={activate} onChange={setActivate} label={t('listings.clone.activate')} description={t('listings.clone.activateHelp')} />
            </div>
            <div className="flex flex-wrap gap-1">
              {plan.warnings.map((w) => (
                <Badge key={w} tone={WARN_TONE[w]}>
                  {t(`listings.clone.warn.${w}`)}
                </Badge>
              ))}
            </div>
            <details className="rounded-lg bg-surface-2 p-2">
              <summary className="cursor-pointer text-xs font-medium">{t('listings.clone.fields', { count: fields.length })}</summary>
              <dl className="mt-2 max-h-56 overflow-auto text-xs">
                {fields.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-2 border-b border-border/50 py-1">
                    <dt className="truncate font-mono text-muted" title={k}>
                      {k}
                    </dt>
                    <dd className="truncate" title={v}>
                      {v === '' ? <span className="text-muted">{t('listings.value.empty')}</span> : truncate(v, 120)}
                    </dd>
                  </div>
                ))}
              </dl>
              {plan.excluded.length > 0 && <p className="mt-2 text-xs text-muted">{t('listings.clone.excluded', { fields: plan.excluded.join(', ') })}</p>}
            </details>
            <p className="text-xs text-muted">
              {t('listings.clone.source')}{' '}
              <a className="underline" href={offerUrl(listing.id)} target="_blank" rel="noreferrer">
                #{listing.id}
              </a>
            </p>
            <CheckboxField checked={understood} onChange={setUnderstood} label={t('listings.clone.confirm')} />
          </>
        )}
        <LiveGateNotice reason={gate.reason} />
      </div>
    </Modal>
  );
}
