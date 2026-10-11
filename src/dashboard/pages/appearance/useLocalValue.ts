import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Local, synchronously-updated copy of a persisted value for controlled inputs (text fields,
 * sliders, colour pickers). Settings writes are async; binding an input directly to the stored
 * value makes React revert keystrokes/slider positions until the write lands. Commits are
 * debounced by `delayMs` and flushed on unmount; external changes are adopted when nothing is
 * pending.
 */
export function useLocalValue<T>(external: T, commit: (v: T) => unknown, delayMs = 0): [T, (v: T) => void, () => void] {
  const [local, setLocal] = useState<T>(external);
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(commit);

  useEffect(() => {
    commitRef.current = commit;
  }, [commit]);

  useEffect(() => {
    if (!pending.current) setLocal(external);
  }, [external]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    if (p) void Promise.resolve(commitRef.current(p.v)).catch(() => undefined);
  }, []);

  const set = useCallback(
    (v: T) => {
      setLocal(v);
      pending.current = { v };
      if (delayMs <= 0) {
        flush();
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delayMs);
    },
    [delayMs, flush],
  );

  useEffect(() => flush, [flush]);
  return [local, set, flush];
}
