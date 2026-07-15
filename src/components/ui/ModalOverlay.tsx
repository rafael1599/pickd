import React from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../hooks/useScrollLock';

const MAX_WIDTH = {
  xs: 'max-w-xs',
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '5xl': 'max-w-5xl',
  '6xl': 'max-w-6xl',
  '7xl': 'max-w-7xl',
} as const;

export interface ModalOverlayProps {
  /** Close handler — fired on backdrop click (unless disabled) and Escape. */
  onClose: () => void;
  children: React.ReactNode;
  /** Card max width. Default 'sm'. */
  maxWidth?: keyof typeof MAX_WIDTH;
  /** Stacking order. Applied inline so it survives JIT purging. Default 200. */
  zIndex?: number;
  /** Close when the backdrop is clicked. Default true. */
  closeOnBackdrop?: boolean;
  /** Backdrop blur strength. Default 'md'. */
  blur?: 'sm' | 'md';
  /** Backdrop tint class. Default 'bg-main/60'. */
  backdrop?: string;
  /** Card background token. Default 'bg-card'. */
  cardBg?: string;
  /** Card border class. Default 'border-subtle'. */
  border?: string;
  /** Card corner radius class. Default 'rounded-2xl'. */
  rounded?: string;
  /** Extra classes appended to the card (e.g. padding, overflow overrides). */
  className?: string;
  /** Lock body scroll while open. Default true. */
  lockScroll?: boolean;
}

/**
 * Shared centered-modal shell: portal to <body>, blurred backdrop, scroll lock,
 * and a card that stops click propagation. Replaces the ~28 hand-rolled
 * `createPortal + fixed inset-0 ... backdrop-blur` overlays across the app.
 * Callers provide the card's inner content (header/body/footer).
 */
export const ModalOverlay: React.FC<ModalOverlayProps> = ({
  onClose,
  children,
  maxWidth = 'sm',
  zIndex = 200,
  closeOnBackdrop = true,
  blur = 'md',
  backdrop = 'bg-main/60',
  cardBg = 'bg-card',
  border = 'border-subtle',
  rounded = 'rounded-2xl',
  className = '',
  lockScroll = true,
}) => {
  useScrollLock(lockScroll, onClose);

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${backdrop} ${
        blur === 'sm' ? 'backdrop-blur-sm' : 'backdrop-blur-md'
      } animate-in fade-in duration-200`}
      style={{ zIndex }}
      onClick={closeOnBackdrop ? onClose : undefined}
    >
      <div
        className={`${cardBg} border ${border} ${rounded} w-full ${MAX_WIDTH[maxWidth]} shadow-2xl animate-in zoom-in-95 duration-200 ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
