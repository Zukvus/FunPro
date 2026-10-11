import { emitEvent } from './bus';

export interface AutomationFailure {
  /** Feature / module that failed, e.g. 'auto-reply', 'bump', 'delivery'. */
  source: string;
  /** Human-readable, already redacted/short message. */
  message: string;
  /** Optional FunPay link for context (validated again by consumers). */
  url?: string | null;
  /** The caller already showed a notification for this failure (consumers must not notify again). */
  notified?: boolean;
  /** Set for failures produced while running workflow actions (loop prevention). */
  origin?: 'workflow';
  /** Extra stable key part (e.g. order id) so distinct failures are not merged. */
  key?: string;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * Emit AUTOMATION_FAILED (workflow trigger, notification and Telegram source). The same failure of
 * the same source is reported at most once per hour, so a broken integration cannot flood the user.
 */
export async function reportAutomationFailure(f: AutomationFailure, now = Date.now()): Promise<boolean> {
  const bucket = Math.floor(now / 3600_000);
  const dedupe = `${f.source}:${f.key ?? hash(f.message)}:${bucket}`;
  return emitEvent('AUTOMATION_FAILED', dedupe, {
    source: f.source,
    message: f.message.slice(0, 500),
    url: f.url ?? null,
    notified: f.notified === true,
    ...(f.origin ? { origin: f.origin, workflowDepth: 1 } : {}),
  });
}
