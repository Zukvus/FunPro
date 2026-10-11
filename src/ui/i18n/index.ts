import { registerLocale, type LocaleNamespace } from './core';

export * from './core';

/**
 * Full translation set for the dashboard: every namespace file under ./locales is registered.
 * New feature modules add a file — no central registry to edit. The popup imports `./core`
 * instead, which only carries the `common` namespace.
 */
const modules = import.meta.glob<{ default: LocaleNamespace }>('./locales/*.ts', { eager: true });
for (const mod of Object.values(modules)) registerLocale(mod.default);
