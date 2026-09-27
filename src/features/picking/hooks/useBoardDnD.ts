import { useCallback, useState } from 'react';
import { type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { supabase } from '../../../lib/supabase';
import { useOrderGroups, type GroupType } from './useOrderGroups';
import type { PickingList } from './useDoubleCheckList';
import toast from 'react-hot-toast';
import { useModal } from '../../../context/ModalContext';
import { detectCombineConflicts } from '../ship/utils/combineConflicts';
import { combineOrdersIntoShipment } from '../ship/api/shipmentActions';
import { resolveBikeSets } from '../../../services/bikeSets.service';
import { isFedexOrder as isFedexOrderShared } from '../../../utils/shippingClassification';

// Zone IDs (must match VerificationBoard)
const ZONE_FEDEX = 'zone-fedex';
const ZONE_REGULAR = 'zone-regular';
const ZONE_WAITING = 'zone-waiting';
const ZONE_COMPLETED = 'zone-completed';
const ZONE_PROJECTS = 'zone-projects';
const ZONE_PRIORITY = 'zone-priority';
const ZONE_READY = 'zone-ready';

export interface PendingWaitingAction {
  order: PickingList;
}

export interface PendingReopenAction {
  order: PickingList;
  targetZone: 'fedex' | 'regular';
}

export interface PendingCrossLaneAction {
  order: PickingList;
  fromType: string;
  toType: 'fedex' | 'regular';
}

export interface PendingMergeAction {
  source: PickingList;
  target: PickingList;
  /** When set, confirming ADDS addOrderId to this existing group (no type pick). */
  joinGroupId?: string;
  addOrderId?: string;
  /** Suggested type when both orders share a lane (modal pre-highlights it). */
  suggestedType?: GroupType;
}

export function useBoardDnD(isAdmin: boolean, refresh: () => void) {
  const { createGroup, addToGroup } = useOrderGroups();
  const { open: openModal } = useModal();

  const [activeOrder, setActiveOrder] = useState<PickingList | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMergeAction | null>(null);
  const [pendingWaiting, setPendingWaiting] = useState<PendingWaitingAction | null>(null);
  const [pendingReopen, setPendingReopen] = useState<PendingReopenAction | null>(null);
  const [pendingCrossLane, setPendingCrossLane] = useState<PendingCrossLaneAction | null>(null);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const order = event.active.data.current?.order as PickingList | undefined;
    if (order) setActiveOrder(order);
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveOrder(null);
      const { active, over } = event;
      if (!over) return;

      const sourceOrder = active.data.current?.order as PickingList | undefined;
      if (!sourceOrder) return;

      const overId = over.id as string;
      const sourceShippingType =
        (active.data.current?.shippingType as string) ?? sourceOrder.shipping_type;
      const isFromCompleted = sourceOrder.status === 'completed';

      // ─── Drop on a zone ─────────────────────────────────
      if (overId.startsWith('zone-')) {
        // Invalid targets
        if (overId === ZONE_PROJECTS) return;
        if (overId === ZONE_COMPLETED) return;

        // Drop on Waiting zone (long-waiting inventory)
        if (overId === ZONE_WAITING) {
          if (!isAdmin) {
            toast.error('Only admins can mark orders as waiting');
            return;
          }
          setPendingWaiting({ order: sourceOrder });
          return;
        }

        // Drop on Ready (new "Waiting" double-check queue) — mark order as
        // ready_to_double_check. The verification board today only fetches
        // ready_to_double_check / double_checking / needs_correction, so the
        // valid sources here are double_checking (cancel the check) or
        // needs_correction (post-fix → re-queue).
        if (overId === ZONE_READY) {
          if (sourceOrder.status === 'ready_to_double_check') return;
          await markReadyForDoubleCheck(sourceOrder.id);
          refresh();
          return;
        }

        // Determine target shipping type
        let targetType: 'fedex' | 'regular' | null = null;
        if (overId === ZONE_FEDEX) targetType = 'fedex';
        else if (overId === ZONE_REGULAR) targetType = 'regular';
        else if (overId === ZONE_PRIORITY) {
          // Priority zone: reclassify FedEx <-> Regular
          targetType = sourceShippingType === 'fedex' ? 'regular' : 'fedex';
        }

        if (!targetType) return;

        // Drop from Completed -> needs reopen
        if (isFromCompleted) {
          setPendingReopen({ order: sourceOrder, targetZone: targetType });
          return;
        }

        // Drop from Ready ("Waiting" queue) onto FDX/Regular: only
        // reclassifies shipping_type — the order stays ready_to_double_check
        // and the next render puts it back in Waiting. To take an order out
        // of Waiting, the verifier opens it normally (start double-check).

        // Cross-lane validation: if original type differs, confirm
        if (sourceShippingType && sourceShippingType !== targetType) {
          setPendingCrossLane({
            order: sourceOrder,
            fromType: sourceShippingType,
            toType: targetType,
          });
          return;
        }

        // Same zone or no prior type — direct reclassify
        await reclassifyOrder(sourceOrder.id, targetType);
        refresh();
        return;
      }

      // ─── Drop on another order ─────────────────────────
      const targetOrder = over.data.current?.order as PickingList | undefined;
      if (!targetOrder || sourceOrder.id === targetOrder.id) return;

      const targetShippingType = over.data.current?.shippingType as string | undefined;

      // Cross-zone drop on an order → reclassify (not merge)
      // e.g. dragging from Priority/FedEx and landing on an order in Regular
      if (targetShippingType && sourceShippingType && targetShippingType !== sourceShippingType) {
        const targetType = targetShippingType as 'fedex' | 'regular';
        if (isFromCompleted) {
          setPendingReopen({ order: sourceOrder, targetZone: targetType });
        } else {
          setPendingCrossLane({
            order: sourceOrder,
            fromType: sourceShippingType,
            toType: targetType,
          });
        }
        return;
      }

      // Same zone → grouping is ALWAYS user-confirmed (idea-151): a drop must
      // never silently merge orders — an accidental drag would join them (and a
      // waiting order could be swept into a group) with no way to notice.
      if (targetOrder.group_id) {
        setPendingMerge({
          source: sourceOrder,
          target: targetOrder,
          joinGroupId: targetOrder.group_id,
          addOrderId: sourceOrder.id,
        });
      } else if (sourceOrder.group_id) {
        setPendingMerge({
          source: sourceOrder,
          target: targetOrder,
          joinGroupId: sourceOrder.group_id,
          addOrderId: targetOrder.id,
        });
      } else {
        setPendingMerge({
          source: sourceOrder,
          target: targetOrder,
          suggestedType:
            sourceShippingType && sourceShippingType === targetShippingType
              ? ((sourceShippingType === 'fedex' ? 'fedex' : 'general') as GroupType)
              : undefined,
        });
      }
    },
    [isAdmin, refresh]
  );

  // ─── Action handlers for prompt confirmations ──────────
  const confirmMerge = useCallback(
    async (type: GroupType) => {
      if (!pendingMerge) return;
      const { source, target, joinGroupId, addOrderId } = pendingMerge;

      // 1. Determine if this is a FedEx batch
      let isFedexBatch = type === 'fedex';
      if (joinGroupId) {
        const { data: grp } = await supabase
          .from('order_groups')
          .select('group_type')
          .eq('id', joinGroupId)
          .single();
        if (grp?.group_type === 'fedex') {
          isFedexBatch = true;
        }
      }

      // If it is a FedEx batch, it is purely an operational work bucket:
      // It does NOT touch physical shipments!
      if (isFedexBatch) {
        if (joinGroupId && addOrderId) {
          await addToGroup(joinGroupId, addOrderId);
        } else {
          await createGroup('fedex', [source.id, target.id]);
        }
        setPendingMerge(null);
        refresh();
        return;
      }

      // 2. Deliberate combine ('general' or 'pickup'):
      // Unify into a single physical shipment via combineOrdersIntoShipment
      const targetOrder = target;
      const sourceOrder = source;

      // Fetch fresh order details with shipment and address info for conflict detection
      const { data: ordersData, error: ordersError } = await supabase
        .from('picking_lists')
        .select(
          'id, order_number, items, shipping_type, transport_company, ship_to_address_id, load_number, customer_id, is_shipped, group_id, shipment_id, order_group:order_groups(group_type), customer:customers(name, street, city, state, zip_code), shipment:shipments(ship_to_address_id, load_number)'
        )
        .in('id', [targetOrder.id, sourceOrder.id]);

      if (ordersError || !ordersData || ordersData.length < 2) {
        toast.error('Failed to load orders for combine');
        setPendingMerge(null);
        return;
      }

      const freshTarget = ordersData.find((o) => o.id === targetOrder.id) ?? targetOrder;
      const freshSource = ordersData.find((o) => o.id === sourceOrder.id) ?? sourceOrder;

      const executeCombine = async (overrides?: {
        selectedAddressId?: string | null;
        selectedLoadNumber?: string | null;
      }) => {
        try {
          if (joinGroupId && addOrderId) {
            await addToGroup(joinGroupId, addOrderId);
          } else {
            await createGroup(type, [sourceOrder.id, targetOrder.id]);
          }

          const allSkus = [
            ...(Array.isArray(freshTarget.items)
              ? (freshTarget.items as Array<Record<string, unknown>>)
              : []),
            ...(Array.isArray(freshSource.items)
              ? (freshSource.items as Array<Record<string, unknown>>)
              : []),
          ]
            .map((i) => (typeof i?.sku === 'string' ? i.sku : ''))
            .filter(Boolean);
          const { bikes } = await resolveBikeSets(allSkus);

          const toItemSlices = (items: unknown): Array<{ sku: string; pickingQty: number }> => {
            if (!Array.isArray(items)) return [];
            return items.map((i) => {
              const item = i as Record<string, unknown>;
              return {
                sku: String(item?.sku ?? ''),
                pickingQty:
                  typeof item?.pickingQty === 'number'
                    ? item.pickingQty
                    : Number(item?.pickingQty ?? 1),
              };
            });
          };

          await combineOrdersIntoShipment({
            targetOrderId: freshTarget.id,
            sourceOrderIds: [freshSource.id],
            selectedAddressId: overrides?.selectedAddressId ?? conflictAnalysis.defaultAddressId,
            selectedLoadNumber: overrides?.selectedLoadNumber ?? conflictAnalysis.defaultLoadNumber,
            targetItems: toItemSlices(freshTarget.items),
            sourceItemsList: [toItemSlices(freshSource.items)],
            isFedex: isFedexOrderShared(
              {
                shipping_type: freshTarget.shipping_type,
                transport_company: freshTarget.transport_company,
                order_group: freshTarget.order_group,
                items: Array.isArray(freshTarget.items)
                  ? (freshTarget.items as Array<Record<string, unknown>>).map((i) => ({
                      sku: String(i?.sku ?? ''),
                      pickingQty: typeof i?.pickingQty === 'number' ? i.pickingQty : 1,
                    }))
                  : [],
              },
              bikes
            ),
          });

          toast.success(`Combined with #${freshSource.order_number}`);
          setPendingMerge(null);
          refresh();
        } catch (err: unknown) {
          console.error('Combine failed:', err);
          const msg = err instanceof Error ? err.message : 'Failed to combine orders';
          toast.error(msg);
          setPendingMerge(null);
        }
      };

      const conflictAnalysis = detectCombineConflicts([
        freshTarget as unknown as Parameters<typeof detectCombineConflicts>[0][number],
        freshSource as unknown as Parameters<typeof detectCombineConflicts>[0][number],
      ]);

      if (conflictAnalysis.hasConflict) {
        openModal({
          type: 'combine-conflict',
          conflict: conflictAnalysis,
          onConfirm: (res: { selectedAddressId?: string; selectedLoadNumber?: string }) => {
            void executeCombine(res);
          },
        });
        return;
      }

      await executeCombine();
    },
    [pendingMerge, addToGroup, createGroup, openModal, refresh]
  );

  const confirmCrossLane = useCallback(async () => {
    if (!pendingCrossLane) return;
    await reclassifyOrder(pendingCrossLane.order.id, pendingCrossLane.toType);
    setPendingCrossLane(null);
    refresh();
  }, [pendingCrossLane, refresh]);

  const cancelPending = useCallback(() => {
    setPendingMerge(null);
    setPendingWaiting(null);
    setPendingReopen(null);
    setPendingCrossLane(null);
  }, []);

  return {
    activeOrder,
    handleDragStart,
    handleDragEnd,
    // Pending actions (UI renders prompts based on these)
    pendingMerge,
    pendingWaiting,
    pendingReopen,
    pendingCrossLane,
    // Confirm/cancel handlers
    confirmMerge,
    confirmCrossLane,
    cancelPending,
    setPendingWaiting,
    setPendingReopen,
  };
}

// ─── Helpers ────────────────────────────────────────────────
async function reclassifyOrder(orderId: string, shippingType: 'fedex' | 'regular') {
  const { error } = await supabase
    .from('picking_lists')
    .update({ shipping_type: shippingType })
    .eq('id', orderId);

  if (error) {
    toast.error('Failed to reclassify order');
    console.error('reclassify error:', error);
  } else {
    toast.success(`Order moved to ${shippingType === 'fedex' ? 'FedEx' : 'Regular'}`);
  }
}

async function markReadyForDoubleCheck(orderId: string) {
  const { error } = await supabase
    .from('picking_lists')
    .update({ status: 'ready_to_double_check', checked_by: null })
    .eq('id', orderId);
  if (error) {
    toast.error('Failed to queue for double-check');
    console.error('markReady error:', error);
  } else {
    toast.success('Queued for double-check');
  }
}
