import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { z } from 'zod';
import type { PageSession } from '@/adapters/funpay';
import { isFlagEnabled } from '@/core/flags/flags';
import { rpc } from '@/core/messaging/client';
import { SettingsSchema } from '@/core/settings/schema';
import { collectRows, removePriceBadges, renderPriceBadges, type OwnPage } from './listings/badges';
import { csLang } from './listings/i18n';
import { mountOfferHelper } from './listings/offer-helper';

/** The subset of `cs.getPageConfig` this enhancement relies on (validated; defaults when missing). */
const PageConfigSchema = z.object({
  language: z.string().default('auto'),
  privacy: z.object({ privacyMode: z.boolean().default(false), hideBalances: z.boolean().default(false) }).prefault({}),
  fees: SettingsSchema.shape.fees,
  flags: z.record(z.string(), z.boolean()).default({}),
});

export function ownPageOf(pathname: string, selfUserId: string | null): OwnPage | 'offer_edit' | null {
  const path = pathname.replace(/^\/(en|uk)(?=\/)/, '');
  const lots = path.match(/^\/lots\/(\d{1,10})\/trade$/);
  if (lots) return { kind: 'own_lots', nodeId: lots[1]! };
  if (selfUserId && path === `/users/${selfUserId}/`) return { kind: 'profile' };
  if (path === '/lots/offerEdit') return 'offer_edit';
  return null;
}

/**
 * funpay.com page enhancements for listings:
 *  - own lots pages and own profile: net price (after a known commission), estimated profit and
 *    promo badges next to prices (data: `cs.getPageConfig`, `cs.listingCosts`);
 *  - offer editor: buyer price ⇄ seller price helper and a link to translate in the dashboard.
 * Everything is removed when the content-script context is invalidated.
 */
export async function mountListingsEnhancements(ctx: ContentScriptContext, getSession: () => PageSession): Promise<void> {
  const session = getSession();
  const page = ownPageOf(location.pathname, session.userId);
  if (!page) return;
  const parsed = PageConfigSchema.safeParse(await rpc('cs.getPageConfig', {}).catch(() => null));
  if (!parsed.success) return;
  const config = parsed.data;
  if (!isFlagEnabled('funpayEnhancements', config.flags) || ctx.isInvalid) return;
  const lang = csLang(config.language, session.locale);

  if (page === 'offer_edit') {
    mountOfferHelper(document, ctx, {
      fees: config.fees,
      lang,
      openInDashboard: (offerId) => void rpc('cs.openListingInDashboard', { offerId }).catch(() => undefined),
    });
    return;
  }

  const rows = collectRows(document, page);
  if (rows.length === 0) return;
  const costs = await rpc<Record<string, number | null>>('cs.listingCosts', { ids: rows.slice(0, 2000).map((r) => r.listing.id) }).catch(() => ({}) as Record<string, number | null>);
  if (ctx.isInvalid) return;
  ctx.requestAnimationFrame(() => {
    renderPriceBadges(document, rows, { fees: config.fees, costs, hideProfit: config.privacy.privacyMode || config.privacy.hideBalances, lang });
  });
  ctx.onInvalidated(() => removePriceBadges(document));
}
