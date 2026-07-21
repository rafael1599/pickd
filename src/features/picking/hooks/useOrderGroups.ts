import { useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

export type GroupType = 'fedex' | 'general' | 'pickup';

export const useOrderGroups = () => {
  const createGroup = useCallback(async (type: GroupType, orderIds: string[]) => {
    if (orderIds.length < 2) return null;

    const { data: group, error: groupError } = await supabase
      .from('order_groups')
      .insert({ group_type: type })
      .select('id')
      .single();

    if (groupError || !group) {
      console.error('Failed to create group:', groupError);
      toast.error('Failed to create group');
      return null;
    }

    const { error: updateError } = await supabase
      .from('picking_lists')
      .update({ group_id: group.id })
      .in('id', orderIds);

    if (updateError) {
      console.error('Failed to assign orders to group:', updateError);
      toast.error('Failed to assign orders to group');
      await supabase.from('order_groups').delete().eq('id', group.id);
      return null;
    }

    toast.success(type === 'fedex' ? 'FedEx group created' : 'Group created');
    return group.id;
  }, []);

  const addToGroup = useCallback(async (groupId: string, orderId: string) => {
    const { error } = await supabase
      .from('picking_lists')
      .update({ group_id: groupId })
      .eq('id', orderId);

    if (error) {
      console.error('Failed to add order to group:', error);
      toast.error('Failed to add order to group');
      return false;
    }

    toast.success('Order added to group');
    return true;
  }, []);

  /**
   * Checks a just-formed/just-joined group for shipping-type issues a manual
   * combine can introduce that the auto-group DB trigger (INSERT-only) never
   * sees. Two rules, checked in order:
   *   1. A heavy item (>50lbs) or >= 5 combined bikes forces the WHOLE group
   *      to 'regular', no exceptions — mirrors classify_picking_list_fedex /
   *      auto_group_fedex_orders so a manual combine can't leave a 6-bike
   *      group misclassified as FedEx just because it wasn't auto-grouped.
   *   2. A GENUINE FedEx+Regular mismatch — each member is classified
   *      properly here (explicit shipping_type, else auto-classified from
   *      its own items), not by a raw "is shipping_type the string 'fedex'"
   *      check. Two same-customer FedEx orders with no shipping_type set
   *      yet must NOT read as "mixed" just because neither is explicitly
   *      tagged — that used to force them to 'regular' even though they're
   *      both small FedEx parcels. A real mismatch (one truck-bound, one
   *      FedEx) still auto-resolves to 'regular' for the same customer (one
   *      truck, not a split shipment); different customers needs a human
   *      call, so the caller should open ShippingResolutionModal when this
   *      returns 'needs-prompt'. Every combine entry point (board merge,
   *      drag-and-drop, cart drawer Add-On, Ship's "Combine with #X"
   *      suggestion) must call this after binding orders into a group — it's
   *      not automatic.
   */
  const resolveMixedShippingType = useCallback(
    async (groupId: string): Promise<'none' | 'auto-converted' | 'needs-prompt'> => {
      const { data: groupOrders } = await supabase
        .from('picking_lists')
        .select('id, customer_id, shipping_type, items')
        .eq('group_id', groupId);

      if (!groupOrders || groupOrders.length < 2) return 'none';

      const allSkus = new Set<string>();
      for (const o of groupOrders) {
        for (const item of (o.items as Array<{ sku?: string }> | null) ?? []) {
          if (item?.sku) allSkus.add(item.sku);
        }
      }
      const { data: metaRows } =
        allSkus.size > 0
          ? await supabase
              .from('sku_metadata')
              .select('sku, is_bike, weight_lbs')
              .in('sku', Array.from(allSkus))
          : { data: [] as { sku: string; is_bike: boolean | null; weight_lbs: number | null }[] };
      const bikeSkus = new Set((metaRows ?? []).filter((m) => m.is_bike).map((m) => m.sku));
      const weightBySku = new Map((metaRows ?? []).map((m) => [m.sku, m.weight_lbs ?? 0]));

      const classifyOne = (
        o: (typeof groupOrders)[number]
      ): { hasHeavy: boolean; bikes: number } => {
        let hasHeavy = false;
        let bikes = 0;
        for (const item of (o.items as Array<{ sku?: string; pickingQty?: number }> | null) ?? []) {
          if (!item?.sku) continue;
          if ((weightBySku.get(item.sku) ?? 0) > 50) hasHeavy = true;
          if (bikeSkus.has(item.sku)) bikes += Number(item.pickingQty) || 0;
        }
        return { hasHeavy, bikes };
      };

      // Rule 1: a heavy item or >= 5 combined bikes → force regular.
      let totalBikes = 0;
      let anyHeavy = false;
      for (const o of groupOrders) {
        const c = classifyOne(o);
        totalBikes += c.bikes;
        if (c.hasHeavy) anyHeavy = true;
      }
      if (anyHeavy || totalBikes >= 5) {
        await supabase
          .from('picking_lists')
          .update({ shipping_type: 'regular' })
          .eq('group_id', groupId);
        return 'auto-converted';
      }

      // Rule 2: genuine FedEx + Regular mismatch, classifying each member
      // properly (explicit tag, else this member's own items) instead of
      // treating "no explicit tag" as "regular".
      const effectiveType = (o: (typeof groupOrders)[number]): 'fedex' | 'regular' => {
        if (o.shipping_type === 'fedex' || o.shipping_type === 'regular') return o.shipping_type;
        const c = classifyOne(o);
        return c.hasHeavy || c.bikes >= 5 ? 'regular' : 'fedex';
      };
      const hasFedex = groupOrders.some((o) => effectiveType(o) === 'fedex');
      const hasRegular = groupOrders.some((o) => effectiveType(o) === 'regular');
      if (!(hasFedex && hasRegular)) return 'none';

      const uniqueCustomers = new Set(groupOrders.map((o) => o.customer_id).filter(Boolean));
      if (uniqueCustomers.size <= 1) {
        await supabase
          .from('picking_lists')
          .update({ shipping_type: 'regular' })
          .eq('group_id', groupId);
        return 'auto-converted';
      }
      return 'needs-prompt';
    },
    []
  );

  const removeFromGroup = useCallback(async (orderId: string, groupId: string) => {
    const { error } = await supabase
      .from('picking_lists')
      .update({ group_id: null })
      .eq('id', orderId);

    if (error) {
      console.error('Failed to remove order from group:', error);
      toast.error('Failed to remove from group');
      return false;
    }

    // Check if group is now empty and clean up
    const { data: remaining } = await supabase
      .from('picking_lists')
      .select('id')
      .eq('group_id', groupId)
      .limit(2);

    if (remaining && remaining.length <= 1) {
      // If 0 or 1 orders left, dissolve the group
      if (remaining.length === 1) {
        await supabase.from('picking_lists').update({ group_id: null }).eq('id', remaining[0].id);
      }
      await supabase.from('order_groups').delete().eq('id', groupId);
    }

    return true;
  }, []);

  return { createGroup, addToGroup, removeFromGroup, resolveMixedShippingType };
};
