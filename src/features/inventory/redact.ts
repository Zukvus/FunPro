/**
 * Inventory leak protection shared by every path where text leaves the device (Telegram, AI).
 * Any fragment whose SHA-256 equals a stored inventory item fingerprint (see
 * InventoryItem.fingerprint) is replaced — delivered or stocked goods must never be forwarded.
 */
import { getDb } from '@/core/db/db';
import { sha256Hex } from '@/core/security/crypto';

export const HIDDEN = '[hidden]';

export function inventoryCandidates(text: string): string[] {
  const set = new Set<string>();
  const add = (s: string) => {
    const t = s.trim();
    if (t.length >= 4 && t.length <= 4000) set.add(t);
  };
  add(text);
  for (const line of text.split(/\r?\n/)) add(line);
  for (const part of text.split(/[,;|]/)) add(part);
  for (const tok of text.split(/\s+/)) {
    add(tok);
    add(tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  }
  return [...set].slice(0, 400);
}

/** Fingerprints are SHA-256 hex of the item plaintext (see InventoryItem.fingerprint). */
export async function redactInventoryItems(text: string): Promise<string> {
  if (!text.trim()) return text;
  const candidates = inventoryCandidates(text);
  const hashes = await Promise.all(candidates.map((c) => sha256Hex(c)));
  const items = await getDb().inventoryItems.where('fingerprint').anyOf(hashes).toArray();
  if (items.length === 0) return text;
  const hit = new Set(items.map((i) => i.fingerprint));
  const matched = candidates.filter((_, i) => hit.has(hashes[i]!)).sort((a, b) => b.length - a.length);
  let out = text;
  for (const m of matched) out = out.split(m).join(HIDDEN);
  return out;
}
