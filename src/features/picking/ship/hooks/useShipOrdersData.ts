import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../context/AuthContext';
import { useDebounce } from '../../../../hooks/useDebounce';
import { useBikeSkuSet } from '../../../../hooks/useBikeSkuSet';
import { withSupabaseRetry } from '../../../../lib/supabaseRetry';
import {
  isFedexOrder as isFedexOrderShared,
  isDeliberateCombineGroupType,
  getCarrierLabel as getCarrierLabelShared,
} from '../../../../utils/shippingClassification';
import type { PickingListItem, CombineMeta } from '../../../../schemas/picking.schema';
import type { PalletDimsEntry } from '../../../../utils/palletDims';

/** Search results come five at a time; "Show 5 more" asks for the next five. */
const SEARCH_PAGE_SIZE = 5;
/** The Shipped column always holds at least this many, today's or not. */
const RECENT_SHIPPED = 10;

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

export function isFedexLane(order: OrderWithRelations, bikeSkus: ReadonlySet<string>): boolean {
  return isFedexOrderShared(order, bikeSkus);
}

export function getCarrierLabel(
  order: OrderWithRelations,
  bikeSkus: ReadonlySet<string>
): string | null {
  return getCarrierLabelShared(order.transport_company, isFedexLane(order, bikeSkus));
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
  /** Medidas del bulto por ordinal de pallet — ver src/utils/palletDims.ts. */
  pallet_dims: PalletDimsEntry[] | null;
  group_id: string | null;
  order_group: { group_type: string | null } | null;
  is_waiting_inventory?: boolean | null;
  is_shipped?: boolean | null;
  verified_item_keys?: string[] | null;
  combined_member_ids?: string[];
  /** Every member's AS400 note, on a combined card (see ShipScreen). */
  member_notes?: { orderNumber: string | null; notes: string | null }[];
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
  pallet_dims,
  customer:customers(id, name, street, city, state, zip_code),
  user:profiles!user_id(full_name),
  checker:profiles!checked_by(full_name),
  presence:user_presence!user_id(last_seen_at),
  order_group:order_groups(group_type)
`;

type LiveSkuMeta = Map<string, { is_bike: boolean | null; weight_lbs: number | null }>;

/** The live `sku_metadata` (is_bike, weight_lbs) of every SKU in these orders. */
async function fetchLiveSkuMetadata(orders: OrderWithRelations[]): Promise<LiveSkuMeta | null> {
  const allSkus = Array.from(
    new Set(
      orders.flatMap((o) => (o.items ?? []).map((i) => i.sku).filter((s): s is string => !!s))
    )
  );
  if (allSkus.length === 0) return null;
  const { data: metaRows } = await withSupabaseRetry(
    () => supabase.from('sku_metadata').select('sku, is_bike, weight_lbs').in('sku', allSkus),
    { label: 'OrdersScreen.fetchOrders.skuMetadata' }
  );
  if (!metaRows) return null;
  const metaMap: LiveSkuMeta = new Map();
  (metaRows as { sku: string; is_bike: boolean | null; weight_lbs: number | null }[]).forEach((r) =>
    metaMap.set(r.sku, r)
  );
  return metaMap;
}

/** Overlays the live catalog on every item, over whatever the stamp sealed. */
const applyLiveSkuMetadata = (
  orders: OrderWithRelations[],
  metaMap: LiveSkuMeta
): OrderWithRelations[] =>
  orders.map((o) => ({
    ...o,
    items: (o.items ?? []).map((item) => ({
      ...item,
      sku_metadata:
        metaMap.get(item.sku ?? '') ??
        (item as { sku_metadata?: { is_bike?: boolean | null; weight_lbs?: number | null } })
          .sku_metadata ??
        null,
    })),
  }));

export function useShipOrdersData() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);

  // Canonical bike SKUs (sku_metadata.is_bike) for every order on screen.
  // Order items are raw watchdog JSONB with no embedded metadata, so the
  // FedEx/Regular classification is wrong without this lookup.
  const allSkus = useMemo(() => {
    const skus: string[] = [];
    orders.forEach((o) => {
      (o.items ?? []).forEach((i) => {
        if (typeof i.sku === 'string' && i.sku) skus.push(i.sku);
      });
    });
    return skus;
  }, [orders]);
  const bikeSkuSet = useBikeSkuSet(allSkus);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const urlOrder = params.get('order') || params.get('q');
    return urlOrder ? urlOrder.trim() : '';
  });
  const debouncedSearchQuery = useDebounce(searchQuery, 200);
  // Search is paged 5 at a time (Rafael, 2026-08-28): typing "8" must not pull
  // 500 rows. Each page re-runs the query with a bigger limit — cheap, indexed
  // on created_at — and one extra row tells us whether "Show 5 more" applies.
  // An exact order number is fetched on its own so an old order is never
  // hidden behind five newer ones that merely contain the digits (the cap
  // that once made a registered order unfindable).
  const [searchPage, setSearchPage] = useState(1);
  const [searchHasMore, setSearchHasMore] = useState(false);
  useEffect(() => {
    setSearchPage(1);
  }, [debouncedSearchQuery]);
  const loadMoreSearch = useCallback(() => setSearchPage((p) => p + 1), []);
  // Pending Ship carrier filter state
  const [pendingSelectedCarriers, setPendingSelectedCarriers] = useState<Set<string>>(new Set());
  const [pendingIncludeUnassigned, setPendingIncludeUnassigned] = useState(false);
  const [pendingShowWaiting, setPendingShowWaiting] = useState(false);

  // Shipped carrier filter state
  const [shippedSelectedCarriers, setShippedSelectedCarriers] = useState<Set<string>>(new Set());
  const [shippedIncludeUnassigned, setShippedIncludeUnassigned] = useState(false);

  const [includeShipped, setIncludeShipped] = useState(true);

  const hasLoadedOnceRef = useRef(false);
  // Background waves (recentShipped, group siblings) can still be in flight
  // when a newer fetchOrders() starts — typing into search, or a manual
  // refresh — and land after it. Only the most recent call may still write.
  const fetchGenerationRef = useRef(0);

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
        const carrier = getCarrierLabel(o, bikeSkuSet);
        return carrier ? pendingSelectedCarriers.has(carrier) : pendingIncludeUnassigned;
      }

      // Waiting filter rule:
      // When pendingShowWaiting is true -> show ONLY waiting orders.
      // When pendingShowWaiting is false -> show ONLY non-waiting orders.
      const isWaiting = !!o.is_waiting_inventory;
      if (pendingShowWaiting) {
        return isWaiting;
      } else {
        if (isWaiting) return false;
      }

      if (pendingSelectedCarriers.size === 0 && !pendingIncludeUnassigned) return true;
      const carrier = getCarrierLabel(o, bikeSkuSet);
      if (carrier) {
        return pendingSelectedCarriers.has(carrier);
      }
      return pendingIncludeUnassigned;
    },
    [
      pendingSelectedCarriers,
      pendingIncludeUnassigned,
      pendingShowWaiting,
      debouncedSearchQuery,
      bikeSkuSet,
    ]
  );

  const matchesShippedCarrierFilter = useCallback(
    (o: OrderWithRelations) => {
      if (shippedSelectedCarriers.size === 0 && !shippedIncludeUnassigned) return true;
      const carrier = getCarrierLabel(o, bikeSkuSet);
      return carrier ? shippedSelectedCarriers.has(carrier) : shippedIncludeUnassigned;
    },
    [shippedSelectedCarriers, shippedIncludeUnassigned, bikeSkuSet]
  );

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    const myGeneration = ++fetchGenerationRef.current;
    const isCurrent = () => fetchGenerationRef.current === myGeneration;
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

      const pageLimit = SEARCH_PAGE_SIZE * searchPage;
      if (sq) {
        if (customerIds.length > 0) {
          query = query.or(`order_number.ilike.%${sq}%,customer_id.in.(${customerIds.join(',')})`);
        } else {
          query = query.ilike('order_number', `%${sq}%`);
        }
        // Newest first, one page at a time, plus one row to know if more exist.
        query = query.limit(pageLimit + 1);
      } else {
        query = query.or(
          `is_shipped.is.null,is_shipped.eq.false,and(is_shipped.eq.true,updated_at.gte.${nyMidnight})`
        );
      }

      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'OrdersScreen.fetchOrders',
      });

      if (error) throw error;

      let rows = (data || []) as unknown as OrderWithRelations[];

      const withGroupSiblings = async (
        base: OrderWithRelations[]
      ): Promise<OrderWithRelations[]> => {
        const groupIds = Array.from(
          new Set(
            base
              .filter((o) => o.group_id && isDeliberateCombineGroupType(o.order_group?.group_type))
              .map((o) => o.group_id as string)
          )
        );
        if (groupIds.length === 0) return base;
        const { data: siblingRows } = await withSupabaseRetry(
          () =>
            supabase
              .from('picking_lists')
              .select(ORDER_LIST_SELECT)
              .in('group_id', groupIds)
              .neq('status', 'cancelled'),
          { label: 'OrdersScreen.fetchOrders.topUpSiblings' }
        );
        if (!siblingRows) return base;
        const existingIds = new Set(base.map((o) => o.id));
        const extra = (siblingRows as unknown as OrderWithRelations[])
          .filter((o) => !existingIds.has(o.id))
          .map((o) => ({ ...o, customer_details: o.customer || {} }));
        return extra.length > 0 ? [...base, ...extra] : base;
      };

      if (sq) {
        // Search stays a single round trip: it's already small and paginated
        // (SEARCH_PAGE_SIZE), so splitting it wouldn't help the "feels slow
        // on open" complaint (idea-224) — that's the default view below. The
        // exact-match prepend also depends on knowing the final row order
        // up front, which a background merge would fight with.
        setSearchHasMore(rows.length > pageLimit);
        rows = rows.slice(0, pageLimit);
        // The exact number, whatever its age, always makes the page.
        if (/^\d{4,}$/.test(sq) && !rows.some((o) => o.order_number === sq)) {
          const { data: exact } = await withSupabaseRetry(
            () =>
              supabase
                .from('picking_lists')
                .select(ORDER_LIST_SELECT)
                .neq('status', 'cancelled')
                .eq('order_number', sq)
                .limit(SEARCH_PAGE_SIZE),
            { label: 'OrdersScreen.fetchOrders.exact' }
          );
          if (exact && exact.length > 0) {
            rows = [...(exact as unknown as OrderWithRelations[]), ...rows];
          }
        }

        const mappedSearch = (await withGroupSiblings(rows)).map((order) => ({
          ...order,
          customer_details: order.customer || {},
        }));
        if (!isCurrent()) return;
        setOrders(mappedSearch);
        const liveMeta = await fetchLiveSkuMetadata(mappedSearch);
        if (liveMeta && isCurrent()) setOrders((prev) => applyLiveSkuMetadata(prev, liveMeta));
        return;
      }

      // Default (non-search) view: this is the load Rafael flagged as slow
      // (idea-224) — paint the primary batch the instant it lands, then
      // fill in the rest (the Shipped column's recent floor, and combined-
      // group siblings) in the background. Neither wave blocks `loading`,
      // and each one only ADDS rows — it never reorders or replaces what's
      // already on screen.
      setSearchHasMore(false);
      const primary = rows.map((order) => ({
        ...order,
        customer_details: order.customer || {},
      }));
      if (!isCurrent()) return;
      setOrders(primary);
      hasLoadedOnceRef.current = true;
      setLoading(false);

      // The Shipped column is never empty at the start of a day: today's
      // shipped orders, and the most recent earlier ones to make it at
      // least RECENT_SHIPPED (Rafael, 2026-08-28). One small indexed query.
      const { data: recent } = await withSupabaseRetry(
        () =>
          supabase
            .from('picking_lists')
            .select(ORDER_LIST_SELECT)
            .neq('status', 'cancelled')
            .eq('is_shipped', true)
            .order('updated_at', { ascending: false })
            .limit(RECENT_SHIPPED),
        { label: 'OrdersScreen.fetchOrders.recentShipped' }
      );

      let merged = primary;
      if (recent && recent.length > 0) {
        const seen = new Set(merged.map((o) => o.id));
        const extra = (recent as unknown as OrderWithRelations[])
          .filter((o) => !seen.has(o.id))
          .map((o) => ({ ...o, customer_details: o.customer || {} }));
        if (extra.length > 0) {
          merged = [...merged, ...extra];
          if (isCurrent()) setOrders(merged);
        }
      }

      const withSiblings = await withGroupSiblings(merged);
      if (withSiblings.length > merged.length && isCurrent()) setOrders(withSiblings);

      // Last wave: the live catalog over each line's seal (also after a
      // search, above). The branch that split this fetch (idea-226) dropped it as redundant with the stamp,
      // but the stamp is only written when the ORDER is written, and an
      // embedded flag wins over `bikeSkuSet` in the classifier — an explicit
      // `false` sealed before a SKU was registered or corrected (#881703,
      // 24 sep 2026) would keep the order FedEx forever. Deferred, not
      // dropped: it no longer blocks the first paint.
      // Applied to whatever is on screen by then, so a row realtime patched
      // meanwhile is enriched, not rolled back.
      const liveMeta = await fetchLiveSkuMetadata(withSiblings);
      if (liveMeta && isCurrent()) setOrders((prev) => applyLiveSkuMetadata(prev, liveMeta));
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [user, debouncedSearchQuery, searchPage]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  return {
    orders,
    setOrders,
    bikeSkuSet,
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
    searchHasMore,
    loadMoreSearch,
    searchPageSize: SEARCH_PAGE_SIZE,
    handlePendingCarrierToggle,
    handleShippedCarrierToggle,
    matchesPendingCarrierFilter,
    matchesShippedCarrierFilter,
    fetchOrders,
  };
}
