import { Fragment, type ReactNode } from 'react';

/**
 * Minimal, safe Markdown renderer for bundled documents (CHANGELOG.md). It understands headings,
 * paragraphs, bullet lists, fenced code, horizontal rules and inline `code`, **bold**, *italic*
 * and [links](https://…). Output is built from React elements only — raw HTML in the source is
 * shown as text, never interpreted — and links are limited to http(s) and in-app `#/` routes.
 */
export type MdBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

export function parseMarkdown(source: string): MdBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'paragraph', text: para.join(' ') });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ type: 'list', items: list });
    list = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      flushPara();
      flushList();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith('```'); i++) code.push(lines[i]!);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    if (!trimmed) {
      flushPara();
      flushList();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushPara();
      flushList();
      blocks.push({ type: 'heading', level: heading[1]!.length as 1 | 2 | 3 | 4, text: heading[2]!.trim() });
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara();
      flushList();
      blocks.push({ type: 'rule' });
      continue;
    }
    const item = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (item) {
      flushPara();
      list ??= [];
      list.push(item[1]!);
      continue;
    }
    if (list && /^\s{2,}\S/.test(line)) {
      // Continuation line of the previous list item.
      list[list.length - 1] += ` ${trimmed}`;
      continue;
    }
    flushList();
    para.push(trimmed);
  }
  flushPara();
  flushList();
  return blocks;
}

export function safeHref(url: string): string | null {
  const u = url.trim();
  if (u.startsWith('#/')) return u;
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)/;

export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    const token = m[0];
    const key = `${keyPrefix}-${n++}`;
    if (m[1]) {
      out.push(
        <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em]">
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token)!;
      const href = safeHref(link[2]!);
      const label = renderInline(link[1]!, key);
      out.push(
        href ? (
          <a
            key={key}
            href={href}
            className="font-medium text-accent underline-offset-2 hover:underline"
            {...(href.startsWith('#/') ? {} : { target: '_blank', rel: 'noreferrer noopener' })}
          >
            {label}
          </a>
        ) : (
          <Fragment key={key}>{label}</Fragment>
        ),
      );
    } else if (m[3]) {
      out.push(<strong key={key}>{renderInline(token.slice(2, -2), key)}</strong>);
    } else {
      out.push(<em key={key}>{renderInline(token.slice(1, -1), key)}</em>);
    }
    rest = rest.slice(m.index + token.length);
  }
  return out;
}

/** Renders Markdown with headings shifted down by `headingOffset` (the page already has an h1). */
export function Markdown({ source, headingOffset = 1 }: { source: string; headingOffset?: number }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-fg">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        switch (b.type) {
          case 'heading': {
            const level = Math.min(6, b.level + headingOffset);
            const cls =
              level <= 2
                ? 'mt-4 text-base font-semibold'
                : level === 3
                  ? 'mt-3 text-sm font-semibold'
                  : 'mt-2 text-xs font-semibold uppercase tracking-wide text-muted';
            const Tag = `h${level}` as 'h2';
            return (
              <Tag key={key} className={cls}>
                {renderInline(b.text, key)}
              </Tag>
            );
          }
          case 'paragraph':
            return <p key={key}>{renderInline(b.text, key)}</p>;
          case 'list':
            return (
              <ul key={key} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{renderInline(it, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case 'code':
            return (
              <pre key={key} className="overflow-auto rounded-lg bg-surface-2 p-3 font-mono text-xs">
                {b.text}
              </pre>
            );
          case 'rule':
            return <hr key={key} className="border-border" />;
        }
      })}
    </div>
  );
}
