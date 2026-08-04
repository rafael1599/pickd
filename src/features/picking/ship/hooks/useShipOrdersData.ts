import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../context/AuthContext';
import { useDebounce } from '../../../../hooks/useDebounce';
import { withSupabaseRetry } from '../../../../lib/supabaseRetry';
import {
  isFedexOrder as isFedexOrderShared,
  isDeliberateCombineGroupType,
  getCarrierLabel as getCarrierLabelShared,
} from '../../../../utils/shippingClassification';
import type { PickingListItem, CombineMeta } from '../../../../schemas/picking.schema';

export function dayKey(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

export function getNYMidnightISO(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value;
  const month = parts.find((p) => p.type === 'month')?.value;
  const day = parts.find((p) => p.type === 'day')?.value;
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value;

  let offset = '-04:00';
  if (offsetPart) {
    const match = offsetPart.match(/([+-]\d{2}):?(\d{2})?/);
    if (match) {
      offset = match[1] + (match[2] || '00');
    } else {
      const gmtMatch = offsetPart.match(/GMT([+-]\d+)/);
      if (gmtMatch) {
        const hours = parseInt(gmtMatch[1], 10);
        offset = `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
      }
    }
  }
  return `${year}-${month}-${day}T00:00:00${offset}`;
}

export function dayLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

export function isFedexLane(order: OrderWithRelations): boolean {
  return isFedexOrderShared(order);
}

export function getCarrierLabel(order: OrderWithRelations): string | null {
  return getCarrierLabelShared(order.transport_company, isFedexLane(order));
}

export interface DayGroup {
  key: string;
  label: string;
  orders: OrderWithRelations[];
}

export interface CustomerDetails {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
}

export interface OrderWithRelations {
  id: string;
  order_number: string | null;
  user_id: string | null;
  customer_id: string | null;
  pallets_qty: number | null;
  total_units: number | null;
  load_number: string | null;
  transport_company: string | null;
  shipping_type: string | null;
  status: string;
  items: PickingListItem[] | null;
  correction_notes: string | null;
  notes: string | null;
  checked_by: string | null;
  combine_meta: CombineMeta;
  created_at: string;
  updated_at: string;
  customer: CustomerDetails | null;
  customer_details: CustomerDetails | Record<string, never>;
  user: { full_name: string | null } | null;
  checker: { full_name: string | null } | null;
  presence: { last_seen_at: string | null } | null;
  pallet_photos: string[] | null;
  group_id: string | null;
  order_group: { group_type: string | null } | null;
  is_waiting_inventory?: boolean | null;
  is_shipped?: boolean | null;
  verified_item_keys?: string[] | null;
  combined_member_ids?: string[];
}

export const ORDER_LIST_SELECT = `
  id,
  order_number,
  customer_id,
  user_id,
  checked_by,
  status,
  is_shipped,
  is_waiting_inventory,
  created_at,
  updated_at,
  transport_company,
  shipping_type,
  load_number,
  group_id,
  pallets_qty,
  total_units,
  combine_meta,
  verified_item_keys,
  items,
  notes,
  pallet_photos,
  customer:customers(id, name, street, city, state, zip_code),
  user:profiles!user_id(full_name),
  checker:profiles!checked_by(full_name),
  presence:user_presence!user_id(last_seen_at),
  order_group:order_groups(group_type)
`;

export function useShipOrdersData() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlOrder = params.get('order') || params.get('q');
    return urlOrder ? urlOrder.trim() : '';
  });
  const debouncedSearchQuery = useDebounce(searchQuery, 200);
  // Pending Ship carrier filter state
  const [pendingSelectedCarriers, setPendingSelectedCarriers] = useState<Set<string>>(new Set());
  const [pendingIncludeUnassigned, setPendingIncludeUnassigned] = useState(false);
  const [pendingShowWaiting, setPendingShowWaiting] = useState(false);

  // Shipped carrier filter state
  const [shippedSelectedCarriers, setShippedSelectedCarriers] = useState<Set<string>>(new Set());
  const [shippedIncludeUnassigned, setShippedIncludeUnassigned] = useState(false);

  const [includeShipped, setIncludeShipped] = useState(true);

  const hasLoadedOnceRef = useRef(false);

  const handlePendingCarrierToggle = useCallback((carrier: string) => {
    setPendingSelectedCarriers((prev) => {
      const next = new Set(prev);
      if (next.has(carrier)) {
        next.delete(carrier);
      } else {
        next.add(carrier);
      }
      return next;
    });
  }, []);

  const handleShippedCarrierToggle = useCallback((carrier: string) => {
    setShippedSelectedCarriers((prev) => {
      const next = new Set(prev);
      if (next.has(carrier)) {
        next.delete(carrier);
      } else {
        next.add(carrier);
      }
      return next;
    });
  }, []);

  const matchesPendingCarrierFilter = useCallback(
    (o: OrderWithRelations) => {
      // Active text search query overrides waiting filter so any searched order is findable
      if (debouncedSearchQuery.trim()) {
        if (pendingSelectedCarriers.size === 0 && !pendingIncludeUnassigned) return true;
        const carrier = getCarrierLabel(o);
        return carrier ? pendingSelectedCarriers.has(carrier) : pendingIncludeUnassigned;
      }

      // Waiting filter rule:
      // By default (pendingShowWaiting = false), orders in WAITING are hidden.
      // When pendingShowWaiting = true, ONLY show orders in WAITING.
      const isWaiting = !!o.is_waiting_inventory;
      if (pendingShowWaiting) {
        if (!isWaiting) return false;
      } else {
        if (isWaiting) return false;
      }

      if (pendingSelectedCarriers.size === 0 && !pendingIncludeUnassigned) return true;
      const carrier = getCarrierLabel(o);
      if (carrier) {
        return pendingSelectedCarriers.has(carrier);
      }
      return pendingIncludeUnassigned && !isWaiting;
    },
    [pendingSelectedCarriers, pendingIncludeUnassigned, pendingShowWaiting, debouncedSearchQuery]
  );

  const matchesShippedCarrierFilter = useCallback(
    (o: OrderWithRelations) => {
      if (shippedSelectedCarriers.size === 0 && !shippedIncludeUnassigned) return true;
      const carrier = getCarrierLabel(o);
      return carrier ? shippedSelectedCarriers.has(carrier) : shippedIncludeUnassigned;
    },
    [shippedSelectedCarriers, shippedIncludeUnassigned]
  );

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    if (!hasLoadedOnceRef.current) setLoading(true);
    try {
      const nyMidnight = getNYMidnightISO();
      const sq = debouncedSearchQuery.trim();
      let customerIds: string[] = [];

      if (sq && sq.length >= 2 && !/^\d+$/.test(sq)) {
        const { data } = await supabase
          .from('customers')
          .select('id')
          .ilike('name', `%${sq}%`)
          .limit(20);
        if (data) {
          customerIds = data.map((c: { id: string }) => c.id);
        }
      }

      let query = supabase
        .from('picking_lists')
        .select(ORDER_LIST_SELECT)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });

      if (sq) {
        if (customerIds.length > 0) {
          query = query.or(`order_number.ilike.%${sq}%,customer_id.in.(${customerIds.join(',')})`);
        } else {
          query = query.ilike('order_number', `%${sq}%`);
        }
        // Ordered by created_at desc, so a low cap here silently drops older
        // matches for generic/short queries before the client even sees
        // them. 500 gives a lot more headroom while still bounding payload size.
        query = query.limit(500);
      } else {
        query = query.or(
          `is_shipped.is.null,is_shipped.eq.false,and(is_shipped.eq.true,updated_at.gte.${nyMidnight})`
        );
      }

      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'OrdersScreen.fetchOrders',
      });

      if (error) throw error;

      let mappedData = ((data || []) as unknown as OrderWithRelations[]).map((order) => ({
        ...order,
        customer_details: order.customer || {},
      }));

      const groupIds = Array.from(
        new Set(
          mappedData
            .filter((o) => o.group_id && isDeliberateCombineGroupType(o.order_group?.group_type))
            .map((o) => o.group_id as string)
        )
      );
      if (groupIds.length > 0) {
        const { data: siblingRows } = await withSupabaseRetry(
          () =>
            supabase
              .from('picking_lists')
              .select(ORDER_LIST_SELECT)
              .in('group_id', groupIds)
              .neq('status', 'cancelled'),
          { label: 'OrdersScreen.fetchOrders.topUpSiblings' }
        );
        if (siblingRows) {
          const existingIds = new Set(mappedData.map((o) => o.id));
          const extra = (siblingRows as unknown as OrderWithRelations[])
            .filter((o) => !existingIds.has(o.id))
            .map((o) => ({ ...o, customer_details: o.customer || {} }));
          if (extra.length > 0) mappedData = [...mappedData, ...extra];
        }
      }

      setOrders(mappedData);
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [user, debouncedSearchQuery]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return {
    orders,
    setOrders,
    loading,
    setLoading,
    searchQuery,
    debouncedSearchQuery,
    setSearchQuery,
    pendingSelectedCarriers,
    setPendingSelectedCarriers,
    pendingIncludeUnassigned,
    setPendingIncludeUnassigned,
    pendingShowWaiting,
    setPendingShowWaiting,
    shippedSelectedCarriers,
    setShippedSelectedCarriers,
    shippedIncludeUnassigned,
    setShippedIncludeUnassigned,
    includeShipped,
    setIncludeShipped,
    handlePendingCarrierToggle,
    handleShippedCarrierToggle,
    matchesPendingCarrierFilter,
    matchesShippedCarrierFilter,
    fetchOrders,
  };
}
