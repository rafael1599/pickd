/**
 * Tiny store: is the full-screen picking / double-check overlay open?
 *
 * The verification drawer (PickingCartDrawer → DoubleCheckView) renders as a
 * `fixed inset-0 z-[60]` overlay. The bottom nav sits at z-100, so it pokes
 * through the overlay. We can't just raise the overlay's z-index — the modals
 * it opens (ItemDetailView z-70, AddOnTargetPicker z-60, PhotoHero z-60) are
 * designed to sit just above it and would end up behind a raised overlay.
 *
 * So instead the drawer reports its open state here and LayoutMain hides the
 * bottom nav while the overlay is up. Keyed on the drawer's real `isOpen` (not
 * sessionMode, which can linger as 'double_checking' after navigating away).
 */

import { useSyncExternalStore } from 'react';

let isOpen = false;
const listeners = new Set<() => void>();

export function setPickingOverlayOpen(open: boolean) {
  if (isOpen === open) return;
  isOpen = open;
  for (const listener of listeners) listener();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): boolean {
  return isOpen;
}

export function usePickingOverlayOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
