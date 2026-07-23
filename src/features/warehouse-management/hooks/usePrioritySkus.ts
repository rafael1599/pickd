import { useCallback, useState } from 'react';

/**
 * SKUs that must be placed in the Overstock block before anything else —
 * e.g. pallets already sorted as "goes here, not to an active row" that
 * need a guaranteed slot right now, not just whatever the weighted ranking
 * happens to favor. Persisted in localStorage — display-only, doesn't touch
 * `inventory`.
 */
const STORAGE_KEY = 'pickd-warehouse-map-priority-skus';

// Seeded once with the pallet decision from 2026-07-22: SKUs with no orders
// in the last 30 days (stopped moving), so they're settled into the block
// instead of waiting on the general ranking.
const SEED_PRIORITY_SKUS = [
  '03-4065BL',
  '06-4638BK',
  '03-4266BK',
  '03-4531GY',
  '03-4532BL',
  '03-4527GY',
  '06-4516KW',
  '03-3842BR',
];

function readStored(): Set<string> {
  if (typeof window === 'undefined') return new Set(SEED_PRIORITY_SKUS);
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set(SEED_PRIORITY_SKUS);
    const parsed: unknown = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
    );
  } catch {
    return new Set(SEED_PRIORITY_SKUS);
  }
}

export function usePrioritySkus() {
  const [prioritySkus, setPrioritySkusState] = useState<Set<string>>(readStored);

  const persist = useCallback((next: Set<string>) => {
    setPrioritySkusState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  }, []);

  const toggle = useCallback(
    (sku: string) => {
      const next = new Set(prioritySkus);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      persist(next);
    },
    [prioritySkus, persist]
  );

  const add = useCallback(
    (skus: string[]) => {
      const next = new Set(prioritySkus);
      for (const sku of skus) next.add(sku);
      persist(next);
    },
    [prioritySkus, persist]
  );

  const remove = useCallback(
    (sku: string) => {
      const next = new Set(prioritySkus);
      next.delete(sku);
      persist(next);
    },
    [prioritySkus, persist]
  );

  const setAll = useCallback((skus: string[]) => persist(new Set(skus)), [persist]);
  const clear = useCallback(() => persist(new Set()), [persist]);

  return { prioritySkus, toggle, add, remove, setAll, clear };
}
