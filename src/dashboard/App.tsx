import { Command, Menu } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { rpc } from '@/core/messaging/client';
import { Badge, IconButton, Kbd, Spinner, Toaster, toast } from '@/ui/components';
import { useApplyAppearance } from '@/ui/hooks/useAppearance';
import { initSettingsSync, useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { AutomationControl } from './components/AutomationControl';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { SessionBadge } from './components/SessionBadge';
import { BackgroundImage } from './components/BackgroundImage';
import { useBackgroundStatus, useHashRoute } from './hooks';
import { ROUTES, WELCOME_ROUTE } from './routes';
import { DashboardContext } from './context';

const GROUPS = ['sell', 'grow', 'automate', 'settings'] as const;

export function App() {
  useEffect(() => initSettingsSync(), []);
  useApplyAppearance();
  const t = useT();
  const [settings] = useSettings();
  const [path, navigate] = useHashRoute();
  const { status, error, refresh } = useBackgroundStatus();
  const [navOpen, setNavOpen] = useState(false);

  const route = ROUTES.find((r) => r.path === path);
  const Page = path === WELCOME_ROUTE.path ? WELCOME_ROUTE.component : (route ?? ROUTES[0]!).component;

  const extra = useMemo<PaletteCommand[]>(
    () => [
      { id: 'stop', label: t('automation.emergencyStop'), hint: 'Action', keywords: ['stop', 'halt'], run: () => void rpc('ui.emergencyStop', {}).then(refresh) },
      { id: 'sync', label: t('common.syncNow'), hint: 'Action', run: () => void rpc('ui.syncNow', {}).then(() => toast.info(t('common.syncNow'))).catch((e: Error) => toast.error(e.message)) },
      { id: 'bump', label: t('popup.bumpNow'), hint: 'Action', keywords: ['raise'], run: () => void rpc('ui.bumpNow', {}).catch((e: Error) => toast.error(e.message)) },
    ],
    [refresh, t],
  );

  return (
    <DashboardContext.Provider value={{ status, refreshStatus: refresh, navigate }}>
      <BackgroundImage assetId={settings.appearance.backgroundImageAssetId} opacity={settings.appearance.backgroundOpacity} />
      <div className="flex min-h-screen">
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-border bg-surface transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Main navigation"
        >
          <div className="flex h-14 items-center gap-2 border-b border-border px-4">
            <img src="/icon/32.png" alt="" width={24} height={24} />
            <div>
              <p className="text-sm font-bold text-fg">{t('app.name')}</p>
              <p className="text-[10px] text-muted">{t('app.tagline')}</p>
            </div>
          </div>
          <nav className="h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-3">
            {GROUPS.map((g) => (
              <div key={g} className="mb-3">
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">{t(`nav.group.${g}`)}</p>
                {ROUTES.filter((r) => r.group === g).map((r) => {
                  const Icon = r.icon;
                  const active = r.path === (route?.path ?? 'overview') && path !== 'welcome';
                  return (
                    <a
                      key={r.path}
                      href={`#/${r.path}`}
                      onClick={() => setNavOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={cn('flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm', active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:bg-surface-2 hover:text-fg')}
                    >
                      <Icon size={16} />
                      {t(r.labelKey)}
                    </a>
                  );
                })}
              </div>
            ))}
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <IconButton label="Menu" className="md:hidden" onClick={() => setNavOpen((o) => !o)}>
                <Menu size={18} />
              </IconButton>
              <SessionBadge session={status?.session} openTabs={status?.openTabs ?? 0} />
              {status && <Badge tone={status.automationState === 'running' ? 'success' : status.automationState === 'stopped' ? 'danger' : 'warning'}>{t(`automation.state.${status.automationState}`)}</Badge>}
              {error && <Badge tone="danger">{error}</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <span className="hidden items-center gap-1 text-xs text-muted lg:flex">
                <Command size={12} /> <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd>
              </span>
              <AutomationControl state={status?.automationState} onChange={refresh} />
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
            <Suspense
              fallback={
                <div className="flex justify-center py-20">
                  <Spinner size={24} />
                </div>
              }
            >
              <Page />
            </Suspense>
          </main>
          <footer className="px-6 pb-4 text-center text-[11px] text-muted">{t('app.unofficial')}</footer>
        </div>
      </div>
      <CommandPalette navigate={navigate} extra={extra} />
      <Toaster />
    </DashboardContext.Provider>
  );
}
