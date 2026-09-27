import { supabase } from '../../../../lib/supabase';
import { resolveBikeSets } from '../../../../services/bikeSets.service';
import { fetchCartSkuMeta } from '../../../../services/cartSkuMeta.service';
import {
  calculateCombineRecalculation,
  calculateSplitRecalculation,
} from '../utils/recalculateShipments';
import type { PickingListItem } from '../../../../schemas/picking.schema';

export interface CombineShipmentsParams {
  targetOrderId: string;
  sourceOrderIds: string[];
  selectedAddressId?: string | null;
  selectedLoadNumber?: string | null;
  targetItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>;
  sourceItemsList: Array<Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>>;
  isFedex?: boolean;
}

export interface CombineShipmentsResult {
  success: boolean;
  shipment_id: string;
  pallets: number;
  weight: number;
}

/**
 * Combines one or more source orders into a target order's shipment.
 * Recalculates physical pallets and total weight live, then invokes the atomic DB RPC.
 */
export async function combineOrdersIntoShipment({
  targetOrderId,
  sourceOrderIds,
  selectedAddressId,
  selectedLoadNumber,
  targetItems,
  sourceItemsList,
  isFedex = false,
}: CombineShipmentsParams): Promise<CombineShipmentsResult> {
  const allItems = [...targetItems, ...sourceItemsList.flat()];
  const allSkus = allItems.map((i) => i.sku);

  const [bikeSets, skuMeta] = await Promise.all([
    resolveBikeSets(allSkus),
    fetchCartSkuMeta(allSkus).catch(() => ({})),
  ]);

  const recalculated = calculateCombineRecalculation(
    targetItems,
    sourceItemsList,
    bikeSets,
    skuMeta,
    isFedex
  );

  const { data, error } = await supabase.rpc('combine_into_shipment', {
    p_target_order_id: targetOrderId,
    p_source_order_ids: sourceOrderIds,
    p_selected_address_id: selectedAddressId ?? null,
    p_selected_load_number: selectedLoadNumber ?? null,
    p_recalculated_pallets: recalculated.pallets,
    p_recalculated_weight: recalculated.weight,
    p_recalculated_dims: recalculated.dims as any,
  });

  if (error) {
    throw new Error(error.message);
  }

  const res = data as any;
  if (!res?.success) {
    throw new Error(res?.error || 'No se pudo combinar el envío');
  }

  return {
    success: true,
    shipment_id: res.shipment_id,
    pallets: recalculated.pallets,
    weight: recalculated.weight,
  };
}

export interface SplitShipmentParams {
  orderId: string;
  remainingItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>;
  exitingItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>;
  isFedex?: boolean;
}

export interface SplitShipmentResult {
  success: boolean;
  order_id: string;
  new_shipment_id: string;
  new_pallets: number;
  remaining_pallets: number;
}

/**
 * Splits an order from its current shipment into its own new shipment.
 * Recalculates pallets and weight for both the remaining shipment and the new one.
 */
export async function splitOrderFromShipment({
  orderId,
  remainingItems,
  exitingItems,
  isFedex = false,
}: SplitShipmentParams): Promise<SplitShipmentResult> {
  const allSkus = [...remainingItems, ...exitingItems].map((i) => i.sku);

  const [bikeSets, skuMeta] = await Promise.all([
    resolveBikeSets(allSkus),
    fetchCartSkuMeta(allSkus).catch(() => ({})),
  ]);

  const { source, target } = calculateSplitRecalculation(
    remainingItems,
    exitingItems,
    bikeSets,
    skuMeta,
    isFedex
  );

  const { data, error } = await supabase.rpc('split_from_shipment', {
    p_order_id: orderId,
    p_recalculated_pallets_source: source.pallets,
    p_recalculated_weight_source: source.weight,
    p_recalculated_dims_source: source.dims as any,
    p_recalculated_pallets_target: target.pallets,
    p_recalculated_weight_target: target.weight,
    p_recalculated_dims_target: target.dims as any,
  });

  if (error) {
    throw new Error(error.message);
  }

  const res = data as any;
  if (!res?.success) {
    throw new Error(res?.error || 'No se pudo separar la orden del envío');
  }

  return {
    success: true,
    order_id: res.order_id,
    new_shipment_id: res.new_shipment_id,
    new_pallets: res.new_pallets,
    remaining_pallets: res.remaining_pallets,
  };
}
