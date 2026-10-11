import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import {
  Activity,
  BarChart3,
  Bell,
  Bot,
  Boxes,
  Info,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Paintbrush,
  Plug,
  Shield,
  ShoppingBag,
  Star,
  Tags,
  TrendingUp,
  Users,
  Wallet,
  Workflow,
  Zap,
} from 'lucide-react';

export interface RouteDef {
  path: string;
  labelKey: string;
  group: 'sell' | 'grow' | 'automate' | 'settings';
  icon: ComponentType<{ size?: number }>;
  component: LazyExoticComponent<ComponentType>;
  /** Extra search terms for the settings/command search. */
  keywords?: string[];
}

/** Pages are lazy-loaded so heavy modules (charts, editors) never slow down the popup or other pages. */
export const ROUTES: RouteDef[] = [
  {
    path: 'overview',
    labelKey: 'nav.overview',
    group: 'sell',
    icon: LayoutDashboard,
    component: lazy(() => import('./pages/OverviewPage')),
  },
  {
    path: 'listings',
    labelKey: 'nav.listings',
    group: 'sell',
    icon: Tags,
    component: lazy(() => import('./pages/ListingsPage')),
    keywords: ['lots', 'offers', 'bulk', 'bump', 'raise', 'лоты', 'поднятие'],
  },
  {
    path: 'orders',
    labelKey: 'nav.orders',
    group: 'sell',
    icon: ShoppingBag,
    component: lazy(() => import('./pages/OrdersPage')),
    keywords: ['sales', 'purchases', 'unconfirmed', 'заказы'],
  },
  {
    path: 'messages',
    labelKey: 'nav.messages',
    group: 'sell',
    icon: MessageSquare,
    component: lazy(() => import('./pages/MessagesPage')),
    keywords: ['templates', 'auto-reply', 'welcome', 'quiet hours', 'шаблоны'],
  },
  {
    path: 'reviews',
    labelKey: 'nav.reviews',
    group: 'sell',
    icon: Star,
    component: lazy(() => import('./pages/ReviewsPage')),
    keywords: ['feedback', 'отзывы'],
  },
  {
    path: 'customers',
    labelKey: 'nav.customers',
    group: 'sell',
    icon: Users,
    component: lazy(() => import('./pages/CustomersPage')),
    keywords: ['crm', 'notes', 'tags'],
  },
  {
    path: 'inventory',
    labelKey: 'nav.inventory',
    group: 'sell',
    icon: Boxes,
    component: lazy(() => import('./pages/InventoryPage')),
    keywords: ['stock', 'delivery', 'keys', 'склад'],
  },
  {
    path: 'analytics',
    labelKey: 'nav.analytics',
    group: 'grow',
    icon: BarChart3,
    component: lazy(() => import('./pages/AnalyticsPage')),
    keywords: ['statistics', 'charts', 'revenue', 'export'],
  },
  {
    path: 'finance',
    labelKey: 'nav.finance',
    group: 'grow',
    icon: Wallet,
    component: lazy(() => import('./pages/FinancePage')),
    keywords: ['balance', 'cash flow', 'profit'],
  },
  {
    path: 'pricing',
    labelKey: 'nav.pricing',
    group: 'grow',
    icon: TrendingUp,
    component: lazy(() => import('./pages/PricingPage')),
    keywords: ['competitors', 'repricing', 'конкуренты'],
  },
  {
    path: 'ai',
    labelKey: 'nav.ai',
    group: 'grow',
    icon: Bot,
    component: lazy(() => import('./pages/AiPage')),
    keywords: ['copilot', 'openai', 'anthropic', 'translate'],
  },
  {
    path: 'automation',
    labelKey: 'nav.automation',
    group: 'automate',
    icon: Zap,
    component: lazy(() => import('./pages/AutomationPage')),
    keywords: ['emergency stop', 'auto bump', 'auto reply'],
  },
  {
    path: 'rules',
    labelKey: 'nav.rules',
    group: 'automate',
    icon: Workflow,
    component: lazy(() => import('./pages/RulesPage')),
    keywords: ['workflow', 'when', 'then'],
  },
  {
    path: 'notifications',
    labelKey: 'nav.notifications',
    group: 'automate',
    icon: Bell,
    component: lazy(() => import('./pages/NotificationsPage')),
    keywords: ['sounds', 'desktop'],
  },
  {
    path: 'integrations',
    labelKey: 'nav.integrations',
    group: 'automate',
    icon: Plug,
    component: lazy(() => import('./pages/IntegrationsPage')),
    keywords: ['telegram'],
  },
  {
    path: 'appearance',
    labelKey: 'nav.appearance',
    group: 'settings',
    icon: Paintbrush,
    component: lazy(() => import('./pages/AppearancePage')),
    keywords: ['theme', 'dark', 'nickname', 'background', 'layout'],
  },
  {
    path: 'privacy',
    labelKey: 'nav.privacy',
    group: 'settings',
    icon: Shield,
    component: lazy(() => import('./pages/PrivacyPage')),
    keywords: ['backup', 'restore', 'delete data', 'permissions'],
  },
  {
    path: 'logs',
    labelKey: 'nav.logs',
    group: 'settings',
    icon: Activity,
    component: lazy(() => import('./pages/LogsPage')),
    keywords: ['diagnostics', 'activity', 'flags'],
  },
  {
    path: 'about',
    labelKey: 'nav.about',
    group: 'settings',
    icon: Info,
    component: lazy(() => import('./pages/AboutPage')),
    keywords: ['changelog', 'version'],
  },
];

export const WELCOME_ROUTE = { path: 'welcome', component: lazy(() => import('./pages/WelcomePage')) };
export const ListChecksIcon = ListChecks;
