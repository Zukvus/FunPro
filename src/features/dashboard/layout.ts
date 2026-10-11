/**
 * Saved dashboard layout for the Overview page: which sections are shown and in which order.
 * Stored in settings (`dashboard.overviewOrder` / `dashboard.overviewHidden`). Unknown ids from older
 * versions are dropped and sections added in newer versions are appended, so a saved layout never
 * hides a new section by accident.
 */
export const OVERVIEW_SECTIONS = ['kpis', 'automation', 'unconfirmed', 'recent', 'freshness'] as const;
export type OverviewSection = (typeof OVERVIEW_SECTIONS)[number];

export function isOverviewSection(v: string): v is OverviewSection {
  return (OVERVIEW_SECTIONS as readonly string[]).includes(v);
}

export function normalizeOrder(order: readonly string[]): OverviewSection[] {
  const seen = new Set<OverviewSection>();
  const out: OverviewSection[] = [];
  for (const id of order) {
    if (isOverviewSection(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of OVERVIEW_SECTIONS) if (!seen.has(id)) out.push(id);
  return out;
}

export interface LayoutEntry {
  id: OverviewSection;
  visible: boolean;
}

export function resolveLayout(order: readonly string[], hidden: readonly string[]): LayoutEntry[] {
  const hiddenSet = new Set(hidden);
  return normalizeOrder(order).map((id) => ({ id, visible: !hiddenSet.has(id) }));
}

export function moveSection(
  order: readonly OverviewSection[],
  id: OverviewSection,
  delta: -1 | 1,
): OverviewSection[] {
  const next = [...order];
  const i = next.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

export function toSettings(entries: readonly LayoutEntry[]): {
  overviewOrder: OverviewSection[];
  overviewHidden: OverviewSection[];
} {
  return {
    overviewOrder: entries.map((e) => e.id),
    overviewHidden: entries.filter((e) => !e.visible).map((e) => e.id),
  };
}
