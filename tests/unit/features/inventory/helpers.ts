import { getDb, resetDbForTests } from '@/core/db/db';
import { clearEventHandlersForTests } from '@/core/events/bus';
import { resetCryptoCacheForTests } from '@/core/security/crypto';
import { updateSettings } from '@/core/settings/store';
import { clearSinksForTests } from '@/features/notifications/notify';
import type { DeliveryDeps } from '@/features/inventory/delivery';
import { createPool, type PoolInput } from '@/features/inventory/pools';
import type { Order } from '@/shared/models';
import { getSettings } from '@/core/settings/store';

export function freshDb(): void {
  resetDbForTests();
  resetCryptoCacheForTests();
  clearEventHandlersForTests();
  clearSinksForTests();
}

export function poolInput(over: Partial<PoolInput> = {}): PoolInput {
  return {
    name: 'Keys',
    listingIds: [],
    lowStockThreshold: 0,
    deliveryTemplate: 'Thanks, {buyer}! Your key: {item}',
    itemsPerUnit: 1,
    matchText: ['steam key'],
    autoReserve: true,
    ...over,
  };
}

export async function makePool(over: Partial<PoolInput> = {}) {
  return createPool(poolInput(over));
}

export async function addOrder(id: string, over: Partial<Order> = {}): Promise<Order> {
  // A fresh order (one minute old): only fresh orders are fulfilled automatically.
  const at = new Date(Date.now() - 60_000).toISOString();
  const order: Order = {
    id,
    direction: 'sale',
    status: 'paid',
    counterpartyName: 'buyer1',
    counterpartyId: '555',
    description: 'Steam key, 1 шт.',
    categoryName: 'Steam',
    listingId: null,
    price: { amountMinor: 10000, currency: 'RUB' },
    createdAt: at,
    rawDate: '',
    firstSeenAt: at,
    updatedAt: at,
    history: [],
    ...over,
  };
  await getDb().orders.put(order);
  return order;
}

export function deps(over: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    getSettings,
    automationContext: async () => ({ funpayTabAvailable: true, sessionLoggedIn: true }),
    selfUserId: async () => '100',
    ...over,
  };
}

export async function enableAutoDelivery(): Promise<void> {
  await updateSettings({
    automation: { state: 'running', liveActionsAcknowledged: true, autoDelivery: true },
  });
}

export function paidEvent(orderId: string, payload: Record<string, unknown> = {}) {
  return {
    id: `ORDER_PAID:${orderId}`,
    type: 'ORDER_PAID' as const,
    at: new Date().toISOString(),
    payload: { orderId, direction: 'sale', baseline: false, ...payload },
    handledBy: [],
  };
}

export function cancelledEvent(orderId: string) {
  return {
    id: `ORDER_CANCELLED:${orderId}`,
    type: 'ORDER_CANCELLED' as const,
    at: new Date().toISOString(),
    payload: { orderId, direction: 'sale', baseline: false },
    handledBy: [],
  };
}
