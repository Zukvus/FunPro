import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Kbd } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { ROUTES } from '../routes';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
}

/** Ctrl/Cmd+K command palette: jump to pages, search settings, run quick actions. */
export function CommandPalette({ navigate, extra }: { navigate: (p: string) => void; extra: PaletteCommand[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) {
      setQ('');
      setIdx(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const commands = useMemo<PaletteCommand[]>(
    () => [
      ...ROUTES.map((r) => ({ id: `go:${r.path}`, label: t(r.labelKey), hint: 'Page', keywords: r.keywords, run: () => navigate(r.path) })),
      ...extra,
    ],
    [extra, navigate, t],
  );
  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands.slice(0, 12);
    return commands.filter((c) => [c.label, ...(c.keywords ?? [])].some((k) => k.toLowerCase().includes(s))).slice(0, 12);
  }, [commands, q]);

  if (!open) return null;
  const run = (c: PaletteCommand | undefined) => {
    if (!c) return;
    setOpen(false);
    c.run();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[12vh]" onClick={() => setOpen(false)}>
      <div role="dialog" aria-label="Command palette" className="w-[min(560px,92vw)] overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setIdx(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setIdx((i) => Math.min(i + 1, results.length - 1));
              else if (e.key === 'ArrowUp') setIdx((i) => Math.max(i - 1, 0));
              else if (e.key === 'Enter') run(results[idx]);
            }}
            placeholder={t('search.settings')}
            aria-label={t('search.settings')}
            className="h-12 w-full bg-transparent text-sm text-fg outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul role="listbox" className="max-h-80 overflow-auto py-1">
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === idx}>
              <button type="button" onMouseEnter={() => setIdx(i)} onClick={() => run(c)} className={cn('flex w-full items-center justify-between px-4 py-2 text-left text-sm', i === idx ? 'bg-accent-soft text-fg' : 'text-fg')}>
                <span>{c.label}</span>
                {c.hint && <span className="text-xs text-muted">{c.hint}</span>}
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">No results</li>}
        </ul>
      </div>
    </div>
  );
}
