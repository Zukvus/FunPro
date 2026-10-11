import type { ActivityLogEntry, LogLevel } from '@/shared/models';
import { getDb } from '../db/db';
import { redact, redactString } from './redact';

const MAX_LOG_ENTRIES = 5000;
let writesSinceTrim = 0;

export interface LogInput {
  source: string;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}

async function write(level: LogLevel, input: LogInput): Promise<void> {
  const entry: ActivityLogEntry = {
    at: Date.now(),
    level,
    source: input.source,
    message: redactString(input.message, 1000),
    ...(input.hint ? { hint: redactString(input.hint, 500) } : {}),
    ...(input.details ? { details: redact(input.details) as Record<string, unknown> } : {}),
  };
  try {
    const db = getDb();
    await db.logs.add(entry);
    if (++writesSinceTrim >= 100) {
      writesSinceTrim = 0;
      const count = await db.logs.count();
      if (count > MAX_LOG_ENTRIES) {
        const excess = await db.logs.orderBy('id').limit(count - MAX_LOG_ENTRIES).primaryKeys();
        await db.logs.bulkDelete(excess);
      }
    }
  } catch {
    // Logging must never break the caller. Fall back to the console (already redacted).
    console.warn('[FunPro]', level, entry.source, entry.message);
  }
}

export const log = {
  debug: (i: LogInput) => write('debug', i),
  info: (i: LogInput) => write('info', i),
  warn: (i: LogInput) => write('warn', i),
  error: (i: LogInput) => write('error', i),
};
