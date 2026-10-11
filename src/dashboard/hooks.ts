import { useCallback, useEffect, useState } from 'react';
import { rpc } from '@/core/messaging/client';
import type { FeatureStatus } from '@/core/automation/policy';
import type { AutomationState } from '@/core/settings/schema';
import type { SessionInfo } from '@/shared/session';

export interface StatusResponse {
  automationState: AutomationState;
  liveActionsAcknowledged: boolean;
  session: SessionInfo | null;
  openTabs: number;
  statuses: FeatureStatus[];
  counts: {
    activeSales: number;
    unreadChats: number;
    salesTodayCount: number;
    failedTasks: number;
    pendingDrafts: number;
  };
  salesToday: Record<string, number>;
}

/** Polls background status while the page is visible. */
export function useBackgroundStatus(intervalMs = 5000): {
  status: StatusResponse | null;
  error: string | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    rpc<StatusResponse>('ui.status', {})
      .then((s) => {
        setStatus(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);
  return { status, error, refresh };
}

export function useHashRoute(defaultPath = 'overview'): [string, (p: string) => void] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('?')[0] || defaultPath;
  const [path, setPath] = useState(read);
  useEffect(() => {
    const onHash = () => setPath(read());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const navigate = useCallback((p: string) => {
    window.location.hash = `/${p}`;
  }, []);
  return [path, navigate];
}
