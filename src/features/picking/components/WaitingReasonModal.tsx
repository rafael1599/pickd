import React, { useState } from 'react';
import { useMarkWaiting } from '../hooks/useWaitingOrders';
import { ReasonPicker } from './ReasonPicker';
import { ModalOverlay } from '../../../components/ui/ModalOverlay';

interface WaitingReasonModalProps {
  /** picking_lists.id of the order to move to the Waiting-for-Inventory list. */
  listId: string;
  /** Close without marking (Cancel button or backdrop click). */
  onClose: () => void;
  /** Fired after the order is successfully marked as waiting (before onClose). */
  onMarked?: () => void;
}

/**
 * Centered, blurred-backdrop modal that captures the "why is this order
 * waiting?" reason before holding an order for inventory.
 *
 * Rendered through a portal to `document.body`, so it is always centered in the
 * viewport regardless of the scroll position of whatever opened it. This is the
 * fix for the DoubleCheckView bug where the reason picker rendered inline at the
 * top of a long, scrolled list and appeared off-screen — looking like a no-op.
 *
 * Shared by DoubleCheckView (kebab → "Mark as Waiting") and VerificationBoard
 * (drag a card into the Waiting zone). It owns its own reason state and the
 * `useMarkWaiting` mutation; callers only supply the order id and callbacks.
 */
export const WaitingReasonModal: React.FC<WaitingReasonModalProps> = ({
  listId,
  onClose,
  onMarked,
}) => {
  const [reason, setReason] = useState('');
  const markWaiting = useMarkWaiting();

  const handleConfirm = () => {
    const trimmed = reason.trim();
    if (!trimmed || markWaiting.isPending) return;
    markWaiting.mutate(
      { listId, reason: trimmed },
      {
        onSuccess: () => {
          onMarked?.();
          onClose();
        },
      }
    );
  };

  return (
    <ModalOverlay
      onClose={onClose}
      maxWidth="xs"
      zIndex={200}
      cardBg="bg-surface"
      border="border-amber-500/30"
      className="p-5 space-y-3"
    >
      <p className="text-xs font-black text-amber-500 uppercase tracking-tight">
        Why is this order waiting?
      </p>
      <ReasonPicker actionType="waiting" selectedReason={reason} onReasonChange={setReason} />
      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-muted bg-card border border-subtle transition-all active:scale-[0.98]"
        >
          Cancel
        </button>
        <button
          onClick={handleConfirm}
          disabled={!reason.trim() || markWaiting.isPending}
          className="flex-1 p-2.5 rounded-xl text-xs font-black uppercase text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
        >
          {markWaiting.isPending ? 'Marking...' : 'Confirm'}
        </button>
      </div>
    </ModalOverlay>
  );
};
