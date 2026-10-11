import { useLiveQuery } from 'dexie-react-hooks';
import { ImageOff, ImagePlus } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import { getDb } from '@/core/db/db';
import {
  BACKGROUND_MIME_TYPES,
  BackgroundImageValidationError,
  MAX_BACKGROUND_BYTES,
  removeBackgroundImage,
  setBackgroundImage,
} from '@/features/appearance/background';
import { Button, Card, toast } from '@/ui/components';
import { Slider } from '@/ui/components/FormControls';
import { useSettings } from '@/ui/hooks/useSettings';
import { useT } from '@/ui/i18n';
import { useLocalValue } from './useLocalValue';

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** Upload / replace / remove the dashboard background image (stored only in IndexedDB). */
export function BackgroundCard() {
  const t = useT();
  const [settings, update] = useSettings();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const assetId = settings.appearance.backgroundImageAssetId;
  const asset = useLiveQuery(() => (assetId ? getDb().assets.get(assetId) : undefined), [assetId]);
  const preview = useObjectUrl(asset?.blob);
  const maxMb = MAX_BACKGROUND_BYTES / 1024 / 1024;
  const [opacity, setOpacity] = useLocalValue(
    settings.appearance.backgroundOpacity,
    (v: number) => update({ appearance: { backgroundOpacity: v } }),
    150,
  );

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      await setBackgroundImage(file);
      toast.success(t('appearance.bg.saved'));
    } catch (err) {
      setError(
        err instanceof BackgroundImageValidationError
          ? t(`appearance.bg.error.${err.code}`, { max: maxMb })
          : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removeBackgroundImage();
      toast.info(t('appearance.bg.removed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={t('appearance.bg.title')} description={t('appearance.bg.description', { max: maxMb })}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="flex h-28 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-border bg-surface-2 sm:w-44">
          {preview ? (
            <img src={preview} alt={t('appearance.bg.previewAlt')} className="h-full w-full object-cover" />
          ) : (
            <ImageOff size={22} className="text-muted" aria-hidden />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={inputRef}
              id={inputId}
              type="file"
              accept={BACKGROUND_MIME_TYPES.join(',')}
              className="sr-only"
              onChange={(e) => void onFile(e)}
            />
            <Button
              size="sm"
              variant="primary"
              icon={<ImagePlus size={14} aria-hidden />}
              loading={busy}
              onClick={() => inputRef.current?.click()}
              aria-describedby={error ? `${inputId}-err` : undefined}
            >
              {assetId ? t('appearance.bg.replace') : t('appearance.bg.upload')}
            </Button>
            {assetId && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>
                {t('appearance.bg.remove')}
              </Button>
            )}
          </div>
          {error && (
            <p id={`${inputId}-err`} role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <Slider
            label={t('appearance.bg.opacity')}
            value={opacity}
            min={0.05}
            max={1}
            step={0.05}
            disabled={!assetId}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => setOpacity(Math.round(v * 100) / 100)}
          />
          <p className="text-xs text-muted">{t('appearance.bg.localOnly')}</p>
        </div>
      </div>
    </Card>
  );
}
