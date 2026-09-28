/* eslint-disable react-refresh/only-export-components */
/**
 * Modal Manager — Context + Root Render pattern
 *
 * See `docs/modal-pattern.md` for the full architectural decision.
 *
 * Golden rule: no critical modal lives inside the component that opens it.
 *
 * Usage:
 *   const { open, close } = useModal();
 *   open({ type: 'item-detail', item });
 */

import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useScrollLock } from '../hooks/useScrollLock';
import { lazyWithRetry } from '../utils/lazyWithRetry';
const InventorySnapshotModal = lazyWithRetry(() =>
  import('../features/inventory/components/InventorySnapshotModal').then((m) => ({
    default: m.InventorySnapshotModal,
  }))
);
const ItemDetailView = lazyWithRetry(() =>
  import('../features/inventory/components/ItemDetailView').then((m) => ({
    default: m.ItemDetailView,
  }))
);
const PickingSummaryModalById = lazyWithRetry(() =>
  import('../components/orders/PickingSummaryModalById').then((m) => ({
    default: m.PickingSummaryModalById,
  }))
);
const NotificationHistoryModal = lazyWithRetry(() =>
  import('../components/ui/NotificationHistoryModal').then((m) => ({
    default: m.NotificationHistoryModal,
  }))
);
const OrderNotesModal = lazyWithRetry(() =>
  import('../features/picking/components/OrderNotesModal').then((m) => ({
    default: m.OrderNotesModal,
  }))
);
const As400DoorModal = lazyWithRetry(() =>
  import('../features/picking/components/board/As400DoorModal').then((m) => ({
    default: m.As400DoorModal,
  }))
);
const SkuLocationsModal = lazyWithRetry(() =>
  import('../features/inventory/components/SkuLocationsModal').then((m) => ({
    default: m.SkuLocationsModal,
  }))
);
import type { InventoryItemWithMetadata, InventoryItemInput } from '../schemas/inventory.schema';
const SlotPlanExecuteSheet = lazyWithRetry(() =>
  import('../features/warehouse-map/components/SlotPlanExecuteSheet').then((m) => ({
    default: m.SlotPlanExecuteSheet,
  }))
);
const LiveMoveSheet = lazyWithRetry(() =>
  import('../features/warehouse-map/components/LiveMoveSheet').then((m) => ({
    default: m.LiveMoveSheet,
  }))
);
const CombineConflictModal = lazyWithRetry(() =>
  import('../features/picking/ship/components/modals/CombineConflictModal').then((m) => ({
    default: m.CombineConflictModal,
  }))
);
const SplitShippingTypeModal = lazyWithRetry(() =>
  import('../features/picking/ship/components/modals/SplitShippingTypeModal').then((m) => ({
    default: m.SplitShippingTypeModal,
  }))
);
import type { SplitShippingTypeOrder } from '../features/picking/ship/components/modals/SplitShippingTypeModal';
export type { SplitShippingTypeOrder };
import type { CombineConflictAnalysis } from '../features/picking/ship/utils/combineConflicts';
import type { MoveDraft } from '../features/warehouse-map/plan/slotPlan';
import type { ZoneId } from '../features/warehouse-map/engine';

type ItemDetailSavePayload = InventoryItemInput & {
  length_in?: number;
  width_in?: number;
  height_in?: number;
};

export type ModalState =
  | { type: 'inventory-snapshot' }
  | {
      type: 'item-detail';
      item: InventoryItemWithMetadata | null;
      mode?: 'add' | 'edit';
      screenType?: string;
      onSave?: (data: ItemDetailSavePayload) => Promise<void> | void;
      onDelete?: () => Promise<void> | void;
    }
  | { type: 'picking-summary'; listId: string }
  | { type: 'notification-history' }
  | {
      /** AS400 captures Bay 2 has published; "Bring in" requests one (the door). */
      type: 'as400-door';
    }
  | {
      /** Every row a SKU is stocked in, the order's own address marked. */
      type: 'sku-locations';
      sku: string;
      itemName?: string | null;
      pickLocation?: string | null;
      pickWarehouse?: string | null;
      onEdit: (row: InventoryItemWithMetadata) => void;
      /** The SKU is not in inventory: the operator chose bike/part and this is the prefilled item to add. */
      onRegister: (prefill: InventoryItemWithMetadata) => void;
    }
  | {
      /** PLAN COMPLETED on the warehouse map: executes a zone's draft plan (idea-173). */
      type: 'slot-plan-execute';
      zoneId: ZoneId;
      planId: string;
    }
  | {
      /** LIVE on the warehouse map: one drop, confirmed, moved now (idea-173, P2). */
      type: 'slot-live-move';
      zoneId: ZoneId;
      drafts: MoveDraft[];
      rule: 'move' | 'swap' | 'join';
    }
  | {
      type: 'order-notes';
      listId: string | string[];
      autoFocusComposer?: boolean;
      watcherNote?: string | null;
      /** The AS400 note of each member of a combined order. */
      watcherNotes?: { orderNumber: string | null; notes: string | null }[];
      combinedNumbers?: string[];
    }
  | {
      type: 'combine-conflict';
      conflict: CombineConflictAnalysis;
      onConfirm: (resolution: {
        selectedAddressId?: string;
        selectedLoadNumber?: string;
      }) => Promise<void> | void;
    }
  | {
      type: 'split-shipping-type';
      orders: SplitShippingTypeOrder[];
      onConfirm: (selections: Record<string, 'regular' | 'fedex'>) => Promise<void> | void;
    }
  | null;

interface ModalContextValue {
  open: (modal: NonNullable<ModalState>) => void;
  close: () => void;
}

const ModalContext = createContext<ModalContextValue | null>(null);

export const ModalProvider = ({ children }: { children: ReactNode }) => {
  const [modal, setModal] = useState<ModalState>(null);

  const open = useCallback((m: NonNullable<ModalState>) => setModal(m), []);
  const close = useCallback(() => setModal(null), []);

  // Any open manager modal locks body scroll — which is also the signal the
  // bottom nav listens to for hiding itself under overlays (useOverlayOpen).
  // Modals that already lock via ModalOverlay just nest; the counter handles it.
  useScrollLock(modal !== null);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ModalContext.Provider value={value}>
      {children}

      {/* Local Suspense: a modal chunk loading must never suspend the screen behind it. */}
      <Suspense fallback={null}>
        {modal?.type === 'inventory-snapshot' && <InventorySnapshotModal isOpen onClose={close} />}

        {modal?.type === 'picking-summary' && (
          <PickingSummaryModalById listId={modal.listId} onClose={close} />
        )}

        {modal?.type === 'notification-history' && <NotificationHistoryModal onClose={close} />}
        {modal?.type === 'as400-door' && <As400DoorModal onClose={close} />}

        {modal?.type === 'sku-locations' && (
          <SkuLocationsModal
            sku={modal.sku}
            itemName={modal.itemName}
            pickLocation={modal.pickLocation}
            pickWarehouse={modal.pickWarehouse}
            onEdit={modal.onEdit}
            onRegister={modal.onRegister}
            onClose={close}
          />
        )}

        {modal?.type === 'slot-plan-execute' && (
          <SlotPlanExecuteSheet zoneId={modal.zoneId} planId={modal.planId} onClose={close} />
        )}

        {modal?.type === 'slot-live-move' && (
          <LiveMoveSheet
            zoneId={modal.zoneId}
            drafts={modal.drafts}
            rule={modal.rule}
            onClose={close}
          />
        )}

        {modal?.type === 'order-notes' && (
          <OrderNotesModal
            listId={modal.listId}
            autoFocusComposer={modal.autoFocusComposer}
            watcherNote={modal.watcherNote}
            watcherNotes={modal.watcherNotes}
            combinedNumbers={modal.combinedNumbers}
            onClose={close}
          />
        )}

        {modal?.type === 'item-detail' && (
          <ItemDetailView
            isOpen
            onClose={close}
            initialData={modal.item}
            mode={modal.mode ?? 'edit'}
            screenType={modal.screenType ?? modal.item?.warehouse}
            onSave={async (data) => {
              await modal.onSave?.(data);
              close();
            }}
            onDelete={
              modal.onDelete
                ? async () => {
                    await modal.onDelete?.();
                    close();
                  }
                : undefined
            }
          />
        )}

        {modal?.type === 'combine-conflict' && (
          <CombineConflictModal
            conflict={modal.conflict}
            onConfirm={modal.onConfirm}
            onClose={close}
          />
        )}

        {modal?.type === 'split-shipping-type' && (
          <SplitShippingTypeModal
            orders={modal.orders}
            onConfirm={modal.onConfirm}
            onClose={close}
          />
        )}
      </Suspense>
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within a ModalProvider');
  return ctx;
};
