import { fakeBrowser } from 'wxt/testing/fake-browser';
import { describe, expect, it } from 'vitest';
import { getSettings, updateSettings, watchSettings } from '@/core/settings/store';

describe('appearance settings persistence (browser.storage.local round trip)', () => {
  it('persists theme, density, font scale, motion, contrast, accent and nickname', async () => {
    await updateSettings({
      appearance: {
        theme: 'aurora',
        density: 'spacious',
        fontScale: 1.2,
        reducedMotion: true,
        highContrast: true,
        accentColor: '#0f766e',
        nickname: { enabled: true, color: '#ff0066', gradientTo: '#00ccff', font: 'rounded', bold: false },
        profileBadge: 'Fast delivery',
      },
      shortcuts: { commandPalette: 'Ctrl+Shift+P' },
    });
    // What actually sits in storage.local (what another context would read).
    const raw = (await fakeBrowser.storage.local.get('settings'))['settings'] as { appearance: Record<string, unknown> };
    expect(raw.appearance).toMatchObject({ theme: 'aurora', density: 'spacious', fontScale: 1.2, accentColor: '#0f766e' });
    const s = await getSettings();
    expect(s.appearance).toMatchObject({ theme: 'aurora', density: 'spacious', fontScale: 1.2, reducedMotion: true, highContrast: true, profileBadge: 'Fast delivery' });
    expect(s.appearance.nickname).toEqual({ enabled: true, color: '#ff0066', gradientTo: '#00ccff', font: 'rounded', bold: false });
    expect(s.shortcuts.commandPalette).toBe('Ctrl+Shift+P');
  });

  it('keeps other sections when patching appearance', async () => {
    await updateSettings({ privacy: { privacyMode: true } });
    await updateSettings({ appearance: { theme: 'mono' } });
    const s = await getSettings();
    expect(s.privacy.privacyMode).toBe(true);
    expect(s.appearance.theme).toBe('mono');
  });

  it('falls back to defaults for an invalid stored appearance section only', async () => {
    await fakeBrowser.storage.local.set({ settings: { appearance: { theme: 'neon', fontScale: 9 }, privacy: { privacyMode: true } } });
    const s = await getSettings();
    expect(s.appearance.theme).toBe('system');
    expect(s.appearance.fontScale).toBe(1);
    expect(s.privacy.privacyMode).toBe(true);
  });

  it('rejects invalid colours and out-of-range values', async () => {
    await expect(updateSettings({ appearance: { accentColor: 'red' } })).rejects.toBeTruthy();
    await expect(updateSettings({ appearance: { fontScale: 3 } })).rejects.toBeTruthy();
    await expect(updateSettings({ appearance: { profileBadge: 'x'.repeat(41) } })).rejects.toBeTruthy();
    expect((await getSettings()).appearance.accentColor).toBeNull();
  });

  it('notifies watchers (other pages, the funpay.com content script) of changes', async () => {
    const seen: string[] = [];
    const unwatch = watchSettings((s) => seen.push(s.appearance.theme));
    await updateSettings({ appearance: { theme: 'forest' } });
    await updateSettings({ appearance: { theme: 'sunset' } });
    unwatch();
    expect(seen).toEqual(['forest', 'sunset']);
  });

  it('records the changelog version the user has seen', async () => {
    await updateSettings({ general: { changelogSeenVersion: '0.1.0' } });
    expect((await getSettings()).general.changelogSeenVersion).toBe('0.1.0');
  });
});
