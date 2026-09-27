import { supabase } from '../../../../lib/supabase';
import { resolveBikeSets } from '../../../../services/bikeSets.service';
import { fetchCartSkuMeta } from '../../../../services/cartSkuMeta.service';
import {
  calculateCombineRecalculation,
  calculateSplitRecalculation,
} from '../utils/recalculateShipments';
import type { PickingListItem } from '../../../../schemas/picking.schema';

export interface CombineIntoShipmentResponse {
  success: boolean;
  target_shipment_id?: string;
  combined_orders?: string[];
  pallets_qty?: number;
  total_weight_lbs?: number;
  load_number?: string | null;
  ship_to_address_id?: string | null;
  error?: string;
}

export interface SplitFromShipmentResponse {
  success: boolean;
  order_id?: string;
  original_shipment_id?: string;
  new_shipment_id?: string;
  remaining_pallets?: number;
  new_pallets?: number;
  error?: string;
}

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
    p_pallets_qty: recalculated.pallets,
    p_total_weight_lbs: recalculated.weight,
  });

  if (error) {
    throw new Error(error.message);
  }

  const res = data as unknown as CombineIntoShipmentResponse | null;
  if (!res?.success || !res.target_shipment_id) {
    throw new Error(res?.error || 'Failed to combine shipment');
  }

  return {
    success: true,
    shipment_id: res.target_shipment_id,
    pallets: recalculated.pallets,
    weight: recalculated.weight,
  };
}

export interface SplitShipmentParams {
  orderId: string;
  remainingItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>;
  exitingItems: Array<Pick<PickingListItem, 'sku' | 'pickingQty'>>;
  isFedex?: boolean;
  remainingIsFedex?: boolean;
  exitingIsFedex?: boolean;
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
  remainingIsFedex,
  exitingIsFedex,
}: SplitShipmentParams): Promise<SplitShipmentResult> {
  const allSkus = [...remainingItems, ...exitingItems].map((i) => i.sku);

  const [bikeSets, skuMeta] = await Promise.all([
    resolveBikeSets(allSkus),
    fetchCartSkuMeta(allSkus).catch(() => ({})),
  ]);

  const remFedex = remainingIsFedex ?? isFedex ?? false;
  const exitFedex = exitingIsFedex ?? isFedex ?? false;

  const { source, target } = calculateSplitRecalculation(
    remainingItems,
    exitingItems,
    bikeSets,
    skuMeta,
    { remainingIsFedex: remFedex, exitingIsFedex: exitFedex }
  );

  const { data, error } = await supabase.rpc('split_from_shipment', {
    p_order_id: orderId,
    p_target_pallets_qty: source.pallets,
    p_target_weight: source.weight,
    p_new_pallets_qty: target.pallets,
    p_new_weight: target.weight,
  });

  if (error) {
    throw new Error(error.message);
  }

  const res = data as unknown as SplitFromShipmentResponse | null;
  if (!res?.success || !res.order_id || !res.new_shipment_id) {
    throw new Error(res?.error || 'Failed to split order from shipment');
  }

  return {
    success: true,
    order_id: res.order_id,
    new_shipment_id: res.new_shipment_id,
    new_pallets: res.new_pallets ?? target.pallets,
    remaining_pallets: res.remaining_pallets ?? source.pallets,
  };
}
