import { create } from 'zustand';
import { cn } from '../lib/cn';

interface ToastItem {
  id: number;
  tone: 'success' | 'error' | 'info';
  text: string;
}

interface ToastState {
  items: ToastItem[];
  push: (tone: ToastItem['tone'], text: string) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (tone, text) => {
    const id = ++seq;
    set({ items: [...get().items, { id, tone, text }].slice(-4) });
    setTimeout(() => get().dismiss(id), tone === 'error' ? 8000 : 4000);
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) }),
}));

export const toast = {
  success: (t: string) => useToasts.getState().push('success', t),
  error: (t: string) => useToasts.getState().push('error', t),
  info: (t: string) => useToasts.getState().push('info', t),
};

export function Toaster() {
  const { items, dismiss } = useToasts();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 flex-col gap-2"
    >
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cn(
            'pointer-events-auto flex items-start justify-between gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg',
            t.tone === 'success' && 'border-success/40 bg-surface text-fg',
            t.tone === 'error' && 'border-danger/50 bg-surface text-fg',
            t.tone === 'info' && 'border-border bg-surface text-fg',
          )}
        >
          <span>{t.text}</span>
          <button
            type="button"
            className="text-muted hover:text-fg"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
