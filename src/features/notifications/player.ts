/**
 * Sound players used by the background:
 *  - Chrome (MV3 service worker has no DOM): an offscreen document (reason AUDIO_PLAYBACK) created
 *    lazily, guarded against concurrent creation, closed again after a short idle period;
 *  - Firefox (event page has DOM): `Audio` directly in the background page.
 * Both are wrapped in a throttle so bursts of notifications never queue up sounds.
 */
import type { Settings } from '@/core/settings/schema';
import {
  OFFSCREEN_TARGET,
  playInPage,
  type OffscreenPlayMessage,
  type PlayHandle,
  type PlayInPageDeps,
} from './audio';
import type { NotificationSink } from './notify';
import { soundEnabledFor, soundIdFor } from './prefs';
import { resolveSoundRef, type SoundRef } from './sounds';

export interface SoundPlayer {
  play(ref: SoundRef, volume: number): Promise<void>;
}

export interface ThrottleOptions {
  /** Minimum time between two sounds; extra sounds inside the window are dropped. */
  minGapMs?: number;
  now?: () => number;
}

/** Drops sounds while one is starting or within `minGapMs` of the last one (no queue to grow). */
export function createThrottledPlayer(
  inner: SoundPlayer,
  opts: ThrottleOptions = {},
): SoundPlayer & { readonly dropped: number } {
  const minGap = opts.minGapMs ?? 1500;
  const now = opts.now ?? Date.now;
  let last = -Infinity;
  let busy = false;
  let dropped = 0;
  return {
    get dropped() {
      return dropped;
    },
    async play(ref, volume) {
      const t = now();
      if (busy || t - last < minGap) {
        dropped++;
        return;
      }
      busy = true;
      last = t;
      try {
        await inner.play(ref, volume);
      } finally {
        busy = false;
      }
    },
  };
}

export interface OffscreenApi {
  createDocument(params: { url: string; reasons: 'AUDIO_PLAYBACK'[]; justification: string }): Promise<void>;
  closeDocument(): Promise<void>;
}

export interface OffscreenPlayerDeps {
  offscreen: OffscreenApi;
  /** True when our offscreen document currently exists (runtime.getContexts). */
  hasDocument(): Promise<boolean>;
  sendMessage(message: OffscreenPlayMessage): Promise<unknown>;
  documentPath?: string;
  idleCloseMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

export function createOffscreenPlayer(deps: OffscreenPlayerDeps): SoundPlayer & { close(): Promise<void> } {
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const idleMs = deps.idleCloseMs ?? 20_000;
  let creating: Promise<void> | null = null;
  let closing: Promise<void> | null = null;
  let idleTimer: unknown = null;
  let active = 0;

  async function ensureDocument(): Promise<void> {
    if (closing) await closing;
    if (await deps.hasDocument()) return;
    creating ??= deps.offscreen
      .createDocument({
        url: deps.documentPath ?? OFFSCREEN_DOCUMENT_PATH,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play FunPro notification sounds',
      })
      .catch(async (e: unknown) => {
        // Another context may have created it in the meantime ("Only a single offscreen document may be created").
        if (!(await deps.hasDocument())) throw e;
      })
      .finally(() => {
        creating = null;
      });
    await creating;
  }

  async function close(): Promise<void> {
    if (idleTimer !== null) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
    if (active > 0 || creating) return;
    closing ??= (async () => {
      try {
        if (await deps.hasDocument()) await deps.offscreen.closeDocument();
      } catch {
        /* already closed */
      }
    })().finally(() => {
      closing = null;
    });
    await closing;
  }

  function scheduleIdleClose(): void {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = setTimer(() => {
      idleTimer = null;
      void close();
    }, idleMs);
  }

  return {
    async play(ref, volume) {
      active++;
      try {
        await ensureDocument();
        await deps.sendMessage({ target: OFFSCREEN_TARGET, type: 'play', sound: ref, volume });
      } finally {
        active--;
        scheduleIdleClose();
      }
    },
    close,
  };
}

/** Plays directly in a DOM context (Firefox background page). Bounded by the throttle wrapper. */
export function createAudioElementPlayer(deps: PlayInPageDeps = {}): SoundPlayer {
  let current: PlayHandle | null = null;
  return {
    async play(ref, volume) {
      current?.stop();
      const handle = await playInPage(ref, volume, deps);
      current = handle;
      void handle.done.then(() => {
        if (current === handle) current = null;
      });
    },
  };
}

export interface SoundSinkDeps {
  player: SoundPlayer;
  getSettings(): Promise<Settings>;
}

export function createSoundSink(deps: SoundSinkDeps): NotificationSink {
  return async (item) => {
    const settings = await deps.getSettings();
    if (!soundEnabledFor(settings, item.kind)) return;
    const ref = resolveSoundRef(soundIdFor(settings, item.kind));
    if (!ref) return;
    await deps.player.play(ref, settings.notifications.volume);
  };
}
