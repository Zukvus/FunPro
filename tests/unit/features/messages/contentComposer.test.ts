import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import { funpayParser } from '@/adapters/funpay';
import { rpc } from '@/core/messaging/client';
import { mountMessagingEnhancements } from '@/content/enhancements/messaging';
import { loadFixture } from '../../../fixtures';

vi.mock('@/core/messaging/client', () => ({ rpc: vi.fn() }));

const rpcMock = vi.mocked(rpc);
const TEMPLATES = [
  {
    id: '1',
    name: 'Thanks',
    command: 'thanks',
    body: 'Thanks {buyer} for order #{order_id} ({product}, {price})!',
  },
  { id: '2', name: 'Delivery time', command: 'eta', body: 'Within 10 minutes, {buyer}.' },
];

let ctx: ContentScriptContext;
let textarea: HTMLTextAreaElement;
let pageKeydowns: string[];
let inputEvents: number;

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

function type(value: string) {
  textarea.focus();
  textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(k: string): boolean {
  return textarea.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
}

const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]#funpro-msg-slash-list');
const slashPop = () => listbox()?.parentElement as HTMLElement | undefined;

beforeEach(async () => {
  history.pushState({}, '', '/chat/?node=users-1000001-2000001');
  const parsed = new DOMParser().parseFromString(loadFixture('messaging-chat-page.html'), 'text/html');
  document.body.replaceChildren(
    ...Array.from(parsed.body.childNodes).map((n) => document.importNode(n, true)),
  );
  textarea = document.querySelector('textarea[name="content"]')!;
  pageKeydowns = [];
  inputEvents = 0;
  // FunPay's own handlers on the chat box.
  textarea.addEventListener('keydown', (e) => pageKeydowns.push(e.key));
  textarea.addEventListener('input', () => inputEvents++);
  rpcMock.mockReset();
  rpcMock.mockImplementation((async (method: string, params: { emoji?: string }) => {
    switch (method) {
      case 'cs.getPageConfig':
        return { language: 'en', flags: {}, recentEmojis: ['🔥'] };
      case 'cs.listTemplates':
        return TEMPLATES;
      case 'cs.messaging.chatContext':
        return {
          buyer: 'BuyerAlpha',
          order_id: 'AAAA1111',
          product: 'Gold 100k',
          price: null,
          seller: 'SellerOne',
          chat_url: null,
        };
      case 'cs.recordEmoji':
        return [params.emoji, '🔥'];
      default:
        throw new Error(`unexpected ${method}`);
    }
  }) as never);
  ctx = new ContentScriptContext('test');
  await mountMessagingEnhancements(ctx, () => funpayParser.parseSession(document));
});

afterEach(() => {
  ctx.notifyInvalidated();
});

describe('chat page helpers', () => {
  it('adds a toolbar before FunPay’s chat form', () => {
    const root = document.querySelector('.funpro-msg-tools')!;
    expect(root).not.toBeNull();
    expect(root.nextElementSibling?.matches('form.chat-form')).toBe(true);
    expect(root.querySelector('button[aria-haspopup="dialog"]')?.getAttribute('aria-label')).toBe('Emoji');
  });

  it('"/" opens an accessible template list; Enter inserts the rendered template without reaching FunPay', async () => {
    type('/th');
    await flush();
    const options = listbox()!.querySelectorAll('[role="option"]');
    expect(slashPop()!.hidden).toBe(false);
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain('/thanks');
    expect(textarea.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
    expect(textarea.getAttribute('aria-controls')).toBe('funpro-msg-slash-list');

    const before = inputEvents;
    expect(key('Enter')).toBe(false); // default prevented: FunPay does not send "/th"
    await flush();
    expect(pageKeydowns).toEqual([]);
    // Unknown values ({price}) stay visible for the seller to fill in.
    expect(textarea.value).toBe('Thanks BuyerAlpha for order #AAAA1111 (Gold 100k, {price})!');
    expect(inputEvents).toBeGreaterThan(before);
    expect(slashPop()!.hidden).toBe(true);
    expect(textarea.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('arrow keys move the selection, Tab inserts, Esc closes and other keys pass through', async () => {
    type('/');
    await flush();
    expect(listbox()!.querySelectorAll('[role="option"]')).toHaveLength(2);
    key('ArrowDown');
    expect(listbox()!.querySelector('[aria-selected="true"]')!.textContent).toContain('/thanks');
    key('Tab');
    await flush();
    expect(textarea.value).toBe('Thanks BuyerAlpha for order #AAAA1111 (Gold 100k, {price})!');

    type('/e');
    await flush();
    expect(key('Escape')).toBe(false);
    expect(slashPop()!.hidden).toBe(true);
    expect(textarea.value).toBe('/e');

    type('hello');
    await flush();
    expect(key('Enter')).toBe(true);
    expect(pageKeydowns).toEqual(['Enter']);
  });

  it('shows an empty state and lets Enter through when nothing matches', async () => {
    type('/zzz');
    await flush();
    expect(listbox()!.textContent).toContain('No matching templates');
    expect(key('Enter')).toBe(true);
    expect(slashPop()!.hidden).toBe(true);
  });

  it('emoji picker: search in Russian, insert at the caret, remember the emoji', async () => {
    textarea.value = 'Thanks!';
    textarea.setSelectionRange(6, 6);
    const toggle = document.querySelector<HTMLButtonElement>(
      '.funpro-msg-tools button[aria-haspopup="dialog"]',
    )!;
    toggle.click();
    const panel = document.getElementById('funpro-msg-emoji-panel')!;
    expect(panel.hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Recently used emojis are shown first.
    expect(panel.querySelector('.funpro-msg-emoji-item')!.textContent).toBe('🔥');

    const search = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
    search.value = 'лайк';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    const first = panel.querySelector<HTMLButtonElement>('.funpro-msg-emoji-item')!;
    expect(first.textContent).toBe('👍');
    expect(first.getAttribute('aria-label')).toBe('thumbs up');
    first.click();
    await flush();
    expect(textarea.value).toBe('Thanks👍!');
    expect(rpcMock).toHaveBeenCalledWith('cs.recordEmoji', { emoji: '👍' });

    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('removes everything when the extension context is invalidated', async () => {
    type('/th');
    await flush();
    ctx.notifyInvalidated();
    expect(document.querySelector('.funpro-msg-tools')).toBeNull();
    expect(document.getElementById('funpro-msg-style')).toBeNull();
    expect(textarea.hasAttribute('aria-controls')).toBe(false);
    // Listeners are gone: typing "/" no longer opens anything.
    type('/');
    await flush();
    expect(listbox()).toBeNull();
  });
});
