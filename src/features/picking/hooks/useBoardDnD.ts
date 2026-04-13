import { useCallback, useState } from 'react';
import { type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { supabase } from '../../../lib/supabase';
import { useOrderGroups, type GroupType } from './useOrderGroups';
import type { PickingList } from './useDoubleCheckList';
import toast from 'react-hot-toast';

// Zone IDs (must match VerificationBoard)
const ZONE_FEDEX = 'zone-fedex';
const ZONE_REGULAR = 'zone-regular';
const ZONE_WAITING = 'zone-waiting';
const ZONE_COMPLETED = 'zone-completed';
const ZONE_PROJECTS = 'zone-projects';
const ZONE_PRIORITY = 'zone-priority';

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
}

export function useBoardDnD(isAdmin: boolean, refresh: () => void) {
  const { createGroup, addToGroup } = useOrderGroups();

  const [activeOrder, setActiveOrder] = useState<PickingList | null>(null);
  const [pendingMerge, setPendingMerge] = useState<PendingMergeAction | null>(
    null
  );
  const [pendingWaiting, setPendingWaiting] =
    useState<PendingWaitingAction | null>(null);
  const [pendingReopen, setPendingReopen] =
    useState<PendingReopenAction | null>(null);
  const [pendingCrossLane, setPendingCrossLane] =
    useState<PendingCrossLaneAction | null>(null);

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
        (active.data.current?.shippingType as string) ??
        sourceOrder.shipping_type;
      const isFromCompleted = sourceOrder.status === 'completed';

      // ─── Drop on a zone ─────────────────────────────────
      if (overId.startsWith('zone-')) {
        // Invalid targets
        if (overId === ZONE_PROJECTS) return;
        if (overId === ZONE_COMPLETED) return;

        // Drop on Waiting zone
        if (overId === ZONE_WAITING) {
          if (!isAdmin) {
            toast.error('Only admins can mark orders as waiting');
            return;
          }
          setPendingWaiting({ order: sourceOrder });
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

        // Cross-lane validation: if original type differs, confirm
        if (sourceShippingType && sourceShippingType !== targetType) {
          // If it's just Priority reclassification, skip confirmation (primary use case)
          if (overId === ZONE_PRIORITY) {
            await reclassifyOrder(sourceOrder.id, targetType);
            refresh();
            return;
          }
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

      // Same zone → merge into group
      if (targetOrder.group_id) {
        await addToGroup(targetOrder.group_id, sourceOrder.id);
        refresh();
      } else if (sourceOrder.group_id) {
        await addToGroup(sourceOrder.group_id, targetOrder.id);
        refresh();
      } else if (sourceShippingType && sourceShippingType === targetShippingType) {
        // Both in same lane — auto-create group with that lane's type
        const groupType = sourceShippingType === 'fedex' ? 'fedex' : 'general';
        await createGroup(groupType as GroupType, [sourceOrder.id, targetOrder.id]);
        refresh();
      } else {
        // Different lanes or unknown — ask user
        setPendingMerge({ source: sourceOrder, target: targetOrder });
      }
    },
    [isAdmin, addToGroup, refresh]
  );

  // ─── Action handlers for prompt confirmations ──────────
  const confirmMerge = useCallback(
    async (type: GroupType) => {
      if (!pendingMerge) return;
      await createGroup(type, [pendingMerge.source.id, pendingMerge.target.id]);
      setPendingMerge(null);
      refresh();
    },
    [pendingMerge, createGroup, refresh]
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
async function reclassifyOrder(
  orderId: string,
  shippingType: 'fedex' | 'regular'
) {
  const { error } = await supabase
    .from('picking_lists')
    .update({ shipping_type: shippingType })
    .eq('id', orderId);

  if (error) {
    toast.error('Failed to reclassify order');
    console.error('reclassify error:', error);
  } else {
    toast.success(
      `Order moved to ${shippingType === 'fedex' ? 'FedEx' : 'Regular'}`
    );
  }
}
