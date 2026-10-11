import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/core/db/db';
import {
  cleanItem,
  decryptExport,
  decryptItem,
  exportEncrypted,
  exportPlain,
  fingerprintItem,
  importItems,
  itemsFromCsv,
  normalizeItem,
  revealItem,
  splitLines,
} from '@/features/inventory/items';
import { deletePool } from '@/features/inventory/pools';
import { freshDb, makePool } from './helpers';

beforeEach(() => {
  freshDb();
});

async function dumpAtRest(): Promise<string> {
  const db = getDb();
  const [items, logs, kv, pools, events] = await Promise.all([db.inventoryItems.toArray(), db.logs.toArray(), db.kv.toArray(), db.inventoryPools.toArray(), db.events.toArray()]);
  return JSON.stringify({ items, logs, kv, pools, events });
}

describe('encryption at rest', () => {
  it('round-trips items and never stores plaintext', async () => {
    const pool = await makePool();
    const secrets = ['AAAA-BBBB-CCCC-0001', 'login:hunter2-password', 'Ключ-кириллица-777'];
    const res = await importItems(pool.id, secrets);
    expect(res.added).toBe(3);
    const stored = await getDb().inventoryItems.where('poolId').equals(pool.id).toArray();
    expect(stored).toHaveLength(3);
    const dump = await dumpAtRest();
    for (const s of secrets) expect(dump).not.toContain(s);
    const decrypted = await Promise.all(stored.map((i) => decryptItem(i)));
    expect(decrypted.sort()).toEqual([...secrets].sort());
    for (const i of stored) {
      expect(i.status).toBe('available');
      expect(i.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(i.cipher).not.toContain('AAAA');
    }
  });

  it('reveal decrypts on demand without persisting or logging the item', async () => {
    const pool = await makePool();
    await importItems(pool.id, ['REVEAL-ME-123']);
    const [item] = await getDb().inventoryItems.toArray();
    expect(await revealItem(item!.id)).toBe('REVEAL-ME-123');
    expect(await dumpAtRest()).not.toContain('REVEAL-ME-123');
  });

  it('keeps items in FIFO order (time-sortable ids)', async () => {
    const pool = await makePool();
    await importItems(pool.id, ['first-item'], 1000);
    await importItems(pool.id, ['second-item'], 2000);
    const ordered = await getDb().inventoryItems.where('[poolId+status]').equals([pool.id, 'available']).toArray();
    expect(await Promise.all(ordered.map((i) => decryptItem(i)))).toEqual(['first-item', 'second-item']);
  });
});

describe('import validation', () => {
  it('rejects duplicates inside the batch and against stored items (unique fingerprint)', async () => {
    const a = await makePool({ name: 'A' });
    const b = await makePool({ name: 'B', matchText: [] });
    const first = await importItems(a.id, ['key-1', 'key-2', ' key-1 ', 'key-3', '', '   ']);
    expect(first).toMatchObject({ added: 3, duplicatesInBatch: 1, duplicatesExisting: 0, empty: 2 });
    // The unique index is global: the same goods can't be added to another pool either.
    const second = await importItems(b.id, ['key-2', 'key 4', 'key   4']);
    expect(second).toMatchObject({ added: 1, duplicatesInBatch: 1, duplicatesExisting: 1 });
    expect(await getDb().inventoryItems.count()).toBe(4);
  });

  it('reports concurrent imports of the same goods as duplicates instead of failing', async () => {
    const pool = await makePool();
    const [r1, r2] = await Promise.all([importItems(pool.id, ['race-1', 'race-2']), importItems(pool.id, ['race-2', 'race-3'])]);
    expect(r1.added + r2.added).toBe(3);
    expect(r1.duplicatesExisting + r2.duplicatesExisting).toBe(1);
    expect(await getDb().inventoryItems.count()).toBe(3);
  });

  it('rejects over-long items and strips invisible characters', async () => {
    const pool = await makePool();
    const res = await importItems(pool.id, ['x'.repeat(1001), 'ab\u200bcd']);
    expect(res).toMatchObject({ added: 1, tooLong: 1 });
    const [item] = await getDb().inventoryItems.toArray();
    expect(await decryptItem(item!)).toBe('abcd');
  });

  it('normalises whitespace for fingerprints only', async () => {
    expect(normalizeItem('  a\t\tb  ')).toBe('a b');
    expect(cleanItem('  a  b \r\n')).toBe('a  b');
    expect(await fingerprintItem('a b')).toBe(await fingerprintItem(' a   b '));
  });

  it('splits pasted text and CSV first columns', () => {
    expect(splitLines('\ufeffa\r\nb\nc\r')).toEqual(['a', 'b', 'c', '']);
    expect(itemsFromCsv('"k,1",x\nk2,y\n')).toEqual(['k,1', 'k2']);
    expect(itemsFromCsv('k1;a\nk2;b')).toEqual(['k1', 'k2']);
  });
});

describe('export', () => {
  it('exports only remaining items, optionally passphrase-encrypted', async () => {
    const pool = await makePool();
    await importItems(pool.id, ['e-1', 'e-2', 'e-3']);
    const [, second] = await getDb().inventoryItems.toArray();
    await getDb().inventoryItems.update(second!.id, { status: 'delivered' });
    expect(await exportPlain(pool.id)).toEqual({ text: 'e-1\ne-3', count: 2 });
    const file = await exportEncrypted(pool.id, 'correct horse battery');
    expect(JSON.stringify(file)).not.toContain('e-1');
    expect(await decryptExport(file, 'correct horse battery')).toEqual(['e-1', 'e-3']);
    await expect(decryptExport(file, 'wrong passphrase!')).rejects.toThrow(/passphrase/i);
    await expect(exportEncrypted(pool.id, 'short')).rejects.toThrow();
  });
});

describe('pool deletion', () => {
  it('refuses while items are reserved, otherwise deletes items too', async () => {
    const pool = await makePool();
    await importItems(pool.id, ['d-1', 'd-2']);
    const [item] = await getDb().inventoryItems.toArray();
    await getDb().inventoryItems.update(item!.id, { status: 'reserved', orderId: 'X' });
    await expect(deletePool(pool.id)).rejects.toThrow(/reserved/);
    await getDb().inventoryItems.update(item!.id, { status: 'delivered' });
    await deletePool(pool.id);
    expect(await getDb().inventoryItems.count()).toBe(0);
    expect(await getDb().inventoryPools.count()).toBe(0);
  });
});
