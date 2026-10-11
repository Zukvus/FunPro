import { FEATURE_FLAGS, isFlagEnabled, type FeatureFlag } from '@/core/flags/flags';

/**
 * Flags that cannot be switched on because the capability behind them does not exist.
 * `nicknameSync` would need an opt-in synchronisation service for sharing nickname styles with
 * other users; FunPro has none, so the flag stays off (no networked code exists for it).
 */
export const LOCKED_FLAGS: Partial<Record<FeatureFlag, 'requires_sync_service'>> = {
  nicknameSync: 'requires_sync_service',
};

export const ALL_FLAGS = Object.keys(FEATURE_FLAGS) as FeatureFlag[];

export function effectiveFlags(overrides: Record<string, boolean>): Record<FeatureFlag, boolean> {
  const out = {} as Record<FeatureFlag, boolean>;
  for (const f of ALL_FLAGS) out[f] = LOCKED_FLAGS[f] ? false : isFlagEnabled(f, overrides);
  return out;
}

export function isOverridden(flag: FeatureFlag, overrides: Record<string, boolean>): boolean {
  return flag in overrides && overrides[flag] !== FEATURE_FLAGS[flag].default;
}

/**
 * Settings patch for a flag change. Settings patches merge (keys cannot be deleted), so "reset to
 * default" stores the default value, which `isOverridden` treats as not overridden.
 */
export function flagPatch(flag: FeatureFlag, value: boolean): Record<string, boolean> {
  if (LOCKED_FLAGS[flag]) return { [flag]: false };
  return { [flag]: value };
}
