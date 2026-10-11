import { describe, expect, it, vi } from 'vitest';
import { decorateOrdersPage, ordersPageDirection } from '@/content/enhancements/orders';
import { pageText } from '@/content/enhancements/orders/strings';
import { loadFixture } from '../../../fixtures';

function salesDoc(): Document {
  return new DOMParser().parseFromString(loadFixture('sales.html'), 'text/html');
}

describe('on-page orders helper', () => {
  it('recognises the sales and purchases lists (with locale prefixes)', () => {
    expect(ordersPageDirection('/orders/trade')).toBe('sale');
    expect(ordersPageDirection('/en/orders/trade')).toBe('sale');
    expect(ordersPageDirection('/uk/orders/')).toBe('purchase');
    expect(ordersPageDirection('/orders/AAAA1111/')).toBeNull();
    expect(ordersPageDirection('/chat/')).toBeNull();
  });

  it('adds one copy button per order and copies without following the row link', async () => {
    const doc = salesDoc();
    const copy = vi.fn(async () => true);
    const cleanup = decorateOrdersPage(doc, { lang: 'en', direction: 'sale', copy });
    const buttons = doc.querySelectorAll<HTMLButtonElement>('.funpro-orders-copy');
    expect(buttons).toHaveLength(3);
    expect(buttons[0]!.getAttribute('aria-label')).toBe('Copy order number AAAA1111');

    const rowClick = vi.fn();
    doc.querySelector('a.tc-item')!.addEventListener('click', rowClick);
    const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    buttons[0]!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(rowClick).not.toHaveBeenCalled();
    expect(copy).toHaveBeenCalledWith('AAAA1111');
    await new Promise((r) => setTimeout(r, 0));
    expect(doc.querySelector('.funpro-orders-live')!.textContent).toBe('Copied: AAAA1111');

    // Decorating twice never duplicates buttons.
    const cleanup2 = decorateOrdersPage(doc, { lang: 'en', direction: 'sale', copy });
    expect(doc.querySelectorAll('.funpro-orders-copy')).toHaveLength(3);
    cleanup2();
    cleanup();
  });

  it('copies the unconfirmed (paid) order ids from the toolbar', async () => {
    const doc = salesDoc();
    const copy = vi.fn(async () => true);
    const cleanup = decorateOrdersPage(doc, { lang: 'ru', direction: 'sale', copy });
    const btn = doc.querySelector<HTMLButtonElement>('.funpro-orders-toolbar-btn')!;
    expect(btn.textContent).toBe(pageText('ru', 'copyUnconfirmed', { count: 1 }));
    btn.click();
    expect(copy).toHaveBeenCalledWith('AAAA1111');
    cleanup();
  });

  it('removes everything it added on cleanup', () => {
    const doc = salesDoc();
    const before = doc.body.innerHTML;
    const cleanup = decorateOrdersPage(doc, { lang: 'uk', direction: 'sale', copy: async () => true });
    expect(doc.querySelectorAll('[class^="funpro-orders"]').length).toBeGreaterThan(0);
    cleanup();
    expect(doc.querySelectorAll('[class^="funpro-orders"]')).toHaveLength(0);
    expect(doc.getElementById('funpro-orders-style')).toBeNull();
    expect(doc.body.innerHTML).toBe(before);
  });

  it('does nothing on pages without orders', () => {
    const doc = new DOMParser().parseFromString('<body><p>empty</p></body>', 'text/html');
    const cleanup = decorateOrdersPage(doc, { lang: 'en', direction: 'purchase', copy: async () => true });
    expect(doc.querySelectorAll('.funpro-orders-copy')).toHaveLength(0);
    expect(doc.querySelector('.funpro-orders-toolbar')).toBeNull();
    cleanup();
    expect(doc.body.innerHTML).toBe('<p>empty</p>');
  });
});
