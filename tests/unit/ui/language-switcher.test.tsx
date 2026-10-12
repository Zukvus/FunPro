import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/settings/schema';
import { getSettings } from '@/core/settings/store';
import { LanguageSwitcher } from '@/dashboard/components/LanguageSwitcher';
import { useSettingsStore } from '@/ui/hooks/useSettings';

beforeEach(() => useSettingsStore.setState({ settings: defaultSettings(), loaded: true }));
afterEach(() => cleanup());

describe('language switcher (top bar)', () => {
  it('switches the interface language and saves the choice', async () => {
    render(<LanguageSwitcher />);
    const select = screen.getByLabelText('Interface language') as HTMLSelectElement;
    expect(select.value).toBe('auto');
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Auto (English)',
      'Русский',
      'English',
      'Українська',
    ]);

    fireEvent.change(select, { target: { value: 'ru' } });
    // The label follows the new language at once; the setting is persisted.
    await waitFor(() => expect(screen.getByLabelText('Язык интерфейса')).toBeTruthy());
    expect((await getSettings()).general.language).toBe('ru');

    fireEvent.change(screen.getByLabelText('Язык интерфейса'), { target: { value: 'uk' } });
    await waitFor(() => expect(screen.getByLabelText('Мова інтерфейсу')).toBeTruthy());
    expect((await getSettings()).general.language).toBe('uk');
  });

  it('uses short labels in the popup', () => {
    render(<LanguageSwitcher compact />);
    const select = screen.getByLabelText('Interface language') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Auto', 'RU', 'EN', 'UA']);
  });
});
