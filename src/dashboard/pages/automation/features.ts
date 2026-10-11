import { CAPABILITIES, type Capability, type CapabilityId } from '@/adapters/funpay/capabilities';
import { FEATURE_CAPABILITIES, type AutomationFeature } from '@/core/automation/policy';

/** Where each automated feature is configured (dashboard hash route). */
export const FEATURE_ROUTE: Record<AutomationFeature, string> = {
  autoBump: 'listings',
  autoReply: 'messages',
  welcomeMessage: 'messages',
  postOrderMessage: 'messages',
  autoReviewReply: 'reviews',
  autoDelivery: 'inventory',
  repricing: 'pricing',
  workflows: 'rules',
};

/** i18n keys for the fixed English reasons produced by `evaluateFeature()` (core/automation/policy.ts). */
const REASON_KEYS: Record<string, string> = {
  'Turned off in settings': 'automation.reason.off',
  'Emergency stop is active': 'automation.reason.stopped',
  'Automation is paused': 'automation.reason.paused',
  'Not supported by the FunPay integration': 'automation.reason.unsupported',
  'Confirm live FunPay actions in Settings → Automation': 'automation.reason.confirm',
  'Open funpay.com in a browser tab': 'automation.reason.noTab',
  'Log in to FunPay': 'automation.reason.login',
  Active: 'automation.reason.active',
};

export function reasonKey(reason: string): string | null {
  return REASON_KEYS[reason] ?? null;
}

export function featureCapabilities(feature: AutomationFeature): Capability[] {
  return FEATURE_CAPABILITIES[feature].map((id: CapabilityId) => CAPABILITIES[id]);
}

/** Mutating capabilities that are only evidenced (not verified live) — what the user must acknowledge. */
export function unverifiedMutatingCapabilities(): Capability[] {
  return (Object.values(CAPABILITIES) as Capability[]).filter((c) => c.mutating && c.status === 'evidenced');
}

export const FUNPAY_RULES_URL = 'https://funpay.com/trade/info';
