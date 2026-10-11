import type { SessionInfo } from '@/shared/session';
import { Badge } from '@/ui/components';
import { useT } from '@/ui/i18n';

export function SessionBadge({ session, openTabs }: { session: SessionInfo | null | undefined; openTabs: number }) {
  const t = useT();
  if (!session || openTabs === 0) return <Badge tone="neutral" title="FunPro acts only through an open FunPay tab">{t('session.unknown')}</Badge>;
  if (session.status === 'logged_in')
    return (
      <Badge tone="success">
        <span className="fp-sensitive">{t('session.logged_in', { name: session.username ?? `#${session.userId}` })}</span>
      </Badge>
    );
  return <Badge tone="warning">{t('session.logged_out')}</Badge>;
}
