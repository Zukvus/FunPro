import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, resetDbForTests } from '@/core/db/db';
import { resetCryptoCacheForTests } from '@/core/security/crypto';
import { setSecret } from '@/core/security/secrets';
import { updateSettings } from '@/core/settings/store';
import { buildDiagnosticReport, redactSettingsForDiagnostics } from '@/features/diagnostics/report';
import { defaultSettings } from '@/core/settings/schema';

const BOT_TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawZ';
const API_KEY = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
const GOLDEN = 'golden_key=abcdef0123456789abcdef0123456789';

const env = {
  extensionVersion: '0.1.0',
  manifestVersion: 3,
  userAgent: 'Mozilla/5.0 Test',
  language: 'ru-RU',
  platform: 'Linux',
};

beforeEach(() => {
  resetDbForTests();
  resetCryptoCacheForTests();
});

async function seedSecrets(): Promise<void> {
  await setSecret('telegram.botToken', BOT_TOKEN);
  await setSecret('ai.apiKey', API_KEY);
  await updateSettings({
    telegram: { enabled: true, chatId: '987654321' },
    ai: {
      enabled: true,
      provider: 'openai_compatible',
      baseUrl: `https://user:${API_KEY}@llm.example.com/v1?key=${API_KEY}`,
    },
    messages: { welcomeText: `Hi! my token is ${BOT_TOKEN}`, postOrderText: 'Thanks BuyerAlpha' },
    appearance: { profileBadge: 'Top seller', backgroundImageAssetId: 'bg_123' },
  });
  const db = getDb();
  // Written directly (bypassing the redacting logger) to prove the report redacts again.
  await db.logs.bulkAdd([
    {
      at: 1,
      level: 'error',
      source: 'telegram',
      message: `send failed for ${BOT_TOKEN}`,
      details: { token: BOT_TOKEN, apiKey: API_KEY, note: GOLDEN },
    },
    { at: 2, level: 'info', source: 'ai', message: `Authorization: Bearer ${API_KEY}` },
  ]);
  await db.tasks.put({
    id: 't1',
    kind: 'send_message',
    status: 'failed',
    idempotencyKey: 'msg:1',
    payload: { chatId: 'users-1-2', text: `private message with ${BOT_TOKEN}` },
    attempts: 1,
    maxAttempts: 1,
    nextRunAt: 0,
    lastError: `Outcome uncertain: ${API_KEY}`,
    createdAt: 1,
    updatedAt: 2,
  });
}

describe('diagnostic report', () => {
  it('contains no secrets, ciphertexts, tokens or free-text settings', async () => {
    await seedSecrets();
    const report = await buildDiagnosticReport({ env, statuses: [] });
    const json = JSON.stringify(report);
    for (const forbidden of [
      BOT_TOKEN,
      API_KEY,
      'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawZ',
      'abcdef0123456789abcdef0123456789',
      '987654321',
      'Top seller',
      'BuyerAlpha',
      'private message',
      'bg_123',
      'user:',
    ]) {
      expect(json, forbidden).not.toContain(forbidden);
    }
    for (const rec of await getDb().secrets.toArray()) {
      expect(json).not.toContain(rec.cipher);
      expect(json).not.toContain(rec.iv);
    }
    expect(report.secretsConfigured).toEqual({ 'ai.apiKey': true, 'telegram.botToken': true });
  });

  it('includes versions, environment, flags, capabilities, table counts, task summary and recent logs', async () => {
    await seedSecrets();
    const report = await buildDiagnosticReport({
      env,
      statuses: [{ feature: 'autoBump', status: 'disabled', reason: 'Turned off in settings' }],
      background: { trackedFunPayTabs: 1 },
    });
    expect(report.report.format).toBe('funpro-diagnostics');
    expect(report.versions).toMatchObject({
      extension: '0.1.0',
      manifest: 3,
      adapter: 'funpay-dom-v1',
      settingsSchema: 1,
    });
    expect(report.versions.database).toBeGreaterThanOrEqual(1);
    expect(report.environment).toEqual({
      userAgent: 'Mozilla/5.0 Test',
      language: 'ru-RU',
      platform: 'Linux',
    });
    expect(report.flags['nicknameSync']).toBe(false);
    expect(report.capabilities.find((c) => c.id === 'sendMessage')).toMatchObject({
      status: 'evidenced',
      mutating: true,
    });
    expect(report.tables).toMatchObject({ logs: 2, tasks: 1, secrets: 2 });
    expect(report.tasks.byStatus).toEqual({ failed: 1 });
    expect(report.tasks.recentFailures[0]).toMatchObject({ kind: 'send_message', attempts: 1 });
    expect(report.tasks.recentFailures[0]).not.toHaveProperty('payload');
    expect(report.logs.map((l) => l.at)).toEqual([2, 1]);
    expect(report.automation.statuses).toHaveLength(1);
    expect(report.background).toEqual({ trackedFunPayTabs: 1 });
  });

  it('limits the log section to the most recent entries', async () => {
    await getDb().logs.bulkAdd(
      Array.from({ length: 250 }, (_, i) => ({
        at: i,
        level: 'info' as const,
        source: 's',
        message: `m${i}`,
      })),
    );
    const report = await buildDiagnosticReport({ env });
    expect(report.logs).toHaveLength(200);
    expect(report.logs[0]!.message).toBe('m249');
  });

  it('reduces free-text settings to summaries', () => {
    const s = defaultSettings();
    s.messages.welcomeText = 'Hello there';
    s.ai.baseUrl = 'http://localhost:11434/v1/chat';
    const red = redactSettingsForDiagnostics(s) as typeof s;
    expect(red.messages.welcomeText).toBe('[text: 11 chars]');
    expect(red.ai.baseUrl).toBe('http://localhost:11434');
    expect(red.appearance.theme).toBe('system');
  });
});
