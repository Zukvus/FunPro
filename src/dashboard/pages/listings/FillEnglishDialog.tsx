import { Languages, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { rpc } from '@/core/messaging/client';
import { buildBulkPlan, type EnText } from '@/features/listings/bulk-plan';
import { readLiveValues, type SanitizedOfferForm } from '@/features/listings/offer-form';
import { getTranslateProvider, translateTexts, type TranslateProvider } from '@/features/listings/translate';
import type { Listing } from '@/shared/models';
import { Button, Callout, Modal, ProgressBar, Spinner } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useDashboard } from '../../context';
import { errorText, truncate, usePageApi } from './shared';

/** One run reads at most this many offer editors (one request every few seconds). */
export const FILL_EN_MAX = 100;

type Phase = 'checking' | 'ready' | 'unavailable' | 'running' | 'done';

export function FillEnglishDialog({ listings, onClose }: { listings: Listing[]; onClose: () => void }) {
  const t = useT();
  const api = usePageApi();
  const { navigate } = useDashboard();
  const [settings] = useSettings();
  const [phase, setPhase] = useState<Phase>('checking');
  const [provider, setProvider] = useState<TranslateProvider | null>(null);
  const [done, setDone] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [texts, setTexts] = useState<Map<string, EnText>>(() => new Map());
  const abort = useRef<AbortController | null>(null);
  const batch = listings.slice(0, FILL_EN_MAX);

  useEffect(() => {
    let alive = true;
    void getTranslateProvider('ru', 'en').then((p) => {
      if (!alive) return;
      setProvider(p);
      setPhase(p ? 'ready' : 'unavailable');
    });
    return () => {
      alive = false;
      abort.current?.abort();
    };
  }, []);

  const start = async () => {
    if (!provider) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setPhase('running');
    setDone(0);
    setErrors([]);
    const out = new Map<string, EnText>();
    for (const l of batch) {
      if (ctrl.signal.aborted) break;
      try {
        const form = await rpc<SanitizedOfferForm>('ui.fetchOfferForm', { offerId: l.id });
        const v = readLiveValues(form.fields);
        const want: { title?: string; desc?: string } = {};
        let summaryEn = '';
        let descEn = '';
        if (!v.summaryEn.trim()) {
          if (l.titleEn?.trim()) summaryEn = l.titleEn.trim();
          else if (v.summaryRu.trim()) want.title = v.summaryRu;
        }
        if (!v.descEn.trim()) {
          if (l.descriptionEn?.trim()) descEn = l.descriptionEn.trim();
          else if (v.descRu.trim()) want.desc = v.descRu;
        }
        const tr = await translateTexts(want, provider.translate, 'ru', 'en', ctrl.signal);
        summaryEn ||= tr.title ?? '';
        descEn ||= tr.desc ?? '';
        if (summaryEn || descEn) out.set(l.id, { summaryEn, descEn, summaryEnBefore: v.summaryEn, descEnBefore: v.descEn });
      } catch (e) {
        if (ctrl.signal.aborted) break;
        setErrors((s) => [...s, `${truncate(l.title, 40)}: ${errorText(t, e)}`]);
        if ((e as { code?: string }).code === 'no_tab') break;
      }
      setDone((n) => n + 1);
    }
    setTexts(out);
    setPhase('done');
  };

  const review = () => {
    const plan = buildBulkPlan(batch, { kind: 'fill_en', overwrite: false }, { fees: settings.fees, now: Date.now(), source: 'translate', label: t('listings.fillEn.planLabel', { count: texts.size }), enTexts: texts });
    api.openPreview(plan);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('listings.fillEn.title')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.close')}
          </Button>
          {phase === 'running' ? (
            <Button icon={<Square size={14} aria-hidden />} onClick={() => abort.current?.abort()}>
              {t('listings.fillEn.stop')}
            </Button>
          ) : phase === 'done' ? (
            <Button variant="primary" disabled={texts.size === 0} onClick={review}>
              {t('listings.fillEn.review', { count: texts.size })}
            </Button>
          ) : (
            <Button variant="primary" icon={<Languages size={14} aria-hidden />} disabled={phase !== 'ready'} onClick={() => void start()}>
              {t('listings.fillEn.start', { count: batch.length })}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>{t('listings.fillEn.intro')}</p>
        {listings.length > FILL_EN_MAX && <Callout tone="info">{t('listings.fillEn.limit', { max: FILL_EN_MAX, count: listings.length })}</Callout>}
        {phase === 'checking' && (
          <p className="flex items-center gap-2 text-muted">
            <Spinner /> {t('listings.fillEn.checking')}
          </p>
        )}
        {phase === 'unavailable' && (
          <Callout tone="warning" title={t('listings.translate.unavailable.title')}>
            <p>{t('listings.translate.unavailable.body')}</p>
            <Button className="mt-2" size="sm" onClick={() => navigate('ai')}>
              {t('listings.translate.unavailable.cta')}
            </Button>
          </Callout>
        )}
        {provider && phase === 'ready' && <p className="text-xs text-muted">{t(provider.external ? 'listings.fillEn.providerExternal' : 'listings.fillEn.provider', { name: provider.label })}</p>}
        {(phase === 'running' || phase === 'done') && (
          <div>
            <ProgressBar value={done} max={batch.length} label={t('listings.fillEn.progress')} />
            <p className="mt-1 text-xs text-muted" aria-live="polite">
              {t('listings.fillEn.progressText', { done, total: batch.length, found: phase === 'done' ? texts.size : '…' })}
            </p>
          </div>
        )}
        {errors.length > 0 && (
          <Callout tone="danger" title={t('listings.fillEn.errors', { count: errors.length })}>
            <ul className="max-h-32 list-disc overflow-auto pl-4 text-xs">
              {errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </Callout>
        )}
        {phase === 'done' && texts.size === 0 && <Callout tone="info">{t('listings.fillEn.nothing')}</Callout>}
      </div>
    </Modal>
  );
}
