import { useCallback, useMemo, useState } from 'react';
import { splitOrderNumbers } from '../utils/orderLabel';

export interface CombinedOrderFilter {
  /** Sorted (desc numeric), deduped sub-order numbers parsed from the combined order_number string. */
  combinedNumbers: string[];
  /** True when 2+ sub-orders are present. */
  isCombined: boolean;
  /** Currently active sub-order filter, or null when showing the full combined view. */
  activeOrderFilter: string | null;
  /** Toggles a sub-order filter on/off — clicking the same number again clears it. */
  toggleOrderFilter: (orderNumber: string) => void;
  /** Explicitly clears the filter (used by the "go back to combined" pill). */
  clearOrderFilter: () => void;
}

/** Shared click-to-filter state for a combined order's `' / '`-joined
 *  order_number. Resets to unfiltered whenever the order_number itself
 *  changes (switching to a different order shouldn't carry over a stale
 *  sub-order filter). */
export function useCombinedOrderFilter(
  orderNumber: string | null | undefined
): CombinedOrderFilter {
  const [activeOrderFilter, setActiveOrderFilter] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState(orderNumber);

  if (orderNumber !== lastOrderNumber) {
    setLastOrderNumber(orderNumber);
    setActiveOrderFilter(null);
  }

  const combinedNumbers = useMemo(() => splitOrderNumbers(orderNumber), [orderNumber]);
  const isCombined = combinedNumbers.length > 1;

  const toggleOrderFilter = useCallback((num: string) => {
    setActiveOrderFilter((prev) => (prev === num ? null : num));
  }, []);

  const clearOrderFilter = useCallback(() => setActiveOrderFilter(null), []);

  return { combinedNumbers, isCombined, activeOrderFilter, toggleOrderFilter, clearOrderFilter };
}
