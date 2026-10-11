import { CAPABILITIES } from '@/adapters/funpay/capabilities';
import { ADAPTER_VERSION } from '@/adapters/funpay/v1/selectors';
import type { FeatureStatus } from '@/core/automation/policy';
import { getDb } from '@/core/db/db';
import { redact, redactString } from '@/core/log/redact';
import type { Settings } from '@/core/settings/schema';
import { getSettings } from '@/core/settings/store';
import type { ActivityLogEntry, Task } from '@/shared/models';
import { effectiveFlags } from './flags';

/**
 * Diagnostic report for bug reports. Designed to be safe to share:
 *  - secrets are never read (only whether one is configured);
 *  - free-text settings (message texts, chat ids, URLs, badges) are reduced to "set"/length/origin;
 *  - log entries are redacted again (defence in depth) and task payloads are omitted entirely;
 *  - no buyer data, chats, orders or listings are included — only table row counts.
 */
export const DIAGNOSTICS_FORMAT = 'funpro-diagnostics';
export const DEFAULT_LOG_LIMIT = 200;

export interface DiagnosticEnvironment {
  extensionVersion: string;
  manifestVersion?: number | null;
  userAgent: string;
  language: string;
  platform?: string | null;
}

export interface DiagnosticInput {
  env: DiagnosticEnvironment;
  /** Feature statuses from the `ui.status` RPC (null when the background was unreachable). */
  statuses?: FeatureStatus[] | null;
  /** Background-side details from the `ui.diagnostics` RPC (already free of personal data). */
  background?: unknown;
  now?: Date;
  logLimit?: number;
}

export interface DiagnosticReport {
  report: { format: typeof DIAGNOSTICS_FORMAT; version: 1; generatedAt: string };
  versions: { extension: string; manifest: number | null; adapter: string; settingsSchema: number; database: number };
  environment: { userAgent: string; language: string; platform: string | null };
  settings: unknown;
  secretsConfigured: Record<string, boolean>;
  flags: Record<string, boolean>;
  automation: { state: string; liveActionsAcknowledged: boolean; statuses: FeatureStatus[] | null };
  capabilities: { id: string; status: string; mutating: boolean; description: string }[];
  tables: Record<string, number>;
  tasks: {
    byStatus: Record<string, number>;
    byKind: Record<string, number>;
    recentFailures: { kind: string; status: string; attempts: number; maxAttempts: number; lastError: string | null; createdAt: number; updatedAt: number }[];
  };
  logs: { at: number; level: string; source: string; message: string; hint?: string; details?: unknown }[];
  background: unknown;
}

function textSummary(value: string): string {
  return value ? `[text: ${value.length} chars]` : '';
}

function urlOrigin(value: string): string {
  if (!value) return '';
  try {
    const u = new URL(value);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '[set]';
  }
}

/** Settings with every free-text / personal field reduced to a harmless summary. */
export function redactSettingsForDiagnostics(settings: Settings): unknown {
  const s: Settings = structuredClone(settings);
  s.messages.welcomeText = textSummary(s.messages.welcomeText);
  s.messages.postOrderText = textSummary(s.messages.postOrderText);
  s.messages.recentEmojis = [];
  s.telegram.chatId = s.telegram.chatId ? '[set]' : '';
  s.ai.baseUrl = urlOrigin(s.ai.baseUrl);
  s.appearance.profileBadge = s.appearance.profileBadge ? '[set]' : '';
  s.appearance.backgroundImageAssetId = s.appearance.backgroundImageAssetId ? '[set]' : null;
  // Category names are not personal, but keep the report focused: counts only.
  const fees = s.fees as Settings['fees'] & Record<string, unknown>;
  const categories = Object.keys(fees.categoryCommissionPct).length;
  (fees as Record<string, unknown>)['categoryCommissionPct'] = `[${categories} categories]`;
  // Generic pass: credential-looking keys and token-shaped strings anywhere.
  return redact(s);
}

function redactLog(e: ActivityLogEntry): DiagnosticReport['logs'][number] {
  return {
    at: e.at,
    level: e.level,
    source: redactString(String(e.source), 64),
    message: redactString(String(e.message), 1000),
    ...(e.hint ? { hint: redactString(String(e.hint), 500) } : {}),
    ...(e.details ? { details: redact(e.details) } : {}),
  };
}

function summarizeTasks(tasks: Task[]): DiagnosticReport['tasks'] {
  const byStatus: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  for (const t of tasks) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
    byKind[t.kind] = (byKind[t.kind] ?? 0) + 1;
  }
  const recentFailures = tasks
    .filter((t) => t.status === 'failed')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20)
    .map((t) => ({
      kind: t.kind,
      status: t.status,
      attempts: t.attempts,
      maxAttempts: t.maxAttempts,
      lastError: t.lastError ? redactString(t.lastError, 300) : null,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  return { byStatus, byKind, recentFailures };
}

export async function buildDiagnosticReport(input: DiagnosticInput): Promise<DiagnosticReport> {
  const db = getDb();
  const settings = await getSettings();
  const limit = Math.max(0, Math.min(input.logLimit ?? DEFAULT_LOG_LIMIT, 1000));
  const [counts, logs, tasks, secretNames] = await Promise.all([
    Promise.all(db.tables.map(async (t) => [t.name, await t.count()] as const)),
    limit > 0 ? db.logs.orderBy('id').reverse().limit(limit).toArray() : Promise.resolve([] as ActivityLogEntry[]),
    db.tasks.toArray(),
    db.secrets.toCollection().primaryKeys(),
  ]);
  const secretsConfigured: Record<string, boolean> = { 'ai.apiKey': false, 'telegram.botToken': false };
  for (const name of secretNames) secretsConfigured[String(name)] = true;

  return {
    report: { format: DIAGNOSTICS_FORMAT, version: 1, generatedAt: (input.now ?? new Date()).toISOString() },
    versions: {
      extension: input.env.extensionVersion,
      manifest: input.env.manifestVersion ?? null,
      adapter: ADAPTER_VERSION,
      settingsSchema: settings.schemaVersion,
      database: db.verno,
    },
    environment: {
      userAgent: redactString(input.env.userAgent, 400),
      language: input.env.language,
      platform: input.env.platform ?? null,
    },
    settings: redactSettingsForDiagnostics(settings),
    secretsConfigured,
    flags: effectiveFlags(settings.flags),
    automation: {
      state: settings.automation.state,
      liveActionsAcknowledged: settings.automation.liveActionsAcknowledged,
      statuses: input.statuses ?? null,
    },
    capabilities: Object.values(CAPABILITIES).map((c) => ({ id: c.id, status: c.status, mutating: c.mutating, description: c.description })),
    tables: Object.fromEntries(counts),
    tasks: summarizeTasks(tasks),
    logs: logs.map(redactLog),
    background: input.background === undefined ? null : redact(input.background),
  };
}

export function diagnosticFileName(now = new Date()): string {
  return `funpro-diagnostics-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
}
