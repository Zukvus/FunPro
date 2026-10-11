import { Keyboard } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { browser } from 'wxt/browser';
import { DEFAULT_PALETTE_SHORTCUT, formatShortcut, shortcutFromEvent, shortcutParts, validateShortcut, type ShortcutProblem } from '@/features/appearance/shortcuts';
import { Button, Card, Kbd, toast } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';

interface BrowserCommand {
  name?: string;
  description?: string;
  shortcut?: string;
}

const COMMAND_DEFAULTS: Record<string, { labelKey: string; fallback: string }> = {
  'emergency-stop': { labelKey: 'shortcuts.emergencyStop', fallback: 'Alt+Shift+S' },
  'open-dashboard': { labelKey: 'shortcuts.openDashboard', fallback: 'Alt+Shift+F' },
};

function Keys({ text }: { text: string }) {
  const parts = shortcutParts(text);
  if (!parts.length) return <span className="text-xs text-muted">{text}</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-0.5">
      {parts.map((p, i) => (
        <span key={`${p}-${i}`} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="text-[10px] text-muted">+</span>}
          <Kbd>{p}</Kbd>
        </span>
      ))}
    </span>
  );
}

const isFirefox = () => /firefox/i.test(globalThis.navigator?.userAgent ?? '');

/** Keyboard shortcuts: configurable command palette key + browser-level extension commands. */
export function ShortcutsCard() {
  const t = useT();
  const [settings, update] = useSettings();
  const [recording, setRecording] = useState(false);
  const [problem, setProblem] = useState<ShortcutProblem | null>(null);
  const [commands, setCommands] = useState<BrowserCommand[] | null>(null);
  const current = settings.shortcuts.commandPalette;

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => browser.commands?.getAll?.())
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setCommands(list as BrowserCommand[]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onRecordKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    if (e.key === 'Escape' || (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey)) {
      setRecording(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const s = shortcutFromEvent(e);
    if (!s) return; // lone modifier — keep listening
    const v = validateShortcut(formatShortcut(s));
    if (!v.ok) {
      setProblem(v.problem);
      return;
    }
    setProblem(null);
    setRecording(false);
    void update({ shortcuts: { commandPalette: v.normalized } });
  };

  const openBrowserShortcuts = () => {
    void browser.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(() => toast.error(t('shortcuts.openFailed')));
  };

  const rows = Object.entries(COMMAND_DEFAULTS).map(([name, def]) => {
    const cmd = commands?.find((c) => c.name === name);
    return { name, label: t(def.labelKey), keys: cmd ? cmd.shortcut || '' : def.fallback };
  });

  return (
    <Card title={t('shortcuts.title')} description={t('shortcuts.description')}>
      <div className="divide-y divide-border">
        <div className="flex flex-wrap items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{t('shortcuts.palette')}</p>
            <p className="text-xs text-muted">{t('shortcuts.paletteHelp')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Keys text={current} />
            <Button
              size="sm"
              variant={recording ? 'primary' : 'outline'}
              onClick={() => {
                setProblem(null);
                setRecording((r) => !r);
              }}
              onKeyDown={onRecordKey}
              onBlur={() => setRecording(false)}
              aria-pressed={recording}
              icon={<Keyboard size={14} aria-hidden />}
            >
              {recording ? t('shortcuts.pressKeys') : t('shortcuts.change')}
            </Button>
            {current !== DEFAULT_PALETTE_SHORTCUT && (
              <Button size="sm" variant="ghost" onClick={() => void update({ shortcuts: { commandPalette: DEFAULT_PALETTE_SHORTCUT } })}>
                {t('shortcuts.reset')}
              </Button>
            )}
          </div>
        </div>
        <p aria-live="polite" className="text-xs text-danger empty:hidden">
          {problem ? t(`shortcuts.problem.${problem}`) : ''}
        </p>
        {rows.map((r) => (
          <div key={r.name} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">{r.label}</p>
              <p className="text-xs text-muted">{t('shortcuts.browserCommand')}</p>
            </div>
            {r.keys ? <Keys text={r.keys} /> : <span className="text-xs text-muted">{t('shortcuts.notSet')}</span>}
          </div>
        ))}
        <div className="py-2.5 text-xs text-muted">
          <p>{t('shortcuts.inPalette')}</p>
          <p className="mt-1">{t('shortcuts.dialogs')}</p>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {isFirefox() ? (
          <p className="text-xs text-muted">{t('shortcuts.firefoxHelp')}</p>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={openBrowserShortcuts}>
              {t('shortcuts.manage')}
            </Button>
            <span className="text-xs text-muted">{t('shortcuts.chromeHelp')}</span>
          </>
        )}
      </div>
    </Card>
  );
}
