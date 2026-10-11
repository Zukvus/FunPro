/**
 * Slash-command quick replies: typing "/" at the very start of the chat box opens a listbox of the
 * seller's templates. ↑/↓ choose, Enter/Tab insert the rendered template, Esc closes. The menu only
 * edits the text box — sending is always the seller's own click on FunPay's Send button.
 *
 * Accessibility: the list is a `listbox` in the light DOM so the text box can point at the active
 * option with `aria-activedescendant` (IDREFs do not cross shadow roots); the count is announced
 * through a polite live region.
 */
import { findSlashMatches, parseSlashQuery } from '@/features/messages/engine';
import { AttrPatch, h, replaceRange } from './dom';
import type { PageT } from './strings';
import { CLS } from './styles';

export interface SlashTemplate {
  id: string;
  name: string;
  command: string | null;
  body: string;
}

export interface SlashMenuOptions {
  doc: Document;
  root: HTMLElement;
  textarea: HTMLTextAreaElement;
  t: PageT;
  signal: AbortSignal;
  announce: (text: string) => void;
  loadTemplates: () => Promise<SlashTemplate[]>;
  render: (tpl: SlashTemplate) => Promise<string>;
}

const LIST_ID = 'funpro-msg-slash-list';
const optionId = (i: number) => `funpro-msg-slash-opt-${i}`;

export class SlashMenu {
  private readonly pop: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly aria: AttrPatch;
  private items: SlashTemplate[] = [];
  private active = 0;
  private isOpen = false;
  private seq = 0;
  private lastAnnounced = -1;
  /** Templates are still being fetched: Enter is swallowed so "/cmd" is never sent by accident. */
  private loading = false;

  constructor(private readonly o: SlashMenuOptions) {
    const { doc, t, textarea, signal } = o;
    this.aria = new AttrPatch(textarea);
    this.pop = h(doc, 'div', { class: `${CLS.pop} ${CLS.slash}`, hidden: true });
    const head = h(doc, 'div', { class: CLS.slashHead });
    head.append(
      h(doc, 'span', {}, t('templates')),
      h(doc, 'span', { 'aria-hidden': 'true' }, t('templatesKeys')),
    );
    this.list = h(doc, 'ul', {
      class: CLS.slashList,
      role: 'listbox',
      id: LIST_ID,
      'aria-label': t('templates'),
    });
    this.pop.append(head, this.list);
    o.root.append(this.pop);

    textarea.addEventListener('input', () => void this.update(), { signal });
    textarea.addEventListener('click', () => void this.update(), { signal });
    textarea.addEventListener('blur', () => this.close(), { signal });
    textarea.form?.addEventListener('submit', () => this.close(), { signal });
    // Capture phase on window runs before FunPay's own handlers on the text box, so Enter/Tab/Esc
    // used by the menu never reach them (Enter must not send the "/command" text).
    doc.defaultView?.addEventListener('keydown', (e) => this.onKey(e), { capture: true, signal });
  }

  destroy(): void {
    this.close();
    this.pop.remove();
  }

  private async update(): Promise<void> {
    const ta = this.o.textarea;
    const caret = ta.selectionStart ?? 0;
    const q = ta.selectionStart === ta.selectionEnd ? parseSlashQuery(ta.value, caret) : null;
    if (!q) {
      this.close();
      return;
    }
    const seq = ++this.seq;
    if (!this.isOpen) this.showMessage(this.o.t('templatesLoading'));
    let templates: SlashTemplate[];
    this.loading = true;
    try {
      templates = await this.o.loadTemplates();
    } catch {
      if (seq === this.seq) this.showMessage(this.o.t('templatesError'));
      return;
    } finally {
      if (seq === this.seq) this.loading = false;
    }
    if (seq !== this.seq) return;
    this.items = findSlashMatches(templates, q.query, 8);
    this.active = Math.min(this.active, Math.max(0, this.items.length - 1));
    this.renderList();
  }

  private showMessage(text: string): void {
    this.items = [];
    this.list.replaceChildren(h(this.o.doc, 'li', { class: CLS.slashEmpty, role: 'presentation' }, text));
    this.setOpen(true);
  }

  private renderList(): void {
    const { doc, t } = this.o;
    if (this.items.length === 0) {
      this.showMessage(t('templatesNone'));
      this.announceCount(0);
      return;
    }
    const nodes = this.items.map((tpl, i) => {
      const li = h(doc, 'li', {
        class: CLS.slashOpt,
        role: 'option',
        id: optionId(i),
        'aria-selected': String(i === this.active),
      });
      li.append(
        h(doc, 'span', { class: CLS.slashCmd }, tpl.command ? `/${tpl.command}` : '/'),
        h(doc, 'span', { class: CLS.slashName }, tpl.name),
        h(doc, 'span', { class: CLS.slashBody }, tpl.body.replace(/\s+/g, ' ').slice(0, 120)),
      );
      // Keep focus in the text box while clicking an option.
      li.addEventListener('mousedown', (e) => e.preventDefault());
      li.addEventListener('click', () => void this.choose(i));
      return li;
    });
    this.list.replaceChildren(...nodes);
    this.setOpen(true);
    this.aria.set('aria-activedescendant', optionId(this.active));
    this.announceCount(this.items.length);
  }

  private announceCount(n: number): void {
    if (n === this.lastAnnounced) return;
    this.lastAnnounced = n;
    this.o.announce(n === 0 ? this.o.t('templatesNone') : this.o.t('templatesCount', { count: n }));
  }

  private setOpen(open: boolean): void {
    this.isOpen = open;
    this.pop.hidden = !open;
    if (open) {
      this.aria.set('aria-controls', LIST_ID);
      this.aria.set('aria-autocomplete', 'list');
    } else {
      this.aria.restore();
    }
  }

  close(): void {
    this.seq++;
    this.loading = false;
    this.lastAnnounced = -1;
    if (this.isOpen) this.setOpen(false);
  }

  private move(delta: number): void {
    if (this.items.length === 0) return;
    this.active = (this.active + delta + this.items.length) % this.items.length;
    this.list
      .querySelectorAll('[role="option"]')
      .forEach((el, i) => el.setAttribute('aria-selected', String(i === this.active)));
    this.aria.set('aria-activedescendant', optionId(this.active));
    this.list.querySelector(`#${optionId(this.active)}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  private async choose(i: number): Promise<void> {
    const tpl = this.items[i];
    if (!tpl) return;
    const seq = ++this.seq;
    const text = await this.o.render(tpl);
    if (seq !== this.seq) return;
    const ta = this.o.textarea;
    const q = parseSlashQuery(ta.value, ta.selectionStart ?? 0);
    this.close();
    if (!q) return;
    replaceRange(ta, 0, q.end, text);
    ta.focus();
    this.o.announce(this.o.t('inserted'));
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.isOpen || e.target !== this.o.textarea || e.isComposing) return;
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    switch (e.key) {
      case 'ArrowDown':
        stop();
        this.move(1);
        break;
      case 'ArrowUp':
        stop();
        this.move(-1);
        break;
      case 'Enter':
      case 'Tab':
        if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
        if (this.loading) {
          stop();
          return;
        }
        if (this.items.length === 0) {
          this.close();
          return;
        }
        stop();
        void this.choose(this.active);
        break;
      case 'Escape':
        stop();
        this.close();
        break;
    }
  }
}
