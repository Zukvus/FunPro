import { describe, expect, it } from 'vitest';
import {
  moveSection,
  normalizeOrder,
  OVERVIEW_SECTIONS,
  resolveLayout,
  toSettings,
} from '@/features/dashboard/layout';
import { defaultSettings } from '@/core/settings/schema';

describe('overview layout', () => {
  it('defaults to every section, visible, in the standard order', () => {
    const s = defaultSettings();
    expect(resolveLayout(s.dashboard.overviewOrder, s.dashboard.overviewHidden)).toEqual(
      OVERVIEW_SECTIONS.map((id) => ({ id, visible: true })),
    );
  });

  it('drops unknown/duplicate ids and appends sections missing from an older saved layout', () => {
    expect(normalizeOrder(['recent', 'bogus', 'recent', 'kpis'])).toEqual([
      'recent',
      'kpis',
      'automation',
      'unconfirmed',
      'freshness',
    ]);
  });

  it('moves sections within bounds and round-trips through settings', () => {
    const order = moveSection(['kpis', 'automation', 'unconfirmed', 'recent', 'freshness'], 'recent', -1);
    expect(order).toEqual(['kpis', 'automation', 'recent', 'unconfirmed', 'freshness']);
    expect(moveSection(order, 'kpis', -1)).toEqual(order);
    const entries = resolveLayout(order, ['freshness']);
    expect(toSettings(entries)).toEqual({ overviewOrder: order, overviewHidden: ['freshness'] });
  });
});
