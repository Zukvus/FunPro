import { Calculator, Copy, Download, ExternalLink, Languages, Save, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { getDb } from '@/core/db/db';
import { rpc } from '@/core/messaging/client';
import { buildBulkPlan } from '@/features/listings/bulk-plan';
import { listingEconomics, resolveCommission } from '@/features/listings/commission';
import { readLiveValues, type SanitizedOfferForm } from '@/features/listings/offer-form';
import { getTranslateProvider, translateTexts } from '@/features/listings/translate';
import type { Listing } from '@/shared/models';
import { Badge, Button, Callout, Field, Input, Modal, Textarea, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { calcTestPrice, type CalcQuote } from './CommissionPanel';
import { CostCell } from './ListingsTable';
import { EstimateMark, errorText, offerEditUrl, offerUrl, useFormat, usePageApi } from './shared';

export function ListingDetailDialog({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const api = usePageApi();
  const { navigate } = useDashboard();
  const [settings, update] = useSettings();
  const econ = listingEconomics(listing, settings.fees);
  const commission = resolveCommission(listing, settings.fees);
  const [form, setForm] = useState<SanitizedOfferForm | null>(null);
  const [titleEn, setTitleEn] = useState(listing.titleEn ?? '');
  const [descEn, setDescEn] = useState(listing.descriptionEn ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [translateUnavailable, setTranslateUnavailable] = useState(false);
  const [quote, setQuote] = useState<CalcQuote | null>(null);
  const live = form ? readLiveValues(form.fields) : null;
  const ruTitle = live?.summaryRu || listing.title;
  const ruDesc = live?.descRu || listing.description || '';
  const dirty = titleEn !== (listing.titleEn ?? '') || descEn !== (listing.descriptionEn ?? '');

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(null);
    }
  };

  const loadFromFunPay = () =>
    run('load', async () => {
      const f = await rpc<SanitizedOfferForm>('ui.fetchOfferForm', { offerId: listing.id });
      setForm(f);
      const v = readLiveValues(f.fields);
      if (!titleEn && v.summaryEn) setTitleEn(v.summaryEn);
      if (!descEn && v.descEn) setDescEn(v.descEn);
      // Keep the Russian description locally (it is shown on FunPay; used as translation source).
      if (v.descRu && v.descRu !== listing.description)
        await getDb().listings.update(listing.id, { description: v.descRu });
      toast.success(t('listings.detail.loaded'));
    });

  const translate = () =>
    run('translate', async () => {
      const provider = await getTranslateProvider('ru', 'en');
      if (!provider) {
        setTranslateUnavailable(true);
        return;
      }
      const out = await translateTexts({ title: ruTitle, desc: ruDesc }, provider.translate, 'ru', 'en');
      if (out.title) setTitleEn(out.title);
      if (out.desc) setDescEn(out.desc);
      toast.success(t('listings.detail.translated', { provider: provider.label }));
    });

  const saveDrafts = () =>
    run('save', async () => {
      await getDb().listings.update(listing.id, {
        titleEn: titleEn.trim() || undefined,
        descriptionEn: descEn.trim() || undefined,
      });
      toast.success(t('listings.detail.draftsSaved'));
    });

  const publish = () => {
    const plan = buildBulkPlan(
      [listing],
      { kind: 'fill_en', overwrite: true },
      {
        fees: settings.fees,
        now: Date.now(),
        source: 'editor',
        label: t('listings.detail.publishLabel', { title: listing.title.slice(0, 80) }),
        enTexts: new Map([
          [
            listing.id,
            {
              summaryEn: titleEn,
              descEn,
              summaryEnBefore: live ? live.summaryEn : null,
              descEnBefore: live ? live.descEn : null,
            },
          ],
        ]),
      },
    );
    if (plan.items.every((i) => i.skip)) {
      toast.info(t('listings.detail.nothingToPublish'));
      return;
    }
    api.openPreview(plan);
  };

  const ask = () =>
    run('calc', async () => {
      if (!listing.nodeId) return;
      setQuote(
        await rpc<CalcQuote>('ui.calcCommission', {
          nodeId: listing.nodeId,
          priceMinor: calcTestPrice(listing.price.currency),
        }),
      );
    });

  const row = (label: string, value: ReactNode) => (
    <div className="flex justify-between gap-3 border-b border-border/50 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );

  return (
    <Modal open wide onClose={onClose} title={listing.title || `#${listing.id}`}>
      <div className="grid gap-5 md:grid-cols-2">
        <section aria-label={t('listings.detail.info')}>
          <dl>
            {row(t('listings.col.category'), listing.categoryName || '—')}
            {row(t('listings.col.price'), fmt.money(listing.price.amountMinor, listing.price.currency))}
            {row(
              t('listings.col.net'),
              econ.netMinor === null ? (
                <span className="text-muted">{t('listings.net.unknownShort')}</span>
              ) : (
                <>
                  {fmt.money(econ.netMinor, listing.price.currency)}
                  <EstimateMark estimate={econ.estimate} />
                </>
              ),
            )}
            {row(
              t('listings.col.cost'),
              <span className="inline-block w-28">
                <CostCell listing={listing} />
              </span>,
            )}
            {row(
              t('listings.col.profit'),
              econ.profitMinor === null ? (
                '—'
              ) : (
                <span className={settings.privacy.privacyMode ? 'fp-sensitive' : undefined}>
                  {fmt.money(econ.profitMinor, listing.price.currency)}
                </span>
              ),
            )}
            {row(t('listings.col.stock'), listing.amount === null ? '∞' : listing.amount)}
            {row(
              t('listings.col.status'),
              <Badge tone={listing.active ? 'success' : 'neutral'}>
                {listing.active ? t('listings.active') : t('listings.inactive')}
              </Badge>,
            )}
            {row(
              t('listings.detail.flags'),
              [
                listing.promoted ? t('listings.promo') : null,
                listing.autoDelivery ? t('listings.autoDelivery') : null,
              ]
                .filter(Boolean)
                .join(' · ') || '—',
            )}
            {row(t('listings.detail.lastSeen'), fmt.dateTime(listing.seenAt))}
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              href={offerUrl(listing.id)}
              target="_blank"
              rel="noreferrer"
            >
              {t('listings.detail.openOffer')} <ExternalLink size={12} aria-hidden />
            </a>
            <a
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
              href={offerEditUrl(listing.id, listing.nodeId)}
              target="_blank"
              rel="noreferrer"
            >
              {t('listings.detail.openEditor')} <ExternalLink size={12} aria-hidden />
            </a>
          </div>
          <div className="mt-4 rounded-xl bg-surface-2 p-3">
            <p className="mb-1 text-xs font-semibold">{t('listings.detail.commission')}</p>
            <p className="text-xs text-muted">
              {commission
                ? `${fmt.pct(commission.pct)} · ${t(`listings.fee.source.${commission.source}`)}`
                : t('listings.fee.unknown')}
            </p>
            <Button
              className="mt-2"
              size="sm"
              icon={<Calculator size={14} aria-hidden />}
              disabled={!listing.nodeId}
              loading={busy === 'calc'}
              onClick={() => void ask()}
            >
              {t('listings.fee.ask')}
            </Button>
            {quote && (
              <div className="mt-2 text-xs">
                {quote.methods.map((m) => (
                  <p key={`${m.name}-${m.priceMinor}`} className="flex justify-between gap-2">
                    <span>{m.name}</span>
                    <span className="tabular-nums">{fmt.money(m.priceMinor, listing.price.currency)}</span>
                  </p>
                ))}
                {quote.commissionPct !== null && listing.nodeId && (
                  <Button
                    className="mt-2"
                    size="sm"
                    variant="primary"
                    onClick={() =>
                      void update({
                        fees: {
                          nodeCommission: {
                            [listing.nodeId!]: { pct: quote.commissionPct!, source: 'calc', at: Date.now() },
                          },
                        },
                      }).then(() =>
                        toast.success(t('listings.fee.saved', { pct: fmt.pct(quote.commissionPct!) })),
                      )
                    }
                  >
                    {t('listings.fee.useCalc', { pct: fmt.pct(quote.commissionPct) })}
                  </Button>
                )}
              </div>
            )}
          </div>
          <Button
            className="mt-3"
            icon={<Copy size={14} aria-hidden />}
            onClick={() => api.openClone(listing)}
          >
            {t('listings.clone.open')}
          </Button>
        </section>

        <section aria-label={t('listings.detail.english')} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">{t('listings.detail.english')}</h3>
            <Button
              size="sm"
              variant="ghost"
              icon={<Download size={14} aria-hidden />}
              loading={busy === 'load'}
              onClick={() => void loadFromFunPay()}
            >
              {t('listings.detail.load')}
            </Button>
          </div>
          <p className="text-xs text-muted">{t('listings.detail.englishHelp')}</p>
          {live && (
            <div className="rounded-lg bg-surface-2 p-2 text-xs">
              <p className="font-medium">{t('listings.detail.ruTexts')}</p>
              <p className="mt-1">{live.summaryRu || '—'}</p>
              <p className="mt-1 line-clamp-4 whitespace-pre-line text-muted">{live.descRu || '—'}</p>
            </div>
          )}
          <Field label={t('listings.field.summary.en')} htmlFor="detail-title-en">
            <Input
              id="detail-title-en"
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              maxLength={500}
            />
          </Field>
          <Field label={t('listings.field.desc.en')} htmlFor="detail-desc-en">
            <Textarea
              id="detail-desc-en"
              rows={6}
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
            />
          </Field>
          {translateUnavailable && (
            <Callout tone="warning" title={t('listings.translate.unavailable.title')}>
              <p>{t('listings.translate.unavailable.body')}</p>
              <Button className="mt-2" size="sm" onClick={() => navigate('ai')}>
                {t('listings.translate.unavailable.cta')}
              </Button>
            </Callout>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<Languages size={14} aria-hidden />}
              loading={busy === 'translate'}
              onClick={() => void translate()}
            >
              {t('listings.detail.translate')}
            </Button>
            <Button
              icon={<Save size={14} aria-hidden />}
              disabled={!dirty}
              loading={busy === 'save'}
              onClick={() => void saveDrafts()}
            >
              {t('listings.detail.saveDrafts')}
            </Button>
            <Button
              variant="primary"
              icon={<Send size={14} aria-hidden />}
              disabled={!titleEn.trim() && !descEn.trim()}
              onClick={publish}
            >
              {t('listings.detail.publish')}
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
