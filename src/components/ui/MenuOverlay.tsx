import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import { useScrollLock } from '../../hooks/useScrollLock';

interface MenuOverlayProps {
  /** The trigger element the menu is anchored under. */
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Horizontal alignment relative to the trigger. Default: right edge. */
  align?: 'left' | 'right';
  /** Optional title for the menu header (especially prominent on mobile). */
  title?: string;
  /** z-index of the overlay. Default 120 (above page, below full-screen modals). */
  z?: number;
}

/**
 * Renders a dropdown menu in a portal over a blurred, scroll-locked backdrop so
 * only the menu is interactive while it's open. Clicking the backdrop (or
 * pressing back) closes it; scrolling the page is blocked — only the menu (if it
 * overflows) scrolls. Positioned centered on mobile and just under `anchorRef` on desktop.
 */
export function MenuOverlay({
  anchorRef,
  open,
  onClose,
  children,
  align = 'right',
  title,
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

  // Intercept and swallow all tap/click events on the backdrop to prevent bleed-through
  // to underlying components (e.g., InventoryCard onClick item detail)
  const handleBackdropDismiss = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 select-none flex items-center justify-center sm:block"
      style={{ zIndex: z }}
      onClick={handleBackdropDismiss}
      onMouseDown={handleBackdropDismiss}
      onTouchEnd={handleBackdropDismiss}
    >
      {/* Darkened blurred backdrop that blocks pointer events underneath */}
      <div
        className="absolute inset-0 bg-black/65 backdrop-blur-sm transition-opacity"
        aria-hidden
      />

      {/* Menu Box Container */}
      <div
        role="menu"
        className="
          relative sm:absolute max-h-[85vh] sm:max-h-[75vh] overflow-y-auto
          w-[calc(100%-2rem)] max-w-xs sm:w-auto sm:max-w-none m-auto sm:m-0
          bg-card border border-subtle rounded-2xl sm:rounded-xl shadow-2xl
          text-content z-10 animate-in fade-in zoom-in-95 duration-150
        "
        style={
          window.innerWidth >= 640 ? { top: pos.top, left: pos.left, right: pos.right } : undefined
        }
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Header with Title and 'X' Close Button */}
        <div className="px-3.5 py-2.5 border-b border-subtle flex items-center justify-between bg-surface/60 rounded-t-2xl sm:rounded-t-xl sticky top-0 z-10 backdrop-blur-md">
          <span className="text-[11px] font-black uppercase tracking-wider text-content truncate">
            {title || 'Options'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="p-1 rounded-lg hover:bg-surface text-muted hover:text-content active:scale-95 transition-all flex items-center justify-center"
            aria-label="Close menu"
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>

        {/* Menu Items Content */}
        <div className="p-1">{children}</div>
      </div>
    </div>,
    document.body
  );
}
