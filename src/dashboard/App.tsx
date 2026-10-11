import { Command, Menu } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { rpc } from '@/core/messaging/client';
import { Badge, IconButton, Kbd, Spinner, Toaster, toast } from '@/ui/components';
import { useApplyAppearance } from '@/ui/hooks/useAppearance';
import { initSettingsSync, useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { isFlagEnabled } from '@/core/flags/flags';
import { shortcutParts } from '@/features/appearance/shortcuts';
import { primeAppearanceFromCache } from '@/ui/theme/applyAppearance';
import { cn } from '@/ui/lib/cn';
import { AutomationControl } from './components/AutomationControl';
import { CommandPalette, type PaletteCommand } from './components/CommandPalette';
import { SessionBadge } from './components/SessionBadge';
import { BackgroundImage } from './components/BackgroundImage';
import { useBackgroundStatus, useHashRoute } from './hooks';
import { ROUTES, WELCOME_ROUTE } from './routes';
import { DashboardContext } from './context';
import { extensionVersion, hasUnseenChangelog } from './pages/about/version';

// Paint with the last known theme/privacy state before settings load (no light flash, no unblurred flash).
primeAppearanceFromCache();

const DESKTOP = '(min-width: 768px)';
function subscribeDesktop(cb: () => void): () => void {
  const mq = window.matchMedia?.(DESKTOP);
  mq?.addEventListener?.('change', cb);
  return () => mq?.removeEventListener?.('change', cb);
}
const isDesktop = () => window.matchMedia?.(DESKTOP).matches ?? true;

const GROUPS = ['sell', 'grow', 'automate', 'settings'] as const;

export function App() {
  useEffect(() => initSettingsSync(), []);
  useApplyAppearance();
  const t = useT();
  const [settings, , loaded] = useSettings();
  const [path, navigate] = useHashRoute();
  const { status, error, refresh } = useBackgroundStatus();
  const [navOpen, setNavOpen] = useState(false);
  const desktop = useSyncExternalStore(subscribeDesktop, isDesktop, () => true);
  const mainRef = useRef<HTMLElement>(null);
  const firstRoute = useRef(true);
  const version = useMemo(() => extensionVersion(), []);
  const whatsNew = hasUnseenChangelog(settings.general, version);
  const paletteEnabled = isFlagEnabled('commandPalette', settings.flags);
  const paletteKeys = shortcutParts(settings.shortcuts.commandPalette);

  const route = ROUTES.find((r) => r.path === path);
  const Page = path === WELCOME_ROUTE.path ? WELCOME_ROUTE.component : (route ?? ROUTES[0]!).component;

  // First run: open the onboarding guide unless the user deep-linked somewhere.
  useEffect(() => {
    if (loaded && !settings.general.onboardingCompleted && !window.location.hash.replace(/^#\/?/, '')) navigate(WELCOME_ROUTE.path);
  }, [loaded, settings.general.onboardingCompleted, navigate]);

  // Route change: title + move focus to the main region so screen readers announce the new page.
  useEffect(() => {
    document.title = `${path === WELCOME_ROUTE.path ? t('app.name') : t((route ?? ROUTES[0]!).labelKey)} · FunPro`;
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo?.(0, 0);
  }, [path, route, t]);

  // Esc closes the mobile navigation drawer.
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setNavOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

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
      <a
        href="#fp-main"
        onClick={(e) => {
          e.preventDefault();
          mainRef.current?.focus();
        }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-fg focus:shadow-lg"
      >
        {t('a11y.skipToContent')}
      </a>
      {navOpen && <div aria-hidden className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setNavOpen(false)} />}
      <div className="flex min-h-screen">
        <aside
          id="fp-nav"
          className={cn(
            'fixed inset-y-0 left-0 z-40 w-64 shrink-0 border-r border-border bg-surface transition-transform md:sticky md:top-0 md:h-screen md:translate-x-0',
            navOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          inert={!desktop && !navOpen}
        >
          <div className="flex h-14 items-center gap-2 border-b border-border px-4">
            <img src="/icon/32.png" alt="" width={24} height={24} />
            <div>
              <p className="text-sm font-bold text-fg">{t('app.name')}</p>
              <p className="text-[10px] text-muted">{t('app.tagline')}</p>
            </div>
          </div>
          <nav aria-label={t('a11y.mainNav')} className="h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-3">
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
                      <Icon size={16} aria-hidden />
                      {t(r.labelKey)}
                      {r.path === 'about' && whatsNew && (
                        <Badge tone="success" className="ml-auto" title={t('shell.whatsNew')}>
                          {t('common.new')}
                        </Badge>
                      )}
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
              <IconButton
                label={t(navOpen ? 'a11y.closeMenu' : 'a11y.openMenu')}
                aria-expanded={navOpen}
                aria-controls="fp-nav"
                className="md:hidden"
                onClick={() => setNavOpen((o) => !o)}
              >
                <Menu size={18} aria-hidden />
              </IconButton>
              <SessionBadge session={status?.session} openTabs={status?.openTabs ?? 0} />
              {status && <Badge tone={status.automationState === 'running' ? 'success' : status.automationState === 'stopped' ? 'danger' : 'warning'}>{t(`automation.state.${status.automationState}`)}</Badge>}
              {error && <Badge tone="danger">{error}</Badge>}
            </div>
            <div className="flex items-center gap-3">
              {paletteEnabled && paletteKeys.length > 0 && (
                <span className="hidden items-center gap-1 text-xs text-muted lg:flex" title={t('shell.paletteHint')}>
                  <Command size={12} aria-hidden />
                  {paletteKeys.map((k, i) => (
                    <span key={`${k}-${i}`} className="inline-flex items-center gap-1">
                      {i > 0 && '+'}
                      <Kbd>{k}</Kbd>
                    </span>
                  ))}
                </span>
              )}
              <AutomationControl state={status?.automationState} onChange={refresh} />
            </div>
          </header>
          <main id="fp-main" ref={mainRef} tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 p-4 outline-none md:p-6">
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
      {paletteEnabled && <CommandPalette navigate={navigate} extra={extra} shortcut={settings.shortcuts.commandPalette} />}
      <Toaster />
    </DashboardContext.Provider>
  );
}
