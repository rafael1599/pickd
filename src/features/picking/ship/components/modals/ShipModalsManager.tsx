import React from 'react';
import { PickingSummaryModal } from '../../../../../components/orders/PickingSummaryModal';
import { SplitOrderModal } from '../../../../../components/orders/SplitOrderModal';
import { ReasonPicker } from '../../../components/ReasonPicker';
import { ShippingFlowPreviewModal } from '../../../components/ShippingFlowPreviewModal';
import { ShippingResolutionModal } from '../../../components/board/ShippingResolutionModal';
import type { OrderWithRelations } from '../../hooks/useShipOrdersData';

interface ShipModalsManagerProps {
  selectedOrder: OrderWithRelations | null;
  // Picking summary
  isShowingPickingSummary: boolean;
  onClosePickingSummary: () => void;
  // Split order
  isShowingSplitModal: boolean;
  onCloseSplitModal: () => void;
  onSplitComplete: () => void;
  // Restore reason modal
  restoreReasonModal: boolean;
  restoreReason: string;
  onRestoreReasonChange: (reason: string) => void;
  onCloseRestoreReasonModal: () => void;
  onConfirmRestore: () => void;
  // Reopen reason modal
  reopenReasonModal: boolean;
  reopenReason: string;
  onReopenReasonChange: (reason: string) => void;
  onCloseReopenReasonModal: () => void;
  onConfirmReopen: () => void;
  // Camera input
  shipCameraInputRef: React.RefObject<HTMLInputElement | null>;
  onShipCameraChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  // Flow preview modal
  showShippingPreview: boolean;
  shippingPreviewOrders: OrderWithRelations[];
  onCloseShippingPreview: () => void;
  onConfirmBatchShip: (photos: Record<string, string[]>) => Promise<void>;
  isShippingBatch: boolean;
  // Resolution modal
  pendingShippingResolutionGroupId: string | null;
  onCloseShippingResolution: () => void;
  onShippingResolutionResolved: () => void;
}

export const ShipModalsManager: React.FC<ShipModalsManagerProps> = ({
  selectedOrder,
  isShowingPickingSummary,
  onClosePickingSummary,
  isShowingSplitModal,
  onCloseSplitModal,
  onSplitComplete,
  restoreReasonModal,
  restoreReason,
  onRestoreReasonChange,
  onCloseRestoreReasonModal,
  onConfirmRestore,
  reopenReasonModal,
  reopenReason,
  onReopenReasonChange,
  onCloseReopenReasonModal,
  onConfirmReopen,
  shipCameraInputRef,
  onShipCameraChange,
  showShippingPreview,
  shippingPreviewOrders,
  onCloseShippingPreview,
  onConfirmBatchShip,
  isShippingBatch,
  pendingShippingResolutionGroupId,
  onCloseShippingResolution,
  onShippingResolutionResolved,
}) => {
  return (
    <>
      {/* Picking Summary Modal */}
      {isShowingPickingSummary && selectedOrder && (
        <PickingSummaryModal
          listId={selectedOrder.id}
          orderNumber={selectedOrder.order_number || ''}
          customerName={selectedOrder.customer?.name ?? undefined}
          items={selectedOrder.items || []}
          completedAt={selectedOrder.updated_at}
          pickedBy={selectedOrder.user?.full_name ?? undefined}
          checkedBy={selectedOrder.checker?.full_name ?? undefined}
          palletPhotos={selectedOrder.pallet_photos ?? undefined}
          status={selectedOrder.status ?? undefined}
          onClose={onClosePickingSummary}
        />
      )}

      {/* Split Order Modal */}
      {isShowingSplitModal && selectedOrder && (
        <SplitOrderModal
          order={selectedOrder as React.ComponentProps<typeof SplitOrderModal>['order']}
          onClose={onCloseSplitModal}
          onSplitComplete={onSplitComplete}
        />
      )}

      {/* Restore reason modal */}
      {restoreReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-main/60 backdrop-blur-md p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-black text-orange-400 uppercase tracking-widest mb-4">
              Why are you restoring this order?
            </h3>
            <ReasonPicker
              actionType="restore"
              selectedReason={restoreReason}
              onReasonChange={onRestoreReasonChange}
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={onCloseRestoreReasonModal}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmRestore}
                disabled={!restoreReason}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-orange-500 text-white border border-orange-500 transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen reason modal */}
      {reopenReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-main/60 backdrop-blur-md p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-black text-orange-400 uppercase tracking-widest mb-4">
              Why are you reopening this order?
            </h3>
            <ReasonPicker
              actionType="reopen"
              selectedReason={reopenReason}
              onReasonChange={onReopenReasonChange}
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={onCloseReopenReasonModal}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmReopen}
                disabled={!reopenReason}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-orange-500 text-white border border-orange-500 transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-50"
              >
                Reopen
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={shipCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onShipCameraChange}
        className="hidden"
      />

      {showShippingPreview && (
        <ShippingFlowPreviewModal
          orders={shippingPreviewOrders}
          onClose={onCloseShippingPreview}
          onConfirm={onConfirmBatchShip}
          isSubmitting={isShippingBatch}
        />
      )}

      {pendingShippingResolutionGroupId && (
        <ShippingResolutionModal
          groupId={pendingShippingResolutionGroupId}
          onClose={onCloseShippingResolution}
          onResolved={onShippingResolutionResolved}
        />
      )}
    </>
  );
};
