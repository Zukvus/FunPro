import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { lintOutgoingText } from '@/core/security/sanitize';
import { MAX_MESSAGE_LENGTH } from '@/features/messages/outbox';
import type { Pool } from '@/features/inventory/model';
import { createPool, listPools, updatePool } from '@/features/inventory/pools';
import { DELIVERY_VARIABLES, renderMaskedMessage } from '@/features/inventory/template';
import { Badge, Button, Callout, Field, Input, Modal, Switch, Textarea, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { errorText, money, useLocaleTag } from './common';

export function PoolEditor({ pool, onClose }: { pool: Pool | null; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleTag();
  const [name, setName] = useState(pool?.name ?? '');
  const [listingIds, setListingIds] = useState<string[]>(pool?.listingIds ?? []);
  const [matchText, setMatchText] = useState((pool?.matchText ?? []).join('\n'));
  const [threshold, setThreshold] = useState(String(pool?.lowStockThreshold ?? 3));
  const [perUnit, setPerUnit] = useState(String(pool?.itemsPerUnit ?? 1));
  const [template, setTemplate] = useState(pool?.deliveryTemplate ?? t('ops.inv.editor.defaultTemplate'));
  const [autoReserve, setAutoReserve] = useState(pool?.autoReserve ?? true);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const listings = useLiveQuery(() => getDb().listings.orderBy('sortIndex').toArray(), [], []);
  const others = useLiveQuery(
    async () => (await listPools()).filter((p) => p.id !== pool?.id),
    [pool?.id],
    [],
  );
  const taken = useMemo(
    () => new Map(others.flatMap((p) => p.listingIds.map((id) => [id, p.name] as const))),
    [others],
  );
  const visible = listings.filter(
    (l) => !filter || l.title.toLowerCase().includes(filter.toLowerCase()) || l.id.includes(filter),
  );
  const lint = lintOutgoingText(template);
  const preview = renderMaskedMessage(template, Math.max(1, Number.parseInt(perUnit, 10) || 1), {
    orderId: 'ABCD1234',
    buyer: t('ops.inv.editor.sampleBuyer'),
    quantity: 1,
    lot: t('ops.inv.editor.sampleLot'),
    category: '',
    price: null,
  });

  const insertVar = (v: string) => setTemplate((cur) => `${cur}{${v}}`);

  const save = async () => {
    const errs: Record<string, string> = {};
    const th = Number(threshold);
    const pu = Number(perUnit);
    if (!name.trim()) errs['name'] = t('ops.common.required');
    if (!Number.isInteger(th) || th < 0 || th > 100000) errs['threshold'] = t('ops.common.invalidNumber');
    if (!Number.isInteger(pu) || pu < 1 || pu > 100) errs['perUnit'] = t('ops.inv.editor.perUnitRange');
    if (!template.trim()) errs['template'] = t('ops.common.required');
    else if (template.length > MAX_MESSAGE_LENGTH)
      errs['template'] = t('ops.inv.editor.templateTooLong', { max: MAX_MESSAGE_LENGTH });
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      const input = {
        name,
        listingIds,
        lowStockThreshold: th,
        itemsPerUnit: pu,
        deliveryTemplate: template,
        matchText: matchText
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        autoReserve,
      };
      if (pool) await updatePool(pool.id, input);
      else await createPool(input);
      toast.success(t('ops.inv.editor.saved'));
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
      wide
      onClose={onClose}
      title={pool ? t('ops.inv.editor.editTitle') : t('ops.inv.editor.newTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} loading={busy}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Field label={t('ops.inv.editor.name')} error={errors['name']} htmlFor="pool-name">
            <Input id="pool-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t('ops.inv.editor.threshold')}
              help={t('ops.inv.editor.thresholdHelp')}
              error={errors['threshold']}
              htmlFor="pool-th"
            >
              <Input
                id="pool-th"
                type="number"
                min={0}
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
              />
            </Field>
            <Field
              label={t('ops.inv.editor.perUnit')}
              help={t('ops.inv.editor.perUnitHelp')}
              error={errors['perUnit']}
              htmlFor="pool-pu"
            >
              <Input
                id="pool-pu"
                type="number"
                min={1}
                max={100}
                value={perUnit}
                onChange={(e) => setPerUnit(e.target.value)}
              />
            </Field>
          </div>
          <Field label={t('ops.inv.editor.match')} help={t('ops.inv.editor.matchHelp')} htmlFor="pool-match">
            <Textarea
              id="pool-match"
              value={matchText}
              onChange={(e) => setMatchText(e.target.value)}
              placeholder={t('ops.inv.editor.matchPlaceholder')}
            />
          </Field>
          <Switch
            checked={autoReserve}
            onChange={setAutoReserve}
            label={t('ops.inv.editor.autoReserve')}
            description={t('ops.inv.editor.autoReserveHelp')}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Field label={t('ops.inv.editor.listings')} help={t('ops.inv.editor.listingsHelp')}>
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
            />
          </Field>
          <div className="max-h-64 overflow-auto rounded-lg border border-border">
            {visible.length === 0 && (
              <p className="p-3 text-xs text-muted">{t('ops.inv.editor.noListings')}</p>
            )}
            {visible.map((l) => {
              const owner = taken.get(l.id);
              const checked = listingIds.includes(l.id);
              return (
                <label
                  key={l.id}
                  className="flex cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-1.5 text-sm last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!!owner && !checked}
                    onChange={() =>
                      setListingIds((cur) => (checked ? cur.filter((x) => x !== l.id) : [...cur, l.id]))
                    }
                  />
                  <span className="min-w-0 flex-1 truncate">{l.title || l.id}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {money(l.price.amountMinor, l.price.currency, locale)}
                  </span>
                  {owner && !checked && <Badge>{t('ops.inv.editor.inPool', { pool: owner })}</Badge>}
                </label>
              );
            })}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <Field
          label={t('ops.inv.editor.template')}
          help={t('ops.inv.editor.templateHelp')}
          error={errors['template']}
          htmlFor="pool-tpl"
        >
          <Textarea id="pool-tpl" value={template} onChange={(e) => setTemplate(e.target.value)} rows={4} />
        </Field>
        <div className="flex flex-wrap gap-1">
          {DELIVERY_VARIABLES.map((v) => (
            <Button key={v} size="sm" variant="outline" onClick={() => insertVar(v)}>{`{${v}}`}</Button>
          ))}
        </div>
        {lint.length > 0 && (
          <Callout tone="warning" title={t('ops.inv.editor.lintTitle')}>
            {t('ops.inv.editor.lintBody', { kinds: lint.join(', ') })}
          </Callout>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-muted">{t('ops.inv.editor.preview')}</p>
          <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-fg">{preview}</pre>
        </div>
      </div>
    </Modal>
  );
}
