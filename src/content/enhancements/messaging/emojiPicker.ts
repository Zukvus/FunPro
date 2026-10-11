/**
 * Emoji picker for the FunPay chat box: search (English / Russian keywords), categories and the
 * seller's recently used emojis. Picking inserts at the caret; nothing is ever sent.
 *
 * Keyboard: the toggle opens a dialog and focuses the search box; ↓ moves into the grid; arrow
 * keys / Home / End move between emojis (roving tabindex); Enter or Space picks; Esc closes and
 * returns focus to the text box.
 */
import { EMOJI_CATEGORIES, emojiName, resolveRecent, searchEmojis, type Emoji, type EmojiCategory } from '@/features/messages/emoji';
import { h } from './dom';
import type { PageLang, PageT, StringKey } from './strings';
import { CLS, EMOJI_GRID_COLUMNS } from './styles';

type Tab = 'recent' | EmojiCategory;

const TAB_ICON: Record<Tab, string> = {
  recent: '🕘',
  smileys: '😀',
  gestures: '👋',
  hearts: '💜',
  nature: '🌿',
  food: '🍕',
  activities: '🎮',
  travel: '🚀',
  objects: '💡',
  symbols: '✅',
};

const PANEL_ID = 'funpro-msg-emoji-panel';
const TITLE_ID = 'funpro-msg-emoji-title';

export interface EmojiPickerOptions {
  doc: Document;
  root: HTMLElement;
  toggle: HTMLButtonElement;
  textarea: HTMLTextAreaElement;
  t: PageT;
  lang: PageLang;
  signal: AbortSignal;
  recent: () => readonly string[];
  onPick: (char: string) => void;
}

export class EmojiPicker {
  private readonly panel: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly title: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly tabs = new Map<Tab, HTMLButtonElement>();
  private tab: Tab = 'smileys';
  private isOpen = false;

  constructor(private readonly o: EmojiPickerOptions) {
    const { doc, t, toggle, signal } = o;
    this.panel = h(doc, 'div', { class: `${CLS.pop} ${CLS.emoji}`, role: 'dialog', id: PANEL_ID, 'aria-label': t('emojiDialog'), hidden: true });
    this.search = h(doc, 'input', { type: 'search', class: CLS.emojiSearch, 'aria-label': t('emojiSearch'), placeholder: t('emojiSearch'), autocomplete: 'off', spellcheck: 'false' });
    const cats = h(doc, 'div', { class: CLS.emojiCats, role: 'toolbar', 'aria-label': t('emojiDialog') });
    for (const tab of ['recent', ...EMOJI_CATEGORIES] as Tab[]) {
      const label = t(tab === 'recent' ? 'emojiRecent' : (`cat.${tab}` as StringKey));
      const b = h(doc, 'button', { type: 'button', class: CLS.emojiCat, 'aria-label': label, title: label, 'aria-pressed': 'false' }, TAB_ICON[tab]);
      b.addEventListener('click', () => this.selectTab(tab), { signal });
      this.tabs.set(tab, b);
      cats.append(b);
    }
    this.title = h(doc, 'div', { class: CLS.emojiTitle, id: TITLE_ID });
    this.grid = h(doc, 'div', { class: CLS.emojiGrid, role: 'group', 'aria-labelledby': TITLE_ID });
    this.panel.append(this.search, cats, this.title, this.grid);
    o.root.append(this.panel);

    toggle.setAttribute('aria-haspopup', 'dialog');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', PANEL_ID);
    toggle.addEventListener('click', () => (this.isOpen ? this.close(true) : this.open()), { signal });
    this.search.addEventListener('input', () => this.render(), { signal });
    this.search.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'ArrowDown' || (e.key === 'Enter' && this.search.value.trim())) {
          e.preventDefault();
          this.focusItem(0);
        }
      },
      { signal },
    );
    this.grid.addEventListener('click', (e) => {
      const btn = (e.target as Element | null)?.closest<HTMLButtonElement>(`.${CLS.emojiItem}`);
      if (btn?.dataset['char']) o.onPick(btn.dataset['char']);
    }, { signal });
    this.grid.addEventListener('keydown', (e) => this.onGridKey(e), { signal });
    this.panel.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.close(true);
        }
      },
      { signal },
    );
    // Click outside closes (capture, so FunPay handlers cannot swallow it first).
    doc.addEventListener(
      'mousedown',
      (e) => {
        if (!this.isOpen) return;
        const target = e.target as Node | null;
        if (target && (this.panel.contains(target) || o.toggle.contains(target))) return;
        this.close(false);
      },
      { capture: true, signal },
    );
  }

  destroy(): void {
    this.close(false);
    this.panel.remove();
  }

  open(): void {
    this.search.value = '';
    this.tab = this.o.recent().length > 0 ? 'recent' : 'smileys';
    this.render();
    this.isOpen = true;
    this.panel.hidden = false;
    this.o.toggle.setAttribute('aria-expanded', 'true');
    this.search.focus();
  }

  close(focusTextarea: boolean): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.panel.hidden = true;
    this.o.toggle.setAttribute('aria-expanded', 'false');
    if (focusTextarea) this.o.textarea.focus();
  }

  /** Re-render after the recent list changed (keeps the current view). */
  refresh(): void {
    if (this.isOpen && this.tab === 'recent' && !this.search.value.trim()) this.render();
  }

  private selectTab(tab: Tab): void {
    this.tab = tab;
    this.search.value = '';
    this.render();
  }

  private render(): void {
    const { doc, t, lang } = this.o;
    const q = this.search.value.trim();
    let items: Emoji[];
    if (q) {
      items = searchEmojis(q, { limit: 160 });
      this.title.textContent = t('emojiSearch');
    } else if (this.tab === 'recent') {
      items = resolveRecent(this.o.recent());
      this.title.textContent = t('emojiRecent');
    } else {
      items = searchEmojis('', { category: this.tab, limit: 600 });
      this.title.textContent = t(`cat.${this.tab}` as StringKey);
    }
    for (const [tab, b] of this.tabs) b.setAttribute('aria-pressed', String(!q && tab === this.tab));
    if (items.length === 0) {
      this.grid.replaceChildren(h(doc, 'div', { class: CLS.emojiEmpty }, t('emojiNone')));
      return;
    }
    this.grid.replaceChildren(
      ...items.map((e, i) => {
        const name = emojiName(e, lang) || e.char;
        const b = h(doc, 'button', { type: 'button', class: CLS.emojiItem, 'aria-label': name, title: name, tabindex: i === 0 ? '0' : '-1' }, e.char);
        b.dataset['char'] = e.char;
        return b;
      }),
    );
  }

  private items(): HTMLButtonElement[] {
    return Array.from(this.grid.querySelectorAll<HTMLButtonElement>(`.${CLS.emojiItem}`));
  }

  private focusItem(index: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const i = Math.max(0, Math.min(index, items.length - 1));
    items.forEach((b, j) => b.setAttribute('tabindex', j === i ? '0' : '-1'));
    items[i]!.focus();
  }

  private onGridKey(e: KeyboardEvent): void {
    const items = this.items();
    const current = items.indexOf(this.o.doc.activeElement as HTMLButtonElement);
    if (current < 0) return;
    const moves: Record<string, number> = {
      ArrowRight: current + 1,
      ArrowLeft: current - 1,
      ArrowDown: current + EMOJI_GRID_COLUMNS,
      ArrowUp: current - EMOJI_GRID_COLUMNS,
      Home: 0,
      End: items.length - 1,
    };
    const next = moves[e.key];
    if (next === undefined) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && next < 0) {
      this.search.focus();
      return;
    }
    this.focusItem(next);
  }
}
