import { useEffect, useRef } from 'react';

/**
 * Locks body scroll when active. Supports nested modals via a ref counter
 * so scroll is only restored when the last modal unmounts.
 *
 * Also hooks into browser back button / swipe-back gesture to close the modal,
 * preventing users from getting stuck when the X button is not visible.
 */
let lockCount = 0;

export const useScrollLock = (isLocked: boolean, onBack?: () => void) => {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!isLocked) return;

    lockCount++;
    document.body.style.overflow = 'hidden';

    return () => {
      lockCount--;
      if (lockCount <= 0) {
        lockCount = 0;
        document.body.style.overflow = '';
      }
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
