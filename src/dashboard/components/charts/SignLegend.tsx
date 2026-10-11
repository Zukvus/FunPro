/** Legend for diverging bars: swatches mirror the marks (rect for bars); text stays in text colours. */
export function SignLegend({ positive, negative }: { positive: string; negative: string }) {
  return (
    <span className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted">
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: 'var(--fp-accent)' }} />
        {positive}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: 'color-mix(in oklab, var(--fp-danger) 55%, var(--fp-surface))' }} />
        {negative}
      </span>
    </span>
  );
}
