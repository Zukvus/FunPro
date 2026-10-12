/**
 * "Push stock to FunPay auto-delivery": writes items into the offer's native `secrets` field
 * (newline-separated goods) and turns `auto_delivery` on. FunPay then hands out the goods itself.
 *
 * Ordering matters to never sell the same goods twice: the chosen items are first marked `void`
 * locally (so FunPro will not reserve them), then the FunPay tab appends them to a freshly loaded
 * goods list and saves it in one step (`appendOfferSecrets`) — the existing goods never travel to the
 * background and are never written back from a stale copy. A definite FunPay rejection returns the
 * items to stock; an unknown outcome (network error) leaves them void and the push is marked
 * `uncertain` so the seller can check the offer and restore them explicitly.
 *
 * Capability `editOffer` is evidenced, not live-verified → the UI labels this "requires live verification".
 */
import type { OfferForm } from '@/adapters/funpay/types';
import { getDb } from '@/core/db/db';
import { log } from '@/core/log/logger';
import { OFFER_GOODS_LINE_MAX, OFFER_GOODS_MAX_LINES } from '@/core/messaging/protocol';
import { newId } from '@/core/util/id';
import type { InventoryItem } from '@/shared/models';
import { cleanItem, decryptItem } from './items';
import { availableCount } from './lowstock';
import { getPool } from './pools';

/** Size limit of the offer's goods list (enforced again by the content script). */
export const FUNPAY_SECRETS_LIMIT = 20_000;

export interface PushExec {
  /** Sanitized form: no CSRF token, goods replaced by `secretsInfo` (count/size). */
  getOfferForm: (offerId: string) => Promise<OfferForm>;
  /** Append goods on a fresh form inside the FunPay tab and enable auto-delivery. */
  appendSecrets: (
    offerId: string,
    lines: string[],
  ) => Promise<{ ok: boolean; errors: string[]; appended: number; duplicates: number }>;
}

export type PushStatus = 'pending' | 'done' | 'failed' | 'uncertain' | 'restored';

export interface PushRecord {
  id: string;
  poolId: string;
  offerId: string;
  itemIds: string[];
  status: PushStatus;
  at: number;
  error: string | null;
}

/** Size of the offer's goods list, or null when the offer has no goods field. */
function secretsInfoOf(form: OfferForm): { count: number; chars: number } | null {
  return form.secretsInfo ?? null;
}

async function assertLinked(poolId: string, offerId: string) {
  const pool = await getPool(poolId);
  if (!pool) throw new Error('Pool not found');
  if (!pool.listingIds.includes(offerId)) throw new Error('This offer is not linked to the pool');
  return pool;
}

export interface PushPreview {
  available: number;
  existingCount: number;
  existingChars: number;
  autoDeliveryOn: boolean;
  supported: boolean;
}

export async function previewPush(poolId: string, offerId: string, exec: PushExec): Promise<PushPreview> {
  await assertLinked(poolId, offerId);
  const form = await exec.getOfferForm(offerId);
  const existing = secretsInfoOf(form);
  return {
    available: await availableCount(poolId),
    existingCount: existing?.count ?? 0,
    existingChars: existing?.chars ?? 0,
    autoDeliveryOn: form.fields.some(([k, v]) => k === 'auto_delivery' && v !== ''),
    supported: existing !== null,
  };
}

export interface PushResult {
  pushId: string;
  status: PushStatus;
  pushed: number;
  errors: string[];
}

async function putRecord(r: PushRecord): Promise<void> {
  await getDb().kv.put({ key: `invpush:${r.id}`, value: r });
}

export async function pushToFunPay(
  poolId: string,
  offerId: string,
  count: number,
  exec: PushExec,
  now = Date.now(),
): Promise<PushResult> {
  const db = getDb();
  await assertLinked(poolId, offerId);
  const form = await exec.getOfferForm(offerId);
  const existing = secretsInfoOf(form);
  if (existing === null)
    throw new Error('This offer has no auto-delivery field on FunPay (the category may not support it)');

  const candidates = await db.inventoryItems
    .where('[poolId+status]')
    .equals([poolId, 'available'])
    .limit(Math.max(0, Math.trunc(count)))
    .toArray();
  const chosen: { item: InventoryItem; text: string }[] = [];
  let length = existing.chars;
  let tooLong = 0;
  for (const item of candidates) {
    if (chosen.length >= OFFER_GOODS_MAX_LINES) break;
    // cleanItem() folds line breaks, so one item is always exactly one line (one good) on FunPay.
    const text = cleanItem(await decryptItem(item));
    if (!text) continue;
    if (text.length > OFFER_GOODS_LINE_MAX) {
      tooLong++;
      continue;
    }
    const add = (length > 0 ? 1 : 0) + text.length;
    if (length + add > FUNPAY_SECRETS_LIMIT) break;
    chosen.push({ item, text });
    length += add;
  }
  if (chosen.length === 0)
    throw new Error(
      candidates.length === 0
        ? 'No available items in this pool'
        : tooLong === candidates.length
          ? `These items are longer than ${OFFER_GOODS_LINE_MAX} characters and cannot be pushed as goods`
          : 'The offer’s auto-delivery list is full (field limit reached)',
    );

  const pushId = newId('push');
  // Items are taken out of FunPro's stock (void) BEFORE FunPay gets them, so they can never be both
  // in FunPay's goods list and reservable here.
  const claimed = await db.transaction('rw', db.inventoryItems, db.kv, async () => {
    const ids: string[] = [];
    for (const c of chosen) {
      const n = await db.inventoryItems
        .where('id')
        .equals(c.item.id)
        .and((i: InventoryItem) => i.status === 'available' && i.orderId === null)
        .modify({ status: 'void' });
      if (n === 1) ids.push(c.item.id);
    }
    await db.kv.put({
      key: `invpush:${pushId}`,
      value: {
        id: pushId,
        poolId,
        offerId,
        itemIds: ids,
        status: 'pending',
        at: now,
        error: null,
      } satisfies PushRecord,
    });
    return ids;
  });
  const claimedSet = new Set(claimed);
  const lines = chosen.filter((c) => claimedSet.has(c.item.id)).map((c) => c.text);
  const record: PushRecord = {
    id: pushId,
    poolId,
    offerId,
    itemIds: claimed,
    status: 'pending',
    at: now,
    error: null,
  };
  if (claimed.length === 0) {
    await putRecord({ ...record, status: 'failed', error: 'Items changed meanwhile' });
    throw new Error('Items changed meanwhile — try again');
  }

  // The FunPay tab appends to a freshly loaded goods list and saves it in one step, so goods FunPay
  // handed out in the meantime are never written back.
  let res: Awaited<ReturnType<PushExec['appendSecrets']>>;
  try {
    res = await exec.appendSecrets(offerId, lines);
  } catch (e) {
    const msg = (e as Error).message;
    await putRecord({ ...record, status: 'uncertain', error: msg.slice(0, 300) });
    await log.warn({
      source: 'inventory',
      message: `Push to FunPay auto-delivery: outcome uncertain (${claimed.length} item(s) kept aside)`,
      hint: 'Open the offer on FunPay; if the goods are not there, restore them in Inventory.',
      details: { poolId, offerId },
    });
    return { pushId, status: 'uncertain', pushed: claimed.length, errors: [msg] };
  }
  if (!res.ok) {
    await revertItems(claimed);
    await putRecord({ ...record, status: 'failed', error: res.errors.join('; ').slice(0, 300) });
    await log.warn({
      source: 'inventory',
      message: `Push to FunPay auto-delivery rejected: ${res.errors.join('; ').slice(0, 200)}`,
      details: { poolId, offerId },
    });
    return { pushId, status: 'failed', pushed: 0, errors: res.errors };
  }
  await putRecord({ ...record, status: 'done' });
  await log.info({
    source: 'inventory',
    message: `Pushed ${res.appended} item(s) to FunPay auto-delivery for offer ${offerId} (${res.duplicates} already there); they are now marked void locally`,
    details: { poolId, offerId },
  });
  return { pushId, status: 'done', pushed: claimed.length, errors: [] };
}

async function revertItems(ids: readonly string[]): Promise<number> {
  const db = getDb();
  return db.transaction('rw', db.inventoryItems, async () => {
    let n = 0;
    for (const id of ids) {
      n += await db.inventoryItems
        .where('id')
        .equals(id)
        .and((i: InventoryItem) => i.status === 'void' && i.orderId === null)
        .modify({ status: 'available' });
    }
    return n;
  });
}

/** Return the items of an `uncertain` push to stock after the seller checked FunPay. */
export async function restorePush(pushId: string): Promise<number> {
  const rec = await getDb().kv.get(`invpush:${pushId}`);
  const r = rec?.value as PushRecord | undefined;
  if (!r) throw new Error('Push not found');
  if (r.status !== 'uncertain') throw new Error('Only pushes with an uncertain outcome can be restored');
  const n = await revertItems(r.itemIds);
  await putRecord({ ...r, status: 'restored' });
  await log.info({
    source: 'inventory',
    message: `Restored ${n} item(s) from an uncertain FunPay push`,
    details: { poolId: r.poolId },
  });
  return n;
}

export async function listPushes(poolId?: string): Promise<PushRecord[]> {
  const rows = await getDb().kv.where('key').startsWith('invpush:').toArray();
  return rows
    .map((r) => r.value as PushRecord)
    .filter((r) => r && (!poolId || r.poolId === poolId))
    .sort((a, b) => b.at - a.at);
}
