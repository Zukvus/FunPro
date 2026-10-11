import type { BackgroundModule } from './index';

/** Background module: operations. Registers RPC handlers, event handlers and alarms for this area. */
export const operationsModule: BackgroundModule = {
  name: 'operations',
  register() {
    // Implemented in its feature area.
  },
};
