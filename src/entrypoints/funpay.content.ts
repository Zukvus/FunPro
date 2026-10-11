import { defineContentScript } from 'wxt/utils/define-content-script';
import { startContent } from '@/content/main';

export default defineContentScript({
  matches: ['https://funpay.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    void startContent(ctx);
  },
});
