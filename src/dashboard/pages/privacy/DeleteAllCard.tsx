import { Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { RpcError, rpc } from '@/core/messaging/client';
import { WIPE_CONFIRMATION } from '@/core/messaging/rpc/settings';
import { wipeAllLocalData } from '@/features/backup/wipe';
import { Button, Callout, Card, Field, Input, Modal } from '@/ui/components';
import { clearAppearanceCache } from '@/ui/theme/cache';
import { useT } from '@/ui/i18n';

/** Danger zone: delete every piece of local FunPro data after a typed confirmation, then reload. */
export function DeleteAllCard() {
  const t = useT();
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const word = t('privacy.delete.word');
  const matches = typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase();

  const wipe = async () => {
    setBusy(true);
    setError(null);
    try {
      try {
        // Run in the background so its in-memory caches (device key, tab registry) are reset too.
        await rpc('ui.wipeAllData', { confirm: WIPE_CONFIRMATION });
      } catch (e) {
        if (!(e instanceof RpcError) || (e.code !== 'unavailable' && e.code !== 'no_response')) throw e;
        await wipeAllLocalData();
      }
      clearAppearanceCache();
      // Per-page conveniences of the extension origin (remembered tabs, caches) go too.
      try {
        window.localStorage.clear();
        window.sessionStorage.clear();
      } catch {
        /* storage unavailable */
      }
      window.location.hash = '#/welcome';
      window.location.reload();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card
      title={t('privacy.delete.title')}
      description={t('privacy.delete.description')}
      className="border-danger/40"
    >
      <ul className="mb-3 list-disc space-y-0.5 pl-5 text-xs text-muted">
        <li>{t('privacy.delete.item.data')}</li>
        <li>{t('privacy.delete.item.secrets')}</li>
        <li>{t('privacy.delete.item.settings')}</li>
        <li>{t('privacy.delete.item.funpay')}</li>
      </ul>
      <Button
        variant="danger"
        icon={<Trash2 size={14} aria-hidden />}
        onClick={() => {
          setTyped('');
          setError(null);
          setOpen(true);
        }}
      >
        {t('privacy.delete.button')}
      </Button>
      <Modal
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={t('privacy.delete.confirmTitle')}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" disabled={!matches} loading={busy} onClick={() => void wipe()}>
              {t('privacy.delete.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <Callout tone="danger">{t('privacy.delete.irreversible')}</Callout>
          <Field label={t('privacy.delete.typeToConfirm', { word })} htmlFor={inputId}>
            <Input
              id={inputId}
              autoComplete="off"
              spellCheck={false}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-invalid={typed.length > 0 && !matches}
            />
          </Field>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </Card>
  );
}
