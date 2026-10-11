/**
 * Offscreen document (reason AUDIO_PLAYBACK) that plays notification sounds for the Chrome
 * service worker. It only reacts to validated `play` messages from this extension; everything
 * else (including RPC traffic from content scripts) is ignored so other listeners can answer it.
 */
import { browser } from 'wxt/browser';
import { OffscreenPlaySchema, playInPage, type PlayHandle } from '@/features/notifications/audio';

let current: PlayHandle | null = null;

browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  const parsed = OffscreenPlaySchema.safeParse(message);
  if (!parsed.success || sender.id !== browser.runtime.id) return false;
  const { sound, volume } = parsed.data;
  current?.stop();
  void playInPage(sound, volume)
    .then((handle) => {
      current = handle;
      void handle.done.then(() => {
        if (current === handle) current = null;
      });
      sendResponse({ ok: true });
    })
    .catch((e: unknown) =>
      sendResponse({ ok: false, error: e instanceof Error ? e.message : 'Playback failed' }),
    );
  return true;
});
