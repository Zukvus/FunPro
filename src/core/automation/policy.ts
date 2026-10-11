import { CAPABILITIES, type Capability, type CapabilityId } from '@/adapters/funpay/capabilities';
import type { Settings } from '../settings/schema';

/** Every automated feature is shown to the user in exactly one of these states. */
export type AutomationStatus = 'disabled' | 'running' | 'paused' | 'awaiting_authorization' | 'blocked';

export type AutomationFeature =
  | 'autoBump'
  | 'autoReply'
  | 'welcomeMessage'
  | 'postOrderMessage'
  | 'autoReviewReply'
  | 'autoDelivery'
  | 'repricing'
  | 'workflows';

export const FEATURE_CAPABILITIES: Record<AutomationFeature, CapabilityId[]> = {
  autoBump: ['raise'],
  autoReply: ['readChats', 'sendMessage'],
  welcomeMessage: ['readChats', 'sendMessage'],
  postOrderMessage: ['readOrders', 'sendMessage'],
  autoReviewReply: ['readReviews', 'replyReview'],
  autoDelivery: ['readOrders', 'sendMessage'],
  repricing: ['readPublicOffers', 'editOffer'],
  workflows: [],
};

export interface AutomationContext {
  /** A logged-in FunPay tab is currently open (required to execute anything on FunPay). */
  funpayTabAvailable: boolean;
  sessionLoggedIn: boolean;
}

export interface FeatureStatus {
  feature: AutomationFeature;
  status: AutomationStatus;
  reason: string;
}

export function evaluateFeature(settings: Settings, feature: AutomationFeature, ctx: AutomationContext): FeatureStatus {
  const a = settings.automation;
  if (!a[feature]) return { feature, status: 'disabled', reason: 'Turned off in settings' };
  if (a.state === 'stopped') return { feature, status: 'blocked', reason: 'Emergency stop is active' };
  if (a.state === 'paused') return { feature, status: 'paused', reason: 'Automation is paused' };
  const caps: Capability[] = FEATURE_CAPABILITIES[feature].map((c) => CAPABILITIES[c]);
  if (caps.some((c) => c.status === 'unsupported')) return { feature, status: 'blocked', reason: 'Not supported by the FunPay integration' };
  const needsLive = caps.some((c) => c.mutating && c.status !== 'verified');
  if (needsLive && !a.liveActionsAcknowledged) {
    return { feature, status: 'awaiting_authorization', reason: 'Confirm live FunPay actions in Settings → Automation' };
  }
  if (caps.length > 0 && !ctx.funpayTabAvailable) return { feature, status: 'blocked', reason: 'Open funpay.com in a browser tab' };
  if (caps.length > 0 && !ctx.sessionLoggedIn) return { feature, status: 'blocked', reason: 'Log in to FunPay' };
  return { feature, status: 'running', reason: 'Active' };
}

export function canRun(settings: Settings, feature: AutomationFeature, ctx: AutomationContext): boolean {
  return evaluateFeature(settings, feature, ctx).status === 'running';
}

export const ALL_FEATURES: AutomationFeature[] = [
  'autoBump',
  'autoReply',
  'welcomeMessage',
  'postOrderMessage',
  'autoReviewReply',
  'autoDelivery',
  'repricing',
  'workflows',
];
