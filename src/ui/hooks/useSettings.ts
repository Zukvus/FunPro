import { create } from 'zustand';
import { defaultSettings, type Settings, type SettingsPatch } from '@/core/settings/schema';
import { getSettings, updateSettings, watchSettings } from '@/core/settings/store';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  update: (patch: SettingsPatch) => Promise<Settings>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings(),
  loaded: false,
  update: async (patch) => {
    const next = await updateSettings(patch);
    set({ settings: next });
    return next;
  },
}));

let initialised = false;

/** Load settings once per page and keep them in sync with changes from other contexts. */
export function initSettingsSync(): () => void {
  if (initialised) return () => undefined;
  initialised = true;
  void getSettings().then((s) => useSettingsStore.setState({ settings: s, loaded: true }));
  const unwatch = watchSettings((s) => useSettingsStore.setState({ settings: s, loaded: true }));
  return () => {
    initialised = false;
    unwatch();
  };
}

export function useSettings(): [Settings, SettingsState['update'], boolean] {
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  const loaded = useSettingsStore((s) => s.loaded);
  return [settings, update, loaded];
}
