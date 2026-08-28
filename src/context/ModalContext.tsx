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

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { InventorySnapshotModal } from '../features/inventory/components/InventorySnapshotModal';
import { ItemDetailView } from '../features/inventory/components/ItemDetailView';
import { PickingSummaryModalById } from '../components/orders/PickingSummaryModalById';
import { NotificationHistoryModal } from '../components/ui/NotificationHistoryModal';
import { OrderNotesModal } from '../features/picking/components/OrderNotesModal';
import { SkuLocationsModal } from '../features/inventory/components/SkuLocationsModal';
import type { InventoryItemWithMetadata, InventoryItemInput } from '../schemas/inventory.schema';
import { SlotPlanExecuteSheet } from '../features/warehouse-map/components/SlotPlanExecuteSheet';
import { LiveMoveSheet } from '../features/warehouse-map/components/LiveMoveSheet';
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
      combinedNumbers?: string[];
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

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ModalContext.Provider value={value}>
      {children}

      {/* All critical modals live here — survive opener unmounting */}
      {modal?.type === 'inventory-snapshot' && <InventorySnapshotModal isOpen onClose={close} />}

      {modal?.type === 'picking-summary' && (
        <PickingSummaryModalById listId={modal.listId} onClose={close} />
      )}

      {modal?.type === 'notification-history' && <NotificationHistoryModal onClose={close} />}

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
    </ModalContext.Provider>
  );
};

export const useModal = () => {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error('useModal must be used within a ModalProvider');
  return ctx;
};
