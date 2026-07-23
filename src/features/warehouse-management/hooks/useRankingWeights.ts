import { useCallback, useState } from 'react';
import { DEFAULT_RANKING_WEIGHTS, type RankingWeights } from '../../../utils/overstockPutaway';

/**
 * User-tunable weights for the Overstock placement score (qty vs. how little
 * a SKU has moved — see rankByWeightedScore). Persisted in localStorage.
 */
const STORAGE_KEY = 'pickd-warehouse-map-ranking-weights';

function readStored(): RankingWeights {
  if (typeof window === 'undefined') return DEFAULT_RANKING_WEIGHTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_RANKING_WEIGHTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_RANKING_WEIGHTS;
    const { qty, moved } = parsed as { qty?: unknown; moved?: unknown };
    return {
      qty: typeof qty === 'number' ? qty : DEFAULT_RANKING_WEIGHTS.qty,
      moved: typeof moved === 'number' ? moved : DEFAULT_RANKING_WEIGHTS.moved,
    };
  } catch {
    return DEFAULT_RANKING_WEIGHTS;
  }
}

export function useRankingWeights() {
  const [weights, setWeightsState] = useState<RankingWeights>(readStored);

  const setWeights = useCallback((next: RankingWeights) => {
    setWeightsState(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  return { weights, setWeights };
}
