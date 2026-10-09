import { recountKey } from '../../../hooks/useOpenRecounts';
import { unitsHeldByOtherOrders } from '../../../services/recount.service';
import type { PickingItem } from '../../../utils/pickingLogic';
import type { RecountRequest } from '../../../schemas/recount.schema';

export interface PromptRecountParams {
  item: PickingItem;
  palletId: number | string;
  checkedItems: Set<string>;
  openRecountsBySkuLocation: Map<string, RecountRequest>;
  promptedRecountKeys: Set<string>;
  activeListId?: string | null;
  openModal: (modal: {
    type: 'recount';
    sku: string;
    warehouse: string;
    location: string;
    listId?: string;
    reason?: string;
  }) => void;
  unitsHeldChecker?: (
    sku: string,
    warehouse: string,
    location: string,
    listId: string | null
  ) => Promise<{ list_id: string; order_number: string; units: number }[]>;
}

/**
 * Checks if marking an item in Double Check should trigger a blind recount modal.
 *
 * Requirements:
 * - Only triggers when transitioning from unchecked to checked.
 * - Only triggers if an open recount request exists for the item's sku|location.
 * - Only triggers if no OTHER open orders hold units of the SKU at that location.
 * - Prioritizes item.source_list_id over activeListId for combined orders.
 * - Deduplicates per view mount using promptedRecountKeys.
 */
export async function maybePromptRecountOnCheck({
  item,
  palletId,
  checkedItems,
  openRecountsBySkuLocation,
  promptedRecountKeys,
  activeListId,
  openModal,
  unitsHeldChecker = unitsHeldByOtherOrders,
}: PromptRecountParams): Promise<boolean> {
  const key = `${palletId}-${item.sku}-${item.location}`;
  const isChecking = !checkedItems.has(key);

  if (!isChecking) {
    return false;
  }

  const itemLocation = item.location || '';
  const itemRecountKey = recountKey(item.sku, itemLocation);
  const req = openRecountsBySkuLocation.get(itemRecountKey);

  if (!req || promptedRecountKeys.has(itemRecountKey)) {
    return false;
  }

  promptedRecountKeys.add(itemRecountKey);
  const itemListId = item.source_list_id || activeListId || null;
  const warehouse = item.warehouse || 'LUDLOW';

  try {
    const otherOrders = await unitsHeldChecker(item.sku, warehouse, itemLocation, itemListId);
    if (otherOrders.length === 0) {
      openModal({
        type: 'recount',
        sku: item.sku,
        warehouse,
        location: itemLocation,
        listId: itemListId ?? undefined,
        reason: req.reason ?? undefined,
      });
      return true;
    }
  } catch (err) {
    console.error('Failed to check units held by open orders:', err);
  }

  return false;
}
