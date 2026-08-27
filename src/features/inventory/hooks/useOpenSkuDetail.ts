import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useModal } from '../../../context/ModalContext';
import { useInventory } from './useInventoryData';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';

export interface OpenSkuDetailArgs {
  sku: string;
  itemName?: string | null;
  /** The address an order sends the picker to — marked first in the picker. */
  pickLocation?: string | null;
  pickWarehouse?: string | null;
}

/**
 * "Open this SKU" from anywhere an order line is shown (Ship's Order Items,
 * idea-165). One live row → straight to its Item Detail; several, or none →
 * the locations picker Double Check opens on long-press (every row with Edit,
 * the order's own address first, and the Bike/Part register flow when the SKU
 * has no row at all). Same three modal callbacks as DoubleCheckView's
 * openSkuLocations; `afterChange` is where a caller refreshes its own maps.
 */
export function useOpenSkuDetail(opts: { afterChange?: () => void | Promise<void> } = {}) {
  const { open: openModal } = useModal();
  const { updateItem, deleteItem, addItem } = useInventory();
  const { afterChange } = opts;

  return useCallback(
    async (args: OpenSkuDetailArgs) => {
      const editRow = (row: InventoryItemWithMetadata) =>
        openModal({
          type: 'item-detail',
          item: row,
          mode: 'edit',
          screenType: row.warehouse,
          onSave: async (formData) => {
            await updateItem(row, formData);
            await afterChange?.();
            toast.success(`Updated ${row.sku}`);
          },
          onDelete: async () => {
            await deleteItem(row.warehouse, row.sku, row.location);
            await afterChange?.();
            toast.success(`Deleted ${row.sku}`);
          },
        });
      const registerSku = (prefill: InventoryItemWithMetadata) =>
        openModal({
          type: 'item-detail',
          item: prefill,
          mode: 'add',
          screenType: prefill.warehouse,
          onSave: async (formData) => {
            await addItem(formData.warehouse, formData);
            await afterChange?.();
            toast.success(`Registered ${formData.sku}`);
          },
        });

      const { data } = await supabase
        .from('inventory')
        .select('*, sku_metadata(*)')
        .eq('sku', args.sku);
      const rows = (data ?? []) as unknown as InventoryItemWithMetadata[];
      const live = rows.filter((r) => r.is_active !== false && (r.quantity ?? 0) > 0);
      if (live.length === 1) {
        editRow(live[0]);
        return;
      }
      openModal({
        type: 'sku-locations',
        sku: args.sku,
        itemName: args.itemName ?? null,
        pickLocation: args.pickLocation ?? null,
        pickWarehouse: args.pickWarehouse ?? null,
        onEdit: editRow,
        onRegister: registerSku,
      });
    },
    [openModal, updateItem, deleteItem, addItem, afterChange]
  );
}
