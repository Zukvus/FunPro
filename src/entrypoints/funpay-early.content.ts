import { defineContentScript } from 'wxt/utils/define-content-script';
import { primeFunPayPrivacy } from '@/content/enhancements/appearance/early';

/**
 * Tiny document_start script: applies the privacy blur before FunPay paints, so names, balances
 * and order ids never flash unblurred (e.g. while streaming). The main content script takes over
 * the same <style> element at document_idle.
 */
export default defineContentScript({
  matches: ['https://funpay.com/*'],
  runAt: 'document_start',
  main() {
    void primeFunPayPrivacy().catch(() => undefined);
  },
});
