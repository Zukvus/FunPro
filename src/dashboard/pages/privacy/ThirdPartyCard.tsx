import { Badge, Card } from '@/ui/components';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';

/** Who receives data from this browser, what, and when — derived from current settings. */
export function ThirdPartyCard() {
  const t = useT();
  const [s] = useSettings();
  const local = s.general.localOnly;
  const telegramOn = s.telegram.enabled && !local;
  const aiOn = s.ai.enabled && s.ai.consentAt !== null && s.ai.provider !== 'none' && !local;
  const rows = [
    { id: 'funpay', active: true, status: t('privacy.third.alwaysOn') },
    { id: 'telegram', active: telegramOn, status: telegramOn ? t('common.enabled') : local && s.telegram.enabled ? t('privacy.third.blockedLocal') : t('common.disabled') },
    { id: 'ai', active: aiOn, status: aiOn ? t('common.enabled') : local && s.ai.enabled ? t('privacy.third.blockedLocal') : t('common.disabled') },
  ];
  return (
    <Card title={t('privacy.third.title')} description={t('privacy.third.description')}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('privacy.third.recipient')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('privacy.third.what')}
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                {t('privacy.third.when')}
              </th>
              <th scope="col" className="py-2 font-semibold">
                {t('privacy.third.status')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 align-top last:border-0">
                <th scope="row" className="py-2 pr-3 font-medium text-fg">
                  {t(`privacy.third.${r.id}.name`)}
                </th>
                <td className="py-2 pr-3 text-muted">{t(`privacy.third.${r.id}.what`)}</td>
                <td className="py-2 pr-3 text-muted">{t(`privacy.third.${r.id}.when`)}</td>
                <td className="py-2">
                  <Badge tone={r.active ? (r.id === 'funpay' ? 'info' : 'warning') : 'neutral'}>{r.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">{t('privacy.third.nobodyElse')}</p>
    </Card>
  );
}
