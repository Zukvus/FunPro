import { describe, expect, it } from 'vitest';
import { defaultSettings } from '@/core/settings/schema';
import { funpayPalette, funpayThemeStylesheet, isSafeImageDataUrl, nicknameStylesheet, ROOT_ATTR } from '@/features/appearance/funpay-css';
import { scopeSelectors, splitSelectorList, THEME_TARGETS } from '@/features/appearance/funpay-selectors';
import { THEMES } from '@/features/appearance/themes';
import { fixtureDoc } from '../../../fixtures';

const nick = (over: Partial<ReturnType<typeof defaultSettings>['appearance']['nickname']> = {}) => ({ ...defaultSettings().appearance.nickname, enabled: true, ...over });

describe('selector helpers', () => {
  it('splits selector lists on top-level commas only', () => {
    expect(splitSelectorList('a.tc-item, div.tc-item')).toEqual(['a.tc-item', 'div.tc-item']);
    expect(splitSelectorList(':is(.a, .b) .c, [data-x="1,2"]')).toEqual([':is(.a, .b) .c', '[data-x="1,2"]']);
    expect(scopeSelectors('html[x]', ['.a, .b', '.c'])).toBe('html[x] .a,\nhtml[x] .b,\nhtml[x] .c');
  });
});

describe('nickname stylesheet', () => {
  it('is empty when disabled', () => {
    expect(nicknameStylesheet(nick({ enabled: false }), '1000001')).toBe('');
  });

  it('styles the header and own profile name, plus own links when the user id is known', () => {
    const css = nicknameStylesheet(nick({ color: '#ff0066', bold: true, font: 'mono' }), '1000001');
    expect(css).toContain(`html[${ROOT_ATTR.nickname}='on'] .user-link-name`);
    expect(css).toContain(`[${ROOT_ATTR.ownProfile}='1'] .profile h1 .mr4`);
    expect(css).toContain('a.chat-msg-author-link[href*="/users/1000001/"]');
    expect(css).toContain('.media-user-name [data-href*="/users/1000001/"]');
    expect(css).toContain('color: #ff0066 !important;');
    expect(css).toContain('font-weight: 700');
    expect(css).toContain('monospace');
  });

  it('matches only the own user in fixtures', () => {
    const css = nicknameStylesheet(nick(), '1000001');
    const doc = fixtureDoc('public-node.html');
    const selectors = css
      .split('{')[0]!
      .split(',\n')
      .map((s) => s.replace(/^\/\*.*\*\/\n/, '').replace(`html[${ROOT_ATTR.nickname}='on'] `, '').trim())
      .filter((s) => !s.includes(ROOT_ATTR.ownProfile));
    const matched = selectors.flatMap((s) => Array.from(doc.querySelectorAll(s))).map((e) => e.textContent);
    expect(matched).toEqual(['SellerOne']);
  });

  it('renders gradients as clipped text', () => {
    const css = nicknameStylesheet(nick({ color: '#112233', gradientTo: '#445566' }), null);
    expect(css).toContain('linear-gradient(90deg, #112233, #445566)');
    expect(css).toContain('background-clip: text');
    expect(css).not.toContain('/users/');
  });

  it('never interpolates unvalidated values', () => {
    // A forged user id or colour cannot inject CSS.
    expect(nicknameStylesheet(nick(), '1"] , * {display:none} [x="')).not.toContain('display:none');
    expect(nicknameStylesheet(nick({ color: 'red;}*{display:none' }), '1')).toBe('');
    expect(nicknameStylesheet(nick({ gradientTo: 'url(x)' }), '1')).not.toContain('url(');
  });
});

describe('funpay.com theme', () => {
  it('uses a dark palette: the selected dark theme, or FunPro Dark for light themes', () => {
    expect(funpayPalette('forest', null, false).bg).toBe(THEMES.forest.palette.bg);
    expect(funpayPalette('light', null, false).bg).toBe(THEMES.dark.palette.bg);
    expect(funpayPalette('system', null, true).bg).toBe(THEMES.dark.palette.bg);
    expect(funpayPalette('dark', '#ff8800', false).accent).toBe('#ff8800');
  });

  it('changes colours only and scopes every rule to the theme attribute', () => {
    const css = funpayThemeStylesheet(funpayPalette('dark', null, false));
    expect(css).not.toMatch(/\b(display|position|width|height|margin|padding|font-size|top|left)\s*:/);
    for (const block of css.split('}').filter((b) => b.includes('{'))) {
      const selectors = block.split('{')[0]!.replace(/\/\*[^*]*\*\//g, '').trim();
      for (const s of selectors.split(',')) expect(s.trim().startsWith('html[data-fp-')).toBe(true);
    }
    for (const s of THEME_TARGETS.surfaces.flatMap(splitSelectorList)) expect(css).toContain(`html[${ROOT_ATTR.theme}='dark'] ${s}`);
  });
});

describe('data URL guard', () => {
  it('only accepts base64 data URLs of allowed image types', () => {
    expect(isSafeImageDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
    expect(isSafeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeImageDataUrl('data:image/png;base64,abc") ; background:url(https://evil')).toBe(false);
    expect(isSafeImageDataUrl('https://example.com/a.png')).toBe(false);
    expect(isSafeImageDataUrl(42)).toBe(false);
  });
});
