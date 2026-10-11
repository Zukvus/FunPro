import { browser } from 'wxt/browser';
import type { Settings } from '@/core/settings/schema';

/** Installed extension version from the manifest ('0.0.0' outside an extension context). */
export function extensionVersion(): string {
  try {
    return browser.runtime.getManifest().version;
  } catch {
    return '0.0.0';
  }
}

/**
 * "What's new" badge: shown after an update until the About page is opened. Fresh installs see no
 * badge (onboarding records the installed version as seen).
 */
export function hasUnseenChangelog(general: Settings['general'], version: string): boolean {
  return general.onboardingCompleted && version !== '0.0.0' && general.changelogSeenVersion !== version;
}
