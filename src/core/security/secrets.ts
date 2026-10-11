/**
 * Secrets (AI API keys, Telegram bot tokens) are encrypted with the device key and stored in the
 * extension-origin IndexedDB. They are never placed in browser.storage (which content scripts can
 * read), never sent to content scripts, and never logged.
 */
import { getDb } from '../db/db';
import { decryptText, encryptText } from './crypto';

export type SecretName = 'ai.apiKey' | 'telegram.botToken';

export async function setSecret(name: SecretName, value: string): Promise<void> {
  const db = getDb();
  if (!value) {
    await db.secrets.delete(name);
    return;
  }
  const enc = await encryptText(value);
  await db.secrets.put({ name, ...enc, updatedAt: Date.now() });
}

export async function getSecret(name: SecretName): Promise<string | null> {
  const rec = await getDb().secrets.get(name);
  if (!rec) return null;
  try {
    return await decryptText(rec);
  } catch {
    return null;
  }
}

export async function hasSecret(name: SecretName): Promise<boolean> {
  return (await getDb().secrets.get(name)) !== undefined;
}

export async function deleteSecret(name: SecretName): Promise<void> {
  await getDb().secrets.delete(name);
}
