import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useModal } from '../../../context/ModalContext';
import type { SplitShippingTypeOrder } from '../ship/components/modals/SplitShippingTypeModal';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useOrderGroups } from './useOrderGroups';
import { splitOrderFromShipment } from '../ship/api/shipmentActions';
import {
  countBikesInItems,
  autoClassifyShippingType,
  isFedexOrder as isFedexOrderShared,
  type ClassifiableItem,
} from '../../../utils/shippingClassification';
import { resolveBikeSets } from '../../../services/bikeSets.service';

export interface SplitOrderItem {
  sku: string;
  pickingQty?: number | null;
}

export interface SplitOrderCandidate {
  id: string;
  order_number?: string | null;
  items?: SplitOrderItem[] | null;
  shipment_id?: string | null;
  is_shipped?: boolean | null;
  shipping_type?: string | null;
  transport_company?: string | null;
  group_id?: string | null;
  order_group?: { group_type?: string | null } | null;
  shipment?: { id: string; is_shipped?: boolean | null } | null;
  combined_member_ids?: string[] | null;
}

export interface SplitOrderOptions {
  groupId?: string | null;
  orders?: SplitOrderCandidate[];
  bikeSkuSet?: ReadonlySet<string>;
  onSuccess?: () => Promise<void> | void;
}

function toItemSlices(items: unknown): Array<{ sku: string; pickingQty: number }> {
  if (!Array.isArray(items)) return [];
  return items.map((i) => {
    const item = i as Record<string, unknown>;
    return {
      sku: String(item?.sku ?? ''),
      pickingQty: typeof item?.pickingQty === 'number' ? item.pickingQty : 1,
    };
  });
}

function toClassifiableItems(items: unknown): ClassifiableItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((i) => {
    const item = i as Record<string, unknown>;
    return {
      sku: String(item?.sku ?? ''),
      pickingQty: typeof item?.pickingQty === 'number' ? item.pickingQty : 1,
    };
  });
}

export function useOrderSplit() {
  const { open: openModal } = useModal();
  const { showConfirmation } = useConfirmation();
  const { removeFromGroup } = useOrderGroups();
  const [isSplitting, setIsSplitting] = useState(false);

  const splitOrder = useCallback(
    async (orderId: string, options?: SplitOrderOptions) => {
      setIsSplitting(true);
      try {
        // 1. Find exiting order from provided orders array or fetch from DB
        let exitingOrder = options?.orders?.find((o) => o.id === orderId);
        if (!exitingOrder) {
          const { data, error } = await supabase
            .from('picking_lists')
            .select(
              'id, order_number, items, shipment_id, is_shipped, shipping_type, transport_company, group_id, order_group:order_groups(group_type), shipment:shipments(id, is_shipped)'
            )
            .eq('id', orderId)
            .single();

          if (error || !data) {
            toast.error('Order not found');
            return;
          }
          exitingOrder = {
            id: data.id,
            order_number: data.order_number,
            items: toItemSlices(data.items),
            shipment_id: data.shipment_id,
            is_shipped: data.is_shipped,
            shipping_type: data.shipping_type,
            transport_company: data.transport_company,
            group_id: data.group_id,
            order_group: data.order_group,
            shipment: data.shipment,
          };
        }

        const effectiveGroupId = options?.groupId ?? exitingOrder.group_id;

        // 2. FedEx batch orders: exiting a FedEx batch only unlinks group_id.
        // Each order already has its own shipment, so physical shipment is untouched.
        let isFedexBatch = exitingOrder.order_group?.group_type === 'fedex';
        if (!isFedexBatch && effectiveGroupId) {
          const groupMemberWithFedex = options?.orders?.find(
            (o) => o.group_id === effectiveGroupId && o.order_group?.group_type === 'fedex'
          );
          if (groupMemberWithFedex) {
            isFedexBatch = true;
          } else if (!exitingOrder.order_group) {
            const { data: grp } = await supabase
              .from('order_groups')
              .select('group_type')
              .eq('id', effectiveGroupId)
              .single();
            if (grp?.group_type === 'fedex') {
              isFedexBatch = true;
            }
          }
        }

        if (isFedexBatch) {
          if (effectiveGroupId) {
            await removeFromGroup(orderId, effectiveGroupId);
          }
          toast.success(`Order #${exitingOrder.order_number ?? orderId} removed from group`);
          await options?.onSuccess?.();
          return;
        }

        // 3. Find remaining orders sharing this shipment
        let remainingOrders: SplitOrderCandidate[] = [];
        if (options?.orders && options.orders.length > 0) {
          remainingOrders = options.orders.filter(
            (o) =>
              (exitingOrder.shipment_id &&
                o.shipment_id === exitingOrder.shipment_id &&
                o.id !== orderId) ||
              (!exitingOrder.shipment_id &&
                effectiveGroupId &&
                o.group_id === effectiveGroupId &&
                o.id !== orderId) ||
              (!exitingOrder.shipment_id &&
                !effectiveGroupId &&
                exitingOrder.combined_member_ids?.includes(o.id) &&
                o.id !== orderId)
          );
        }

        // If not in memory or no remaining found in memory but shipment_id exists, check DB
        if (exitingOrder.shipment_id && remainingOrders.length === 0) {
          const { data: dbSiblings } = await supabase
            .from('picking_lists')
            .select(
              'id, order_number, items, shipment_id, is_shipped, shipping_type, transport_company, group_id, order_group:order_groups(group_type), shipment:shipments(id, is_shipped)'
            )
            .eq('shipment_id', exitingOrder.shipment_id)
            .neq('id', orderId);

          if (dbSiblings && dbSiblings.length > 0) {
            remainingOrders = dbSiblings.map((s) => ({
              id: s.id,
              order_number: s.order_number,
              items: toItemSlices(s.items),
              shipment_id: s.shipment_id,
              is_shipped: s.is_shipped,
              shipping_type: s.shipping_type,
              transport_company: s.transport_company,
              group_id: s.group_id,
              order_group: s.order_group,
              shipment: s.shipment,
            }));
          }
        }

        // If no remaining orders share the shipment (it's already a single shipment)
        if (remainingOrders.length === 0 || !exitingOrder.shipment_id) {
          if (effectiveGroupId) {
            await removeFromGroup(orderId, effectiveGroupId);
          }
          toast.success(`Order #${exitingOrder.order_number ?? orderId} removed from group`);
          await options?.onSuccess?.();
          return;
        }

        // 4. Check if shipped
        const isShipped =
          exitingOrder.is_shipped ||
          exitingOrder.shipment?.is_shipped ||
          remainingOrders.some((o) => o.is_shipped || o.shipment?.is_shipped);

        // 5. Resolve bikeSkuSet
        let bikeSkuSet = options?.bikeSkuSet;
        if (!bikeSkuSet) {
          const allSkus = [
            ...(Array.isArray(exitingOrder.items) ? exitingOrder.items : []),
            ...remainingOrders.flatMap((o) => (Array.isArray(o.items) ? o.items : [])),
          ]
            .map((i) => i.sku)
            .filter(Boolean);
          const { bikes } = await resolveBikeSets(allSkus);
          bikeSkuSet = bikes;
        }

        const executeSplit = async (
          unshipFirst: boolean,
          selections: Record<string, 'regular' | 'fedex'>
        ) => {
          try {
            if (unshipFirst) {
              const allShipmentIds = Array.from(
                new Set(
                  [exitingOrder.shipment_id, ...remainingOrders.map((o) => o.shipment_id)].filter(
                    (s): s is string => !!s
                  )
                )
              );
              for (const sId of allShipmentIds) {
                await supabase
                  .from('shipments')
                  .update({ is_shipped: false, shipped_at: null })
                  .eq('id', sId);
              }
              await supabase
                .from('picking_lists')
                .update({ is_shipped: false })
                .in('id', [orderId, ...remainingOrders.map((o) => o.id)]);
            }

            const exitingChoice = selections[orderId];
            const exitingIsFedex = exitingChoice
              ? exitingChoice === 'fedex'
              : isFedexOrderShared(
                  {
                    shipping_type: exitingOrder.shipping_type,
                    transport_company: exitingOrder.transport_company,
                    order_group: exitingOrder.order_group,
                    items: toClassifiableItems(exitingOrder.items),
                  },
                  bikeSkuSet!
                );

            const remainingChoice =
              remainingOrders.length === 1 ? selections[remainingOrders[0].id] : undefined;
            const remainingIsFedex = remainingChoice
              ? remainingChoice === 'fedex'
              : remainingOrders.length === 1
                ? isFedexOrderShared(
                    {
                      shipping_type: remainingOrders[0].shipping_type,
                      transport_company: remainingOrders[0].transport_company,
                      order_group: remainingOrders[0].order_group,
                      items: toClassifiableItems(remainingOrders[0].items),
                    },
                    bikeSkuSet!
                  )
                : false;

            if (remainingOrders.length > 0 && exitingOrder.shipment_id) {
              const splitResult = await splitOrderFromShipment({
                orderId,
                remainingItems: remainingOrders.flatMap((o) => toItemSlices(o.items)),
                exitingItems: toItemSlices(exitingOrder.items),
                remainingIsFedex,
                exitingIsFedex,
              });

              // Update exiting order in picking_lists
              const exitingUpdates: {
                shipping_type?: 'regular' | 'fedex';
                pallets_qty: number;
                transport_company?: string | null;
              } = {
                pallets_qty: exitingIsFedex ? 0 : splitResult.new_pallets,
              };
              if (exitingChoice) {
                exitingUpdates.shipping_type = exitingChoice;
                if (exitingChoice === 'fedex') {
                  exitingUpdates.transport_company = 'FEDEX';
                } else if (exitingOrder.transport_company?.toUpperCase() === 'FEDEX') {
                  exitingUpdates.transport_company = null;
                }
              }
              await supabase.from('picking_lists').update(exitingUpdates).eq('id', orderId);

              // Update remaining order in picking_lists if left alone
              if (remainingOrders.length === 1) {
                const remOrder = remainingOrders[0];
                const remUpdates: {
                  shipping_type?: 'regular' | 'fedex';
                  pallets_qty: number;
                  transport_company?: string | null;
                } = {
                  pallets_qty: remainingIsFedex ? 0 : splitResult.remaining_pallets,
                };
                if (remainingChoice) {
                  remUpdates.shipping_type = remainingChoice;
                  if (remainingChoice === 'fedex') {
                    remUpdates.transport_company = 'FEDEX';
                  } else if (remOrder.transport_company?.toUpperCase() === 'FEDEX') {
                    remUpdates.transport_company = null;
                  }
                }
                await supabase.from('picking_lists').update(remUpdates).eq('id', remOrder.id);
              }

              toast.success(`Order #${exitingOrder.order_number ?? orderId} removed from shipment`);
            }

            if (effectiveGroupId) {
              await removeFromGroup(orderId, effectiveGroupId);
            }

            await options?.onSuccess?.();
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : 'Failed to split order from shipment';
            toast.error(msg);
          }
        };

        const promptShippingTypeOrConfirm = (unshipFirst: boolean) => {
          const ordersNeedingResolution: SplitShippingTypeOrder[] = [];

          // 1. Exiting order
          const exitItems = toClassifiableItems(exitingOrder.items);
          const exitBikeCount = countBikesInItems(exitItems, bikeSkuSet!);
          if (autoClassifyShippingType(exitItems, bikeSkuSet!) === 'fedex') {
            ordersNeedingResolution.push({
              id: exitingOrder.id,
              orderNumber: exitingOrder.order_number ?? null,
              bikeCount: exitBikeCount,
            });
          }

          // 2. Remaining order (if exactly one order remains)
          if (remainingOrders.length === 1) {
            const remOrder = remainingOrders[0];
            const remItems = toClassifiableItems(remOrder.items);
            const remBikeCount = countBikesInItems(remItems, bikeSkuSet!);
            if (autoClassifyShippingType(remItems, bikeSkuSet!) === 'fedex') {
              ordersNeedingResolution.push({
                id: remOrder.id,
                orderNumber: remOrder.order_number ?? null,
                bikeCount: remBikeCount,
              });
            }
          }

          if (ordersNeedingResolution.length > 0) {
            openModal({
              type: 'split-shipping-type',
              orders: ordersNeedingResolution,
              onConfirm: async (selections) => {
                await executeSplit(unshipFirst, selections);
              },
            });
          } else {
            showConfirmation(
              'Remove order from shipment?',
              `Order #${exitingOrder.order_number ?? orderId} will be removed from this shipment and become its own shipment.`,
              () => void executeSplit(unshipFirst, {}),
              undefined,
              'Separate',
              'Cancel'
            );
          }
        };

        if (isShipped) {
          showConfirmation(
            'Unmark as shipped?',
            'This order is marked as shipped. Do you want to unmark it as shipped first to remove it from the shipment?',
            () => void promptShippingTypeOrConfirm(true),
            undefined,
            'Unmark & Split',
            'Cancel',
            'warning'
          );
          return;
        }

        promptShippingTypeOrConfirm(false);
      } finally {
        setIsSplitting(false);
      }
    },
    [openModal, showConfirmation, removeFromGroup]
  );

  return { splitOrder, isSplitting };
}
