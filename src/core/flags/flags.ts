/**
 * Feature flags. Defaults are compiled in; users can override them in Settings → Diagnostics.
 * Flags gate *experimental* surfaces, never safety checks.
 */
export const FEATURE_FLAGS = {
  pricingIntelligence: { default: true, description: 'Competitor price dashboard and repricing simulator' },
  workflowBuilder: { default: true, description: 'Visual WHEN → IF → THEN rule builder' },
  aiCopilot: { default: true, description: 'AI assistant (requires a provider and explicit consent)' },
  telegram: { default: true, description: 'Telegram bot notifications (opt-in)' },
  inventory: { default: true, description: 'Digital goods inventory and fulfillment assistance' },
  commandPalette: { default: true, description: 'Ctrl+K command palette in the dashboard' },
  funpayEnhancements: { default: true, description: 'On-page helpers on funpay.com (quick replies, net price, copy ids)' },
  nicknameSync: { default: false, description: 'Share nickname styles with other FunPro users (requires a sync service — not available)' },
} as const;

export type FeatureFlag = keyof typeof FEATURE_FLAGS;

export function isFlagEnabled(flag: FeatureFlag, overrides: Record<string, boolean>): boolean {
  return overrides[flag] ?? FEATURE_FLAGS[flag].default;
}
