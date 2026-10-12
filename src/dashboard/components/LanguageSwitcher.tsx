import { ChevronDown, Languages } from 'lucide-react';
import { useId } from 'react';
import type { Settings } from '@/core/settings/schema';
import { useSettings } from '@/ui/hooks/useSettings';
import { detectBrowserLang, useT, type Lang } from '@/ui/i18n/core';
import { cn } from '@/ui/lib/cn';

type LanguageSetting = Settings['general']['language'];

/** Each language is listed in its own language, so anyone can find theirs. */
export const LANGUAGE_NAMES: Record<Lang, string> = { ru: 'Русский', en: 'English', uk: 'Українська' };
/** Short labels for tight spaces (the popup). Ukrainian is shown as UA: "UK" reads as English. */
const SHORT: Record<Lang, string> = { ru: 'RU', en: 'EN', uk: 'UA' };
const ORDER: readonly Lang[] = ['ru', 'en', 'uk'];

/**
 * Interface language control for the top bar of the dashboard and the popup. A native select:
 * keyboard and screen-reader support come for free and it works inside the popup. The choice is
 * saved in settings (`general.language`) and applies to every open FunPro page at once.
 */
export function LanguageSwitcher({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const [settings, update] = useSettings();
  const id = useId();
  const browserLang = detectBrowserLang();
  return (
    <div className={cn('relative inline-flex shrink-0 items-center', className)}>
      <label htmlFor={id} className="sr-only">
        {t('lang.switcher')}
      </label>
      <Languages size={14} aria-hidden className="pointer-events-none absolute left-2.5 text-muted" />
      <select
        id={id}
        value={settings.general.language}
        title={t('lang.switcher')}
        onChange={(e) => void update({ general: { language: e.target.value as LanguageSetting } })}
        className="h-8 cursor-pointer appearance-none rounded-lg border border-border bg-surface py-0 pl-8 pr-7 text-xs font-medium text-fg hover:bg-surface-2 focus:border-accent focus:outline-none"
      >
        <option value="auto">
          {compact ? t('lang.autoShort') : t('lang.auto', { lang: LANGUAGE_NAMES[browserLang] })}
        </option>
        {ORDER.map((l) => (
          <option key={l} value={l} lang={l}>
            {compact ? SHORT[l] : LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
      <ChevronDown size={12} aria-hidden className="pointer-events-none absolute right-2.5 text-muted" />
    </div>
  );
}
