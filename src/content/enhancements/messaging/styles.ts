/** Namespaced styles for the chat helpers. Everything FunPro adds uses `funpro-msg-*` classes. */
export const CLS = {
  style: 'funpro-msg-style',
  root: 'funpro-msg-tools',
  dark: 'funpro-msg-dark',
  bar: 'funpro-msg-bar',
  btn: 'funpro-msg-btn',
  hint: 'funpro-msg-hint',
  pop: 'funpro-msg-pop',
  slash: 'funpro-msg-slash',
  slashHead: 'funpro-msg-slash-head',
  slashList: 'funpro-msg-slash-list',
  slashOpt: 'funpro-msg-slash-opt',
  slashCmd: 'funpro-msg-slash-cmd',
  slashName: 'funpro-msg-slash-name',
  slashBody: 'funpro-msg-slash-body',
  slashEmpty: 'funpro-msg-slash-empty',
  emoji: 'funpro-msg-emoji',
  emojiSearch: 'funpro-msg-emoji-search',
  emojiCats: 'funpro-msg-emoji-cats',
  emojiCat: 'funpro-msg-emoji-cat',
  emojiTitle: 'funpro-msg-emoji-title',
  emojiGrid: 'funpro-msg-emoji-grid',
  emojiItem: 'funpro-msg-emoji-item',
  emojiEmpty: 'funpro-msg-emoji-empty',
  sr: 'funpro-msg-sr',
} as const;

const C = CLS;

export const STYLE = `
.${C.root}{position:relative;margin:4px 0;font:12px/1.4 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#5d6385;--fpm-bg:#fff;--fpm-fg:#171a2b;--fpm-muted:#5d6385;--fpm-border:#d9dbe6;--fpm-hover:#f0f1f7;--fpm-accent:#6d4aff;--fpm-accent-soft:#ece7ff}
.${C.root}.${C.dark}{color:#9aa0c7;--fpm-bg:#171a2e;--fpm-fg:#e9ebff;--fpm-muted:#9aa0c7;--fpm-border:#2c3156;--fpm-hover:#1f2340;--fpm-accent:#8c72ff;--fpm-accent-soft:#2a2457}
.${C.bar}{display:flex;align-items:center;gap:8px;min-height:26px}
.${C.btn}{display:inline-flex;align-items:center;justify-content:center;gap:4px;height:26px;min-width:26px;padding:0 6px;border:1px solid var(--fpm-border);border-radius:6px;background:var(--fpm-bg);color:var(--fpm-fg);font:inherit;font-size:14px;line-height:1;cursor:pointer}
.${C.btn}:hover{background:var(--fpm-hover)}
.${C.btn}[aria-expanded="true"]{border-color:var(--fpm-accent)}
.${C.root} :focus-visible{outline:2px solid var(--fpm-accent);outline-offset:1px}
.${C.hint}{color:var(--fpm-muted);font-size:11px}
.${C.pop}{position:absolute;left:0;bottom:calc(100% + 4px);z-index:2147483000;box-sizing:border-box;width:min(380px,92vw);max-height:340px;display:flex;flex-direction:column;background:var(--fpm-bg);color:var(--fpm-fg);border:1px solid var(--fpm-border);border-radius:10px;box-shadow:0 10px 30px rgba(15,17,32,.22);overflow:hidden}
.${C.pop}[hidden]{display:none}
.${C.slashHead}{display:flex;justify-content:space-between;gap:8px;padding:6px 10px;border-bottom:1px solid var(--fpm-border);color:var(--fpm-muted);font-size:11px}
.${C.slashList}{list-style:none;margin:0;padding:4px;overflow:auto}
.${C.slashOpt}{display:grid;grid-template-columns:auto 1fr;gap:2px 8px;padding:6px 8px;border-radius:6px;cursor:pointer}
.${C.slashOpt}[aria-selected="true"]{background:var(--fpm-accent-soft)}
.${C.slashOpt}:hover{background:var(--fpm-hover)}
.${C.slashCmd}{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fpm-accent);font-size:12px}
.${C.slashName}{font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${C.slashBody}{grid-column:1/-1;color:var(--fpm-muted);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.${C.slashEmpty}{padding:10px;color:var(--fpm-muted)}
.${C.emoji}{width:min(340px,92vw)}
.${C.emojiSearch}{margin:8px;padding:6px 8px;border:1px solid var(--fpm-border);border-radius:6px;background:var(--fpm-bg);color:var(--fpm-fg);font:inherit;font-size:12px}
.${C.emojiCats}{display:flex;gap:2px;padding:0 6px 6px;border-bottom:1px solid var(--fpm-border);overflow-x:auto}
.${C.emojiCat}{flex:0 0 auto;width:28px;height:28px;border:0;border-radius:6px;background:transparent;font-size:16px;line-height:1;cursor:pointer}
.${C.emojiCat}[aria-pressed="true"]{background:var(--fpm-accent-soft)}
.${C.emojiCat}:hover{background:var(--fpm-hover)}
.${C.emojiTitle}{padding:6px 10px 2px;color:var(--fpm-muted);font-size:11px;font-weight:600}
.${C.emojiGrid}{display:grid;grid-template-columns:repeat(8,1fr);gap:2px;padding:4px 6px 8px;overflow:auto}
.${C.emojiItem}{height:34px;border:0;border-radius:6px;background:transparent;font-size:20px;line-height:1;cursor:pointer}
.${C.emojiItem}:hover,.${C.emojiItem}:focus{background:var(--fpm-hover)}
.${C.emojiEmpty}{grid-column:1/-1;padding:10px;color:var(--fpm-muted);text-align:center}
.${C.sr}{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`;

export const EMOJI_GRID_COLUMNS = 8;
