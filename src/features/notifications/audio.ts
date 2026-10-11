/**
 * Plays one notification sound inside a document that has `Audio` (the Chrome offscreen document,
 * the Firefox background page, or the dashboard for previews). Custom sounds are read from
 * db.assets and played through a blob URL that is always revoked; playback is capped in length.
 */
import { browser } from 'wxt/browser';
import { z } from 'zod';
import { getDb } from '@/core/db/db';
import { BUILTIN_SOUND_IDS, isBuiltinSoundPath, type SoundRef } from './sounds';

export const OFFSCREEN_TARGET = 'funpro-offscreen';
/** Longest a notification sound may play (uploaded files can be long). */
export const MAX_PLAYBACK_MS = 10_000;

export const OffscreenPlaySchema = z.object({
  target: z.literal(OFFSCREEN_TARGET),
  type: z.literal('play'),
  sound: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('builtin'), id: z.enum(BUILTIN_SOUND_IDS), path: z.string().max(64).refine(isBuiltinSoundPath) }),
    z.object({ kind: z.literal('custom'), assetId: z.string().regex(/^[\w-]{1,80}$/) }),
  ]),
  volume: z.number().min(0).max(1),
});
export type OffscreenPlayMessage = z.infer<typeof OffscreenPlaySchema>;

export function extensionUrl(path: string): string {
  return (browser.runtime.getURL as (p: string) => string)(path);
}

export interface PlayHandle {
  /** Resolves when playback finished, failed or was cut off. */
  done: Promise<void>;
  stop(): void;
}

export interface PlayInPageDeps {
  createAudio?: (src: string) => HTMLAudioElement;
  loadAsset?: (assetId: string) => Promise<Blob | null>;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  maxPlaybackMs?: number;
}

async function defaultLoadAsset(assetId: string): Promise<Blob | null> {
  const rec = await getDb().assets.get(assetId);
  return rec && rec.kind === 'sound' ? rec.blob : null;
}

/** Starts playback; rejects when the sound cannot be loaded or the browser refuses to play it. */
export async function playInPage(ref: SoundRef, volume: number, deps: PlayInPageDeps = {}): Promise<PlayHandle> {
  const createAudio = deps.createAudio ?? ((src: string) => new Audio(src));
  const revokeUrl = deps.revokeObjectUrl ?? ((u: string) => URL.revokeObjectURL(u));
  let src: string;
  let objectUrl: string | null = null;
  if (ref.kind === 'builtin') {
    if (!isBuiltinSoundPath(ref.path)) throw new Error('Unknown built-in sound');
    src = extensionUrl(ref.path);
  } else {
    const blob = await (deps.loadAsset ?? defaultLoadAsset)(ref.assetId);
    if (!blob) throw new Error('Custom sound not found');
    objectUrl = (deps.createObjectUrl ?? ((b: Blob) => URL.createObjectURL(b)))(blob);
    src = objectUrl;
  }
  const audio = createAudio(src);
  audio.volume = Math.min(1, Math.max(0, volume));
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    clearTimeout(timer);
    audio.removeEventListener('ended', cleanup);
    audio.removeEventListener('error', cleanup);
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch {
      /* element already gone */
    }
    if (objectUrl) revokeUrl(objectUrl);
    finish();
  };
  const timer = setTimeout(cleanup, deps.maxPlaybackMs ?? MAX_PLAYBACK_MS);
  audio.addEventListener('ended', cleanup);
  audio.addEventListener('error', cleanup);
  try {
    await audio.play();
  } catch (e) {
    cleanup();
    throw e instanceof Error ? e : new Error('Playback failed');
  }
  return { done, stop: cleanup };
}
