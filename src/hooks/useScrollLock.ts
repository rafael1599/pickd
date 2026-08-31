import { useEffect, useRef, useSyncExternalStore } from 'react';

/**
 * Locks body scroll when active. Supports nested modals via a ref counter
 * so scroll is only restored when the last modal unmounts.
 *
 * Also hooks into browser back button / swipe-back gesture to close the modal,
 * preventing users from getting stuck when the X button is not visible.
 */
let lockCount = 0;
const lockListeners = new Set<() => void>();

const notifyLockListeners = () => {
  for (const listener of lockListeners) listener();
};

const subscribeToLocks = (cb: () => void): (() => void) => {
  lockListeners.add(cb);
  return () => {
    lockListeners.delete(cb);
  };
};

const isAnyLockActive = () => lockCount > 0;

/**
 * True while anything holds a body scroll lock — i.e. a modal, sheet, menu or
 * drawer is sitting on top of the view. The bottom nav reads this to get out
 * of the way (it lives at z-150 and would otherwise poke through overlays).
 */
export const useOverlayOpen = (): boolean =>
  useSyncExternalStore(subscribeToLocks, isAnyLockActive, isAnyLockActive);

export const useScrollLock = (isLocked: boolean, onBack?: () => void) => {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isLocked) return;

    lockCount++;
    document.body.style.overflow = 'hidden';
    notifyLockListeners();

    return () => {
      lockCount--;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.style.overflow = '';
      }
      notifyLockListeners();
    };
  }, [isLocked]);

  // Back button / swipe-back closes the modal
  useEffect(() => {
    if (!isLocked || !onBack) return;

    // Push a state so pressing back pops it instead of navigating away
    const tag = `modal-${Date.now()}-${Math.random()}`;
    history.pushState({ scrollLockModal: tag }, '');

    const handlePopState = () => {
      // Our entry was popped by the user pressing back — close the modal
      // Check that the current state no longer has our tag
      const state = history.state as { scrollLockModal?: string } | null;
      if (state?.scrollLockModal === tag) return; // Not our pop
      onBackRef.current?.();
    };

    // Small delay to avoid catching residual popstate from other modals
    let ready = false;
    const timer = setTimeout(() => {
      ready = true;
    }, 50);

    const wrappedHandler = (e: PopStateEvent) => {
      if (!ready) return;
      handlePopState();
      // After handling, prevent this event from propagating further
      e.stopImmediatePropagation();
    };

    window.addEventListener('popstate', wrappedHandler, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('popstate', wrappedHandler, true);
      // If modal closed programmatically (not via back button), our history
      // entry is still on the stack. We leave it — it's harmless (just a
      // {scrollLockModal: tag} state) and trying to remove it with
      // history.back() causes React Router to re-render the entire app.
    };
  }, [isLocked]); // eslint-disable-line react-hooks/exhaustive-deps
};
