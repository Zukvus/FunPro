import { useLiveQuery } from 'dexie-react-hooks';
import { History } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getDb } from '@/core/db/db';
import { unconfirmedOrders } from '@/features/orders/unconfirmed';
import type { Order } from '@/shared/models';
import { Button, PageHeader, Tabs } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { ImportHistoryCard } from './orders/ImportHistoryCard';
import { OrderDrawer } from './orders/OrderDrawer';
import { OrdersTab } from './orders/OrdersTab';
import { SupportTicketModal } from './orders/SupportTicketModal';
import { SyncStatusBar } from './orders/SyncStatus';
import { UnconfirmedTab, useMinuteClock } from './orders/UnconfirmedTab';

type Tab = 'sales' | 'purchases' | 'unconfirmed';
const NO_ORDERS: Order[] = [];

function tabFromHash(): Tab {
  const q = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const tab = q.get('tab');
  return tab === 'purchases' || tab === 'unconfirmed' ? tab : 'sales';
}

export default function OrdersPage() {
  const t = useT();
  const [settings] = useSettings();
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [selected, setSelected] = useState<Order | null>(null);
  const [ticketOrders, setTicketOrders] = useState<Order[] | null>(null);
  const [showImport, setShowImport] = useState(false);
  const now = useMinuteClock();

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Keep the drawer in sync with live updates of the selected order.
  const live = useLiveQuery(() => (selected ? getDb().orders.get(selected.id) : undefined), [selected?.id]);
  const drawerOrder = selected ? (live ?? selected) : null;

  const paid = useLiveQuery(
    () => getDb().orders.where('[direction+status]').equals(['sale', 'paid']).toArray(),
    [],
  );
  const unconfirmedCount = useMemo(
    () =>
      paid
        ? unconfirmedOrders(paid, { now, minAgeHours: settings.analytics.unconfirmedAfterHours }).length
        : 0,
    [paid, now, settings.analytics.unconfirmedAfterHours],
  );

  const direction = tab === 'purchases' ? 'purchase' : 'sale';

  return (
    <div>
      <PageHeader
        title={t('nav.orders')}
        description={t('orders.page.description')}
        actions={
          <Button
            variant={showImport ? 'secondary' : 'outline'}
            size="sm"
            icon={<History size={14} />}
            aria-expanded={showImport}
            onClick={() => setShowImport((v) => !v)}
          >
            {t('orders.import.toggle')}
          </Button>
        }
      />
      <div className="mb-3">
        <SyncStatusBar areas={['sales', 'purchases']} rpcAreas={['orders']} />
      </div>
      {showImport && tab !== 'unconfirmed' && (
        <div className="mb-4">
          <ImportHistoryCard direction={direction} />
        </div>
      )}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'sales', label: t('orders.tab.sales') },
          { value: 'purchases', label: t('orders.tab.purchases') },
          {
            value: 'unconfirmed',
            label:
              unconfirmedCount > 0
                ? t('orders.tab.unconfirmedN', { count: unconfirmedCount })
                : t('orders.tab.unconfirmed'),
          },
        ]}
      />
      {tab === 'unconfirmed' ? (
        <UnconfirmedTab onOpen={setSelected} onDraftTicket={setTicketOrders} />
      ) : (
        <OrdersTab key={direction} direction={direction} onOpen={setSelected} />
      )}
      <OrderDrawer
        order={drawerOrder}
        onClose={() => setSelected(null)}
        onDraftTicket={(o) => setTicketOrders([o])}
      />
      <SupportTicketModal
        open={ticketOrders !== null}
        onClose={() => setTicketOrders(null)}
        orders={ticketOrders ?? NO_ORDERS}
      />
    </div>
  );
}
