import type { BackgroundModule } from './index';

/** Background module: messaging. Registers RPC handlers, event handlers and alarms for this area. */
export const messagingModule: BackgroundModule = {
  name: 'messaging',
  register() {
    // Implemented in its feature area.
  },
};
