import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

/**
 * FunPro build configuration.
 *
 * Permissions follow least privilege:
 *  - host access is limited to https://funpay.com/* (the only site we integrate with);
 *  - third-party APIs (Telegram, AI providers) are *optional* host permissions that are
 *    requested at runtime only after the user explicitly opts in.
 */
export default defineConfig({
  srcDir: 'src',
  imports: false,
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    build: { chunkSizeWarningLimit: 900 },
  }),
  manifest: ({ browser, command }) => {
    const isFirefox = browser === 'firefox';
    const permissions = ['storage', 'unlimitedStorage', 'alarms', 'notifications'];
    if (!isFirefox) permissions.push('offscreen');
    return {
      name: '__MSG_extName__',
      short_name: 'FunPro',
      description: '__MSG_extDescription__',
      default_locale: 'en',
      permissions,
      host_permissions: ['https://funpay.com/*'],
      optional_host_permissions: [
        'https://api.telegram.org/*',
        'https://api.openai.com/*',
        'https://api.anthropic.com/*',
        'https://openrouter.ai/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ],
      action: { default_title: 'FunPro' },
      ...(command === 'build'
        ? {
            content_security_policy: {
              extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            },
          }
        : {}),
      commands: {
        'emergency-stop': {
          suggested_key: { default: 'Alt+Shift+S' },
          description: '__MSG_cmdEmergencyStop__',
        },
        'open-dashboard': {
          suggested_key: { default: 'Alt+Shift+F' },
          description: '__MSG_cmdOpenDashboard__',
        },
      },
      ...(isFirefox
        ? {
            browser_specific_settings: {
              gecko: { id: 'funpro@funpro.local', strict_min_version: '128.0' },
            },
          }
        : { minimum_chrome_version: '116' }),
    };
  },
});
