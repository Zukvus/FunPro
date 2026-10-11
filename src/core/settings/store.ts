import { storage } from 'wxt/utils/storage';
import { defaultSettings, mergeSettings, parseSettings, type Settings, type SettingsPatch } from './schema';

const settingsItem = storage.defineItem<unknown>('local:settings', { fallback: null });

export async function getSettings(): Promise<Settings> {
  return parseSettings(await settingsItem.getValue());
}

/** Serialised writes: concurrent patches from different contexts are applied in order. */
let writeChain: Promise<unknown> = Promise.resolve();

export function updateSettings(patch: SettingsPatch): Promise<Settings> {
  const next = writeChain.then(async () => {
    const merged = mergeSettings(await getSettings(), patch);
    await settingsItem.setValue(merged);
    return merged;
  });
  writeChain = next.catch(() => undefined);
  return next;
}

export async function replaceSettings(raw: unknown): Promise<Settings> {
  const parsed = parseSettings(raw);
  await settingsItem.setValue(parsed);
  return parsed;
}

export async function resetSettings(): Promise<Settings> {
  const d = defaultSettings();
  await settingsItem.setValue(d);
  return d;
}

export function watchSettings(cb: (s: Settings) => void): () => void {
  return settingsItem.watch((v) => cb(parseSettings(v)));
}
