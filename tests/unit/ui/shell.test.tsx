import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDbForTests } from '@/core/db/db';
import { updateSettings } from '@/core/settings/store';
import { App } from '@/dashboard/App';

beforeEach(() => {
  resetDbForTests();
  fakeBrowser.runtime.getManifest = vi.fn(() => ({ manifest_version: 3, name: 'FunPro', version: '0.2.0' })) as never;
});

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('dashboard shell', () => {
  it('opens the onboarding guide on first run', async () => {
    window.location.hash = '';
    render(<App />);
    await waitFor(() => expect(window.location.hash).toBe('#/welcome'));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Welcome to FunPro' })).toBeTruthy());
  });

  it('does not redirect deep links or completed installs', async () => {
    await updateSettings({ general: { onboardingCompleted: true, changelogSeenVersion: '0.2.0' } });
    window.location.hash = '#/about';
    render(<App />);
    await waitFor(() => expect(screen.getByText('Version 0.2.0')).toBeTruthy());
    expect(window.location.hash).toBe('#/about');
  });

  it('has a working skip link and a labelled main navigation', async () => {
    await updateSettings({ general: { onboardingCompleted: true } });
    window.location.hash = '#/about';
    render(<App />);
    const skip = screen.getByText('Skip to main content');
    fireEvent.click(skip);
    expect(document.activeElement?.id).toBe('fp-main');
    expect(window.location.hash).toBe('#/about');
    expect(screen.getByRole('navigation', { name: 'Main navigation' })).toBeTruthy();
  });

  it('opens the command palette with the configured shortcut (any keyboard layout)', async () => {
    await updateSettings({ general: { onboardingCompleted: true }, shortcuts: { commandPalette: 'Ctrl+Shift+P' } });
    window.location.hash = '#/about';
    render(<App />);
    await waitFor(() => expect(screen.getByTitle('Command palette').textContent).toContain('P'));
    act(() => {
      fireEvent.keyDown(window, { key: 'k', code: 'KeyK', ctrlKey: true });
    });
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).toBeNull();
    act(() => {
      fireEvent.keyDown(window, { key: 'З', code: 'KeyP', ctrlKey: true, shiftKey: true });
    });
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
  });

  it('shows a "new" badge on About after an update', async () => {
    await updateSettings({ general: { onboardingCompleted: true, changelogSeenVersion: '0.1.0' } });
    window.location.hash = '#/automation';
    render(<App />);
    await waitFor(() => expect(screen.getByRole('link', { name: /About & updates/ }).textContent).toContain('New'));
  });
});
