// idea-125 — per-tab quantity-bucket filter for consolidation candidates.
// Single-select; persists to localStorage so the operator's choice survives
// reloads / tab switches. Default at first visit: no bucket active (= show all).

import { useCallback, useEffect, useState } from 'react';

const STORAGE_PREFIX = 'consolidation_qty_bucket_';

export type QtyBucket = 'singles' | 'lines' | 'tower1' | 'towerPlus';

const VALID_BUCKETS: ReadonlySet<string> = new Set<QtyBucket>([
  'singles',
  'lines',
  'tower1',
  'towerPlus',
]);

function loadInitial(modeKey: string): QtyBucket | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + modeKey);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string' && VALID_BUCKETS.has(parsed)) return parsed as QtyBucket;
    return null;
  } catch {
    return null;
  }
}

export interface QtyBucketFilterApi {
  bucket: QtyBucket | null;
  setBucket: (next: QtyBucket | null) => void;
}

/**
 * Matches a quantity against a bucket's range. Buckets:
 *   - singles:    1-2
 *   - lines:      3-15
 *   - tower1:     16-30
 *   - towerPlus:  > 30
 */
export function matchesBucket(qty: number, bucket: QtyBucket): boolean {
  switch (bucket) {
    case 'singles':
      return qty >= 1 && qty <= 2;
    case 'lines':
      return qty >= 3 && qty <= 15;
    case 'tower1':
      return qty >= 16 && qty <= 30;
    case 'towerPlus':
      return qty > 30;
    default:
      return true;
  }
}

export function useQtyBucketFilter(modeKey: string): QtyBucketFilterApi {
  const [bucket, setBucketState] = useState<QtyBucket | null>(() => loadInitial(modeKey));

  // Re-load when modeKey changes (operator switched tabs).
  useEffect(() => {
    setBucketState(loadInitial(modeKey));
  }, [modeKey]);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = STORAGE_PREFIX + modeKey;
    if (bucket === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, JSON.stringify(bucket));
    }
  }, [modeKey, bucket]);

  const setBucket = useCallback((next: QtyBucket | null) => {
    setBucketState(next);
  }, []);

  return { bucket, setBucket };
}
