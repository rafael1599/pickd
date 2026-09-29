import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import {
  bikeSetsFrom,
  cartSkusKey,
  fetchCartSkuMeta,
  type CartSkuMeta,
} from '../../../../services/cartSkuMeta.service';
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
import type { PalletDimsEntry } from '../../../../utils/palletDims';
import type { Shipment } from '../../../../schemas/shipment.schema';
import { ensurePickingNotes } from '../../hooks/usePickingNotes';
import { prefetchAutoSelectCandidate, prefetchDetailByOrderNumber } from '../api/shipOrderDetail';

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
  /** From AS400's CUSTOMER DISPLAY, filled by the watcher (29 sep 2026). */
  phone?: string | null;
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
  shipment_id?: string | null;
  shipment?: Shipment | null;
  combined_member_ids?: string[];
  /** Every member's AS400 note, on a combined card (see ShipScreen). */
  member_notes?: { orderNumber: string | null; notes: string | null }[];
}

export { SHIPMENT_EMBED } from '../api/shipmentEmbed';

/**
 * What a list row carries: enough to draw its card, file it into a column and a
 * carrier lane, and open it at once — not the photos' history, dims or people of
 * an order nobody opened (those come with the detail, `api/shipOrderDetail.ts`).
 * `items` stays: the FedEx stripe and the progress bar read them.
 */
export const ORDER_LIST_LIGHT = `
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
  customer:customers(id, name, street, city, state, zip_code, phone),
  ship_to_address_id,
  ship_to:customer_addresses!picking_lists_ship_to_address_id_fkey(id, label, street, city, state, zip_code, contact_name),
  order_group:order_groups(group_type),
  shipment_id,
  shipment:shipments(
    id,
    customer_id,
    ship_to_address_id,
    transport_company,
    load_number,
    pallets_qty,
    total_weight_lbs,
    pallet_photos,
    is_shipped,
    shipped_at
  )
`;

type LiveSkuMeta = Map<string, { is_bike: boolean | null; weight_lbs: number | null }>;

function skusOf(orders: readonly OrderWithRelations[]): string[] {
  return orders.flatMap((o) =>
    (o.items ?? []).map((i) => i.sku).filter((s): s is string => typeof s === 'string' && !!s)
  );
}

/** Only SKUs that have a catalogue row overlay the item's own stamp. */
function liveSkuMetaFrom(meta: Readonly<Record<string, CartSkuMeta>>): LiveSkuMeta {
  const map: LiveSkuMeta = new Map();
  for (const [sku, m] of Object.entries(meta)) {
    if (m.catalog_sku) map.set(sku, { is_bike: m.is_bike, weight_lbs: m.weight_lbs });
  }
  return map;
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

/**
 * The catalogue of each set of SKUs a card can open with — each order, and each
 * combined shipment or group — so opening one reads `useCartSkuMeta` from cache.
 */
function seedCartSkuMeta(
  queryClient: QueryClient,
  orders: readonly OrderWithRelations[],
  meta: Readonly<Record<string, CartSkuMeta>>
) {
  const sets = new Map<string, string[]>();
  const add = (key: string, skus: string[]) => sets.set(key, [...(sets.get(key) ?? []), ...skus]);
  for (const o of orders) {
    const skus = skusOf([o]);
    add(`order:${o.id}`, skus);
    if (o.shipment_id) add(`shipment:${o.shipment_id}`, skus);
    if (o.group_id && isDeliberateCombineGroupType(o.order_group?.group_type)) {
      add(`group:${o.group_id}`, skus);
    }
  }
  queryClient.setQueryDefaults(['cart-sku-meta'], { gcTime: 10 * 60_000 });
  for (const skus of sets.values()) {
    const key = cartSkusKey(skus);
    if (!key || queryClient.getQueryData(['cart-sku-meta', key]) !== undefined) continue;
    const keySkus = key.split(',');
    if (!keySkus.every((sku) => sku in meta)) continue;
    const subset: Record<string, CartSkuMeta> = {};
    for (const sku of keySkus) subset[sku] = meta[sku];
    queryClient.setQueryData(['cart-sku-meta', key], subset);
  }
}

/** After the first paint, when the browser has a moment. */
function whenIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      window.requestIdleCallback(() => resolve(), { timeout: 500 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function normalizeShipOrder<T extends OrderWithRelations>(order: T): T {
  return {
    ...order,
    customer_details: order.customer || {},
    pallet_photos: order.shipment?.pallet_photos ?? order.pallet_photos,
    pallet_dims: order.shipment?.pallet_dims ?? order.pallet_dims,
    pallets_qty: order.shipment?.pallets_qty ?? order.pallets_qty,
    load_number: order.shipment?.load_number ?? order.load_number,
    transport_company: order.shipment?.transport_company ?? order.transport_company,
  };
}

export function useShipOrdersData() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);

  // The catalogue of every SKU on screen, read in ONE batch after the first
  // paint. Order items are raw watchdog JSONB, so the FedEx/Regular lane needs
  // `is_bike` from here; until it lands, the stamp sealed in each item decides.
  const [liveMeta, setLiveMeta] = useState<Record<string, CartSkuMeta>>({});
  const liveMetaRef = useRef(liveMeta);
  useEffect(() => {
    liveMetaRef.current = liveMeta;
  }, [liveMeta]);
  const requestedSkusRef = useRef(new Set<string>());
  /** Asks the catalogue only for SKUs nobody asked for yet; returns all known. */
  const loadSkuMeta = useCallback(async (skus: readonly string[]) => {
    const missing = [...new Set(skus)].filter((s) => !requestedSkusRef.current.has(s));
    missing.forEach((s) => requestedSkusRef.current.add(s));
    let fetched: Record<string, CartSkuMeta> = {};
    if (missing.length > 0) {
      try {
        fetched = await fetchCartSkuMeta(missing);
      } catch {
        missing.forEach((s) => requestedSkusRef.current.delete(s));
        return null;
      }
      setLiveMeta((prev) => ({ ...prev, ...fetched }));
      setOrders((prev) => applyLiveSkuMetadata(prev, liveSkuMetaFrom(fetched)));
    }
    return { ...liveMetaRef.current, ...fetched };
  }, []);
  const bikeSkuSet = useMemo(() => bikeSetsFrom(liveMeta).bikes, [liveMeta]);
  // The list cards read their notes from the cache the batch seeds; they hold
  // off their own fetch until it has, or each card would ask on its own.
  const [notesSeeded, setNotesSeeded] = useState(false);

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

  /**
   * Phase 2, once the list is on screen: the notes of every card in one query
   * and the catalogue of every SKU in one query, seeded into the caches the
   * cards and the open card read.
   */
  const loadCardExtras = useCallback(
    async (rows: OrderWithRelations[], isCurrent: () => boolean) => {
      const pendingIds = rows.filter((o) => !o.is_shipped).map((o) => o.id);
      const [, meta] = await Promise.all([
        ensurePickingNotes(queryClient, pendingIds).catch((err) => {
          console.error('Error seeding card notes:', err);
        }),
        loadSkuMeta(skusOf(rows)),
      ]);
      if (!isCurrent()) return;
      setNotesSeeded(true);
      if (meta) seedCartSkuMeta(queryClient, rows, meta);
    },
    [queryClient, loadSkuMeta]
  );

  const fetchOrders = useCallback(async () => {
    if (!userId) return;
    const myGeneration = ++fetchGenerationRef.current;
    const isCurrent = () => fetchGenerationRef.current === myGeneration;
    if (!hasLoadedOnceRef.current) setLoading(true);
    setNotesSeeded(false);
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
        .select(ORDER_LIST_LIGHT)
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

      // Phase 1: the list and the order that will open, side by side — the card
      // never waits for the list to come back first.
      const exactNumber = /^\d{4,}$/.test(sq) ? sq : null;
      const [{ data, error }] = await Promise.all([
        withSupabaseRetry(() => query, { label: 'OrdersScreen.fetchOrders' }),
        sq
          ? exactNumber
            ? prefetchDetailByOrderNumber(queryClient, exactNumber)
            : Promise.resolve()
          : prefetchAutoSelectCandidate(queryClient),
      ]);

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
              .select(ORDER_LIST_LIGHT)
              .in('group_id', groupIds)
              .neq('status', 'cancelled'),
          { label: 'OrdersScreen.fetchOrders.topUpSiblings' }
        );
        if (!siblingRows) return base;
        const existingIds = new Set(base.map((o) => o.id));
        const extra = (siblingRows as unknown as OrderWithRelations[])
          .filter((o) => !existingIds.has(o.id))
          .map(normalizeShipOrder);
        return extra.length > 0 ? [...base, ...extra] : base;
      };

      if (sq) {
        // Search stays a single round trip: it's already small and paginated
        // (SEARCH_PAGE_SIZE). The exact-match prepend depends on knowing the
        // final row order up front, which a background merge would fight with.
        setSearchHasMore(rows.length > pageLimit);
        rows = rows.slice(0, pageLimit);
        // The exact number, whatever its age, always makes the page.
        if (exactNumber && !rows.some((o) => o.order_number === sq)) {
          const { data: exact } = await withSupabaseRetry(
            () =>
              supabase
                .from('picking_lists')
                .select(ORDER_LIST_LIGHT)
                .neq('status', 'cancelled')
                .eq('order_number', sq)
                .limit(SEARCH_PAGE_SIZE),
            { label: 'OrdersScreen.fetchOrders.exact' }
          );
          if (exact && exact.length > 0) {
            rows = [...(exact as unknown as OrderWithRelations[]), ...rows];
          }
        }

        const mappedSearch = (await withGroupSiblings(rows)).map(normalizeShipOrder);
        if (!isCurrent()) return;
        setOrders(mappedSearch);
        hasLoadedOnceRef.current = true;
        setLoading(false);
        await loadCardExtras(mappedSearch, isCurrent);
        return;
      }

      // Default (non-search) view: paint the primary batch the instant it
      // lands, then fill in the rest — the Shipped column's recent floor,
      // combined-group siblings, notes and catalogue — once the browser is
      // idle. Each wave only ADDS rows; it never reorders what's on screen.
      setSearchHasMore(false);
      const primary = rows.map(normalizeShipOrder);
      if (!isCurrent()) return;
      setOrders(primary);
      hasLoadedOnceRef.current = true;
      setLoading(false);

      await whenIdle();
      if (!isCurrent()) return;

      // The Shipped column is never empty at the start of a day: today's
      // shipped orders, and the most recent earlier ones to make it at
      // least RECENT_SHIPPED (Rafael, 2026-08-28). In parallel with the
      // siblings of what is already on screen.
      const [recentRes, primaryWithSiblings] = await Promise.all([
        withSupabaseRetry(
          () =>
            supabase
              .from('picking_lists')
              .select(ORDER_LIST_LIGHT)
              .neq('status', 'cancelled')
              .eq('is_shipped', true)
              .order('updated_at', { ascending: false })
              .limit(RECENT_SHIPPED),
          { label: 'OrdersScreen.fetchOrders.recentShipped' }
        ),
        withGroupSiblings(primary),
      ]);

      let merged = primaryWithSiblings;
      const recent = recentRes.data as unknown as OrderWithRelations[] | null;
      if (recent && recent.length > 0) {
        const seen = new Set(merged.map((o) => o.id));
        const extra = recent.filter((o) => !seen.has(o.id)).map(normalizeShipOrder);
        if (extra.length > 0) {
          // A recent order of a group not on screen yet brings its siblings.
          merged = await withGroupSiblings([...merged, ...extra]);
        }
      }
      if (merged.length > primary.length && isCurrent()) {
        const known = new Set(primary.map((o) => o.id));
        const added = merged.filter((o) => !known.has(o.id));
        // Added to whatever is on screen by then: a row realtime patched in the
        // meantime is kept, not rolled back to this read.
        setOrders((prev) => {
          const present = new Set(prev.map((o) => o.id));
          return [...prev, ...added.filter((o) => !present.has(o.id))];
        });
      }

      // The live catalog over each line's seal: the stamp is only written when
      // the ORDER is written, and an embedded flag wins over `bikeSkuSet` in the
      // classifier — a `false` sealed before a SKU was registered or corrected
      // (#881703, 24 sep 2026) would keep the order FedEx forever.
      await loadCardExtras(merged, isCurrent);
    } catch (err) {
      console.error('Error fetching orders:', err);
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [userId, debouncedSearchQuery, searchPage, queryClient, loadCardExtras]);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // Orders that arrive later (realtime, a refresh) may bring SKUs the batch
  // never saw: fetch only those, so their lane is right without re-reading all.
  const allSkusKey = useMemo(() => cartSkusKey(skusOf(orders)), [orders]);
  useEffect(() => {
    // Nothing until the first batch has asked: that one covers the first paint.
    if (requestedSkusRef.current.size === 0 || !allSkusKey) return;
    void loadSkuMeta(allSkusKey.split(','));
  }, [allSkusKey, loadSkuMeta]);

  return {
    orders,
    setOrders,
    bikeSkuSet,
    loading,
    setLoading,
    notesSeeded,
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
