import { ArrowDown, ArrowUp, ChevronsDown, ChevronsUp, GripVertical, Save, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useState, type DragEvent, type KeyboardEvent } from 'react';
import { listingCategories } from '@/features/listings/filters';
import { moveItem, saveLocalOrder } from '@/features/listings/reorder';
import type { Listing } from '@/shared/models';
import { Button, Callout, EmptyState, Field, IconButton, Select, toast } from '@/ui/components';
import { useT } from '@/ui/i18n';
import { cn } from '@/ui/lib/cn';
import { errorText, useFormat } from './shared';

/** Lists longer than this are not rendered for reordering (pick a category). */
const MAX_REORDER = 400;

export function ReorderPanel({ listings }: { listings: Listing[] }) {
  const t = useT();
  const fmt = useFormat();
  const categories = useMemo(() => listingCategories(listings), [listings]);
  const [category, setCategory] = useState<string | null>(() => categories[0]?.name ?? null);
  const base = useMemo(
    () =>
      listings
        .filter((l) => category === null || l.categoryName === category)
        .sort((a, b) => a.sortIndex - b.sortIndex || a.id.localeCompare(b.id))
        .map((l) => l.id),
    [listings, category],
  );
  const byId = useMemo(() => new Map(listings.map((l) => [l.id, l])), [listings]);
  const [order, setOrder] = useState<string[]>(base);
  const [grabbed, setGrabbed] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = order.length !== base.length || order.some((id, i) => id !== base[i]);

  // Reset when the category or the underlying listings change (and nothing is being edited).
  useEffect(() => {
    if (!dirty) setOrder(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  useEffect(() => {
    setOrder(base);
    setGrabbed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const move = (id: string, to: number) => {
    const from = order.indexOf(id);
    if (from < 0) return;
    const next = moveItem(order, from, to);
    setOrder(next);
    const pos = next.indexOf(id) + 1;
    setAnnounce(t('listings.order.moved', { title: byId.get(id)?.title ?? id, pos, total: next.length }));
  };

  const onGripKey = (e: KeyboardEvent<HTMLButtonElement>, id: string) => {
    const idx = order.indexOf(id);
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (grabbed === id) {
        setGrabbed(null);
        setAnnounce(t('listings.order.dropped', { title: byId.get(id)?.title ?? id, pos: idx + 1 }));
      } else {
        setGrabbed(id);
        setAnnounce(t('listings.order.grabbed', { title: byId.get(id)?.title ?? id, pos: idx + 1 }));
      }
    } else if (e.key === 'Escape' && grabbed) {
      e.preventDefault();
      setGrabbed(null);
    } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (grabbed === id || e.altKey)) {
      e.preventDefault();
      move(id, idx + (e.key === 'ArrowUp' ? -1 : 1));
      // keep focus on the moved item's handle
      requestAnimationFrame(() => document.getElementById(`reorder-grip-${id}`)?.focus());
    }
  };

  const onDrop = (e: DragEvent<HTMLLIElement>, targetId: string) => {
    e.preventDefault();
    const id = dragging ?? e.dataTransfer.getData('text/plain');
    setDragging(null);
    if (!id || id === targetId) return;
    move(id, order.indexOf(targetId));
  };

  const save = async () => {
    setBusy(true);
    try {
      const r = await saveLocalOrder(order, t('listings.order.backupLabel', { category: category ?? t('common.all') }));
      toast.success(t('listings.order.saved', { count: r.changed }));
    } catch (e) {
      toast.error(errorText(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Callout tone="warning" title={t('listings.order.blocked.title')}>
        {t('listings.order.blocked.body')}
      </Callout>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <Field label={t('listings.filter.category')}>
          <Select value={category === null ? '' : `c:${category}`} onChange={(e) => setCategory(e.target.value === '' ? null : e.target.value.slice(2))}>
            {listings.length <= MAX_REORDER && <option value="">{t('listings.filter.allCategories')}</option>}
            {categories.map((c) => (
              <option key={c.name} value={`c:${c.name}`}>
                {(c.name || t('listings.filter.noCategory')) + ` (${c.count})`}
              </option>
            ))}
          </Select>
        </Field>
        <div className="flex gap-2">
          <Button variant="ghost" icon={<Undo2 size={14} aria-hidden />} disabled={!dirty || busy} onClick={() => setOrder(base)}>
            {t('listings.order.reset')}
          </Button>
          <Button variant="primary" icon={<Save size={14} aria-hidden />} disabled={!dirty} loading={busy} onClick={() => void save()}>
            {t('listings.order.save')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted">{t('listings.order.keyboardHelp')}</p>
      <p className="sr-only" aria-live="assertive">
        {announce}
      </p>
      {order.length === 0 ? (
        <EmptyState title={t('listings.order.empty')}>{t('listings.empty.body')}</EmptyState>
      ) : order.length > MAX_REORDER ? (
        <Callout tone="info">{t('listings.order.tooMany', { max: MAX_REORDER })}</Callout>
      ) : (
        <ol className="divide-y divide-border rounded-xl border border-border bg-surface" aria-label={t('listings.order.listLabel')}>
          {order.map((id, i) => {
            const l = byId.get(id);
            if (!l) return null;
            return (
              <li
                key={id}
                draggable
                onDragStart={(e) => {
                  setDragging(id);
                  e.dataTransfer.setData('text/plain', id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => onDrop(e, id)}
                className={cn('flex items-center gap-2 px-2 py-1.5 text-sm', grabbed === id && 'bg-accent-soft ring-2 ring-accent', dragging === id && 'opacity-50')}
              >
                <button
                  id={`reorder-grip-${id}`}
                  type="button"
                  className="cursor-grab rounded p-1 text-muted hover:bg-surface-2 hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  aria-label={t('listings.order.grip', { title: l.title, pos: i + 1 })}
                  aria-pressed={grabbed === id}
                  onKeyDown={(e) => onGripKey(e, id)}
                >
                  <GripVertical size={16} aria-hidden />
                </button>
                <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate" title={l.title}>
                  {l.title || `#${l.id}`}
                </span>
                <span className="hidden shrink-0 text-xs tabular-nums text-muted sm:inline">{fmt.money(l.price.amountMinor, l.price.currency)}</span>
                <IconButton label={t('listings.order.top')} onClick={() => move(id, 0)} disabled={i === 0}>
                  <ChevronsUp size={14} />
                </IconButton>
                <IconButton label={t('listings.order.up')} onClick={() => move(id, i - 1)} disabled={i === 0}>
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton label={t('listings.order.down')} onClick={() => move(id, i + 1)} disabled={i === order.length - 1}>
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton label={t('listings.order.bottom')} onClick={() => move(id, order.length - 1)} disabled={i === order.length - 1}>
                  <ChevronsDown size={14} />
                </IconButton>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
