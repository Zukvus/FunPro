/**
 * Background sync of orders, finance and own-profile data through an open FunPay tab.
 *
 * The executor (`exec`) is injected — in the service worker it is `execInFunPayTab` — so this
 * module has no browser dependencies and is unit-testable. Everything returned by the content
 * script is validated with zod again before it is persisted (invalid items are dropped).
 */
import type { ParsedFinanceOp, ParsedListing, ParsedOrder, ParsedReview } from '@/adapters/funpay/types';
import type { ContentCommand } from '@/core/messaging/protocol';
import {
  ingestFinance,
  ingestListings,
  ingestOrders,
  ingestReviews,
  type OrderIngestResult,
} from '@/features/sync/ingest';
import {
  FinanceOperationSchema,
  ListingSchema,
  OrderSchema,
  ReviewSchema,
  type OrderDirection,
} from '@/shared/models';
import type { z } from 'zod';
import { ingestHistoricalOrders } from './history';
import {
  paginateOrders,
  type OrdersPage,
  type PaginationProgress,
  type PaginationResult,
} from './pagination';

export type ExecFn = (cmd: ContentCommand) => Promise<unknown>;

const ParsedOrderSchema = OrderSchema.omit({ firstSeenAt: true, updatedAt: true, history: true });
const ParsedFinanceSchema = FinanceOperationSchema.omit({ firstSeenAt: true });
const ParsedListingSchema = ListingSchema.omit({
  costMinor: true,
  sortIndex: true,
  seenAt: true,
  updatedAt: true,
});
const ParsedReviewSchema = ReviewSchema.omit({ firstSeenAt: true });

function validItems<S extends z.ZodType>(schema: S, items: unknown): z.output<S>[] {
  if (!Array.isArray(items)) return [];
  const out: z.output<S>[] = [];
  for (const i of items) {
    const r = schema.safeParse(i);
    if (r.success) out.push(r.data);
  }
  return out;
}

/** Validate a `{orders, continueToken}` payload from the content script. */
export function parseOrdersPayload(data: unknown, direction: OrderDirection): OrdersPage {
  const rec = (data && typeof data === 'object' ? data : {}) as { orders?: unknown; continueToken?: unknown };
  const orders = validItems(ParsedOrderSchema, rec.orders).filter(
    (o) => o.direction === direction,
  ) as ParsedOrder[];
  const token =
    typeof rec.continueToken === 'string' && rec.continueToken.length > 0 && rec.continueToken.length <= 512
      ? rec.continueToken
      : null;
  return { orders, continueToken: token };
}

const LIST_PATH: Record<OrderDirection, string> = { sale: '/orders/trade', purchase: '/orders/' };
const PAGE_KIND: Record<OrderDirection, 'orders' | 'purchases'> = { sale: 'orders', purchase: 'purchases' };

export async function fetchFirstOrdersPage(exec: ExecFn, direction: OrderDirection): Promise<OrdersPage> {
  return parseOrdersPayload(
    await exec({ action: 'fetchPage', kind: PAGE_KIND[direction], path: LIST_PATH[direction] }),
    direction,
  );
}

/** `continue`-token paging command (POST to the order list with the token from the previous page). */
export type FetchMoreOrdersCommand = Extract<ContentCommand, { action: 'fetchMoreOrders' }>;

export async function fetchMoreOrdersPage(
  exec: ExecFn,
  direction: OrderDirection,
  continueToken: string,
): Promise<OrdersPage> {
  const cmd: FetchMoreOrdersCommand = { action: 'fetchMoreOrders', direction, continueToken };
  try {
    return parseOrdersPayload(await exec(cmd), direction);
  } catch (e) {
    if ((e as { code?: unknown } | null)?.code === 'invalid') throw new PagingUnsupportedError();
    throw e;
  }
}

export class PagingUnsupportedError extends Error {
  readonly code = 'unsupported';
  constructor() {
    // Only reachable when an outdated content script (from before an update) answers the command.
    super('The open FunPay tab runs an outdated FunPro content script — reload the tab to load older pages.');
    this.name = 'PagingUnsupportedError';
  }
}

export async function syncOrderList(
  exec: ExecFn,
  direction: OrderDirection,
  now = Date.now(),
): Promise<OrderIngestResult> {
  const page = await fetchFirstOrdersPage(exec, direction);
  return ingestOrders(page.orders, direction, now);
}

export async function syncFinance(
  exec: ExecFn,
  now = Date.now(),
): Promise<{ fetched: number; created: number }> {
  const ops = validItems(
    ParsedFinanceSchema,
    await exec({ action: 'fetchPage', kind: 'finance', path: '/account/balance' }),
  ) as ParsedFinanceOp[];
  return { fetched: ops.length, created: await ingestFinance(ops, now) };
}

/** Own profile → listings (offers) and reviews. */
export async function syncProfile(
  exec: ExecFn,
  now = Date.now(),
): Promise<{ listings: number; newReviews: number }> {
  const data = (await exec({ action: 'fetchPage', kind: 'profile', path: '/' })) as {
    listings?: unknown;
    reviews?: unknown;
  } | null;
  const listings = validItems(ParsedListingSchema, data?.listings) as ParsedListing[];
  const reviews = validItems(ParsedReviewSchema, data?.reviews) as ParsedReview[];
  if (listings.length) await ingestListings(listings, { now });
  const created = reviews.length ? await ingestReviews(reviews, now) : [];
  return { listings: listings.length, newReviews: created.length };
}

export type ImportMode = 'full' | 'missing';

export interface ImportOptions {
  direction: OrderDirection;
  mode: ImportMode;
  maxPages: number;
  signal?: AbortSignal;
  onProgress?: (p: PaginationProgress) => void | Promise<void>;
  now?: () => number;
}

/**
 * Walk the order list page by page. Page 1 uses the regular ingestion (events, baseline); older
 * pages are written silently (see history.ts). `missing` mode stops after two consecutive pages
 * without anything new.
 */
export async function importOrderHistory(exec: ExecFn, opts: ImportOptions): Promise<PaginationResult> {
  const now = opts.now ?? Date.now;
  return paginateOrders(
    {
      fetchFirst: () => fetchFirstOrdersPage(exec, opts.direction),
      fetchMore: (token) => fetchMoreOrdersPage(exec, opts.direction, token),
      ingest: async (page, index) => {
        if (index === 0) {
          const r = await ingestOrders(page.orders, opts.direction, now());
          return { created: r.created.length, updated: r.changed.length };
        }
        return ingestHistoricalOrders(page.orders, opts.direction, now());
      },
    },
    {
      maxPages: opts.maxPages,
      stopAfterKnownPages: opts.mode === 'missing' ? 2 : undefined,
      signal: opts.signal,
      onProgress: opts.onProgress,
    },
  );
}

export type SyncFailureKind = 'awaiting_tab' | 'logged_out' | 'rate_limited' | 'unsupported' | 'error';

/** Classify an error thrown by `exec` (duck-typed so features never import background code). */
export function classifySyncError(e: unknown): { kind: SyncFailureKind; message: string } {
  const err = e as { name?: unknown; code?: unknown; message?: unknown } | null;
  const message = typeof err?.message === 'string' ? err.message : String(e);
  if (err?.name === 'NoFunPayTabError') return { kind: 'awaiting_tab', message };
  if (err?.code === 'logged_out') return { kind: 'logged_out', message };
  if (err?.code === 'rate_limited') return { kind: 'rate_limited', message };
  if (err?.code === 'unsupported' || err instanceof PagingUnsupportedError)
    return { kind: 'unsupported', message };
  return { kind: 'error', message };
}
