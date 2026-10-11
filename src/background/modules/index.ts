/**
 * Background feature modules. Each module registers its RPC handlers, event handlers and alarms.
 * Modules must be safe to register on every service-worker start (no side effects besides
 * registering listeners and idempotent alarm creation).
 */
export interface BackgroundModule {
  name: string;
  register: () => void | Promise<void>;
}

export const MODULES: BackgroundModule[] = [];
