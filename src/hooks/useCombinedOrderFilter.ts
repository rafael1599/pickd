import { useCallback, useMemo, useState } from 'react';
import { splitOrderNumbers } from '../utils/orderLabel';

interface PendingPreset {
  forOrderNumber: string;
  filterValue: string;
}

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
  /**
   * Arms a sub-order filter to apply the moment `orderNumber` changes to a
   * specific value — e.g. a list row's number click that also needs to
   * switch which order is selected. Calling toggleOrderFilter in the same
   * batch as switching orders doesn't work: the reset-on-change guard below
   * always runs on the render where orderNumber first changes and clobbers
   * whatever the toggle just set (it can't tell "a fresh filter for this new
   * order" apart from "a stale filter left over from the previous order").
   * This presets the value the guard should use for one specific upcoming
   * order_number instead of unconditionally nulling it.
   */
  presetFilterForNextOrder: (forOrderNumber: string, filterValue: string) => void;
}

/** Shared click-to-filter state for a combined order's `' / '`-joined
 *  order_number. Resets to unfiltered whenever the order_number itself
 *  changes (switching to a different order shouldn't carry over a stale
 *  sub-order filter), unless a preset was armed via presetFilterForNextOrder
 *  for that exact incoming order_number. */
export function useCombinedOrderFilter(
  orderNumber: string | null | undefined
): CombinedOrderFilter {
  const [activeOrderFilter, setActiveOrderFilter] = useState<string | null>(null);
  const [lastOrderNumber, setLastOrderNumber] = useState(orderNumber);
  // Plain state, not a ref — React disallows reading/writing refs during
  // render (only effects/handlers), but adjusting state during render, as
  // this guard already does for lastOrderNumber/activeOrderFilter, is the
  // officially supported pattern for exactly this "derive from a prop
  // change" case.
  const [pendingPreset, setPendingPreset] = useState<PendingPreset | null>(null);

  if (orderNumber !== lastOrderNumber) {
    setLastOrderNumber(orderNumber);
    if (pendingPreset && pendingPreset.forOrderNumber === orderNumber) {
      setActiveOrderFilter(pendingPreset.filterValue);
    } else {
      setActiveOrderFilter(null);
    }
    if (pendingPreset) setPendingPreset(null);
  }

  const combinedNumbers = useMemo(() => splitOrderNumbers(orderNumber), [orderNumber]);
  const isCombined = combinedNumbers.length > 1;

  const toggleOrderFilter = useCallback((num: string) => {
    setActiveOrderFilter((prev) => (prev === num ? null : num));
  }, []);

  const clearOrderFilter = useCallback(() => setActiveOrderFilter(null), []);

  const presetFilterForNextOrder = useCallback((forOrderNumber: string, filterValue: string) => {
    setPendingPreset({ forOrderNumber, filterValue });
  }, []);

  return {
    combinedNumbers,
    isCombined,
    activeOrderFilter,
    toggleOrderFilter,
    clearOrderFilter,
    presetFilterForNextOrder,
  };
}
