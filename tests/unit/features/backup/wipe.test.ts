import { storage } from 'wxt/utils/storage';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { getDeviceKey, resetCryptoCacheForTests } from '@/core/security/crypto';
import { getSecret, setSecret } from '@/core/security/secrets';
import { getSettings, updateSettings } from '@/core/settings/store';
import { wipeAllLocalData } from '@/features/backup/wipe';

beforeEach(() => {
  resetDbForTests();
  resetCryptoCacheForTests();
});

describe('delete all local data', () => {
  it('clears every IndexedDB table (incl. secrets, keys, assets, logs, tasks) and extension storage', async () => {
    const db = getDb();
    await setSecret('ai.apiKey', 'sk-test-1234567890');
    await db.listings.put({ id: '1', nodeId: null, gameId: null, categoryName: '', title: 't', price: { amountMinor: 1, currency: 'RUB' }, amount: null, active: true, promoted: false, autoDelivery: false, costMinor: null, sortIndex: 0, seenAt: 'x', updatedAt: 'x' });
    await db.logs.add({ at: 1, level: 'info', source: 's', message: 'm' });
    await db.kv.put({ key: 'k', value: 1 });
    await db.tasks.put({ id: 't', kind: 'bump', status: 'pending', idempotencyKey: 'k', payload: {}, attempts: 0, maxAttempts: 3, nextRunAt: 0, lastError: null, createdAt: 0, updatedAt: 0 });
    await updateSettings({ appearance: { theme: 'midnight' }, general: { onboardingCompleted: true } });
    await storage.setItem('session:funpayTabs', { '1': { tabId: 1 } });
    expect(await db.keys.count()).toBe(1);

    const res = await wipeAllLocalData();
    expect(res.tablesCleared).toBe(db.tables.length);
    expect(res.rowsDeleted).toBeGreaterThanOrEqual(6);
    for (const t of db.tables) expect(await t.count(), t.name).toBe(0);
    expect(await storage.snapshot('local')).toEqual({});
    expect(await storage.snapshot('session')).toEqual({});
    const s = await getSettings();
    expect(s.appearance.theme).toBe('system');
    expect(s.general.onboardingCompleted).toBe(false);
  });

  it('a new device key is created after the wipe (old secrets are gone, new ones work)', async () => {
    await setSecret('ai.apiKey', 'sk-old-1234567890');
    const before = await getDeviceKey();
    await wipeAllLocalData();
    expect(await getSecret('ai.apiKey')).toBeNull();
    const after = await getDeviceKey();
    expect(after).not.toBe(before);
    await setSecret('ai.apiKey', 'sk-new-1234567890');
    resetCryptoCacheForTests();
    expect(await getSecret('ai.apiKey')).toBe('sk-new-1234567890');
  });
});
