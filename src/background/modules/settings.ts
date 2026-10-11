import type { BackgroundModule } from './index';

/** Background module: settings. Registers RPC handlers, event handlers and alarms for this area. */
export const settingsModule: BackgroundModule = {
  name: 'settings',
  register() {
    // Implemented in its feature area.
  },
};
