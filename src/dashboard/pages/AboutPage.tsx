import changelog from '@@/CHANGELOG.md?raw';
import { BookOpen, ExternalLink, Info, Scale, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { Badge, Card, PageHeader } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { FUNPAY_RULES_URL } from './automation/features';
import { Markdown } from './about/Markdown';
import { extensionVersion, hasUnseenChangelog } from './about/version';

/** The card already carries the "Changelog" title: drop the document's own top-level heading. */
const CHANGELOG_BODY = changelog.replace(/^#\s+[^\n]*\n/, '');

const DOC_LINKS = [
  { href: '#/welcome', key: 'about.docs.welcome' },
  { href: '#/automation', key: 'about.docs.automation' },
  { href: '#/privacy', key: 'about.docs.privacy' },
  { href: '#/appearance', key: 'about.docs.appearance' },
  { href: '#/logs', key: 'about.docs.logs' },
];

function homepageUrl(): string | null {
  try {
    const url = (browser.runtime.getManifest() as { homepage_url?: string }).homepage_url;
    return url && /^https:\/\//.test(url) ? url : null;
  } catch {
    return null;
  }
}

export default function AboutPage() {
  const t = useT();
  const [settings, update, loaded] = useSettings();
  const version = extensionVersion();
  const [isNew, setIsNew] = useState(false);
  const homepage = homepageUrl();

  // Opening this page marks the current changelog as seen (clears the "what's new" badge).
  useEffect(() => {
    if (!loaded) return;
    if (hasUnseenChangelog(settings.general, version)) setIsNew(true);
    if (settings.general.changelogSeenVersion !== version && version !== '0.0.0')
      void update({ general: { changelogSeenVersion: version } });
  }, [loaded, settings.general, update, version]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t('about.page.title')}
        description={t('about.page.description')}
        actions={
          <span className="inline-flex items-center gap-2">
            <Badge tone="accent">{t('about.version', { version })}</Badge>
            {isNew && (
              <Badge tone="success">
                <Sparkles size={11} aria-hidden /> {t('common.new')}
              </Badge>
            )}
          </span>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Info size={15} aria-hidden /> {t('about.disclaimer.title')}
            </span>
          }
        >
          <p className="text-sm text-fg">{t('app.unofficial')}</p>
          <p className="mt-2 text-xs text-muted">{t('about.disclaimer.body')}</p>
          <a
            href={FUNPAY_RULES_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            {t('about.funpayRules')} <ExternalLink size={11} aria-hidden />
          </a>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <Scale size={15} aria-hidden /> {t('about.license.title')}
            </span>
          }
        >
          <p className="text-sm text-fg">GPL-3.0-or-later</p>
          <p className="mt-2 text-xs text-muted">{t('about.license.body')}</p>
          <a
            href="https://www.gnu.org/licenses/gpl-3.0.html"
            target="_blank"
            rel="noreferrer noopener"
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
          >
            {t('about.license.link')} <ExternalLink size={11} aria-hidden />
          </a>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              <BookOpen size={15} aria-hidden /> {t('about.docs.title')}
            </span>
          }
        >
          <ul className="space-y-1.5 text-sm">
            {DOC_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="text-accent hover:underline">
                  {t(l.key)}
                </a>
              </li>
            ))}
            {homepage && (
              <li>
                <a
                  href={homepage}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  {t('about.docs.homepage')} <ExternalLink size={11} aria-hidden />
                </a>
              </li>
            )}
          </ul>
        </Card>
      </div>

      <Card
        title={t('about.changelog.title')}
        description={isNew ? t('about.changelog.updated', { version }) : undefined}
      >
        <Markdown source={CHANGELOG_BODY} headingOffset={1} />
      </Card>
    </div>
  );
}
