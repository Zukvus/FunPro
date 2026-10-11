/**
 * Follow-up reminders: when a customer's `followUpAt` passes, the seller is notified once per
 * follow-up time (changing the time re-arms the reminder). Reminders only notify; they never
 * contact the buyer.
 */
import { getDb } from '@/core/db/db';
import type { NotifyInput } from '@/features/notifications/notify';
import { dueFollowUps } from './customers';

const notifiedKey = (customerId: string) => `crm:followUpNotified:${customerId}`;

export interface FollowUpDeps {
  now: number;
  notify: (input: NotifyInput) => Promise<unknown>;
  /** Link opened from the notification (e.g. the dashboard customer page). */
  urlFor: (customerId: string) => string | null;
}

/** Notify due follow-ups that were not notified for their current time yet. Returns the count. */
export async function processFollowUps(deps: FollowUpDeps): Promise<number> {
  const db = getDb();
  let count = 0;
  for (const c of await dueFollowUps(deps.now)) {
    if (!c.followUpAt) continue;
    const marker = await db.kv.get(notifiedKey(c.id));
    if (marker?.value === c.followUpAt) continue;
    await db.kv.put({ key: notifiedKey(c.id), value: c.followUpAt });
    await deps.notify({
      kind: 'system',
      title: `Follow up: ${c.name}`,
      body: c.followUpNote || 'Reminder from your customer notes in FunPro.',
      url: deps.urlFor(c.id),
      dedupeKey: `followup:${c.id}:${c.followUpAt}`,
    });
    count++;
  }
  return count;
}

export async function isFollowUpNotified(customerId: string, followUpAt: string): Promise<boolean> {
  return (await getDb().kv.get(notifiedKey(customerId)))?.value === followUpAt;
}
