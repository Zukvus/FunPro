import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import {
  moveSection,
  OVERVIEW_SECTIONS,
  resolveLayout,
  toSettings,
  type LayoutEntry,
} from '@/features/dashboard/layout';
import { Button, IconButton, Modal, Switch, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';

/** Choose which Overview sections are shown and in which order (saved in settings). */
export function LayoutDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [settings, update] = useSettings();
  const [entries, setEntries] = useState<LayoutEntry[]>(() =>
    resolveLayout(settings.dashboard.overviewOrder, settings.dashboard.overviewHidden),
  );

  const move = (id: LayoutEntry['id'], delta: -1 | 1) => {
    const order = moveSection(
      entries.map((e) => e.id),
      id,
      delta,
    );
    setEntries(order.map((oid) => entries.find((e) => e.id === oid)!));
  };

  const save = async () => {
    try {
      await update({ dashboard: toSettings(entries) });
      toast.success(t('overview.layout.saved'));
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t('overview.layout.title')}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<RotateCcw size={14} aria-hidden />}
            onClick={() => setEntries(OVERVIEW_SECTIONS.map((id) => ({ id, visible: true })))}
          >
            {t('overview.layout.reset')}
          </Button>
          <Button variant="primary" onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-muted">{t('overview.layout.description')}</p>
      <ol className="divide-y divide-border/60">
        {entries.map((e, i) => (
          <li key={e.id} className="flex items-center gap-2 py-1">
            <div className="min-w-0 flex-1">
              <Switch
                checked={e.visible}
                onChange={(v) => setEntries(entries.map((x) => (x.id === e.id ? { ...x, visible: v } : x)))}
                label={t(`overview.layout.section.${e.id}`)}
              />
            </div>
            <IconButton
              label={t('overview.layout.up', { name: t(`overview.layout.section.${e.id}`) })}
              disabled={i === 0}
              onClick={() => move(e.id, -1)}
            >
              <ArrowUp size={14} />
            </IconButton>
            <IconButton
              label={t('overview.layout.down', { name: t(`overview.layout.section.${e.id}`) })}
              disabled={i === entries.length - 1}
              onClick={() => move(e.id, 1)}
            >
              <ArrowDown size={14} />
            </IconButton>
          </li>
        ))}
      </ol>
    </Modal>
  );
}
