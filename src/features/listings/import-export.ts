/**
 * Listings import / export (JSON, XLSX, CSV).
 *
 * Round-trip guarantee: `parseListingsImport(export(listings))` returns listings identical to the
 * exported ones. JSON is exact; XLSX/CSV are exact too, with one documented normalisation: an
 * optional text that is an empty string (titleEn / description / descriptionEn) is indistinguishable
 * from an absent one in a spreadsheet and is imported as absent.
 *
 * Importing never changes FunPay by itself: only LOCAL fields (cost, display order, English drafts)
 * are applied. Differences in FunPay-side fields (price, active, stock) are shown and can be turned
 * into a bulk-edit plan explicitly, which then goes through preview → backup → queue.
 */
import { z } from 'zod';
import type { Settings } from '@/core/settings/schema';
import { getDb, type BackupRecord } from '@/core/db/db';
import { newId } from '@/core/util/id';
import { ListingSchema, type Listing } from '@/shared/models';
import { parseCsv, toCsv, type Cell } from '@/features/export/csv';
import { readXlsx, writeXlsx } from '@/features/export/xlsx';
import { baseItem, emptyPlan, setPriceChange, type BulkPlan, type PlanItem } from './bulk-plan';
import { parsePriceInput } from './commission';

export const LISTINGS_EXPORT_FORMAT = 'funpro-listings';
export const LISTINGS_EXPORT_VERSION = 1;
/** Maximum accepted import size (a 10k-listing JSON export is ~5 MB). */
export const LISTINGS_IMPORT_MAX_BYTES = 15 * 1024 * 1024;
export const LISTINGS_IMPORT_MAX_ROWS = 20_000;

export const EXPORT_COLUMNS = [
  'id',
  'nodeId',
  'gameId',
  'category',
  'title',
  'titleEn',
  'description',
  'descriptionEn',
  'price',
  'currency',
  'amount',
  'active',
  'promoted',
  'autoDelivery',
  'cost',
  'sortIndex',
  'seenAt',
  'updatedAt',
] as const;

type Column = (typeof EXPORT_COLUMNS)[number];

/** Minor units → decimal number for spreadsheets (exact for two-decimal currencies). */
function decimal(minor: number): number {
  return minor / 100;
}

export function listingToRow(l: Listing): Cell[] {
  const rec: Record<Column, Cell> = {
    id: l.id,
    nodeId: l.nodeId ?? '',
    gameId: l.gameId ?? '',
    category: l.categoryName,
    title: l.title,
    titleEn: l.titleEn ?? '',
    description: l.description ?? '',
    descriptionEn: l.descriptionEn ?? '',
    price: decimal(l.price.amountMinor),
    currency: l.price.currency,
    amount: l.amount ?? '',
    active: l.active,
    promoted: l.promoted,
    autoDelivery: l.autoDelivery,
    cost: l.costMinor === null ? '' : decimal(l.costMinor),
    sortIndex: l.sortIndex,
    seenAt: l.seenAt,
    updatedAt: l.updatedAt,
  };
  return EXPORT_COLUMNS.map((c) => rec[c]);
}

export function listingsToJson(listings: readonly Listing[], now = new Date()): string {
  return JSON.stringify(
    {
      format: LISTINGS_EXPORT_FORMAT,
      version: LISTINGS_EXPORT_VERSION,
      exportedAt: now.toISOString(),
      listings,
    },
    null,
    2,
  );
}

export function listingsToXlsx(listings: readonly Listing[]): Uint8Array {
  return writeXlsx([{ name: 'Listings', headers: [...EXPORT_COLUMNS], rows: listings.map(listingToRow) }]);
}

export function listingsToCsv(listings: readonly Listing[]): string {
  return toCsv([...EXPORT_COLUMNS], listings.map(listingToRow));
}

export type ImportFormat = 'json' | 'xlsx' | 'csv';

/** UTF-8 byte-order mark (built from its code point: no invisible characters in source). */
const BOM = String.fromCharCode(0xfeff);

function stripBom(s: string): string {
  return s.startsWith(BOM) ? s.slice(1) : s;
}

export function detectImportFormat(fileName: string, bytes: Uint8Array): ImportFormat | null {
  const name = fileName.toLowerCase();
  if (name.endsWith('.json')) return 'json';
  if (name.endsWith('.xlsx')) return 'xlsx';
  if (name.endsWith('.csv')) return 'csv';
  // Sniff: XLSX is a zip ("PK"), JSON starts with "{" (after optional whitespace / BOM).
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx';
  const head = stripBom(new TextDecoder().decode(bytes.slice(0, 64))).trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return 'json';
  return null;
}

export interface ImportError {
  /** 1-based row (spreadsheets, header = row 1) or item index (JSON). */
  row: number;
  message: string;
}

export interface ParsedImport {
  listings: Listing[];
  errors: ImportError[];
}

const JsonEnvelopeSchema = z.object({
  format: z.literal(LISTINGS_EXPORT_FORMAT),
  version: z.number().int().min(1).max(LISTINGS_EXPORT_VERSION),
  listings: z.array(z.unknown()).max(LISTINGS_IMPORT_MAX_ROWS),
});

/** Strict listing validation for imports: ids are FunPay offer ids. */
const ImportedListingSchema = ListingSchema.extend({ id: z.string().regex(/^\d{1,12}$/) });

function zodMessage(e: z.ZodError): string {
  return e.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
    .join('; ');
}

/** Undo the CSV formula-injection guard (`'` before = + - @ tab CR) added by `escapeCsvCell`. */
function unguard(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s;
}

function cellString(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : String(v);
}

function optText(v: string | number | boolean | null | undefined): string | undefined {
  const s = cellString(v);
  return s === '' ? undefined : s;
}

function nullableId(v: string | number | boolean | null | undefined): string | null {
  const s = cellString(v).trim();
  return s === '' ? null : s;
}

function bool(v: string | number | boolean | null | undefined): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  const s = cellString(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'да', 'так', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'нет', 'ні', 'n', ''].includes(s)) return false;
  return null;
}

function minorFrom(v: string | number | boolean | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  return parsePriceInput(cellString(v));
}

function intFrom(v: string | number | boolean | null | undefined): number | null {
  if (typeof v === 'number') return Number.isInteger(v) ? v : null;
  const s = cellString(v).trim();
  return /^-?\d+$/.test(s) ? Number.parseInt(s, 10) : null;
}

function numberFrom(v: string | number | boolean | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = cellString(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function rowToListing(row: Record<string, string | number | boolean | null>): unknown {
  const price = minorFrom(row['price'] ?? null);
  const costText = cellString(row['cost'] ?? null).trim();
  const amountText = cellString(row['amount'] ?? null).trim();
  const out: Record<string, unknown> = {
    id: cellString(row['id'] ?? null).trim(),
    nodeId: nullableId(row['nodeId'] ?? null),
    gameId: nullableId(row['gameId'] ?? null),
    categoryName: cellString(row['category'] ?? null),
    title: cellString(row['title'] ?? null),
    price: {
      amountMinor: price,
      currency:
        cellString(row['currency'] ?? null)
          .trim()
          .toUpperCase() || 'UNKNOWN',
    },
    amount: amountText === '' ? null : intFrom(row['amount'] ?? null),
    active: bool(row['active'] ?? null),
    promoted: bool(row['promoted'] ?? null) ?? false,
    autoDelivery: bool(row['autoDelivery'] ?? null) ?? false,
    costMinor: costText === '' ? null : minorFrom(row['cost'] ?? null),
    sortIndex: numberFrom(row['sortIndex'] ?? null) ?? 0,
    seenAt: cellString(row['seenAt'] ?? null),
    updatedAt: cellString(row['updatedAt'] ?? null),
  };
  const titleEn = optText(row['titleEn'] ?? null);
  const description = optText(row['description'] ?? null);
  const descriptionEn = optText(row['descriptionEn'] ?? null);
  if (titleEn !== undefined) out['titleEn'] = titleEn;
  if (description !== undefined) out['description'] = description;
  if (descriptionEn !== undefined) out['descriptionEn'] = descriptionEn;
  return out;
}

function parseMatrix(matrix: (string | number | boolean | null)[][], fromCsv: boolean): ParsedImport {
  const errors: ImportError[] = [];
  const listings: Listing[] = [];
  const header = (matrix[0] ?? []).map((h) => cellString(h).trim());
  if (!header.includes('id') || !header.includes('price')) {
    return {
      listings,
      errors: [
        {
          row: 1,
          message:
            'Missing header row with "id" and "price" columns (export a file from FunPro to see the format)',
        },
      ],
    };
  }
  const body = matrix.slice(1).filter((r) => r.some((c) => cellString(c).trim() !== ''));
  if (body.length > LISTINGS_IMPORT_MAX_ROWS)
    return { listings, errors: [{ row: 1, message: `Too many rows (max ${LISTINGS_IMPORT_MAX_ROWS})` }] };
  const seen = new Set<string>();
  matrix.slice(1).forEach((r, idx) => {
    if (!r.some((c) => cellString(c).trim() !== '')) return;
    const rec: Record<string, string | number | boolean | null> = {};
    header.forEach((h, i) => {
      const v = r[i] ?? null;
      rec[h] = fromCsv && typeof v === 'string' ? unguard(v) : v;
    });
    const res = ImportedListingSchema.safeParse(rowToListing(rec));
    if (!res.success) {
      errors.push({ row: idx + 2, message: zodMessage(res.error) });
      return;
    }
    if (seen.has(res.data.id)) {
      errors.push({ row: idx + 2, message: `Duplicate id ${res.data.id}` });
      return;
    }
    seen.add(res.data.id);
    listings.push(res.data);
  });
  return { listings, errors };
}

function parseJson(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(text));
  } catch {
    return { listings: [], errors: [{ row: 0, message: 'Not valid JSON' }] };
  }
  const env = JsonEnvelopeSchema.safeParse(raw);
  if (!env.success)
    return {
      listings: [],
      errors: [{ row: 0, message: `Not a FunPro listings export (${zodMessage(env.error)})` }],
    };
  const errors: ImportError[] = [];
  const listings: Listing[] = [];
  const seen = new Set<string>();
  env.data.listings.forEach((item, i) => {
    const res = ImportedListingSchema.safeParse(item);
    if (!res.success) errors.push({ row: i + 1, message: zodMessage(res.error) });
    else if (seen.has(res.data.id)) errors.push({ row: i + 1, message: `Duplicate id ${res.data.id}` });
    else {
      seen.add(res.data.id);
      listings.push(res.data);
    }
  });
  return { listings, errors };
}

/** Parse and validate an import file. Never throws for bad content: problems are returned as errors. */
export function parseListingsImport(bytes: Uint8Array, format: ImportFormat): ParsedImport {
  if (bytes.byteLength > LISTINGS_IMPORT_MAX_BYTES) {
    return {
      listings: [],
      errors: [
        {
          row: 0,
          message: `File is too large (max ${Math.round(LISTINGS_IMPORT_MAX_BYTES / 1024 / 1024)} MB)`,
        },
      ],
    };
  }
  try {
    if (format === 'json') return parseJson(new TextDecoder().decode(bytes));
    if (format === 'csv') return parseMatrix(parseCsv(new TextDecoder().decode(bytes)), true);
    return parseMatrix(readXlsx(bytes), false);
  } catch (e) {
    return {
      listings: [],
      errors: [{ row: 0, message: e instanceof Error ? e.message : 'Unreadable file' }],
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Diff & apply
// ---------------------------------------------------------------------------------------------

export interface LocalPatch {
  costMinor?: number | null;
  sortIndex?: number;
  titleEn?: string | undefined;
  descriptionEn?: string | undefined;
}

export interface RemoteDiff {
  priceMinor?: { from: number; to: number };
  active?: { from: boolean; to: boolean };
  amount?: { from: number | null; to: number | null };
}

export interface ImportDiffRow {
  id: string;
  title: string;
  status: 'update' | 'unchanged' | 'unknown';
  local: LocalPatch;
  remote: RemoteDiff;
}

export interface ImportDiff {
  rows: ImportDiffRow[];
  updates: number;
  unchanged: number;
  unknown: number;
  remoteChanges: number;
}

export function diffImport(existing: ReadonlyMap<string, Listing>, imported: readonly Listing[]): ImportDiff {
  const rows: ImportDiffRow[] = [];
  let updates = 0;
  let unchanged = 0;
  let unknown = 0;
  let remoteChanges = 0;
  for (const imp of imported) {
    const cur = existing.get(imp.id);
    if (!cur) {
      rows.push({ id: imp.id, title: imp.title, status: 'unknown', local: {}, remote: {} });
      unknown++;
      continue;
    }
    const local: LocalPatch = {};
    if (imp.costMinor !== cur.costMinor) local.costMinor = imp.costMinor;
    if (imp.sortIndex !== cur.sortIndex) local.sortIndex = imp.sortIndex;
    if ((imp.titleEn ?? '') !== (cur.titleEn ?? '')) local.titleEn = imp.titleEn;
    if ((imp.descriptionEn ?? '') !== (cur.descriptionEn ?? '')) local.descriptionEn = imp.descriptionEn;
    const remote: RemoteDiff = {};
    if (imp.price.amountMinor !== cur.price.amountMinor && imp.price.currency === cur.price.currency)
      remote.priceMinor = { from: cur.price.amountMinor, to: imp.price.amountMinor };
    if (imp.active !== cur.active) remote.active = { from: cur.active, to: imp.active };
    if (imp.amount !== cur.amount) remote.amount = { from: cur.amount, to: imp.amount };
    const hasLocal = Object.keys(local).length > 0;
    if (Object.keys(remote).length) remoteChanges++;
    if (hasLocal) updates++;
    else unchanged++;
    rows.push({ id: imp.id, title: cur.title, status: hasLocal ? 'update' : 'unchanged', local, remote });
  }
  return { rows, updates, unchanged, unknown, remoteChanges };
}

/** Apply the local part of an import (cost, order, EN drafts). Backup (kind 'import') first. */
export async function applyImportLocal(
  diff: ImportDiff,
  label: string,
  now = Date.now(),
): Promise<{ updated: number; backupId: string | null }> {
  const rows = diff.rows.filter((r) => r.status === 'update');
  if (rows.length === 0) return { updated: 0, backupId: null };
  const db = getDb();
  let updated = 0;
  const backupId = newId('bak');
  await db.transaction('rw', db.listings, db.backups, async () => {
    const current = (await db.listings.bulkGet(rows.map((r) => r.id))).filter((x): x is Listing => !!x);
    const backup: BackupRecord = {
      id: backupId,
      kind: 'import',
      createdAt: now,
      label: label.slice(0, 200),
      listings: current,
    };
    await db.backups.add(backup);
    for (const r of rows) {
      const patch: Partial<Listing> = {};
      if ('costMinor' in r.local) patch.costMinor = r.local.costMinor ?? null;
      if (r.local.sortIndex !== undefined) patch.sortIndex = r.local.sortIndex;
      if ('titleEn' in r.local) patch.titleEn = r.local.titleEn;
      if ('descriptionEn' in r.local) patch.descriptionEn = r.local.descriptionEn;
      updated += await db.listings.update(r.id, patch);
    }
  });
  return { updated, backupId };
}

/**
 * Turn the FunPay-side differences of an import into a bulk-edit plan. Price changes carry the
 * optimistic-concurrency check (the live editor price must still equal the locally known price).
 */
export function importToBulkPlan(
  diff: ImportDiff,
  existing: ReadonlyMap<string, Listing>,
  fees: Settings['fees'],
  ctx: { now: number; label: string },
): BulkPlan {
  const items: PlanItem[] = [];
  for (const row of diff.rows) {
    if (row.status === 'unknown' || Object.keys(row.remote).length === 0) continue;
    const cur = existing.get(row.id);
    if (!cur) continue;
    const item = baseItem(cur);
    if (row.remote.active) {
      item.after.active = row.remote.active.to;
      item.changes.active = row.remote.active.to ? 'on' : '';
    }
    if (row.remote.amount && row.remote.amount.to !== null) {
      item.after.amount = row.remote.amount.to;
      item.changes.amount = String(row.remote.amount.to);
      if (cur.autoDelivery) item.warnings.push('auto_delivery_stock');
    }
    if (row.remote.priceMinor) {
      setPriceChange(item, cur, row.remote.priceMinor.to, fees, true);
      if (item.skip && (item.changes.active !== undefined || item.changes.amount !== undefined)) {
        // An invalid price must not block the other (valid) field changes of this row.
        item.skip = null;
        delete item.changes.price;
        delete item.after.priceMinor;
        item.expectPriceMinor = null;
      }
    }
    if (!item.skip && Object.keys(item.changes).length === 0) item.skip = 'no_change';
    items.push(item);
  }
  return emptyPlan({ kind: 'import' }, { now: ctx.now, label: ctx.label, source: 'import' }, items);
}
