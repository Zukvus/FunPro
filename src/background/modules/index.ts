/**
 * Background feature modules. Each module registers its RPC handlers, event handlers and alarms.
 * Modules must be safe to register on every service-worker start (no side effects besides
 * registering listeners and idempotent alarm creation).
 */
export interface BackgroundModule {
  name: string;
  register: () => void | Promise<void>;
}

import { outboxModule } from './outbox';
import { listingsModule } from './listings';
import { messagingModule } from './messaging';
import { ordersModule } from './orders';
import { assistantModule } from './assistant';
import { operationsModule } from './operations';
import { settingsModule } from './settings';

export const MODULES: BackgroundModule[] = [outboxModule, listingsModule, messagingModule, ordersModule, assistantModule, operationsModule, settingsModule];
