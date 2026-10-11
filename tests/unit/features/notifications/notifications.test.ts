import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { defaultSettings, mergeSettings, type Settings, type SettingsPatch } from '@/core/settings/schema';
import {
  addCustomSound,
  clearSinksForTests,
  createClickTargetStore,
  createDesktopSink,
  createOffscreenPlayer,
  createSoundSink,
  createThrottledPlayer,
  desktopEnabledFor,
  filterNotifications,
  handleDesktopClick,
  markAllNotificationsRead,
  MAX_CUSTOM_SOUNDS,
  notificationForEvent,
  notify,
  openableUrl,
  playInPage,
  pruneNotificationDedupe,
  registerSink,
  resolveSoundRef,
  soundEnabledFor,
  soundIdFor,
  validateSoundFile,
  wantsPriceNotifications,
  type ClickTarget,
  type DesktopNotificationOptions,
  type SoundPlayer,
} from '@/features/notifications';
import type { DomainEvent, NotificationItem } from '@/shared/models';

const EXT = 'chrome-extension://abc';

function settings(patch: SettingsPatch = {}): Settings {
  return mergeSettings(mergeSettings(defaultSettings(), { general: { language: 'en' } }), patch);
}

function memoryStorage() {
  let value: Record<string, ClickTarget> = {};
  return {
    getValue: async () => value,
    setValue: async (v: Record<string, ClickTarget>) => {
      value = v;
    },
    peek: () => value,
  };
}

function desktopApi() {
  const created: [string, DesktopNotificationOptions][] = [];
  return {
    created,
    api: {
      create: vi.fn(async (id: string, o: DesktopNotificationOptions) => {
        created.push([id, o]);
        return id;
      }),
      clear: vi.fn(async () => true),
    },
  };
}

function event(type: DomainEvent['type'], payload: Record<string, unknown>, id = `${type}:x`): DomainEvent {
  return { id, type, at: new Date().toISOString(), payload, handledBy: [] };
}

beforeEach(() => {
  resetDbForTests();
  clearSinksForTests();
});

describe('notify fan-out', () => {
  it('records in the center and dedupes by key within 24 h', async () => {
    const sink = vi.fn();
    registerSink('test', sink);
    expect(
      await notify({ kind: 'order', title: 'New order', body: 'x', dedupeKey: 'order:A' }),
    ).not.toBeNull();
    expect(await notify({ kind: 'order', title: 'New order', body: 'x', dedupeKey: 'order:A' })).toBeNull();
    expect(sink).toHaveBeenCalledTimes(1);
    expect(await getDb().notifications.count()).toBe(1);
  });

  it('honours `silent` and the `sinks` allow-list, and isolates failing sinks', async () => {
    const a = vi.fn();
    const b = vi.fn(() => {
      throw new Error('boom');
    });
    const c = vi.fn();
    registerSink('a', a);
    registerSink('b', b);
    registerSink('c', c);
    await notify({ kind: 'system', title: 't', body: '', silent: true });
    expect(a).not.toHaveBeenCalled();
    await notify({ kind: 'system', title: 't', body: '', sinks: ['b', 'c'] });
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
    expect(c).toHaveBeenCalledTimes(1);
  });

  it('prunes expired dedupe markers', async () => {
    await getDb().kv.bulkPut([
      { key: 'notif:old', value: Date.now() - 25 * 3600_000 },
      { key: 'notif:new', value: Date.now() },
      { key: 'other', value: 1 },
    ]);
    expect(await pruneNotificationDedupe()).toBe(1);
    expect(await getDb().kv.get('notif:new')).toBeDefined();
    expect(await getDb().kv.get('other')).toBeDefined();
  });

  it('filters and bulk-marks the notification center', async () => {
    await notify({ kind: 'order', title: 'New order', body: 'Elden Ring key' });
    await notify({ kind: 'message', title: 'New message', body: 'hello' });
    const items = await getDb().notifications.toArray();
    expect(filterNotifications(items, { query: 'elden', kind: 'all', unreadOnly: false })).toHaveLength(1);
    expect(filterNotifications(items, { query: '', kind: 'message', unreadOnly: true })).toHaveLength(1);
    expect(await markAllNotificationsRead()).toBe(2);
    expect(
      filterNotifications(await getDb().notifications.toArray(), {
        query: '',
        kind: 'all',
        unreadOnly: true,
      }),
    ).toHaveLength(0);
  });
});

describe('desktop sink', () => {
  const item = (
    kind: NotificationItem['kind'],
    url: string | null = 'https://funpay.com/orders/ABC/',
  ): NotificationItem => ({ id: `n_${kind}`, at: 1, kind, title: 'Title', body: 'Body', url, read: false });

  it('respects the master switch and per-kind toggles', async () => {
    const { api, created } = desktopApi();
    let s = settings();
    const sink = createDesktopSink({
      api,
      getSettings: async () => s,
      iconUrl: 'icon.png',
      clickStore: createClickTargetStore(memoryStorage()),
      extensionOrigin: EXT,
      chromeOptions: true,
    });
    await sink(item('order'), { kind: 'order', title: '', body: '' });
    expect(created).toHaveLength(1);
    expect(created[0]![1]).toMatchObject({
      type: 'basic',
      title: 'Title',
      message: 'Body',
      iconUrl: 'icon.png',
      silent: true,
      priority: 2,
    });
    s = settings({ notifications: { onOrder: false } });
    await sink(item('order'), { kind: 'order', title: '', body: '' });
    s = settings({ notifications: { desktop: false } });
    await sink(item('message'), { kind: 'message', title: '', body: '' });
    expect(created).toHaveLength(1);
    expect(desktopEnabledFor(settings(), 'price')).toBe(false);
    expect(desktopEnabledFor(settings(), 'system')).toBe(true);
  });

  it('omits Chrome-only options for Firefox', async () => {
    const { api, created } = desktopApi();
    const sink = createDesktopSink({
      api,
      getSettings: async () => settings(),
      iconUrl: 'i',
      clickStore: createClickTargetStore(memoryStorage()),
      extensionOrigin: EXT,
      chromeOptions: false,
    });
    await sink(item('message'), { kind: 'message', title: '', body: '' });
    expect(created[0]![1]).not.toHaveProperty('silent');
    expect(created[0]![1]).not.toHaveProperty('priority');
  });

  it('maps clicks to safe URLs only and forgets them afterwards', async () => {
    const storage = memoryStorage();
    const store = createClickTargetStore(storage);
    const { api } = desktopApi();
    const sink = createDesktopSink({
      api,
      getSettings: async () => settings(),
      iconUrl: 'i',
      clickStore: store,
      extensionOrigin: EXT,
      chromeOptions: true,
    });
    await sink(item('order'), { kind: 'order', title: '', body: '' });
    await sink(
      { ...item('failure', 'https://evil.example/'), id: 'evil' },
      { kind: 'failure', title: '', body: '' },
    );
    expect(Object.keys(storage.peek())).toEqual(['n_order']);
    const opened: string[] = [];
    const ok = await handleDesktopClick('n_order', {
      clickStore: store,
      api,
      extensionOrigin: EXT,
      openUrl: async (u) => void opened.push(u),
    });
    expect(ok).toBe(true);
    expect(opened).toEqual(['https://funpay.com/orders/ABC/']);
    expect(api.clear).toHaveBeenCalledWith('n_order');
    expect(
      await handleDesktopClick('n_order', {
        clickStore: store,
        api,
        extensionOrigin: EXT,
        openUrl: async (u) => void opened.push(u),
      }),
    ).toBe(false);
    expect(openableUrl(`${EXT}/options.html#/inventory`, EXT)).toBe(`${EXT}/options.html#/inventory`);
    expect(openableUrl('/orders/ABC/', EXT)).toBeNull();
    expect(openableUrl('javascript:alert(1)', EXT)).toBeNull();
  });

  it('keeps the click-target map bounded', async () => {
    const storage = memoryStorage();
    const store = createClickTargetStore(storage, 3);
    await Promise.all([1, 2, 3, 4, 5].map((i) => store.remember(`n${i}`, 'https://funpay.com/', i)));
    expect(Object.keys(storage.peek()).sort()).toEqual(['n3', 'n4', 'n5']);
  });
});

describe('sounds', () => {
  it('validates uploads (audio/* only, at most 1 MB)', async () => {
    expect(validateSoundFile({ type: 'audio/mpeg', size: 1000 })).toEqual({ ok: true });
    expect(validateSoundFile({ type: 'audio/wav', size: 1024 * 1024 + 1 })).toEqual({
      ok: false,
      error: 'too_large',
    });
    expect(validateSoundFile({ type: 'image/png', size: 10 })).toEqual({ ok: false, error: 'not_audio' });
    expect(validateSoundFile({ type: 'audio/ogg', size: 0 })).toEqual({ ok: false, error: 'empty' });
    await expect(addCustomSound(new Blob(['x'], { type: 'text/html' }), 'evil.html')).rejects.toThrow(
      /not_audio/,
    );
    const rec = await addCustomSound(new Blob([new Uint8Array(100)], { type: 'audio/wav' }), 'My <ding>.wav');
    expect(rec).toMatchObject({ kind: 'sound', mime: 'audio/wav', name: 'My ding' });
    expect(resolveSoundRef(`custom:${rec.id}`)).toEqual({ kind: 'custom', assetId: rec.id });
  });

  it('limits the number of custom sounds', async () => {
    for (let i = 0; i < MAX_CUSTOM_SOUNDS; i++)
      await addCustomSound(new Blob([new Uint8Array(4)], { type: 'audio/wav' }), `s${i}`);
    await expect(
      addCustomSound(new Blob([new Uint8Array(4)], { type: 'audio/wav' }), 'one more'),
    ).rejects.toThrow(/limit/);
  });

  it('resolves per-kind sounds and toggles', () => {
    const s = settings({ notifications: { messageSound: 'pop', soundKinds: { failure: true } } });
    expect(soundIdFor(s, 'message')).toBe('pop');
    expect(soundIdFor(s, 'order')).toBe('register');
    expect(soundIdFor(s, 'inventory')).toBe('alert');
    expect(soundEnabledFor(s, 'failure')).toBe(true);
    expect(soundEnabledFor(s, 'price')).toBe(false);
    expect(soundEnabledFor(settings({ notifications: { sound: false } }), 'order')).toBe(false);
    expect(soundEnabledFor(settings({ notifications: { volume: 0 } }), 'order')).toBe(false);
    expect(resolveSoundRef('chime')).toEqual({ kind: 'builtin', id: 'chime', path: '/sounds/chime.wav' });
    expect(resolveSoundRef('../../etc')).toBeNull();
  });

  it('the sound sink plays the configured sound at the configured volume', async () => {
    const play = vi.fn(async () => undefined);
    const sink = createSoundSink({
      player: { play },
      getSettings: async () => settings({ notifications: { volume: 0.3 } }),
    });
    await sink(
      { id: 'n', at: 1, kind: 'order', title: '', body: '', url: null, read: false },
      { kind: 'order', title: '', body: '' },
    );
    await sink(
      { id: 'n2', at: 1, kind: 'price', title: '', body: '', url: null, read: false },
      { kind: 'price', title: '', body: '' },
    );
    expect(play).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledWith({ kind: 'builtin', id: 'register', path: '/sounds/register.wav' }, 0.3);
  });

  it('throttles bursts instead of queueing them', async () => {
    let now = 0;
    const inner: SoundPlayer = { play: vi.fn(async () => undefined) };
    const p = createThrottledPlayer(inner, { minGapMs: 1500, now: () => now });
    const ref = resolveSoundRef('pop')!;
    await p.play(ref, 1);
    await p.play(ref, 1);
    now = 1000;
    await p.play(ref, 1);
    now = 2000;
    await p.play(ref, 1);
    expect(inner.play).toHaveBeenCalledTimes(2);
    expect(p.dropped).toBe(2);
  });

  it('creates the offscreen document once under concurrency and closes it when idle', async () => {
    let exists = false;
    let timer: (() => void) | null = null;
    const offscreen = {
      createDocument: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 5));
        exists = true;
      }),
      closeDocument: vi.fn(async () => {
        exists = false;
      }),
    };
    const sendMessage = vi.fn(async () => ({ ok: true }));
    const player = createOffscreenPlayer({
      offscreen,
      hasDocument: async () => exists,
      sendMessage,
      setTimer: (fn) => {
        timer = fn;
        return 1;
      },
      clearTimer: () => {
        timer = null;
      },
    });
    const ref = resolveSoundRef('chime')!;
    await Promise.all([player.play(ref, 0.5), player.play(ref, 0.5), player.play(ref, 0.5)]);
    expect(offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(offscreen.createDocument).toHaveBeenCalledWith({
      url: 'offscreen.html',
      reasons: ['AUDIO_PLAYBACK'],
      justification: expect.any(String),
    });
    expect(sendMessage).toHaveBeenCalledWith({
      target: 'funpro-offscreen',
      type: 'play',
      sound: ref,
      volume: 0.5,
    });
    expect(timer).not.toBeNull();
    timer!();
    await vi.waitFor(() => expect(offscreen.closeDocument).toHaveBeenCalledTimes(1));
    expect(exists).toBe(false);
  });

  it('plays custom sounds through a blob URL that is always revoked', async () => {
    const rec = await addCustomSound(new Blob([new Uint8Array(10)], { type: 'audio/wav' }), 'x');
    const listeners: Record<string, () => void> = {};
    const audio = {
      volume: 1,
      play: vi.fn(async () => undefined),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
      removeEventListener: vi.fn(),
    };
    const revoke = vi.fn();
    const handle = await playInPage({ kind: 'custom', assetId: rec.id }, 0.4, {
      createAudio: () => audio as unknown as HTMLAudioElement,
      createObjectUrl: () => 'blob:sound',
      revokeObjectUrl: revoke,
    });
    expect(audio.volume).toBe(0.4);
    listeners['ended']!();
    await handle.done;
    expect(revoke).toHaveBeenCalledWith('blob:sound');

    const failing = { ...audio, play: vi.fn(async () => Promise.reject(new Error('NotAllowedError'))) };
    const revoke2 = vi.fn();
    await expect(
      playInPage({ kind: 'custom', assetId: rec.id }, 1, {
        createAudio: () => failing as unknown as HTMLAudioElement,
        createObjectUrl: () => 'blob:2',
        revokeObjectUrl: revoke2,
      }),
    ).rejects.toThrow('NotAllowedError');
    expect(revoke2).toHaveBeenCalledWith('blob:2');
  });
});

describe('domain events → notifications', () => {
  const ctx = { dashboardUrl: (h: string) => `${EXT}/options.html${h}` };

  it('never notifies for baseline events or purchases', async () => {
    expect(
      await notificationForEvent(
        event('ORDER_PAID', { orderId: 'A', direction: 'sale', baseline: true }),
        settings(),
        ctx,
      ),
    ).toBeNull();
    expect(
      await notificationForEvent(
        event('ORDER_PAID', { orderId: 'A', direction: 'purchase' }),
        settings(),
        ctx,
      ),
    ).toBeNull();
    expect(
      await notificationForEvent(event('REVIEW_RECEIVED', { orderId: 'A', baseline: true }), settings(), ctx),
    ).toBeNull();
  });

  it('builds a "New order" notification with item, price and buyer, and a deep link', async () => {
    await getDb().orders.add({
      id: 'ABCD1234',
      direction: 'sale',
      status: 'paid',
      counterpartyName: 'Petya',
      counterpartyId: '5',
      description: 'Elden Ring key',
      categoryName: 'Steam',
      listingId: null,
      price: { amountMinor: 125000, currency: 'RUB' },
      createdAt: null,
      rawDate: '',
      firstSeenAt: '',
      updatedAt: '',
      history: [],
    });
    const n = await notificationForEvent(
      event('ORDER_PAID', { orderId: 'ABCD1234', direction: 'sale', buyer: 'Petya' }),
      settings(),
      ctx,
    );
    expect(n).toMatchObject({
      kind: 'order',
      title: 'New order',
      url: 'https://funpay.com/orders/ABCD1234/',
      dedupeKey: 'order:ABCD1234',
      meta: { orderId: 'ABCD1234', buyer: 'Petya' },
    });
    expect(n!.body).toMatch(/^Elden Ring key — .*1.?250.* · Petya$/);
    const priv = await notificationForEvent(
      event('ORDER_PAID', { orderId: 'ABCD1234', direction: 'sale', buyer: 'Petya' }),
      settings({ privacy: { privacyMode: true } }),
      ctx,
    );
    expect(priv!.body).not.toContain('Petya');
  });

  it('shows message previews only when privacy mode is off', async () => {
    const ev = event('MESSAGE_RECEIVED', {
      chatId: 'users-1-2',
      messageId: '9',
      authorName: 'Petya',
      text: 'Where is my key?',
    });
    const open = await notificationForEvent(ev, settings(), ctx);
    expect(open).toMatchObject({
      kind: 'message',
      title: 'New message from Petya',
      body: 'Where is my key?',
      url: 'https://funpay.com/chat/?node=users-1-2',
      dedupeKey: 'msg:users-1-2:9',
    });
    const hidden = await notificationForEvent(ev, settings({ privacy: { privacyMode: true } }), ctx);
    expect(hidden).toMatchObject({ title: 'New message', body: 'Open the chat to read it.' });
    expect(hidden!.meta?.preview).toBe('Where is my key?');
  });

  it('maps failures, low stock and price changes; price alerts are opt-in', async () => {
    const f = await notificationForEvent(
      event('AUTOMATION_FAILED', { feature: 'autoBump', message: 'HTTP 429' }),
      settings(),
      ctx,
    );
    expect(f).toMatchObject({
      kind: 'failure',
      title: 'Automation failed: autoBump',
      body: 'HTTP 429',
      url: `${EXT}/options.html#/logs`,
    });
    const inv = await notificationForEvent(
      event('INVENTORY_LOW', { poolName: 'Steam keys', available: 2 }),
      settings(),
      ctx,
    );
    expect(inv).toMatchObject({
      kind: 'inventory',
      body: 'Steam keys: 2 left',
      url: `${EXT}/options.html#/inventory`,
    });
    const price = await notificationForEvent(
      event('PRICE_CHANGE_DETECTED', { nodeId: '123', seller: 'Rival', from: 10000, to: 9000 }),
      settings(),
      ctx,
    );
    expect(price).toMatchObject({ kind: 'price', url: 'https://funpay.com/lots/123/' });
    expect(price!.body).toMatch(/Rival: 100 → 90/);
    expect(wantsPriceNotifications(settings())).toBe(false);
    expect(wantsPriceNotifications(settings({ notifications: { onPrice: true } }))).toBe(true);
    expect(wantsPriceNotifications(settings({ telegram: { enabled: true, notifyPrices: true } }))).toBe(true);
  });
});
