import { describe, expect, it } from 'vitest';
import { formatShortcut, matchesShortcut, parseShortcut, shortcutFromEvent, shortcutParts, validateShortcut, type KeyEventLike } from '@/features/appearance/shortcuts';

const ev = (over: Partial<KeyEventLike>): KeyEventLike => ({ key: '', code: '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...over });

describe('shortcut parsing', () => {
  it('parses and normalises common forms', () => {
    expect(parseShortcut('Ctrl+K')).toEqual({ ctrl: true, alt: false, shift: false, meta: false, key: 'k' });
    expect(formatShortcut(parseShortcut('shift+ctrl+p')!)).toBe('Ctrl+Shift+P');
    expect(formatShortcut(parseShortcut('Mod+/')!)).toBe('Ctrl+/');
    expect(formatShortcut(parseShortcut('Alt+F2')!)).toBe('Alt+F2');
    expect(formatShortcut(parseShortcut('Cmd+Space')!)).toBe('Meta+Space');
    expect(shortcutParts('ctrl+k')).toEqual(['Ctrl', 'K']);
  });

  it('rejects malformed shortcuts', () => {
    for (const bad of ['', 'Ctrl+', '+K', 'Ctrl+Hyper+K', 'Ctrl+KK', 'Ctrl++', 'x'.repeat(50)]) expect(parseShortcut(bad)).toBeNull();
  });
});

describe('shortcut matching', () => {
  const ctrlK = parseShortcut('Ctrl+K');

  it('matches Ctrl or ⌘ with K', () => {
    expect(matchesShortcut(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), ctrlK)).toBe(true);
    expect(matchesShortcut(ev({ key: 'k', code: 'KeyK', metaKey: true }), ctrlK)).toBe(true);
  });

  it('is layout independent (Russian layout produces "л" for the K key)', () => {
    expect(matchesShortcut(ev({ key: 'л', code: 'KeyK', ctrlKey: true }), ctrlK)).toBe(true);
  });

  it('requires the exact modifier set', () => {
    expect(matchesShortcut(ev({ key: 'k', code: 'KeyK' }), ctrlK)).toBe(false);
    expect(matchesShortcut(ev({ key: 'K', code: 'KeyK', ctrlKey: true, shiftKey: true }), ctrlK)).toBe(false);
    expect(matchesShortcut(ev({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true }), ctrlK)).toBe(false);
    expect(matchesShortcut(ev({ key: 'j', code: 'KeyJ', ctrlKey: true }), ctrlK)).toBe(false);
    expect(matchesShortcut(ev({ key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true }), parseShortcut('Ctrl+Shift+P'))).toBe(true);
  });

  it('records shortcuts from key presses, ignoring lone modifiers', () => {
    expect(shortcutFromEvent(ev({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toBeNull();
    expect(formatShortcut(shortcutFromEvent(ev({ key: 'л', code: 'KeyK', ctrlKey: true }))!)).toBe('Ctrl+K');
    expect(formatShortcut(shortcutFromEvent(ev({ key: 'k', code: 'KeyK', metaKey: true }))!)).toBe('Ctrl+K');
  });
});

describe('shortcut validation', () => {
  it('requires a modifier (except function keys) and refuses reserved combinations', () => {
    expect(validateShortcut('Ctrl+K')).toEqual({ ok: true, normalized: 'Ctrl+K' });
    expect(validateShortcut('F2')).toEqual({ ok: true, normalized: 'F2' });
    expect(validateShortcut('K')).toEqual({ ok: false, problem: 'no_modifier' });
    expect(validateShortcut('Shift+K')).toEqual({ ok: false, problem: 'no_modifier' });
    expect(validateShortcut('ctrl+w')).toEqual({ ok: false, problem: 'reserved' });
    expect(validateShortcut('Alt+Shift+S')).toEqual({ ok: false, problem: 'reserved' });
    expect(validateShortcut('nonsense+')).toEqual({ ok: false, problem: 'invalid' });
  });
});
