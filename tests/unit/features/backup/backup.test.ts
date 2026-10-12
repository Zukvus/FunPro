import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests, USER_DATA_TABLES } from '@/core/db/db';
import { decryptText, encryptText, resetCryptoCacheForTests, sha256Hex } from '@/core/security/crypto';
import { setSecret } from '@/core/security/secrets';
import { getSettings, updateSettings } from '@/core/settings/store';
import { createBackup } from '@/features/backup/backup';
import { BackupError, TABLE_ROW_SCHEMAS, type BackupEnvelope } from '@/features/backup/format';
import { openBackup, parseBackupText, restoreBackup } from '@/features/backup/restore';
import type { Customer, Listing, MessageTemplate, Order } from '@/shared/models';

const PASS = 'correct horse battery staple';

function listing(id: string, title = `Offer ${id}`): Listing {
  return {
    id,
    nodeId: '501',
    gameId: '41',
    categoryName: 'Game A',
    title,
    price: { amountMinor: 19999, currency: 'RUB' },
    amount: 5,
    active: true,
    promoted: false,
    autoDelivery: false,
    costMinor: null,
    sortIndex: 0,
    seenAt: '2024-11-05T07:15:00.000Z',
    updatedAt: '2024-11-05T07:15:00.000Z',
  };
}

function order(id: string): Order {
  return {
    id,
    direction: 'sale',
    status: 'paid',
    counterpartyName: 'BuyerAlpha',
    counterpartyId: '2000001',
    description: 'Item',
    categoryName: 'Game A',
    listingId: null,
    price: { amountMinor: 125050, currency: 'RUB' },
    createdAt: '2024-11-05T07:15:00.000Z',
    rawDate: '',
    firstSeenAt: '2024-11-05T07:15:00.000Z',
    updatedAt: '2024-11-05T07:15:00.000Z',
    history: [],
  };
}

const customer: Customer = {
  id: '2000001',
  name: 'BuyerAlpha',
  tags: ['vip'],
  notes: 'likes fast delivery',
  pinned: true,
  followUpAt: null,
  followUpNote: '',
  firstSeenAt: '2024-01-01',
  lastSeenAt: '2024-11-05',
};
const template: MessageTemplate = {
  id: 't1',
  name: 'Thanks',
  command: 'thanks',
  body: 'Thank you!',
  lang: 'any',
  tags: [],
  createdAt: '2024-01-01',
  updatedAt: '2024-01-01',
};

async function seed(): Promise<void> {
  const db = getDb();
  await db.listings.bulkPut([listing('9000001'), listing('9000002')]);
  await db.orders.put(order('AAAA1111'));
  await db.customers.put(customer);
  await db.templates.put(template);
  await db.balances.add({
    balances: [{ amountMinor: 152040, currency: 'RUB' }],
    at: '2024-11-05T07:00:00.000Z',
  });
  await db.drafts.put({
    id: 'd1',
    chatId: 'c1',
    triggerMessageId: null,
    source: 'ai',
    text: 'draft',
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    sendAt: null,
  });
  // A delivery draft contains rendered goods: it must never appear in a backup.
  await db.drafts.put({
    id: 'deliv1',
    chatId: 'c1',
    triggerMessageId: null,
    source: 'delivery',
    text: 'Your key: SECRET-GOODS-KEY-0001',
    status: 'pending',
    createdAt: 1,
    updatedAt: 1,
    sendAt: null,
  });
  await db.logs.add({ at: 1, level: 'info', source: 'test', message: 'log line' });
  await setSecret('telegram.botToken', '123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  await setSecret('ai.apiKey', 'sk-live-SECRETSECRETSECRET');
  await updateSettings({
    appearance: { theme: 'forest' },
    automation: { state: 'running', autoBump: true, liveActionsAcknowledged: true },
    general: { onboardingCompleted: true },
  });
}

beforeEach(async () => {
  resetDbForTests();
  resetCryptoCacheForTests();
});

describe('backup format', () => {
  it('has a row schema for every user data table', () => {
    expect(Object.keys(TABLE_ROW_SCHEMAS).sort()).toEqual([...USER_DATA_TABLES].sort());
  });
});

describe('plain backup round trip', () => {
  it('exports settings and user tables, but never secrets, keys, logs or tasks', async () => {
    await seed();
    const { json, counts, envelope } = await createBackup({
      appVersion: '0.1.0',
      now: new Date('2024-11-05T12:00:00Z'),
    });
    expect(envelope.encrypted).toBe(false);
    expect(counts).toMatchObject({
      listings: 2,
      orders: 1,
      customers: 1,
      templates: 1,
      balances: 1,
      drafts: 1,
    });
    expect(json).not.toContain('sk-live-SECRET');
    expect(json).not.toContain('123456789:AAAA');
    // Delivery drafts (rendered goods) are excluded; the ordinary AI draft is kept (drafts: 1).
    expect(json).not.toContain('SECRET-GOODS-KEY');
    for (const rec of await getDb().secrets.toArray()) {
      expect(json).not.toContain(rec.cipher);
      expect(json).not.toContain(rec.iv);
    }
    expect(json).not.toContain('"logs"');
    expect(json).not.toContain('"secrets"');
    expect(json).not.toContain('"keys"');
    expect(json).not.toContain('log line');
  });

  it('restores everything into an empty profile (replace)', async () => {
    await seed();
    const { json } = await createBackup({ appVersion: '0.1.0' });
    resetDbForTests();
    await updateSettings({ appearance: { theme: 'light' } });

    const plan = await openBackup(parseBackupText(json));
    expect(plan.report['listings']).toEqual({ valid: 2, invalid: 0 });
    expect(plan.header).toMatchObject({
      format: 'funpro-backup',
      version: 1,
      appVersion: '0.1.0',
      encrypted: false,
    });
    const res = await restoreBackup(plan, { mode: 'replace', restoreSettings: true });
    expect(res.restored).toMatchObject({
      listings: 2,
      orders: 1,
      customers: 1,
      templates: 1,
      balances: 1,
      drafts: 1,
    });
    const db = getDb();
    expect(await db.listings.get('9000002')).toMatchObject({ title: 'Offer 9000002' });
    expect(await db.customers.get('2000001')).toMatchObject({ notes: 'likes fast delivery', tags: ['vip'] });
    expect(await db.balances.count()).toBe(1);
    expect(await db.secrets.count()).toBe(0);
    const s = await getSettings();
    expect(s.appearance.theme).toBe('forest');
    expect(s.automation.autoBump).toBe(true);
  });

  it('never resumes automation or carries the live-actions consent from a backup', async () => {
    await seed();
    const { json } = await createBackup({ appVersion: '0.1.0' });
    resetDbForTests();
    await restoreBackup(await openBackup(parseBackupText(json)), { mode: 'replace', restoreSettings: true });
    const s = await getSettings();
    expect(s.automation.state).toBe('paused');
    expect(s.automation.liveActionsAcknowledged).toBe(false);
  });

  it('never carries consent to external integrations from a backup', async () => {
    await seed();
    await updateSettings({
      ai: {
        enabled: true,
        provider: 'openai',
        consentAt: 123,
        consentScope: 'openai|https://api.openai.com',
        autoPostReviewReplies: true,
      },
      telegram: { enabled: true, chatId: '42', consentAt: 456, remoteCommands: true, includePreviews: true },
    });
    const { json } = await createBackup({ appVersion: '0.1.0' });
    resetDbForTests();
    await restoreBackup(await openBackup(parseBackupText(json)), { mode: 'replace', restoreSettings: true });
    const s = await getSettings();
    expect(s.ai).toMatchObject({
      provider: 'openai',
      consentAt: null,
      consentScope: '',
      autoPostReviewReplies: false,
    });
    expect(s.telegram).toMatchObject({
      chatId: '42',
      consentAt: null,
      remoteCommands: false,
      includePreviews: false,
    });
  });

  it('detects a modified payload', async () => {
    await seed();
    const { envelope } = await createBackup({ appVersion: '0.1.0' });
    const tampered = structuredClone(envelope) as Extract<BackupEnvelope, { encrypted: false }>;
    (tampered.payload as { tables: Record<string, Listing[]> }).tables['listings']![0]!.title = 'changed';
    await expect(openBackup(parseBackupText(JSON.stringify(tampered)))).rejects.toMatchObject({
      code: 'tampered',
    });
  });
});

describe('encrypted backup', () => {
  it('round-trips with the right passphrase and hides contents', async () => {
    await seed();
    const { json, envelope } = await createBackup({ appVersion: '0.1.0', passphrase: PASS });
    expect(envelope.encrypted).toBe(true);
    expect(json).not.toContain('BuyerAlpha');
    expect(json).not.toContain('9000001');
    if (!envelope.encrypted) throw new Error('expected encrypted');
    expect(envelope.kdf).toMatchObject({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000 });
    resetDbForTests();
    const plan = await openBackup(parseBackupText(json), PASS);
    await restoreBackup(plan, { mode: 'replace', restoreSettings: false });
    expect(await getDb().orders.get('AAAA1111')).toMatchObject({ counterpartyName: 'BuyerAlpha' });
  });

  it('fails with a wrong or missing passphrase', async () => {
    await seed();
    const { json } = await createBackup({ appVersion: '0.1.0', passphrase: PASS });
    const env = parseBackupText(json);
    await expect(openBackup(env, 'wrong passphrase!')).rejects.toMatchObject({ code: 'decrypt_failed' });
    await expect(openBackup(env)).rejects.toMatchObject({ code: 'passphrase_required' });
  });

  it('fails when the ciphertext or the header was modified', async () => {
    await seed();
    const { envelope } = await createBackup({ appVersion: '0.1.0', passphrase: PASS });
    if (!envelope.encrypted) throw new Error('expected encrypted');
    const bytes = atob(envelope.cipher.data);
    const flipped = btoa(String.fromCharCode(bytes.charCodeAt(0) ^ 1) + bytes.slice(1));
    await expect(
      openBackup({ ...envelope, cipher: { ...envelope.cipher, data: flipped } }, PASS),
    ).rejects.toMatchObject({ code: 'decrypt_failed' });
    await expect(openBackup({ ...envelope, appVersion: '9.9.9' }, PASS)).rejects.toMatchObject({
      code: 'decrypt_failed',
    });
    await expect(
      openBackup({ ...envelope, createdAt: '2000-01-01T00:00:00.000Z' }, PASS),
    ).rejects.toMatchObject({ code: 'decrypt_failed' });
  });

  it('refuses weak passphrases', async () => {
    await expect(createBackup({ appVersion: '0.1.0', passphrase: 'short' })).rejects.toMatchObject({
      code: 'weak_passphrase',
    });
  });
});

describe('inventory items (opt-in)', () => {
  async function seedItem(): Promise<string> {
    const plaintext = 'KEY-AAAA-BBBB-CCCC';
    const enc = await encryptText(plaintext);
    await getDb().inventoryItems.put({
      id: 'i1',
      poolId: 'p1',
      ...enc,
      fingerprint: await sha256Hex(plaintext),
      status: 'available',
      orderId: null,
      reservedAt: null,
      deliveredAt: null,
      createdAt: '2024-01-01',
    });
    return plaintext;
  }

  it('are excluded by default and require an encrypted file to be included', async () => {
    await seedItem();
    const plain = await createBackup({ appVersion: '0.1.0' });
    expect(plain.json).not.toContain('inventoryItems');
    await expect(createBackup({ appVersion: '0.1.0', includeInventoryItems: true })).rejects.toMatchObject({
      code: 'inventory_requires_encryption',
    });
  });

  it('are re-encrypted with the target device key on restore', async () => {
    const plaintext = await seedItem();
    const { json } = await createBackup({
      appVersion: '0.1.0',
      passphrase: PASS,
      includeInventoryItems: true,
    });
    // A different device: fresh database and a new device key.
    resetDbForTests();
    resetCryptoCacheForTests();
    const plan = await openBackup(parseBackupText(json), PASS);
    expect(plan.report['inventoryItems']).toEqual({ valid: 1, invalid: 0 });
    await restoreBackup(plan, { mode: 'merge', restoreSettings: false });
    const item = (await getDb().inventoryItems.get('i1'))!;
    expect(item.cipher).not.toContain(plaintext);
    expect(await decryptText(item)).toBe(plaintext);
  });
});

describe('restore modes', () => {
  it('merge keeps local rows and upserts imported ones; replace drops local rows', async () => {
    await seed();
    const { json } = await createBackup({ appVersion: '0.1.0' });
    const db = getDb();
    // Local changes after the backup was taken.
    await db.listings.put(listing('9000003', 'Local only'));
    await db.listings.put(listing('9000001', 'Edited locally'));
    await db.balances.add({
      balances: [{ amountMinor: 1, currency: 'RUB' }],
      at: '2024-11-06T00:00:00.000Z',
    });

    const plan = await openBackup(parseBackupText(json));
    await restoreBackup(plan, { mode: 'merge', restoreSettings: false });
    expect((await db.listings.toArray()).map((l) => l.id).sort()).toEqual(['9000001', '9000002', '9000003']);
    expect((await db.listings.get('9000001'))!.title).toBe('Offer 9000001');
    // Balance snapshots are deduplicated by timestamp (auto-increment ids differ per device).
    expect(await db.balances.count()).toBe(2);

    await restoreBackup(plan, { mode: 'replace', restoreSettings: false });
    expect((await db.listings.toArray()).map((l) => l.id).sort()).toEqual(['9000001', '9000002']);
    expect(await db.balances.count()).toBe(1);
  });

  it('skips invalid rows and reports them; is all-or-nothing', async () => {
    await seed();
    const { envelope } = await createBackup({ appVersion: '0.1.0' });
    if (envelope.encrypted) throw new Error('expected plain');
    const payload = envelope.payload as { tables: Record<string, unknown[]> };
    payload.tables['listings']!.push({ id: 42, title: null });
    payload.tables['templates']!.push('not an object');
    payload.tables['futureTable'] = [{ id: 'x' }];
    const doctored = { ...envelope, sha256: await sha256Hex(JSON.stringify(envelope.payload)) };
    const plan = await openBackup(parseBackupText(JSON.stringify(doctored)));
    expect(plan.report['listings']).toEqual({ valid: 2, invalid: 1 });
    expect(plan.report['templates']).toEqual({ valid: 1, invalid: 1 });
    expect(plan.unknownTables).toEqual(['futureTable']);

    // A failing write rolls back every table of the restore.
    resetDbForTests();
    await getDb().listings.put(listing('LOCAL'));
    const broken = {
      ...plan,
      tables: { ...plan.tables, orders: [{ ...plan.tables.orders![0], id: undefined }] },
    };
    await expect(restoreBackup(broken, { mode: 'replace', restoreSettings: false })).rejects.toBeTruthy();
    expect((await getDb().listings.toArray()).map((l) => l.id)).toEqual(['LOCAL']);
  });

  it('rejects files that are not FunPro backups', () => {
    expect(() => parseBackupText('not json')).toThrow(BackupError);
    expect(() => parseBackupText('{"format":"other"}')).toThrowError(
      expect.objectContaining({ code: 'not_a_backup' }),
    );
    expect(() => parseBackupText('{"format":"funpro-backup","version":2}')).toThrowError(
      expect.objectContaining({ code: 'unsupported_version' }),
    );
    expect(() => parseBackupText('{"format":"funpro-backup","version":1,"encrypted":false}')).toThrowError(
      expect.objectContaining({ code: 'invalid_format' }),
    );
  });
});
