import { useEffect } from 'react';
import { applyAppearance } from '../theme/applyAppearance';
import { useSettingsStore } from './useSettings';

export function useApplyAppearance(): void {
  const settings = useSettingsStore((s) => s.settings);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => applyAppearance(document.documentElement, settings, mq?.matches ?? false);
    apply();
    mq?.addEventListener?.('change', apply);
    return () => mq?.removeEventListener?.('change', apply);
  }, [settings]);
}
