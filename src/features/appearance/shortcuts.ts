/**
 * Keyboard shortcut parsing/matching for in-page shortcuts (the dashboard command palette).
 *
 * Shortcuts are stored as text such as "Ctrl+K" or "Ctrl+Shift+P". Matching is layout independent
 * for letters and digits (uses `KeyboardEvent.code`), so "Ctrl+K" also works while a Russian or
 * Ukrainian layout is active (where `event.key` would be "л"). "Ctrl" also accepts ⌘ (Meta) so the
 * same setting works on macOS.
 *
 * Browser-level extension commands (emergency stop, open dashboard) are NOT handled here — the
 * browser owns those bindings (chrome://extensions/shortcuts, about:addons).
 */
export interface Shortcut {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** Normalised key: lower-case letter/digit/punctuation, or a named key like "f2", "enter", "space". */
  key: string;
}

export interface KeyEventLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const NAMED_KEYS: Record<string, string> = {
  enter: 'enter',
  return: 'enter',
  esc: 'escape',
  escape: 'escape',
  space: 'space',
  ' ': 'space',
  spacebar: 'space',
  tab: 'tab',
  backspace: 'backspace',
  delete: 'delete',
  del: 'delete',
  insert: 'insert',
  home: 'home',
  end: 'end',
  pageup: 'pageup',
  pagedown: 'pagedown',
  arrowup: 'arrowup',
  arrowdown: 'arrowdown',
  arrowleft: 'arrowleft',
  arrowright: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  slash: '/',
  period: '.',
  comma: ',',
  semicolon: ';',
  minus: '-',
  equal: '=',
  backquote: '`',
  bracketleft: '[',
  bracketright: ']',
};

const PUNCTUATION = new Set(['/', '.', ',', ';', '-', '=', '`', '[', ']', "'", '\\']);
const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta', 'os', 'altgraph', 'capslock', 'fn', 'hyper', 'super']);

function normaliseKey(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  if (!k) return null;
  if (NAMED_KEYS[k]) return NAMED_KEYS[k]!;
  if (/^f([1-9]|1[0-2])$/.test(k)) return k;
  if (/^[a-z0-9]$/.test(k)) return k;
  if (PUNCTUATION.has(k)) return k;
  return null;
}

export function parseShortcut(text: string | null | undefined): Shortcut | null {
  if (!text) return null;
  const raw = text.trim();
  if (!raw || raw.length > 40) return null;
  // Split on "+" but allow "+" itself only as a key at the end ("Ctrl+Plus" is not supported).
  const parts = raw.split('+').map((p) => p.trim());
  if (parts.some((p) => p === '')) return null;
  const s: Shortcut = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!.toLowerCase();
    const last = i === parts.length - 1;
    if (!last) {
      if (p === 'ctrl' || p === 'control' || p === 'mod') s.ctrl = true;
      else if (p === 'alt' || p === 'option' || p === 'opt') s.alt = true;
      else if (p === 'shift') s.shift = true;
      else if (p === 'meta' || p === 'cmd' || p === 'command' || p === 'win' || p === 'super') s.meta = true;
      else return null;
    } else {
      const key = normaliseKey(p);
      if (!key) return null;
      s.key = key;
    }
  }
  return s.key ? s : null;
}

const DISPLAY_KEYS: Record<string, string> = {
  enter: 'Enter',
  escape: 'Esc',
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
};

/** Canonical text form, e.g. "Ctrl+Shift+K". */
export function formatShortcut(s: Shortcut): string {
  const parts: string[] = [];
  if (s.ctrl) parts.push('Ctrl');
  if (s.meta) parts.push('Meta');
  if (s.alt) parts.push('Alt');
  if (s.shift) parts.push('Shift');
  parts.push(DISPLAY_KEYS[s.key] ?? s.key.toUpperCase());
  return parts.join('+');
}

/** Split for rendering with <Kbd>: ["Ctrl", "K"]. */
export function shortcutParts(text: string): string[] {
  const s = parseShortcut(text);
  return s ? formatShortcut(s).split('+') : [];
}

/** Key from the physical key code (layout independent) for letters and digits. */
function keyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!.toLowerCase();
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  const named: Record<string, string> = {
    Slash: '/',
    Period: '.',
    Comma: ',',
    Semicolon: ';',
    Minus: '-',
    Equal: '=',
    Backquote: '`',
    BracketLeft: '[',
    BracketRight: ']',
    Quote: "'",
    Backslash: '\\',
  };
  return named[code] ?? null;
}

export function matchesShortcut(e: KeyEventLike, s: Shortcut | null): boolean {
  if (!s) return false;
  const primary = e.ctrlKey || e.metaKey;
  if (s.ctrl) {
    if (!primary) return false;
    // "Ctrl+Meta+X" requires both; plain "Ctrl+X" accepts either.
    if (s.meta && !(e.ctrlKey && e.metaKey)) return false;
  } else if (s.meta) {
    if (!e.metaKey || e.ctrlKey) return false;
  } else if (primary) {
    return false;
  }
  if (e.altKey !== s.alt || e.shiftKey !== s.shift) return false;
  const fromCode = keyFromCode(e.code);
  if (fromCode !== null && fromCode === s.key) return true;
  return normaliseKey(e.key) === s.key;
}

/** Build a shortcut from a key press (for "press the new shortcut" recorders). Null for lone modifiers. */
export function shortcutFromEvent(e: KeyEventLike): Shortcut | null {
  if (MODIFIER_KEYS.has(e.key.toLowerCase())) return null;
  const key = keyFromCode(e.code) ?? normaliseKey(e.key);
  if (!key) return null;
  // ⌘ on macOS is recorded as the cross-platform primary modifier ("Ctrl" matches ⌘ too).
  return { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey, meta: false, key };
}

/** Combinations the browser reserves or that break basic editing; pages cannot (or should not) take them. */
export const RESERVED_SHORTCUTS = [
  'Ctrl+W',
  'Ctrl+T',
  'Ctrl+N',
  'Ctrl+Q',
  'Ctrl+Tab',
  'Ctrl+Shift+T',
  'Ctrl+Shift+N',
  'Ctrl+Shift+W',
  'Ctrl+Shift+Q',
  'Ctrl+L',
  'Ctrl+R',
  'Ctrl+F',
  'Ctrl+P',
  'Ctrl+S',
  'Ctrl+D',
  'Ctrl+H',
  'Ctrl+J',
  'Ctrl+A',
  'Ctrl+C',
  'Ctrl+V',
  'Ctrl+X',
  'Ctrl+Z',
  'Ctrl+Y',
  'Alt+F4',
  // FunPro's own browser-level commands (manifest `commands`).
  'Alt+Shift+S',
  'Alt+Shift+F',
];

export type ShortcutProblem = 'invalid' | 'no_modifier' | 'reserved';

export function validateShortcut(text: string): { ok: true; normalized: string } | { ok: false; problem: ShortcutProblem } {
  const s = parseShortcut(text);
  if (!s) return { ok: false, problem: 'invalid' };
  const isFunctionKey = /^f\d+$/.test(s.key);
  if (!s.ctrl && !s.alt && !s.meta && !isFunctionKey) return { ok: false, problem: 'no_modifier' };
  const normalized = formatShortcut(s);
  if (RESERVED_SHORTCUTS.includes(normalized)) return { ok: false, problem: 'reserved' };
  return { ok: true, normalized };
}

export const DEFAULT_PALETTE_SHORTCUT = 'Ctrl+K';
