import { OctagonX, Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { rpc } from '@/core/messaging/client';
import { Button, toast } from '@/ui/components';
import { useT } from '@/ui/i18n/core';
import type { AutomationState } from '@/core/settings/schema';

export function AutomationControl({
  state,
  onChange,
  compact,
}: {
  state: AutomationState | undefined;
  onChange?: () => void;
  compact?: boolean;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const set = async (next: AutomationState) => {
    setBusy(true);
    try {
      await rpc('ui.setAutomationState', { state: next });
      onChange?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {state === 'running' ? (
        <Button
          size="sm"
          variant="outline"
          icon={<Pause size={14} />}
          onClick={() => set('paused')}
          disabled={busy}
        >
          {!compact && t('automation.pause')}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="outline"
          icon={<Play size={14} />}
          onClick={() => set('running')}
          disabled={busy}
        >
          {!compact && t('automation.resume')}
        </Button>
      )}
      <Button
        size="sm"
        variant="danger"
        icon={<OctagonX size={14} />}
        onClick={() => set('stopped')}
        disabled={busy || state === 'stopped'}
        aria-label={t('automation.emergencyStop')}
      >
        {!compact && t('automation.emergencyStop')}
      </Button>
    </div>
  );
}
