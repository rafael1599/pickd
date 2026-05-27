// idea-117 — per-tab user filter to hide specific source rows from the
// consolidation candidates / suggestions list. Replaces the older binary
// "Exclude ROW 20-34" toggle with a fine-grained multi-select; persists to
// localStorage so the operator's preference survives reloads / tab switches.

import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'consolidation_hidden_rows_';

function loadInitial(modeKey: string, defaults: string[]): Set<string> {
  if (typeof window === 'undefined') return new Set(defaults);
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + modeKey);
    if (raw === null) return new Set(defaults);
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((x) => typeof x === 'string')) : new Set();
  } catch {
    return new Set(defaults);
  }
}

export interface HiddenRowsApi {
  hidden: Set<string>;
  isHidden: (row: string) => boolean;
  toggle: (row: string) => void;
  setMany: (rows: string[], hide: boolean) => void;
  clear: () => void;
}

/**
 * Returns an API to read & mutate the hidden-rows set for a given mode. The
 * `defaults` array is only used the FIRST time the operator visits this mode
 * on this device — subsequent visits load whatever they left last. Pass an
 * empty array if you don't want a built-in default.
 */
export function useHiddenRows(modeKey: string, defaults: string[] = []): HiddenRowsApi {
  // Lazy initializer + remount when modeKey changes (operator switched tabs).
  const [hidden, setHidden] = useState<Set<string>>(() => loadInitial(modeKey, defaults));

  // Re-load when modeKey changes. Without this, switching tabs would keep
  // the previous tab's hidden set in memory.
  useEffect(() => {
    setHidden(loadInitial(modeKey, defaults));
    // We intentionally exclude `defaults` from deps — it's a fresh array on
    // every render of the parent, which would loop. The defaults only matter
    // for first-visit hydration, captured at mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modeKey]);

  // Persist on every change. Skip the very first render (already loaded).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(STORAGE_PREFIX + modeKey, JSON.stringify([...hidden]));
  }, [modeKey, hidden]);

  const isHidden = useCallback((row: string) => hidden.has(row), [hidden]);

  const toggle = useCallback((row: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });
  }, []);

  const setMany = useCallback((rows: string[], hide: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (hide) next.add(r);
        else next.delete(r);
      }
      return next;
    });
  }, []);

  const clear = useCallback(() => setHidden(new Set()), []);

  return { hidden, isHidden, toggle, setMany, clear };
}
