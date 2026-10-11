import { BarChart3, Bell, Boxes, ExternalLink, EyeOff, HardDrive, KeyRound, LayoutDashboard, MessageSquare, OctagonX, PauseCircle, ShieldCheck, ToggleLeft, Trash2, Zap } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { browser } from 'wxt/browser';
import type { Settings } from '@/core/settings/schema';
import { Button, Card, Field, Kbd, ProgressBar, Select } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { SessionBadge } from '../components/SessionBadge';
import { useDashboard } from '../context';
import { extensionVersion } from './about/version';
import { ThemePicker } from './appearance/ThemePicker';

const STEPS = ['what', 'privacy', 'connect', 'personalize', 'automation'] as const;
type Step = (typeof STEPS)[number];

function Point({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span aria-hidden className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
        {icon}
      </span>
      <span className="text-sm text-fg">{children}</span>
    </li>
  );
}

export default function WelcomePage() {
  const t = useT();
  const [settings, update] = useSettings();
  const { status, refreshStatus, navigate } = useDashboard();
  const [index, setIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  const langId = useId();
  const step: Step = STEPS[index]!;
  const last = index === STEPS.length - 1;

  // Move focus to the new step's heading so screen readers announce it.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [index]);

  const finish = async () => {
    await update({ general: { onboardingCompleted: true, changelogSeenVersion: extensionVersion() } });
    navigate('overview');
  };

  const openFunPay = () => void browser.tabs.create({ url: 'https://funpay.com/' }).catch(() => window.open('https://funpay.com/', '_blank', 'noopener'));

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs font-medium text-muted" aria-live="polite">
          {t('welcome.progress', { step: index + 1, total: STEPS.length })}
        </p>
        <Button size="sm" variant="ghost" onClick={() => void finish()}>
          {t('welcome.skip')}
        </Button>
      </div>
      <ProgressBar value={index + 1} max={STEPS.length} label={t('welcome.progress', { step: index + 1, total: STEPS.length })} />

      <Card className="mt-4">
        <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-fg outline-none">
          {t(`welcome.${step}.title`)}
        </h1>
        <p className="mt-1 text-sm text-muted">{t(`welcome.${step}.intro`)}</p>

        <div className="mt-5">
          {step === 'what' && (
            <ul className="space-y-3">
              <Point icon={<LayoutDashboard size={15} />}>{t('welcome.what.dashboard')}</Point>
              <Point icon={<MessageSquare size={15} />}>{t('welcome.what.messages')}</Point>
              <Point icon={<BarChart3 size={15} />}>{t('welcome.what.analytics')}</Point>
              <Point icon={<Boxes size={15} />}>{t('welcome.what.inventory')}</Point>
              <Point icon={<Bell size={15} />}>{t('welcome.what.notifications')}</Point>
              <Point icon={<Zap size={15} />}>{t('welcome.what.automation')}</Point>
            </ul>
          )}

          {step === 'privacy' && (
            <ul className="space-y-3">
              <Point icon={<HardDrive size={15} />}>{t('welcome.privacy.local')}</Point>
              <Point icon={<KeyRound size={15} />}>{t('welcome.privacy.credentials')}</Point>
              <Point icon={<ShieldCheck size={15} />}>{t('welcome.privacy.integrations')}</Point>
              <Point icon={<EyeOff size={15} />}>{t('welcome.privacy.mode')}</Point>
              <Point icon={<Trash2 size={15} />}>{t('welcome.privacy.control')}</Point>
            </ul>
          )}

          {step === 'connect' && (
            <div className="space-y-4">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm text-fg">
                <li>{t('welcome.connect.step1')}</li>
                <li>{t('welcome.connect.step2')}</li>
                <li>{t('welcome.connect.step3')}</li>
              </ol>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" icon={<ExternalLink size={14} aria-hidden />} onClick={openFunPay}>
                  {t('session.openFunPay')}
                </Button>
                <Button variant="outline" onClick={refreshStatus}>
                  {t('welcome.connect.check')}
                </Button>
                <span aria-live="polite">
                  <SessionBadge session={status?.session} openTabs={status?.openTabs ?? 0} />
                </span>
              </div>
              <p className="text-xs text-muted">{t('welcome.connect.tabNote')}</p>
            </div>
          )}

          {step === 'personalize' && (
            <div className="space-y-5">
              <div className="max-w-xs">
                <Field label={t('welcome.personalize.language')} htmlFor={langId}>
                  <Select id={langId} value={settings.general.language} onChange={(e) => void update({ general: { language: e.target.value as Settings['general']['language'] } })}>
                    <option value="auto">{t('welcome.personalize.languageAuto')}</option>
                    <option value="en">English</option>
                    <option value="ru">Русский</option>
                    <option value="uk">Українська</option>
                  </Select>
                </Field>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-fg">{t('appearance.theme.label')}</p>
                <ThemePicker compact value={settings.appearance.theme} onChange={(theme) => void update({ appearance: { theme } })} />
              </div>
              <p className="text-xs text-muted">{t('welcome.personalize.more')}</p>
            </div>
          )}

          {step === 'automation' && (
            <ul className="space-y-3">
              <Point icon={<ToggleLeft size={15} />}>{t('welcome.automation.off')}</Point>
              <Point icon={<PauseCircle size={15} />}>{t('welcome.automation.paused')}</Point>
              <Point icon={<ShieldCheck size={15} />}>{t('welcome.automation.confirm')}</Point>
              <Point icon={<OctagonX size={15} />}>
                {t('welcome.automation.stop')} <Kbd>Alt</Kbd>+<Kbd>Shift</Kbd>+<Kbd>S</Kbd>
              </Point>
              <Point icon={<ExternalLink size={15} />}>{t('welcome.automation.browser')}</Point>
            </ul>
          )}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4">
          <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            {t('welcome.back')}
          </Button>
          {last ? (
            <Button variant="primary" onClick={() => void finish()}>
              {t('welcome.finish')}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => setIndex((i) => Math.min(STEPS.length - 1, i + 1))}>
              {t('welcome.next')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
