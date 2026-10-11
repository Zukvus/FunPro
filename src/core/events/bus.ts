import type { DomainEvent, EventType } from '@/shared/models';
import { getDb } from '../db/db';

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

const handlers = new Map<EventType, Set<EventHandler>>();
const EVENT_RETENTION_MS = 30 * 24 * 3600_000;

export function onEvent(type: EventType, handler: EventHandler): () => void {
  let set = handlers.get(type);
  if (!set) handlers.set(type, (set = new Set()));
  set.add(handler);
  return () => set.delete(handler);
}

export function clearEventHandlersForTests(): void {
  handlers.clear();
}

/**
 * Emit a domain event. Events are deduplicated by their deterministic id: emitting the same id twice
 * (e.g. after a service-worker restart re-parses the same page) is a no-op and returns false.
 */
export async function emitEvent(
  type: EventType,
  dedupeKey: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const db = getDb();
  const id = `${type}:${dedupeKey}`;
  const event: DomainEvent = { id, type, at: new Date().toISOString(), payload, handledBy: [] };
  const inserted = await db.transaction('rw', db.events, async () => {
    if (await db.events.get(id)) return false;
    await db.events.add(event);
    return true;
  });
  if (!inserted) return false;
  await dispatch(event);
  return true;
}

async function dispatch(event: DomainEvent): Promise<void> {
  const set = handlers.get(event.type);
  if (!set) return;
  for (const h of set) {
    try {
      await h(event);
    } catch (e) {
      // Handlers are isolated: one failing feature never prevents the others from running.
      console.warn('[FunPro] event handler failed', event.type, e instanceof Error ? e.message : e);
    }
  }
}

/** Mark that a handler (e.g. workflow rule) processed an event — for idempotent actions. */
export async function markHandled(eventId: string, handlerId: string): Promise<boolean> {
  const db = getDb();
  return db.transaction('rw', db.events, async () => {
    const ev = await db.events.get(eventId);
    if (!ev || ev.handledBy.includes(handlerId)) return false;
    await db.events.update(eventId, { handledBy: [...ev.handledBy, handlerId] });
    return true;
  });
}

export async function pruneEvents(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - EVENT_RETENTION_MS).toISOString();
  return getDb().events.where('at').below(cutoff).delete();
}
