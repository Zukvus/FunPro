import { Check } from 'lucide-react';
import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { ThemeIdSchema, type ThemeId } from '@/core/settings/schema';
import { THEMES, type Palette } from '@/features/appearance/themes';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';

const THEME_IDS = ThemeIdSchema.options;

function MiniPreview({ palette, className, style }: { palette: Palette; className?: string; style?: CSSProperties }) {
  return (
    <div aria-hidden className={cn('flex h-full w-full flex-col gap-1 p-2', className)} style={{ background: palette.bg, color: palette.fg, ...style }}>
      <div className="flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: palette.accent }} />
        <span className="h-1.5 w-8 rounded-full" style={{ background: palette.fg, opacity: 0.85 }} />
      </div>
      <div className="flex flex-1 flex-col gap-1 rounded-md p-1.5" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
        <span className="h-1.5 w-10 rounded-full" style={{ background: palette.fg, opacity: 0.8 }} />
        <span className="h-1.5 w-14 rounded-full" style={{ background: palette.muted, opacity: 0.8 }} />
        <div className="mt-auto flex gap-1">
          <span className="h-2.5 w-7 rounded" style={{ background: palette.accent }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette.success }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette.warning }} />
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: palette.danger }} />
        </div>
      </div>
    </div>
  );
}

function ThemeSwatch({ id }: { id: ThemeId }) {
  if (id === 'system') {
    return (
      <div className="relative h-full w-full">
        <MiniPreview palette={THEMES.light.palette} className="absolute inset-0" style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }} />
        <MiniPreview palette={THEMES.dark.palette} className="absolute inset-0" style={{ clipPath: 'polygon(100% 0, 100% 100%, 0 100%)' }} />
      </div>
    );
  }
  return <MiniPreview palette={THEMES[id].palette} />;
}

/** Theme chooser as an ARIA radio group (roving tab stop, arrow keys move the selection). */
export function ThemePicker({ value, onChange, compact }: { value: ThemeId; onChange: (t: ThemeId) => void; compact?: boolean }) {
  const t = useT();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, THEME_IDS.indexOf(value));
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (index + delta + THEME_IDS.length) % THEME_IDS.length;
    onChange(THEME_IDS[next]!);
    refs.current[next]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={t('appearance.theme.label')} className={cn('grid gap-3', compact ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5')}>
      {THEME_IDS.map((id, i) => {
        const selected = id === value;
        const label = t(id === 'system' ? 'appearance.theme.system' : THEMES[id].labelKey);
        return (
          <button
            key={id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={onKey}
            onClick={() => onChange(id)}
            className={cn(
              'group flex flex-col overflow-hidden rounded-xl border text-left transition-shadow',
              selected ? 'border-accent ring-2 ring-accent' : 'border-border hover:border-muted',
            )}
          >
            <div className={cn('w-full', compact ? 'h-14' : 'h-20')}>
              <ThemeSwatch id={id} />
            </div>
            <span className="flex items-center justify-between gap-1 bg-surface px-2.5 py-1.5 text-xs font-medium text-fg">
              <span className="truncate">{label}</span>
              {selected && <Check size={13} className="shrink-0 text-accent" aria-hidden />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
