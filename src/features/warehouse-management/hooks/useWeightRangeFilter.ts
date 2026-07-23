import { useCallback, useState } from 'react';

/**
 * Min/max weight (lbs) range for the Overstock put-away plan. SKUs outside
 * the range are excluded from the view (e.g. bikes too heavy for a tower
 * lift, or too light to bother slotting). Persisted in localStorage —
 * display-only, doesn't touch `inventory` or `sku_metadata`.
 */
const STORAGE_KEY = 'pickd-warehouse-map-weight-range';

export interface WeightRange {
  min: number | null;
  max: number | null;
}

const EMPTY_RANGE: WeightRange = { min: null, max: null };

function readStored(): WeightRange {
  if (typeof window === 'undefined') return EMPTY_RANGE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_RANGE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_RANGE;
    const { min, max } = parsed as { min?: unknown; max?: unknown };
    return {
      min: typeof min === 'number' ? min : null,
      max: typeof max === 'number' ? max : null,
    };
  } catch {
    return EMPTY_RANGE;
  }
}

export function useWeightRangeFilter() {
  const [range, setRangeState] = useState<WeightRange>(readStored);

  const setRange = useCallback((next: WeightRange) => {
    setRangeState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  return { range, setRange };
}
