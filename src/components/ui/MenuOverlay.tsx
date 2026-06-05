import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';

interface MenuOverlayProps {
  /** The trigger element the menu is anchored under. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Horizontal alignment relative to the trigger. Default: right edge. */
  align?: 'left' | 'right';
  /** z-index of the overlay. Default 120 (above page, below full-screen modals). */
  z?: number;
}

/**
 * Renders a dropdown menu in a portal over a blurred, scroll-locked backdrop so
 * only the menu is interactive while it's open. Clicking the backdrop (or
 * pressing back) closes it; scrolling the page is blocked — only the menu (if it
 * overflows) scrolls. Positioned just under `anchorRef`.
 */
export function MenuOverlay({
  anchorRef,
  open,
  onClose,
  children,
  align = 'right',
  z = 120,
}: MenuOverlayProps) {
  useScrollLock(open, open ? onClose : undefined);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number }>({ top: 0 });

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const update = () => {
      const r = anchorRef.current?.getBoundingClientRect();
      if (!r) return;
      setPos(
        align === 'right'
          ? { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) }
          : { top: r.bottom + 6, left: Math.max(8, r.left) }
      );
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open, anchorRef, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0" style={{ zIndex: z }} onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" aria-hidden />
      <div
        role="menu"
        className="absolute max-h-[70vh] overflow-y-auto"
        style={{ top: pos.top, left: pos.left, right: pos.right }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
