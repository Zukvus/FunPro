import type { BackgroundModule } from './index';

/** Background module: orders. Registers RPC handlers, event handlers and alarms for this area. */
export const ordersModule: BackgroundModule = {
  name: 'orders',
  register() {
    // Implemented in its feature area.
  },
};
