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
import type {
  InventoryItemWithMetadata,
  InventoryItemInput,
} from '../schemas/inventory.schema';

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
      {modal?.type === 'inventory-snapshot' && (
        <InventorySnapshotModal isOpen onClose={close} />
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
