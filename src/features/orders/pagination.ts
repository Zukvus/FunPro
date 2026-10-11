/**
 * Deep order-history import: walks FunPay's `continue`-token pagination one page at a time.
 *
 * Pure control flow with injected I/O so it can be unit-tested. Requests are strictly sequential
 * (the content-script transport additionally enforces ≥2.5 s between requests and backs off on
 * 429). The walk stops at the first error and never retries on its own: the seller can simply run
 * the import again (ingestion is idempotent).
 */
import type { ParsedOrder } from '@/adapters/funpay/types';

export interface OrdersPage {
  orders: ParsedOrder[];
  continueToken: string | null;
}

export interface PageIngestResult {
  /** Orders that were new to the local database. */
  created: number;
  /** Existing orders whose status changed. */
  updated: number;
}

export interface PaginationDeps {
  fetchFirst: () => Promise<OrdersPage>;
  fetchMore: (continueToken: string) => Promise<OrdersPage>;
  /** Persist one page. `pageIndex` is 0 for the first page. */
  ingest: (page: OrdersPage, pageIndex: number) => Promise<PageIngestResult>;
}

export interface PaginationProgress {
  pages: number;
  orders: number;
  created: number;
  updated: number;
  /** Token of the next page, if any (diagnostics only — tokens are never persisted long-term). */
  nextToken: string | null;
}

export interface PaginationOptions {
  /** Safety cap on the number of pages fetched (≥ 1). */
  maxPages: number;
  /**
   * Incremental mode: stop after this many consecutive pages that contained no new orders and no
   * status changes. Undefined/0 = walk to the end (full import).
   */
  stopAfterKnownPages?: number;
  signal?: AbortSignal;
  onProgress?: (p: PaginationProgress) => void | Promise<void>;
}

export type PaginationStop = 'end' | 'max_pages' | 'known' | 'cancelled' | 'error' | 'loop';

export interface PaginationResult extends PaginationProgress {
  stop: PaginationStop;
  error?: unknown;
}

export async function paginateOrders(
  deps: PaginationDeps,
  opts: PaginationOptions,
): Promise<PaginationResult> {
  const progress: PaginationProgress = { pages: 0, orders: 0, created: 0, updated: 0, nextToken: null };
  const maxPages = Math.max(1, Math.floor(opts.maxPages));
  const knownLimit =
    opts.stopAfterKnownPages && opts.stopAfterKnownPages > 0 ? opts.stopAfterKnownPages : Infinity;
  const seenTokens = new Set<string>();
  let knownStreak = 0;
  let token: string | null = null;

  const finish = (stop: PaginationStop, error?: unknown): PaginationResult =>
    error === undefined ? { ...progress, stop } : { ...progress, stop, error };

  for (;;) {
    if (opts.signal?.aborted) return finish('cancelled');
    let page: OrdersPage;
    try {
      page = progress.pages === 0 ? await deps.fetchFirst() : await deps.fetchMore(token!);
    } catch (e) {
      return finish('error', e);
    }
    let ingested: PageIngestResult;
    try {
      ingested = await deps.ingest(page, progress.pages);
    } catch (e) {
      return finish('error', e);
    }
    progress.pages++;
    progress.orders += page.orders.length;
    progress.created += ingested.created;
    progress.updated += ingested.updated;
    progress.nextToken = page.continueToken;
    knownStreak = ingested.created === 0 && ingested.updated === 0 ? knownStreak + 1 : 0;
    try {
      await opts.onProgress?.({ ...progress });
    } catch {
      /* progress reporting must never break the import */
    }

    if (!page.continueToken || page.orders.length === 0) return finish('end');
    if (seenTokens.has(page.continueToken)) return finish('loop');
    seenTokens.add(page.continueToken);
    if (knownStreak >= knownLimit) return finish('known');
    if (progress.pages >= maxPages) return finish('max_pages');
    token = page.continueToken;
  }
}
