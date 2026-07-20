import React, { useState } from 'react';
import { ModalOverlay } from '../../../components/ui/ModalOverlay';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import Play from 'lucide-react/dist/esm/icons/play';
import GitMerge from 'lucide-react/dist/esm/icons/git-merge';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import X from 'lucide-react/dist/esm/icons/x';
import PackageCheck from 'lucide-react/dist/esm/icons/package-check';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';

export interface OrderActionsMenuProps {
  /** Header label — a single order number or a combined "a / b / c" string. */
  orderNumber: string | null;
  /** Fallback identity for the header when there is no order number. */
  fallbackId?: string;
  status: string;
  isWaiting?: boolean;
  /** Members of the current group — drives the Ungroup picker. */
  groupMembers?: Array<{ id: string; order_number: string | null }>;
  groupId?: string | null;
  /** Edit Order issue badge (stock conflicts, etc). */
  problemCount?: number;
  /** Take Photo progress. */
  photo?: { count: number; total: number; isScanning?: boolean };
  /** Gate the waiting action (e.g. admin-only in DoubleCheck). Default true. */
  canWait?: boolean;
  /** Gate merge/combine (e.g. already-combined orders can't combine). Default true. */
  canMerge?: boolean;
  /** Optional node rendered in the header (e.g. the FedEx/Regular toggle). */
  headerToggle?: React.ReactNode;
  onClose: () => void;
  onEdit?: () => void;
  onTakePhoto?: () => void;
  onMarkWaiting?: () => void;
  onResume?: () => void;
  onMerge?: () => void;
  onUngroup?: (orderId: string, groupId: string) => void | Promise<void>;
  onReopen?: () => void;
  onCancel?: () => void;
  /** Sets the order's carrier to PICK UP — for orders picked up in person. */
  onMarkPickup?: () => void;
  /** Opens the note composer for this order. */
  onAddNote?: () => void;
}

const ROW =
  'w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-surface/80 transition-colors text-left rounded-xl';

/**
 * Shared 3-dot actions menu for an order. Rendered as a centered modal and
 * inherited by both the Live Board and the DoubleCheck view — each view passes
 * its own handlers. Which items appear is driven purely by order state + which
 * handlers are provided, so the two views expose the same set of actions.
 */
export const OrderActionsMenu: React.FC<OrderActionsMenuProps> = ({
  orderNumber,
  fallbackId,
  status,
  isWaiting = false,
  groupMembers = [],
  groupId = null,
  problemCount = 0,
  photo,
  canWait = true,
  canMerge = true,
  headerToggle,
  onClose,
  onEdit,
  onTakePhoto,
  onMarkWaiting,
  onResume,
  onMerge,
  onUngroup,
  onReopen,
  onCancel,
  onMarkPickup,
  onAddNote,
}) => {
  const [ungroupOpen, setUngroupOpen] = useState(false);
  const isPastOrder = status === 'completed' || status === 'cancelled' || status === 'shipped';
  const isGrouped = !!groupId && groupMembers.length > 1;
  const headerLabel = orderNumber || fallbackId || '—';

  const photoLabel = photo?.isScanning
    ? 'Processing…'
    : photo && photo.total > 0 && photo.count > 0 && photo.count < photo.total
      ? `Take Photo ${photo.count + 1} of ${photo.total}`
      : 'Take Photo';

  return (
    <ModalOverlay
      onClose={onClose}
      maxWidth="sm"
      zIndex={260}
      blur="sm"
      backdrop="bg-black/60"
      cardBg="bg-[#1a1a1a]"
      border="border-white/10"
      className="p-5 flex flex-col"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0 pb-3 border-b border-white/5">
        <div>
          <h3 className="text-sm font-black text-content uppercase tracking-widest flex items-center gap-2">
            Order Options
            {headerToggle && !isPastOrder && (
              <div className="ml-2 scale-90 origin-left">{headerToggle}</div>
            )}
          </h3>
          <p className="text-[10px] text-muted/70 mt-1">Order #{headerLabel}</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 text-muted hover:text-content transition-colors rounded-lg hover:bg-content/[0.05]"
          type="button"
        >
          <X size={18} />
        </button>
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        {onEdit && !isPastOrder && (
          <button onClick={onEdit} className={ROW}>
            <Pencil size={16} className={problemCount > 0 ? 'text-red-400' : 'text-sky-400'} />
            <div className="flex-1">
              <div className="text-xs font-black uppercase tracking-wider text-content">
                Edit Order
              </div>
              <div className="text-[9px] text-muted/70">
                Adjust items or resolve stock conflicts
              </div>
            </div>
            {problemCount > 0 && (
              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 uppercase tracking-wider">
                {problemCount} issue{problemCount > 1 ? 's' : ''}
              </span>
            )}
          </button>
        )}

        {onTakePhoto && !isPastOrder && (
          <button onClick={onTakePhoto} disabled={photo?.isScanning} className={ROW}>
            {photo?.isScanning ? (
              <Loader2 size={16} className="text-accent animate-spin" />
            ) : (
              <Camera
                size={16}
                className={
                  photo && photo.total > 0 && photo.count >= photo.total
                    ? 'text-emerald-400'
                    : photo && photo.count > 0
                      ? 'text-amber-400'
                      : 'text-accent'
                }
              />
            )}
            <div className="flex-1">
              <div className="text-xs font-black uppercase tracking-wider text-content">
                {photoLabel}
              </div>
              <div className="text-[9px] text-muted/70">
                {photo && photo.total > 0
                  ? `${photo.count} of ${photo.total} pallet${photo.total > 1 ? 's' : ''} captured`
                  : 'Capture and upload pallet photos'}
              </div>
            </div>
            {photo && photo.total > 0 && (
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  photo.count >= photo.total
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : photo.count > 0
                      ? 'bg-amber-500/20 text-amber-400'
                      : 'bg-red-500/20 text-red-400'
                }`}
              >
                {photo.count}/{photo.total}
              </span>
            )}
          </button>
        )}

        {!isPastOrder &&
          canWait &&
          (isWaiting
            ? onResume && (
                <button onClick={onResume} className={ROW}>
                  <Play size={16} className="text-emerald-400 animate-pulse" />
                  <div>
                    <div className="text-xs font-black uppercase tracking-wider text-content">
                      Resume Order
                    </div>
                    <div className="text-[9px] text-muted/70">Resume double check flow</div>
                  </div>
                </button>
              )
            : onMarkWaiting && (
                <button onClick={onMarkWaiting} className={ROW}>
                  <Hourglass size={16} className="text-amber-400" />
                  <div>
                    <div className="text-xs font-black uppercase tracking-wider text-content">
                      Mark as Waiting
                    </div>
                    <div className="text-[9px] text-muted/70">
                      Hold order for inventory/stock issues
                    </div>
                  </div>
                </button>
              ))}

        {onMerge && canMerge && (
          <button onClick={onMerge} className={ROW}>
            <GitMerge size={16} className="text-purple-400" />
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-content">
                Combine
              </div>
              <div className="text-[9px] text-muted/70">Combine this order with another one</div>
            </div>
          </button>
        )}

        {onUngroup && isGrouped && groupId && (
          <>
            <button onClick={() => setUngroupOpen((v) => !v)} className={ROW}>
              <Unlink size={16} className="text-amber-400" />
              <div className="flex-1">
                <div className="text-xs font-black uppercase tracking-wider text-content">
                  Ungroup
                </div>
                <div className="text-[9px] text-muted/70">Remove an order from this group</div>
              </div>
              <ChevronDown
                size={14}
                className={`text-muted transition-transform ${ungroupOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {ungroupOpen && (
              <div className="pl-3 space-y-1">
                {groupMembers.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onUngroup(m.id, groupId)}
                    className="w-full flex items-center gap-2 px-4 py-2.5 bg-surface/60 border border-subtle hover:border-amber-500/40 hover:bg-surface transition-colors text-left rounded-xl"
                  >
                    <Unlink size={14} className="text-amber-400 shrink-0" />
                    <span className="text-xs font-black uppercase tracking-wider text-content truncate">
                      #{m.order_number || m.id.slice(-6).toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {onMarkPickup && (
          <button onClick={onMarkPickup} className={ROW}>
            <PackageCheck size={16} className="text-orange-400" />
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-content">
                Mark as Pickup
              </div>
              <div className="text-[9px] text-muted/70">Set carrier to PICK UP</div>
            </div>
          </button>
        )}

        {onAddNote && (
          <button onClick={onAddNote} className={ROW}>
            <MessageSquare size={16} className="text-sky-400" />
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-content">
                Add Note
              </div>
              <div className="text-[9px] text-muted/70">Leave a note on this order</div>
            </div>
          </button>
        )}

        {onReopen && isPastOrder && status !== 'shipped' && (
          <button onClick={onReopen} className={ROW}>
            <Clock size={16} className="text-sky-400" />
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-content">
                Reopen Order
              </div>
              <div className="text-[9px] text-muted/70">Restore order to an active lane</div>
            </div>
          </button>
        )}

        {onCancel && !isPastOrder && (
          <button
            onClick={onCancel}
            className="w-full flex items-center gap-3 px-4 py-3 bg-surface border border-subtle hover:bg-red-500/10 transition-colors text-left rounded-xl"
          >
            <Trash2 size={16} className="text-red-500" />
            <div>
              <div className="text-xs font-black uppercase tracking-wider text-red-400">
                Cancel Order
              </div>
              <div className="text-[9px] text-muted/70">Release items back to stock</div>
            </div>
          </button>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 shrink-0 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 min-h-10 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
          type="button"
        >
          Cancel
        </button>
      </div>
    </ModalOverlay>
  );
};
