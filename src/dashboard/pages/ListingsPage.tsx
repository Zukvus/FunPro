import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getDb } from '@/core/db/db';
import type { BulkPlan } from '@/features/listings/bulk-plan';
import type { Listing } from '@/shared/models';
import { PageHeader, Spinner, Tabs, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { useSettings } from '@/ui/hooks/useSettings';
import { BulkDialog, type BulkDialogInput } from './listings/BulkDialog';
import { BulkHistory } from './listings/BulkHistory';
import { BumpPanel } from './listings/BumpPanel';
import { CloneDialog } from './listings/CloneDialog';
import { CommissionPanel } from './listings/CommissionPanel';
import { CompareDialog } from './listings/CompareDialog';
import { FillEnglishDialog } from './listings/FillEnglishDialog';
import { ImportExportPanel } from './listings/ImportExportPanel';
import { ListingDetailDialog } from './listings/ListingDetailDialog';
import { ListingsTable } from './listings/ListingsTable';
import { ReorderPanel } from './listings/ReorderPanel';
import {
  LISTINGS_TABS,
  ListingsPageContext,
  type ListingsPageApi,
  type ListingsTab,
} from './listings/shared';
import { TemplatesPanel } from './listings/TemplatesPanel';

function hashQuery(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '');
}

function tabFromHash(): ListingsTab {
  const tab = hashQuery().get('tab');
  return (LISTINGS_TABS as string[]).includes(tab ?? '') ? (tab as ListingsTab) : 'table';
}

/** Keep the active tab in the URL without adding history entries or re-routing. */
function writeTabToHash(tab: ListingsTab): void {
  const q = hashQuery();
  q.delete('offer');
  if (tab === 'table') q.delete('tab');
  else q.set('tab', tab);
  const qs = q.toString();
  window.history.replaceState(null, '', `#/listings${qs ? `?${qs}` : ''}`);
}

export default function ListingsPage() {
  const t = useT();
  const listings = useLiveQuery(() => getDb().listings.toArray(), []);
  const [tab, setTabState] = useState<ListingsTab>(tabFromHash);
  const [bulk, setBulk] = useState<BulkDialogInput | null>(null);
  const [cloneOf, setCloneOf] = useState<Listing | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [fillEn, setFillEn] = useState<Listing[] | null>(null);
  const [compare, setCompare] = useState<Listing[] | null>(null);
  const offerHandled = useRef(false);
  const [settings] = useSettings();

  // When Chrome's on-device translator is unavailable, translation may fall back to the user's AI
  // provider — registered only while that integration is fully set up and consented (lazy import
  // keeps the AI code out of this page's initial chunk).
  useEffect(() => {
    let cancelled = false;
    void import('@/features/ai/listing-translate')
      .then((m) => (cancelled ? undefined : m.syncAiTranslateProvider(settings)))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.ai, settings.general.localOnly, settings.flags]);

  const setTab = (next: ListingsTab) => {
    setTabState(next);
    writeTabToHash(next);
  };

  // Deep link from funpay.com (offer editor → "Translate in FunPro"): #/listings?offer=<id>
  useEffect(() => {
    if (!listings || offerHandled.current) return;
    offerHandled.current = true;
    const offer = hashQuery().get('offer');
    if (!offer) return;
    if (listings.some((l) => l.id === offer)) setDetailId(offer);
    else toast.info(t('listings.deepLink.unknown'));
  }, [listings, t]);

  const api = useMemo<ListingsPageApi>(
    () => ({
      openPreview: (plan: BulkPlan) => {
        setDetailId(null);
        setFillEn(null);
        setBulk({ kind: 'plan', plan });
      },
      openBulk: (op, ls) => setBulk({ kind: 'configure', op, listings: ls }),
      openClone: (l) => {
        setDetailId(null);
        setCloneOf(l);
      },
      openDetail: (l) => setDetailId(l.id),
      openFillEnglish: (ls) => setFillEn(ls),
      openCompare: (ls) => setCompare(ls),
      goTab: (next) => {
        setTabState(next);
        writeTabToHash(next);
      },
    }),
    [],
  );

  const detail = detailId ? (listings?.find((l) => l.id === detailId) ?? null) : null;

  return (
    <ListingsPageContext.Provider value={api}>
      <PageHeader title={t('nav.listings')} description={t('listings.page.description')} />
      {listings === undefined ? (
        <div className="flex justify-center py-16">
          <Spinner size={24} />
        </div>
      ) : (
        <>
          <BumpPanel listings={listings} />
          <Tabs
            value={tab}
            onChange={setTab}
            items={[
              { value: 'table', label: `${t('listings.tab.table')} (${listings.length})` },
              { value: 'history', label: t('listings.tab.history') },
              { value: 'import', label: t('listings.tab.import') },
              { value: 'templates', label: t('listings.tab.templates') },
              { value: 'order', label: t('listings.tab.order') },
              { value: 'commission', label: t('listings.tab.commission') },
            ]}
          />
          <div role="tabpanel">
            {tab === 'table' && <ListingsTable listings={listings} />}
            {tab === 'history' && <BulkHistory />}
            {tab === 'import' && <ImportExportPanel listings={listings} />}
            {tab === 'templates' && <TemplatesPanel />}
            {tab === 'order' && <ReorderPanel listings={listings} />}
            {tab === 'commission' && <CommissionPanel listings={listings} />}
          </div>
        </>
      )}
      {bulk && (
        <BulkDialog
          input={bulk}
          onClose={() => setBulk(null)}
          onExecuted={() => {
            setBulk(null);
            setTab('history');
          }}
        />
      )}
      {cloneOf && <CloneDialog listing={cloneOf} onClose={() => setCloneOf(null)} />}
      {detail && <ListingDetailDialog listing={detail} onClose={() => setDetailId(null)} />}
      {fillEn && <FillEnglishDialog listings={fillEn} onClose={() => setFillEn(null)} />}
      {compare && <CompareDialog listings={compare} onClose={() => setCompare(null)} />}
    </ListingsPageContext.Provider>
  );
}
