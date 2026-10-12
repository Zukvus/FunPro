import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/db';
import { encryptText } from '@/core/security/crypto';
import { fingerprintItem, importItems, MAX_ITEM_LENGTH, newItemId } from '@/features/inventory/items';
import { previewPush, pushToFunPay, type PushExec } from '@/features/inventory/push';
import type { OfferForm } from '@/adapters/funpay/types';
import { OFFER_GOODS_LINE_MAX } from '@/core/messaging/protocol';
import { freshDb, makePool } from './helpers';

beforeEach(() => freshDb());

const FORM: OfferForm = {
  offerId: '777',
  nodeId: '1',
  currencyText: '₽',
  fields: [
    ['offer_id', '777'],
    ['auto_delivery', ''],
  ],
  buyerPrices: [],
  secretsInfo: { count: 1, chars: 5 },
};

function exec(
  result: Awaited<ReturnType<PushExec['appendSecrets']>> | Error,
): PushExec & { sent: string[][] } {
  const sent: string[][] = [];
  return {
    sent,
    getOfferForm: async () => FORM,
    appendSecrets: async (_offerId, lines) => {
      sent.push(lines);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** Imports cap item length; older data or a restore could still hold a longer item. */
async function addRawItem(poolId: string, text: string): Promise<void> {
  const enc = await encryptText(text);
  await getDb().inventoryItems.add({
    id: newItemId(),
    poolId,
    cipher: enc.cipher,
    iv: enc.iv,
    fingerprint: await fingerprintItem(text),
    status: 'available',
    orderId: null,
    reservedAt: null,
    deliveredAt: null,
    createdAt: new Date().toISOString(),
  });
}

async function setup() {
  const pool = await makePool({ listingIds: ['777'] });
  await importItems(pool.id, ['GOODS-1', 'GOODS-2']);
  return pool;
}

describe('push stock to FunPay auto-delivery', () => {
  it('previews from the sanitized form (size only)', async () => {
    const pool = await setup();
    expect(
      await previewPush(pool.id, '777', exec({ ok: true, errors: [], appended: 0, duplicates: 0 })),
    ).toMatchObject({ available: 2, existingCount: 1, existingChars: 5, supported: true });
  });

  it('voids items before handing them to FunPay and marks the push done', async () => {
    const pool = await setup();
    const e = exec({ ok: true, errors: [], appended: 2, duplicates: 0 });
    const r = await pushToFunPay(pool.id, '777', 5, e);
    expect(r).toMatchObject({ status: 'done', pushed: 2 });
    expect(e.sent[0]!.sort()).toEqual(['GOODS-1', 'GOODS-2']);
    expect(await getDb().inventoryItems.where('status').equals('void').count()).toBe(2);
  });

  it('returns items to stock when FunPay rejects, keeps them aside when the outcome is unknown', async () => {
    const pool = await setup();
    expect(
      (
        await pushToFunPay(
          pool.id,
          '777',
          5,
          exec({ ok: false, errors: ['nope'], appended: 0, duplicates: 0 }),
        )
      ).status,
    ).toBe('failed');
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(2);
    expect((await pushToFunPay(pool.id, '777', 5, exec(new Error('tab closed')))).status).toBe('uncertain');
    expect(await getDb().inventoryItems.where('status').equals('void').count()).toBe(2);
  });

  it('never sends a goods line longer than the command allows (it stays in stock)', async () => {
    const pool = await makePool({ listingIds: ['777'] });
    await importItems(pool.id, ['SHORT-1']);
    await addRawItem(pool.id, 'x'.repeat(OFFER_GOODS_LINE_MAX + 1));
    const e = exec({ ok: true, errors: [], appended: 1, duplicates: 0 });
    expect((await pushToFunPay(pool.id, '777', 5, e)).status).toBe('done');
    expect(e.sent).toEqual([['SHORT-1']]);
    expect(await getDb().inventoryItems.where('status').equals('available').count()).toBe(1);
  });

  it('explains when every candidate is too long to be a goods line', async () => {
    const pool = await makePool({ listingIds: ['777'] });
    await addRawItem(pool.id, 'y'.repeat(OFFER_GOODS_LINE_MAX + 5));
    const e = exec({ ok: true, errors: [], appended: 0, duplicates: 0 });
    await expect(pushToFunPay(pool.id, '777', 5, e)).rejects.toThrow(/longer than/);
    expect(e.sent).toHaveLength(0);
    expect(await getDb().inventoryItems.where('status').equals('void').count()).toBe(0);
  });

  it('imports can never produce an item too long to push as a goods line', () => {
    expect(MAX_ITEM_LENGTH).toBeLessThanOrEqual(OFFER_GOODS_LINE_MAX);
  });

  it('refuses offers that are not linked to the pool', async () => {
    const pool = await setup();
    await expect(
      pushToFunPay(pool.id, '999', 1, exec({ ok: true, errors: [], appended: 1, duplicates: 0 })),
    ).rejects.toThrow();
  });
});
