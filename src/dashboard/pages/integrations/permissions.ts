import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';

/**
 * Optional host permission helpers. `requestOrigin` MUST be the first call in a click handler:
 * browsers only show the permission prompt during a user gesture, and an earlier `await` loses it.
 */
export function requestOrigin(origin: string): Promise<boolean> {
  try {
    return browser.permissions.request({ origins: [origin] }).catch(() => false);
  } catch {
    return Promise.resolve(false);
  }
}

/**
 * Whether the manifest declares this origin (or a pattern covering it) as an optional host
 * permission — browsers refuse to request anything else.
 */
export function isDeclaredOptionalOrigin(origin: string): boolean {
  let declared: string[];
  try {
    const manifest = browser.runtime.getManifest() as { optional_host_permissions?: string[]; optional_permissions?: string[] };
    declared = [...(manifest.optional_host_permissions ?? []), ...(manifest.optional_permissions ?? [])];
  } catch {
    return true;
  }
  if (declared.length === 0) return true;
  const toRe = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return declared.some((p) => p === '<all_urls>' || p === origin || toRe(p).test(origin));
}

export async function revokeOrigin(origin: string): Promise<boolean> {
  try {
    return await browser.permissions.remove({ origins: [origin] });
  } catch {
    return false;
  }
}

/** Whether the extension currently holds the optional host permission (kept in sync with changes). */
export function useOriginPermission(origin: string | null): { granted: boolean | null; refresh: () => void } {
  const [granted, setGranted] = useState<boolean | null>(null);
  const refresh = useCallback(() => {
    if (!origin) {
      setGranted(null);
      return;
    }
    browser.permissions
      .contains({ origins: [origin] })
      .then(setGranted)
      .catch(() => setGranted(false));
  }, [origin]);
  useEffect(() => {
    refresh();
    const onChange = () => refresh();
    browser.permissions.onAdded?.addListener(onChange);
    browser.permissions.onRemoved?.addListener(onChange);
    return () => {
      browser.permissions.onAdded?.removeListener(onChange);
      browser.permissions.onRemoved?.removeListener(onChange);
    };
  }, [refresh]);
  return { granted, refresh };
}
