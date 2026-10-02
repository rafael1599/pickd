import { useEffect, type RefObject } from 'react';
import { useOverlayOpen } from './useScrollLock';

/**
 * Typing anywhere on the screen writes into its search box (Rafael, 2 Oct 2026:
 * «que el teclado siempre comience a escribir en el buscador sin necesidad de
 * que se haga click primero, pero no quiero que esté en modo focus siempre»).
 *
 * Nothing is focused ahead of time. The first printable key focuses the input
 * with the caret at the end and is NOT swallowed: the browser delivers that same
 * key to the input it just moved focus to, so it goes through the input's own
 * onChange (and its SKU dash) like any other keystroke, and the rest follow.
 * A scanner gun is a keyboard, so a scan lands in the search too.
 */

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  defaultPrevented: boolean;
}

const isEditable = (el: Element | null): boolean => {
  if (!el) return false;
  if (el.closest('[contenteditable]:not([contenteditable="false"])')) return true;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
};

/** Whether this keydown should be redirected into the search box. */
export function shouldCaptureKey(e: KeyLike, active: Element | null): boolean {
  if (e.defaultPrevented || e.isComposing) return false;
  // Shortcuts (copy, reload, find…) stay the browser's.
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  // Printable characters only; Enter, Tab, arrows, F-keys keep their job.
  // Space scrolls the page and starts no search, so it is left alone too.
  if (e.key.length !== 1 || e.key === ' ') return false;
  // Someone is already typing somewhere: a note, a quantity, the search itself.
  return !isEditable(active);
}

export function useTypeToSearch(inputRef: RefObject<HTMLInputElement | null>, enabled = true) {
  // A modal, sheet or menu on top owns the keyboard.
  const overlayOpen = useOverlayOpen();

  useEffect(() => {
    if (!enabled || overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || !input.isConnected) return;
      if (!shouldCaptureKey(e, document.activeElement)) return;
      input.focus({ preventScroll: true });
      const end = input.value.length;
      input.setSelectionRange(end, end);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inputRef, enabled, overlayOpen]);
}
