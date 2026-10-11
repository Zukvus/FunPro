import { useEffect, useState } from 'react';
import { getDb } from '@/core/db/db';

/** Renders the user's uploaded background image (stored as a Blob in IndexedDB; never remote). */
export function BackgroundImage({ assetId, opacity }: { assetId: string | null; opacity: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!assetId) {
      setUrl(null);
      return;
    }
    void getDb()
      .assets.get(assetId)
      .then((a) => {
        if (cancelled || !a || !a.mime.startsWith('image/')) return;
        revoked = URL.createObjectURL(a.blob);
        setUrl(revoked);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [assetId]);
  if (!url) return null;
  return <div aria-hidden className="fp-bg-image" style={{ backgroundImage: `url("${url}")`, opacity }} />;
}
