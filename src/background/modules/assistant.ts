import type { BackgroundModule } from './index';

/** Background module: assistant. Registers RPC handlers, event handlers and alarms for this area. */
export const assistantModule: BackgroundModule = {
  name: 'assistant',
  register() {
    // Implemented in its feature area.
  },
};
