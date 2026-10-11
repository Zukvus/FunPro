/**
 * Binds FunPro's chat helpers (slash-command templates, emoji picker) to one FunPay chat box.
 * A small toolbar is inserted right before FunPay's chat form; everything is removed on unmount.
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import { funpayParser, type PageSession } from '@/adapters/funpay';
import { rpc } from '@/core/messaging/client';
import { chatUrl, clockVariables, renderTemplate, type TemplateVars } from '@/features/messages/engine';
import { chatIdFromSearch, h, hasDarkBackground, insertAtCaret, type Composer } from './dom';
import { EmojiPicker } from './emojiPicker';
import { SlashMenu, type SlashTemplate } from './slashMenu';
import { pageT, type PageLang, type PageT } from './strings';
import { CLS } from './styles';

export interface ComposerConfig {
  lang: PageLang;
  recentEmojis: string[];
}

type ChatContext = Partial<
  Record<'buyer' | 'seller' | 'order_id' | 'product' | 'price' | 'chat_url', string | null>
>;

const TEMPLATE_TTL_MS = 30_000;
const CONTEXT_TTL_MS = 60_000;

/** The newest FunPay order id mentioned by a system message visible in this chat. */
export function latestOrderIdOnPage(doc: Document, chatId: string, selfUserId: string | null): string | null {
  const messages = funpayParser.parseChatMessages(doc, chatId, selfUserId);
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.kind !== 'system') continue;
    const id = funpayParser.classifySystemMessage(m.text)?.orderId;
    if (id) return id;
  }
  return null;
}

export class ChatComposerEnhancer {
  private readonly ac = new AbortController();
  private readonly t: PageT;
  private root: HTMLDivElement | null = null;
  private live: HTMLDivElement | null = null;
  private slash: SlashMenu | null = null;
  private emoji: EmojiPicker | null = null;
  private recent: string[];
  private templates: { at: number; list: SlashTemplate[] } | null = null;
  private readonly contexts = new Map<string, { at: number; value: ChatContext }>();

  constructor(
    private readonly ctx: ContentScriptContext,
    readonly composer: Composer,
    private readonly getSession: () => PageSession,
    private readonly config: ComposerConfig,
  ) {
    this.t = pageT(config.lang);
    this.recent = [...config.recentEmojis];
  }

  get connected(): boolean {
    return this.composer.textarea.isConnected && !!this.root?.isConnected;
  }

  mount(): void {
    const { form, textarea } = this.composer;
    const doc = textarea.ownerDocument;
    const t = this.t;
    const signal = this.ac.signal;

    const root = h(doc, 'div', { class: CLS.root, role: 'group', 'aria-label': t('toolbar') });
    if (hasDarkBackground(form)) root.classList.add(CLS.dark);
    const bar = h(doc, 'div', { class: CLS.bar });
    const emojiBtn = h(
      doc,
      'button',
      { type: 'button', class: CLS.btn, 'aria-label': t('emojiButton'), title: t('emojiButton') },
      '😊',
    );
    const hint = h(doc, 'span', { class: CLS.hint, title: t('notSentHint') }, t('slashHint'));
    this.live = h(doc, 'div', { class: CLS.sr, role: 'status', 'aria-live': 'polite' });
    bar.append(emojiBtn, hint);
    root.append(bar, this.live);
    form.before(root);
    this.root = root;

    const announce = (text: string) => {
      if (!this.live) return;
      this.live.textContent = '';
      this.ctx.setTimeout(() => {
        if (this.live) this.live.textContent = text;
      }, 50);
    };

    this.slash = new SlashMenu({
      doc,
      root,
      textarea,
      t,
      signal,
      announce,
      loadTemplates: () => this.loadTemplates(),
      render: (tpl) => this.renderForChat(tpl.body),
    });
    this.emoji = new EmojiPicker({
      doc,
      root,
      toggle: emojiBtn,
      textarea,
      t,
      lang: this.config.lang,
      signal,
      recent: () => this.recent,
      onPick: (char) => this.pickEmoji(char),
    });
  }

  unmount(): void {
    this.ac.abort();
    this.slash?.destroy();
    this.emoji?.destroy();
    this.root?.remove();
    this.root = null;
    this.live = null;
    this.slash = null;
    this.emoji = null;
  }

  private async loadTemplates(): Promise<SlashTemplate[]> {
    if (this.templates && Date.now() - this.templates.at < TEMPLATE_TTL_MS) return this.templates.list;
    const list = await rpc<SlashTemplate[]>('cs.listTemplates', {});
    this.templates = { at: Date.now(), list: Array.isArray(list) ? list : [] };
    return this.templates.list;
  }

  private async chatContext(chatId: string, partnerName: string | undefined): Promise<ChatContext> {
    const cached = this.contexts.get(chatId);
    if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.value;
    let value: ChatContext = {};
    try {
      value = await rpc<ChatContext>('cs.messaging.chatContext', {
        chatId,
        ...(partnerName ? { partnerName: partnerName.slice(0, 100) } : {}),
      });
    } catch {
      // Background unavailable: fall back to what the page shows.
    }
    this.contexts.set(chatId, { at: Date.now(), value });
    return value;
  }

  /**
   * Fill variables from what is visible on the page (buyer in the contact list, order id in FunPay's
   * system messages, the seller's own name) and from FunPro's local data. Unknown values stay as
   * `{name}` so the seller sees them before pressing Send.
   */
  private async renderForChat(body: string): Promise<string> {
    const doc = this.composer.textarea.ownerDocument;
    const session = this.getSession();
    const vars: TemplateVars = { seller: session.username, ...clockVariables(new Date()) };
    const chatId = chatIdFromSearch(doc.defaultView?.location.search ?? '');
    if (chatId) {
      const partner = funpayParser.parseChatList(doc).find((c) => c.id === chatId)?.partnerName || undefined;
      const known = await this.chatContext(chatId, partner);
      const pageOrder = latestOrderIdOnPage(doc, chatId, session.userId);
      const sameOrder = !pageOrder || !known.order_id || pageOrder === known.order_id;
      Object.assign(vars, {
        buyer: partner ?? known.buyer,
        seller: session.username ?? known.seller,
        order_id: pageOrder ?? known.order_id,
        product: sameOrder ? known.product : null,
        price: sameOrder ? known.price : null,
        chat_url: chatUrl(chatId),
      });
    }
    return renderTemplate(body, vars, { missing: 'keep' }).text;
  }

  private pickEmoji(char: string): void {
    insertAtCaret(this.composer.textarea, char);
    this.recent = [char, ...this.recent.filter((c) => c !== char)].slice(0, 24);
    this.emoji?.refresh();
    void rpc<string[]>('cs.recordEmoji', { emoji: char })
      .then((list) => {
        if (Array.isArray(list)) this.recent = list;
      })
      .catch(() => undefined);
  }
}
