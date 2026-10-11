/**
 * DOM helpers for the funpay.com chat page. Selectors come from the FunPay adapter (SEL); FunPro
 * never parses FunPay markup outside the adapter. All text is set via textContent.
 */
import { SEL } from '@/adapters/funpay';

export const CHAT_ID_RE = /^[\w-]{1,64}$/;

export function isChatPath(pathname: string): boolean {
  return /^\/(en\/|uk\/)?chat\/$/.test(pathname);
}

export function chatIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get('node');
  return id && CHAT_ID_RE.test(id) ? id : null;
}

export interface Composer {
  form: HTMLElement;
  textarea: HTMLTextAreaElement;
}

/** The chat message box and its form (or closest container). */
export function findComposer(doc: Document): Composer | null {
  const textarea = doc.querySelector<HTMLTextAreaElement>(SEL.chatInput);
  if (!textarea || textarea.disabled) return null;
  const form = textarea.closest<HTMLElement>(SEL.chatForm) ?? textarea.parentElement;
  return form ? { form, textarea } : null;
}

/**
 * Replace `[start, end)` of the textarea value with `text`, put the caret after it and notify
 * FunPay's own scripts with an `input` event (exactly as if the seller had typed). Never submits.
 */
export function replaceRange(textarea: HTMLTextAreaElement, start: number, end: number, text: string): void {
  const value = textarea.value;
  const s = Math.max(0, Math.min(start, value.length));
  const e = Math.max(s, Math.min(end, value.length));
  textarea.value = value.slice(0, s) + text + value.slice(e);
  const caret = s + text.length;
  textarea.setSelectionRange(caret, caret);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Insert at the current caret / selection. */
export function insertAtCaret(textarea: HTMLTextAreaElement, text: string): void {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? start;
  replaceRange(textarea, start, end, text);
}

type Attrs = Record<string, string | boolean | undefined>;

/** Create an element with attributes and optional text (never HTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  if (text !== undefined) el.textContent = text;
  return el;
}

/** True when an element's effective background is dark (FunPay themed dark by the seller). */
export function hasDarkBackground(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    const m = bg.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/);
    if (m && (m[4] === undefined || Number(m[4]) > 0.5)) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110;
    }
    node = node.parentElement;
  }
  return false;
}

/** Remembers attribute values so they can be restored exactly. */
export class AttrPatch {
  private saved = new Map<string, string | null>();
  constructor(private readonly el: Element) {}
  set(name: string, value: string): void {
    if (!this.saved.has(name)) this.saved.set(name, this.el.getAttribute(name));
    this.el.setAttribute(name, value);
  }
  restore(): void {
    for (const [name, value] of this.saved) {
      if (value === null) this.el.removeAttribute(name);
      else this.el.setAttribute(name, value);
    }
    this.saved.clear();
  }
}
