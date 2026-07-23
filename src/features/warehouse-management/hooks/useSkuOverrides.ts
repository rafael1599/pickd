import { useCallback, useState } from 'react';

/**
 * Per-SKU overrides for the Overstock put-away plan's automatic exclusion
 * rules (default model exclusions + weight range). `true` = force include
 * (overrides an automatic exclusion), `false` = force exclude (manual
 * exclusion, even if nothing automatic would have excluded it). A SKU with
 * no entry here just follows whatever the automatic rules say.
 * Persisted in localStorage — display-only, doesn't touch `inventory`.
 */
const STORAGE_KEY = 'pickd-warehouse-map-sku-overrides';

function readStored(): Map<string, boolean> {
  if (typeof window === 'undefined') return new Map();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return new Map();
    return new Map(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, boolean] => typeof e[1] === 'boolean'
      )
    );
  } catch {
    return new Map();
  }
}

export function useSkuOverrides() {
  const [overrides, setOverridesState] = useState<Map<string, boolean>>(readStored);

  const persist = useCallback((next: Map<string, boolean>) => {
    setOverridesState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)));
  }, []);

  /** Sets the override to the opposite of whatever is currently excluded, so the checkbox just flips. */
  const setOverride = useCallback(
    (sku: string, forceInclude: boolean) => {
      const next = new Map(overrides);
      next.set(sku, forceInclude);
      persist(next);
    },
    [overrides, persist]
  );

  const clearAll = useCallback(() => persist(new Map()), [persist]);

  return { overrides, setOverride, clearAll };
}
