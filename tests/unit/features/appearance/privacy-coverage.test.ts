import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { privacyStylesheet, ROOT_ATTR } from '@/features/appearance/funpay-css';
import { EXTRA_SELECTORS, PRIVACY_TARGETS, privacySelectorList, splitSelectorList, type PrivacyCategory } from '@/features/appearance/funpay-selectors';
import { fixtureDoc } from '../../../fixtures';

const FIXTURES = readdirSync(join(__dirname, '../../../fixtures/funpay')).filter((f) => f.endsWith('.html'));
const docs = new Map(FIXTURES.map((f) => [f, fixtureDoc(f)]));
const CATEGORIES = Object.keys(PRIVACY_TARGETS) as PrivacyCategory[];

/** Selectors with no sanitized fixture yet (markup documented in research notes only). */
const NO_FIXTURE_YET = new Set<string>([EXTRA_SELECTORS.chatHeaderName]);

/**
 * Every sensitive value that appears in the fixtures, by category. If a fixture gains new sensitive
 * markup, add it here — the test then proves privacy mode covers it.
 */
const SENSITIVE: Record<PrivacyCategory, string[]> = {
  usernames: ['SellerOne', 'BuyerAlpha', 'BuyerBeta', 'CompOne', 'CompTwo'],
  chatPreviews: ['Hello, is it available?', 'Thanks!', 'Hi! Processing your order.'],
  orderIds: ['AAAA1111', 'BBBB2222', 'CCCC3333', 'DDDD4444'],
  balances: ['1 520.40', '1 120.00', '68.52', '57.20'],
};

/** Elements whose own text nodes contain `value`. */
function elementsWithText(doc: Document, value: string): Element[] {
  return Array.from(doc.querySelectorAll('body *')).filter((el) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent ?? '').includes(value)),
  );
}

describe('privacy mode selector list', () => {
  it('uses only syntactically valid selectors', () => {
    const doc = docs.values().next().value!;
    for (const sel of privacySelectorList(CATEGORIES)) expect(() => doc.querySelectorAll(sel)).not.toThrow();
  });

  it('every selector matches elements in at least one fixture (where a fixture exists)', () => {
    const unmatched: string[] = [];
    for (const category of CATEGORIES) {
      for (const list of PRIVACY_TARGETS[category]) {
        for (const sel of splitSelectorList(list)) {
          const hits = [...docs.values()].reduce((n, d) => n + d.querySelectorAll(sel).length, 0);
          if (hits === 0 && !NO_FIXTURE_YET.has(sel)) unmatched.push(`${category}: ${sel}`);
        }
      }
    }
    expect(unmatched).toEqual([]);
  });

  it('covers every known sensitive value in every fixture', () => {
    const uncovered: string[] = [];
    const all = privacySelectorList(CATEGORIES).join(', ');
    for (const [name, doc] of docs) {
      for (const [category, values] of Object.entries(SENSITIVE)) {
        for (const value of values) {
          for (const el of elementsWithText(doc, value)) {
            if (!el.closest(all)) uncovered.push(`${name}: ${category} "${value}" in <${el.tagName.toLowerCase()} class="${el.className}">`);
          }
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  it('the balance category alone covers balances (used by "hide balances")', () => {
    const balances = privacySelectorList(['balances']).join(', ');
    for (const [name, doc] of docs) {
      for (const value of SENSITIVE.balances) {
        for (const el of elementsWithText(doc, value)) expect(el.closest(balances), `${name}: ${value}`).not.toBeNull();
      }
    }
  });

  it('does not blur ordinary page content (offer titles, prices of own lots, page headers)', () => {
    const all = privacySelectorList(CATEGORIES).join(', ');
    for (const text of ['Starter account, level 10', 'Мои продажи', 'Game A — Accounts']) {
      for (const doc of docs.values()) for (const el of elementsWithText(doc, text)) expect(el.closest(all)).toBeNull();
    }
  });

  it('scopes every selector in the injected stylesheet and adds hover/focus reveal', () => {
    const css = privacyStylesheet();
    for (const sel of privacySelectorList(CATEGORIES)) {
      expect(css).toContain(`html[${ROOT_ATTR.privacy}='on'] ${sel}`);
      expect(css).toContain(`html[${ROOT_ATTR.privacy}='on'] ${sel}:hover`);
      expect(css).toContain(`html[${ROOT_ATTR.privacy}='on'] ${sel}:focus-within`);
    }
    for (const sel of privacySelectorList(['balances'])) expect(css).toContain(`html[${ROOT_ATTR.balances}='on'] ${sel}`);
    // No unscoped rule: every selector line starts with the html attribute scope.
    const selectorLines = css.split('\n').filter((l) => l && !l.startsWith(' ') && !l.startsWith('/*') && l !== '}');
    for (const l of selectorLines) expect(l.startsWith('html[data-fp-')).toBe(true);
  });
});
