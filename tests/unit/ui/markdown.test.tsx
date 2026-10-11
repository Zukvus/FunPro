import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import changelog from '../../../CHANGELOG.md?raw';
import { Markdown, parseMarkdown, safeHref } from '@/dashboard/pages/about/Markdown';

describe('safe markdown renderer', () => {
  it('parses headings, lists, paragraphs, code and rules', () => {
    const blocks = parseMarkdown('# Title\n\nSome *text*\nwrapped.\n\n- one\n- two\n  continued\n\n---\n\n```\ncode <b>\n```');
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'Some *text* wrapped.' },
      { type: 'list', items: ['one', 'two continued'] },
      { type: 'rule' },
      { type: 'code', text: 'code <b>' },
    ]);
  });

  it('renders inline formatting as elements and raw HTML as plain text', () => {
    const { container } = render(<Markdown source={'## Hello **bold** and `code`\n\n<script>alert(1)</script> <img src=x onerror=alert(1)>'} />);
    expect(container.querySelector('h3')?.textContent).toBe('Hello bold and code');
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(container.querySelector('code')?.textContent).toBe('code');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('only links to http(s) and in-app routes', () => {
    expect(safeHref('https://funpay.com/trade/info')).toBe('https://funpay.com/trade/info');
    expect(safeHref('#/privacy')).toBe('#/privacy');
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    const { container } = render(<Markdown source={'[ok](https://semver.org/) [bad](javascript:alert(1)) [app](#/about)'} />);
    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://semver.org/', '#/about']);
    expect(links[0]!.getAttribute('rel')).toContain('noopener');
    expect(container.textContent).toContain('bad');
  });

  it('renders the bundled CHANGELOG with a version section', () => {
    const { container } = render(<Markdown source={changelog} />);
    expect(container.querySelectorAll('h2, h3, h4').length).toBeGreaterThan(4);
    expect(container.textContent).toMatch(/0\.1\.0/);
    expect(container.querySelectorAll('li').length).toBeGreaterThan(10);
  });
});
