import { browser } from 'wxt/browser';

type AlarmHandler = (name: string) => Promise<void> | void;
const alarmHandlers = new Map<string, AlarmHandler>();
const running = new Set<string>();

/** Register a handler for an alarm name (or prefix ending with ':*'). */
export function onAlarm(name: string, handler: AlarmHandler): void {
  alarmHandlers.set(name, handler);
}

export async function dispatchAlarm(name: string): Promise<void> {
  const handler = alarmHandlers.get(name) ?? [...alarmHandlers.entries()].find(([k]) => k.endsWith(':*') && name.startsWith(k.slice(0, -1)))?.[1];
  if (!handler) return;
  // Re-entrancy guard: a slow handler is not started twice in parallel within one worker lifetime.
  if (running.has(name)) return;
  running.add(name);
  try {
    await handler(name);
  } catch (e) {
    console.warn('[FunPro] alarm handler failed', name, e instanceof Error ? e.message : e);
  } finally {
    running.delete(name);
  }
}

/** Create a periodic alarm only if it does not exist or its period changed (idempotent on SW restart). */
export async function ensurePeriodicAlarm(name: string, periodInMinutes: number, delayInMinutes = 0.5): Promise<void> {
  const existing = await browser.alarms.get(name);
  if (existing && existing.periodInMinutes === periodInMinutes) return;
  await browser.alarms.create(name, { periodInMinutes, delayInMinutes });
}

/** Schedule a one-shot alarm at `when` (epoch ms). Chrome clamps to ≥30 s in the future. */
export async function scheduleAt(name: string, when: number): Promise<void> {
  await browser.alarms.create(name, { when: Math.max(when, Date.now() + 30_000) });
}

export async function clearAlarm(name: string): Promise<void> {
  await browser.alarms.clear(name);
}
