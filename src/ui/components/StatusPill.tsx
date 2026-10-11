import type { AutomationStatus } from '@/core/automation/policy';
import { useT } from '../i18n/core';
import { Badge } from './primitives';

const TONE: Record<AutomationStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  disabled: 'neutral',
  running: 'success',
  paused: 'warning',
  awaiting_authorization: 'info',
  blocked: 'danger',
};

export function StatusPill({ status, reason }: { status: AutomationStatus; reason?: string }) {
  const t = useT();
  return (
    <Badge tone={TONE[status]} title={reason}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {t(`status.${status}`)}
    </Badge>
  );
}
