import { useState, useEffect, useMemo, useRef, useCallback, Fragment } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { orderColorFor } from '../../utils/orderColors';
import { useAuth } from '../../context/AuthContext.tsx';
import { useDebounce } from '../../hooks/useDebounce';

import Info from 'lucide-react/dist/esm/icons/info';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { LivePrintPreview } from '../../components/orders/LivePrintPreview.tsx';

import { generateShipLabel } from '../../components/orders/generateShipLabel';
import { usePickingSession } from '../../context/PickingContext.tsx';
import { useViewMode as useViewModeCtx } from '../../context/ViewModeContext.tsx';

import {
  OrderDetailsContainer,
  OrderAutoSaveIndicator,
  ShipOrderListSkeleton,
} from './ship/components';
import type { AutoSaveStatus } from './ship/types';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import Truck from 'lucide-react/dist/esm/icons/truck';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart';
import { ShipOrderCard } from '../../components/orders/ShipOrderCard.tsx';
import { ShippedTruckBadge } from '../../components/orders/ShippedTruckBadge.tsx';
import { OrderProgressBar } from './components/OrderProgressBar.tsx';
import { TransportLogo } from '../../components/orders/TransportLogo.tsx';
import { useShipOutSms } from './hooks/useShipOutSms';
import { withSupabaseRetry } from '../../lib/supabaseRetry';
import { PickingSummaryModal } from '../../components/orders/PickingSummaryModal.tsx';
import { SplitOrderModal } from '../../components/orders/SplitOrderModal.tsx';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import type { PickingListItem, CombineMeta } from '../../schemas/picking.schema';
import { saveCustomerAddress } from '../../lib/customerAddresses';
import { ReasonPicker } from './components/ReasonPicker';
import { DoubleCheckHeader } from './components/DoubleCheckHeader';
import { ShippingFlowPreviewModal } from './components/ShippingFlowPreviewModal';
import { compressImage, base64ToBlobUrl } from '../../services/photoUpload.service';
import { useUnmarkWaiting } from './hooks/useWaitingOrders';
import { CarrierFilter } from './components/board/CarrierFilter';
import { OrderNotesInline } from './components/OrderNotesInline';
import { OrderActionsMenu } from './components/OrderActionsMenu';
import { useModal } from '../../context/ModalContext';

function dayKey(date: Date): string {
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

function getNYMidnightISO(): string {
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

function dayLabel(date: Date): string {
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

/**
 * Bike vs part classification for an item. sku_metadata.is_bike is the
 * definitive answer once loaded; while it's still loading for a freshly
 * merged/combined item set (skuMeta[sku] entirely undefined, not just
 * false), fall back to the "03-" SKU prefix — the same convention used
 * elsewhere in the app (usePickingSync, classify_picking_list_fedex) — so
 * items don't get misclassified as parts during that race.
 */
function isLikelyBike(sku: string, meta?: { is_bike: boolean }): boolean {
  if (meta) return meta.is_bike;
  return sku.startsWith('03-');
}

function isFedexLane(order: OrderWithRelations): boolean {
  const groupType = (order.order_group as { group_type?: string } | null)?.group_type;
  const transport = String(order.transport_company || '')
    .trim()
    .toUpperCase();
  return groupType === 'fedex' || transport === 'FEDEX';
}

/**
 * Merges the members of a "general" combined group into one pseudo-order —
 * the anchor (oldest sibling, whose id everything else routes through) plus
 * pallets/units/items/dates aggregated across the WHOLE group. Used both by
 * the list-building memo and directly by the realtime handler, so a
 * deep-link, auto-select, or realtime echo can resolve the exact same
 * combined view without waiting a render cycle for filteredOrders to catch
 * up (that gap is what let editing one field on a combined order flash back
 * to a lone sibling's numbers).
 */
function combineGeneralGroupSiblings(siblings: OrderWithRelations[]): OrderWithRelations {
  const sorted = [...siblings].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const anchor = sorted[0];

  const allOrderNumbers = sorted
    .map((s) => s.order_number)
    .filter((n): n is string => !!n)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const combinedOrderNumber = allOrderNumbers.join(' / ');

  const newestCreatedAt = sorted.reduce(
    (max, s) => (s.created_at > max ? s.created_at : max),
    anchor.created_at
  );
  const newestUpdatedAt = sorted.reduce(
    (max, s) => (s.updated_at > max ? s.updated_at : max),
    anchor.updated_at
  );

  const combinedPalletsQty = sorted.reduce((sum, s) => sum + (s.pallets_qty ?? 0), 0);
  const combinedItems = sorted.flatMap((s) => (Array.isArray(s.items) ? s.items : []));
  // Prefer summing pickingQty straight off the merged items — per-sibling
  // total_units columns can drift stale after corrections, so trust the
  // live items when they're present (matches Orders board's getOrderUnits).
  const combinedTotalUnits =
    combinedItems.length > 0
      ? combinedItems.reduce((sum, i) => sum + (i.pickingQty || 0), 0)
      : sorted.reduce((sum, s) => sum + (s.total_units ?? 0), 0);
  const combinedVerifiedKeys = sorted.flatMap((s) => s.verified_item_keys ?? []);
  // The group only counts as shipped once every sibling is — one sibling
  // shipped ahead of the rest (legacy data, or shipped before being combined)
  // shouldn't make the whole group disappear from the "to ship" tab.
  const allShipped = sorted.every((s) => !!s.is_shipped);

  return {
    ...anchor,
    order_number: combinedOrderNumber || anchor.order_number,
    created_at: newestCreatedAt,
    updated_at: newestUpdatedAt,
    pallets_qty: combinedPalletsQty,
    total_units: combinedTotalUnits,
    items: combinedItems,
    verified_item_keys: combinedVerifiedKeys,
    is_shipped: allShipped,
    combine_meta: { ...(anchor.combine_meta ?? {}), is_combined: true } as CombineMeta,
  };
}

// Single source of truth for the orders-list column set — used by fetchOrders,
// fetchSingleLightweightOrder, and the group-sibling top-up query. Previously
// duplicated by hand in two places and `load_number` silently went missing
// from both; extracting this is what makes that class of bug impossible.
const ORDER_LIST_SELECT = `
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
  customer:customers(id, name, street, city, state, zip_code),
  user:profiles!user_id(full_name),
  checker:profiles!checked_by(full_name),
  presence:user_presence!user_id(last_seen_at),
  order_group:order_groups(group_type)
`;

/**
 * FedEx orders count as the 'FEDEX' carrier; everything else uses its
 * transport_company. PICK UP is checked first so it never gets swallowed by
 * a 'fedex' lane classification (mirrors the same guard in OrdersBoardScreen).
 */
function getCarrierLabel(order: OrderWithRelations): string | null {
  const explicit = order.transport_company?.trim().toUpperCase() || null;
  if (explicit === 'PICK UP') return explicit;
  if (isFedexLane(order)) return 'FEDEX';
  return explicit;
}

interface DayGroup {
  key: string;
  label: string;
  orders: OrderWithRelations[];
}

interface CustomerDetails {
  id: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip_code: string;
}

interface OrderWithRelations {
  id: string;
  order_number: string | null;
  user_id: string | null;
  customer_id: string | null;
  pallets_qty: number | null;
  total_units: number | null;
  load_number: string | null;
  transport_company: string | null;
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
}

export const ShipScreen = () => {
  const { user } = useAuth();
  const { open: openModal } = useModal();
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const { isEnabled: isShipSmsEnabled, triggerForList: triggerShipOutSms } = useShipOutSms();
  const { takeOverOrder, loadReopenedOrder, resumeReopenedOrder, restoreCancelledOrder } =
    usePickingSession();
  const {
    externalOrderId,
    setExternalOrderId,
    setExternalDoubleCheckId,
    setExternalActionTrigger,
    setViewMode,
  } = useViewModeCtx();
  const unmarkWaiting = useUnmarkWaiting();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithRelations | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearchQuery = useDebounce(searchQuery, 200);
  const [selectedCarriers, setSelectedCarriers] = useState<Set<string>>(new Set());
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const handleCarrierToggle = useCallback((carrier: string) => {
    setSelectedCarriers((prev) => {
      const next = new Set(prev);
      if (next.has(carrier)) {
        next.delete(carrier);
      } else {
        next.add(carrier);
      }
      return next;
    });
  }, []);
  const matchesCarrierFilter = useCallback(
    (o: OrderWithRelations) => {
      if (selectedCarriers.size === 0 && !includeUnassigned) return true;
      const carrier = getCarrierLabel(o);
      return carrier ? selectedCarriers.has(carrier) : includeUnassigned;
    },
    [selectedCarriers, includeUnassigned]
  );
  const navigate = useNavigate();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [reopenReasonModal, setReopenReasonModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [restoreReasonModal, setRestoreReasonModal] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [pendingShipmentOrder, setPendingShipmentOrder] = useState<OrderWithRelations | null>(null);
  const shipCameraInputRef = useRef<HTMLInputElement>(null);
  const [shipTab, setShipTab] = useState<'to_ship' | 'shipped'>('to_ship');
  const [hoveredTabInfo, setHoveredTabInfo] = useState<'to_ship' | 'shipped' | null>(null);
  const [showShippingPreview, setShowShippingPreview] = useState(false);
  const [isShippingBatch, setIsShippingBatch] = useState(false);

  useEffect(() => {
    if (loading || orders.length === 0) return;
    const hasUnshipped = orders.some((o) => o.status !== 'cancelled' && !o.is_shipped);
    if (!hasUnshipped && shipTab === 'to_ship') {
      setShipTab('shipped');
    }
  }, [orders, loading, shipTab]);
  // Add-On reopen flow (idea-067 Phase 2): after the user picks the reason,
  const searchQueryRef = useRef(searchQuery);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  // Ref to track selectedOrder without triggering re-renders in callbacks
  const selectedOrderRef = useRef(selectedOrder);
  useEffect(() => {
    selectedOrderRef.current = selectedOrder;
  }, [selectedOrder]);

  // Auto-scroll to top when searching to ensure results are visible
  useEffect(() => {
    if (searchQuery && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [searchQuery]);

  const [isPrinting, setIsPrinting] = useState(false);
  const [isShowingPickingSummary, setIsShowingPickingSummary] = useState(false);
  const [isShowingSplitModal, setIsShowingSplitModal] = useState(false);

  // Form state for live editing
  const [formData, setFormData] = useState({
    customerName: '',
    street: '',
    city: '',
    state: '',
    zip: '',
    pallets: '1',
    units: '0',
    loadNumber: '',
    transportCompany: '',
    bikes: '',
    parts: '',
    weight: '',
  });

  // SKU metadata map fetched from sku_metadata (weight + bike classification)
  const [skuMeta, setSkuMeta] = useState<
    Record<string, { weight_lbs: number | null; is_bike: boolean }>
  >({});
  const [weightsReady, setWeightsReady] = useState(false);

  // Fetch sku_metadata (weights + is_bike) when selected order changes
  useEffect(() => {
    setWeightsReady(false);
    if (!selectedOrder?.items || !Array.isArray(selectedOrder.items)) {
      setSkuMeta({});
      return;
    }
    const skus = [...new Set(selectedOrder.items.map((i: PickingListItem) => i.sku))] as string[];
    if (skus.length === 0) return;

    supabase
      .from('sku_metadata')
      .select('sku, weight_lbs, is_bike')
      .in('sku', skus)
      .then(({ data }) => {
        const map: Record<string, { weight_lbs: number | null; is_bike: boolean }> = {};
        skus.forEach((s) => {
          map[s] = { weight_lbs: null, is_bike: false };
        });
        (
          data as unknown as
            | { sku: string; weight_lbs: number | null; is_bike: boolean | null }[]
            | null
        )?.forEach((row) => {
          map[row.sku] = { weight_lbs: row.weight_lbs, is_bike: row.is_bike ?? false };
        });
        setSkuMeta(map);
        setWeightsReady(true);
      });
  }, [selectedOrder?.id, selectedOrder?.items]);

  // Items missing weight
  const itemsMissingWeight = useMemo(() => {
    const items = selectedOrder?.items;
    if (!Array.isArray(items) || Object.keys(skuMeta).length === 0) return [];
    const seen = new Set<string>();
    return items.filter((item: PickingListItem) => {
      if (seen.has(item.sku)) return false;
      seen.add(item.sku);
      return skuMeta[item.sku]?.weight_lbs == null;
    });
  }, [selectedOrder?.items, skuMeta]);

  // Auto-assign default weight to SKUs missing weight in sku_metadata
  // Bikes → 45 lbs, Parts → 0.1 lbs
  useEffect(() => {
    if (!weightsReady || itemsMissingWeight.length === 0) return;
    const skusToFix = itemsMissingWeight.map((i: PickingListItem) => i.sku);

    Promise.all(
      skusToFix.map((sku: string) => {
        const isBike = skuMeta[sku]?.is_bike;
        const defaultWeight = isBike === false ? 0.1 : 45;
        return supabase
          .from('sku_metadata')
          .upsert({ sku, weight_lbs: defaultWeight }, { onConflict: 'sku' });
      })
    ).then(() => {
      setSkuMeta((prev) => {
        const updated = { ...prev };
        skusToFix.forEach((sku: string) => {
          const isBike = updated[sku]?.is_bike;
          updated[sku] = { ...updated[sku], weight_lbs: isBike === false ? 0.1 : 45 };
        });
        return updated;
      });
    });
  }, [weightsReady, itemsMissingWeight, skuMeta]);

  // FedEx orders don't use pallets — skip pallet weight
  const isFedexOrder =
    (selectedOrder?.order_group as { group_type?: string } | null)?.group_type === 'fedex';

  // Calculate total weight live from the Pallets/Bikes/Parts fields shown in
  // this view — not just the raw item list — so overriding Bikes or Parts
  // actually moves the weight instead of silently ignoring the edit. Average
  // weight-per-unit comes from the real items + sku_metadata (bikes and
  // parts weigh very differently), then gets multiplied by whatever count is
  // currently shown (edited or auto), same fallback order as autoBikeCount/
  // autoPartCount and the same 45/0.1 lbs defaults used to backfill missing
  // sku_metadata weights.
  const totalWeight = useMemo(() => {
    const items = selectedOrder?.items;
    const palletCount = parseInt(formData.pallets, 10) || 0;
    const palletWeight = isFedexOrder ? 0 : palletCount * 40;

    if (!Array.isArray(items) || items.length === 0) {
      return Math.round(palletWeight);
    }

    let bikeUnits = 0;
    let bikeWeightTotal = 0;
    let partUnits = 0;
    let partWeightTotal = 0;
    items.forEach((item: PickingListItem) => {
      const qty = item.pickingQty || 0;
      const weight = skuMeta[item.sku]?.weight_lbs ?? 0;
      if (isLikelyBike(item.sku, skuMeta[item.sku])) {
        bikeUnits += qty;
        bikeWeightTotal += weight * qty;
      } else {
        partUnits += qty;
        partWeightTotal += weight * qty;
      }
    });

    const avgBikeWeight = bikeUnits > 0 ? bikeWeightTotal / bikeUnits : 45;
    const avgPartWeight = partUnits > 0 ? partWeightTotal / partUnits : 0.1;

    const bikesCount = formData.bikes !== '' ? parseInt(formData.bikes, 10) || 0 : bikeUnits;
    const partsCount = formData.parts !== '' ? parseInt(formData.parts, 10) || 0 : partUnits;
    const productWeight = bikesCount * avgBikeWeight + partsCount * avgPartWeight;

    return Math.round(productWeight + palletWeight);
  }, [
    selectedOrder?.items,
    skuMeta,
    formData.pallets,
    formData.bikes,
    formData.parts,
    isFedexOrder,
  ]);

  // Manual override: if the user typed a value in the Weight field, use it.
  // Otherwise fall back to the auto-calculated total. Used by preview, PDF,
  // and DB persistence so all three stay in sync.
  const effectiveWeight = useMemo(() => {
    const trimmed = formData.weight.trim();
    if (trimmed === '') return totalWeight;
    const manual = parseFloat(trimmed);
    if (Number.isNaN(manual) || manual < 0) return totalWeight;
    return Math.round(manual);
  }, [formData.weight, totalWeight]);

  // Split item counts: bikes vs parts (auto-calculated)
  const { autoBikeCount, autoPartCount } = useMemo(() => {
    const items = selectedOrder?.items;
    if (!Array.isArray(items)) return { autoBikeCount: 0, autoPartCount: 0 };
    let bikes = 0,
      parts = 0;
    items.forEach((item: PickingListItem) => {
      const qty = item.pickingQty || 0;
      if (isLikelyBike(item.sku, skuMeta[item.sku])) bikes += qty;
      else parts += qty;
    });
    return { autoBikeCount: bikes, autoPartCount: parts };
  }, [selectedOrder?.items, skuMeta]);

  // Effective counts: manual override takes priority over auto-calculated
  const bikeCount = formData.bikes !== '' ? parseInt(formData.bikes, 10) || 0 : autoBikeCount;
  const partCount = formData.parts !== '' ? parseInt(formData.parts, 10) || 0 : autoPartCount;

  // Parts SKUs with their weights (for inline editor)
  const partsWithWeights = useMemo(() => {
    const items = selectedOrder?.items;
    if (!Array.isArray(items)) return [];
    const seen = new Set<string>();
    return items
      .filter((item: PickingListItem) => {
        if (isLikelyBike(item.sku, skuMeta[item.sku]) || seen.has(item.sku)) return false;
        seen.add(item.sku);
        return true;
      })
      .map((item: PickingListItem) => ({
        sku: item.sku,
        qty: item.pickingQty || 0,
        weight: skuMeta[item.sku]?.weight_lbs ?? 0,
      }));
  }, [selectedOrder?.items, skuMeta]);

  // Track the selected customer ID to link/unlink
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  // Track original params to detect changes (Name vs Address)
  const [originalCustomerParams, setOriginalCustomerParams] = useState<CustomerDetails | null>(
    null
  );

  // Full-screen spinner ONLY on the very first load. Refetches triggered by
  // realtime events or the field auto-save must be silent: flipping `loading`
  // replaces the whole screen with the spinner, which unmounts the card and
  // kicks the user out of whatever field they were editing — with warehouse
  // activity streaming in, that felt like the page "refreshing every second".
  const hasLoadedOnceRef = useRef(false);

  const lastFetchedDetailIdRef = useRef<string | null>(null);

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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          customerIds = data.map((c: any) => c.id);
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
        query = query.limit(100);
      } else {
        query = query.or(
          `is_shipped.is.null,is_shipped.eq.false,and(is_shipped.eq.true,updated_at.gte.${nyMidnight})`
        );
      }

      // Wrap the supabase call so transient network/5xx errors get
      // retried with exponential backoff. Without this, a single
      // flake on a flaky network surfaces as "Failed to load orders"
      // and the picker has to manually refresh.
      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'OrdersScreen.fetchOrders',
      });

      if (error) throw error;

      let mappedData = ((data || []) as unknown as OrderWithRelations[]).map((order) => ({
        ...order,
        customer_details: order.customer || {},
      }));

      // Top up any "general" combined group whose siblings didn't ALL match
      // this fetch's own filters (most commonly: search text only matches
      // one sibling's own order_number, e.g. searching "787" never fetches
      // "880848" at all). Combining needs every sibling present — without
      // this, a search or a narrow status/tab filter silently shows the
      // group as if it were just the one matching sibling.
      const groupIds = Array.from(
        new Set(
          mappedData
            .filter(
              (o) =>
                o.group_id &&
                (o.order_group as { group_type?: string } | null)?.group_type === 'general'
            )
            .map((o) => o.group_id as string)
        )
      );
      if (groupIds.length > 0) {
        const { data: siblingRows } = await withSupabaseRetry(
          () => supabase.from('picking_lists').select(ORDER_LIST_SELECT).in('group_id', groupIds),
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
      toast.error('Failed to load orders');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [user, externalOrderId, debouncedSearchQuery]); // Include externalOrderId here to ensure consistency

  const fetchOrderDetails = useCallback(async (id: string) => {
    try {
      const query = supabase
        .from('picking_lists')
        .select(
          `
          *,
          customer:customers(id, name, street, city, state, zip_code),
          user:profiles!user_id(full_name),
          checker:profiles!checked_by(full_name),
          presence:user_presence!user_id(last_seen_at),
          order_group:order_groups(group_type)
        `
        )
        .eq('id', id)
        .single();

      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'OrdersScreen.fetchOrderDetails',
      });

      if (error) throw error;
      if (data) {
        return {
          ...data,
          customer_details: data.customer || {},
        } as unknown as OrderWithRelations;
      }
    } catch (err) {
      console.error('Error fetching order details:', err);
      toast.error('Failed to load order details');
    }
    return null;
  }, []);

  // Fetches every sibling of a "general" combined group fresh from the DB —
  // used so the realtime handler can resolve straight to the properly
  // combined pseudo-order instead of setting selectedOrder to a lone raw
  // sibling and waiting a render cycle for the self-heal effect to catch it.
  const fetchGroupSiblings = useCallback(async (groupId: string) => {
    try {
      const { data, error } = await withSupabaseRetry(
        () =>
          supabase
            .from('picking_lists')
            .select(
              `
          *,
          customer:customers(id, name, street, city, state, zip_code),
          user:profiles!user_id(full_name),
          checker:profiles!checked_by(full_name),
          presence:user_presence!user_id(last_seen_at),
          order_group:order_groups(group_type)
        `
            )
            .eq('group_id', groupId),
        { label: 'OrdersScreen.fetchGroupSiblings' }
      );

      if (error) throw error;
      return (data ?? []).map((d) => ({
        ...d,
        customer_details: d.customer || {},
      })) as unknown as OrderWithRelations[];
    } catch (err) {
      console.error('Error fetching group siblings:', err);
      return [];
    }
  }, []);

  const fetchSingleLightweightOrder = useCallback(async (id: string) => {
    try {
      const query = supabase.from('picking_lists').select(ORDER_LIST_SELECT).eq('id', id).single();

      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'OrdersScreen.fetchSingleLightweightOrder',
      });
      if (error) throw error;
      if (data) {
        return {
          ...data,
          customer_details: data.customer || {},
        } as unknown as OrderWithRelations;
      }
    } catch (err) {
      console.error('Error fetching single lightweight order:', err);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!selectedOrder?.id) {
      lastFetchedDetailIdRef.current = null;
      setIsLoadingDetails(false);
      return;
    }

    if (selectedOrder.id === lastFetchedDetailIdRef.current) {
      return;
    }

    setIsLoadingDetails(true);
    let active = true;
    const loadDetails = async () => {
      const details = await fetchOrderDetails(selectedOrder.id);
      if (details && active) {
        lastFetchedDetailIdRef.current = details.id;
        setSelectedOrder(details);
      }
      if (active) setIsLoadingDetails(false);
    };
    loadDetails();

    return () => {
      active = false;
    };
  }, [selectedOrder?.id, fetchOrderDetails]);

  useEffect(() => {
    fetchOrders();

    const channel = supabase
      .channel('orders_realtime_sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'picking_lists',
        },
        async (payload) => {
          console.log('🔄 [OrdersScreen] Realtime update received:', payload.eventType);

          if (payload.eventType === 'DELETE') {
            const deletedId = payload.old.id;
            setOrders((prev) => prev.filter((o) => o.id !== deletedId));
            if (selectedOrderRef.current?.id === deletedId) {
              setSelectedOrder(null);
            }
          } else if (payload.eventType === 'INSERT') {
            const inserted = await fetchSingleLightweightOrder(payload.new.id);
            if (inserted) {
              const nyMidnight = getNYMidnightISO();
              const isOperational =
                inserted.status !== 'cancelled' &&
                (!inserted.is_shipped ||
                  (inserted.is_shipped && inserted.updated_at >= nyMidnight));
              if (isOperational) {
                setOrders((prev) => {
                  const filtered = prev.filter((o) => o.id !== inserted.id);
                  const next = [...filtered, inserted];
                  next.sort((a, b) => b.created_at.localeCompare(a.created_at));
                  return next;
                });
              }
            }
          } else if (payload.eventType === 'UPDATE') {
            const updated = await fetchSingleLightweightOrder(payload.new.id);
            if (updated) {
              const nyMidnight = getNYMidnightISO();
              const isOperational =
                updated.status !== 'cancelled' &&
                (!updated.is_shipped || (updated.is_shipped && updated.updated_at >= nyMidnight));

              setOrders((prev) => {
                const filtered = prev.filter((o) => o.id !== updated.id);
                if (isOperational) {
                  const next = [...filtered, updated];
                  next.sort((a, b) => b.created_at.localeCompare(a.created_at));
                  return next;
                }
                return filtered;
              });

              // If this is the currently selected order, fetch and update its full details.
              if (selectedOrderRef.current?.id === updated.id) {
                if (isOperational) {
                  const details = await fetchOrderDetails(updated.id);
                  if (details && selectedOrderRef.current?.id === updated.id) {
                    lastFetchedDetailIdRef.current = details.id;
                    const isGeneralGroup =
                      details.group_id &&
                      (details.order_group as { group_type?: string } | null)?.group_type ===
                        'general';
                    if (isGeneralGroup) {
                      // Resolve straight to the combined pseudo-order — don't
                      // set the raw lone sibling even momentarily, that's
                      // exactly what let one field's save flash the others
                      // back to a single sibling's numbers.
                      const siblings = await fetchGroupSiblings(details.group_id as string);
                      if (selectedOrderRef.current?.id === updated.id) {
                        setSelectedOrder(
                          siblings.length > 0 ? combineGeneralGroupSiblings(siblings) : details
                        );
                      }
                    } else {
                      setSelectedOrder(details);
                    }
                  }
                } else {
                  setSelectedOrder(null);
                }
              }
            }
          }
        }
      )
      .subscribe((status) => {
        console.log('📡 [OrdersScreen] Realtime status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchOrders, fetchSingleLightweightOrder, fetchOrderDetails, fetchGroupSiblings]);

  // Sync form data when the SELECTED ORDER CHANGES (i.e. the user picks a
  // different order) — deliberately keyed on id, not the object reference.
  // selectedOrder gets reassigned to a new object on every realtime echo,
  // self-heal resync, and post-save refresh even when it's still the same
  // order; resetting the form on every one of those wiped out whatever the
  // user had just typed before they could hit save.
  useEffect(() => {
    if (selectedOrder) {
      setFormData({
        customerName: selectedOrder.customer?.name || '',
        street: selectedOrder.customer?.street || '',
        city: selectedOrder.customer?.city || '',
        state: selectedOrder.customer?.state || '',
        zip: selectedOrder.customer?.zip_code || '',
        pallets: String(selectedOrder.pallets_qty || 1),
        units: String(selectedOrder.total_units || 0),
        loadNumber: selectedOrder.load_number || '',
        transportCompany: selectedOrder.transport_company || '',
        bikes: '',
        parts: '',
        // Weight stays blank by default — placeholder shows the auto-calculated
        // value and the user only fills it when they want a manual override.
        weight: '',
      });
      setSelectedCustomerId(selectedOrder.customer_id || null);
      setOriginalCustomerParams(selectedOrder.customer || null);
    }

    // keyed on id only, see comment above
  }, [selectedOrder?.id]);

  const { availableCarriers, carrierCounts, hasUnassignedOrders, unassignedCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of orders) {
      if (o.status === 'cancelled') continue;
      const carrier = getCarrierLabel(o);
      if (carrier) {
        counts.set(carrier, (counts.get(carrier) || 0) + 1);
      } else {
        unassigned++;
      }
    }
    return {
      availableCarriers: Array.from(counts.keys()).sort(),
      carrierCounts: counts,
      hasUnassignedOrders: unassigned > 0,
      unassignedCount: unassigned,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const todayStr = dayKey(new Date());
    const query = debouncedSearchQuery.toLowerCase().trim();

    // 1. Drop cancelled orders only. Grouping has to run BEFORE the tab/
    //    carrier filter — deciding "to ship" vs "shipped" per raw sibling
    //    (instead of per combined group) let one already-shipped sibling
    //    filter itself out while its still-pending twin stayed visible,
    //    which is what made a combined order look "solita" outside of
    //    search (search skipped this filter entirely via the `if (query)`
    //    early-return below, which is why it only ever looked right there).
    const notCancelled = orders.filter((o) => o.status !== 'cancelled');

    // 2. Collapse 'general' group siblings into a single virtual entry per
    //    group_id. We pick the OLDEST (first by created_at ASC) sibling as
    //    the underlying picking_list — clicks/select operate on its id, and
    //    loadExternalList merges sibling items via group_id at open time.
    //    The display order_number becomes "A / B" sorted ascending.
    const byGroup = new Map<string, typeof notCancelled>();
    const ungrouped: typeof notCancelled = [];
    for (const o of notCancelled) {
      const isGeneralGroup =
        o.group_id && (o.order_group as { group_type?: string } | null)?.group_type === 'general';
      if (isGeneralGroup) {
        const arr = byGroup.get(o.group_id!) ?? [];
        arr.push(o);
        byGroup.set(o.group_id!, arr);
      } else {
        ungrouped.push(o);
      }
    }

    const collapsed = [...ungrouped];
    for (const siblings of byGroup.values()) {
      collapsed.push(combineGeneralGroupSiblings(siblings));
    }

    // 3. Filter by status/tab and the carrier filter panel — now operating on
    //    the already-combined groups, so a group's shipped state is judged
    //    as a whole (all siblings shipped) rather than per raw row.
    const byCarrier = collapsed.filter((o) => {
      if (query) return true; // If searching, ignore tab/carrier boundaries

      const shippedToday = !!o.is_shipped && dayKey(new Date(o.updated_at)) === todayStr;
      const matchTab = shipTab === 'shipped' ? shippedToday : !o.is_shipped;
      if (!matchTab) return false;

      return matchesCarrierFilter(o);
    });

    // Re-sort by created_at desc to preserve the original list ordering.
    byCarrier.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const results = byCarrier.filter((order) => {
      const orderNum = String(order.order_number || order.id.toString().slice(-6)).toLowerCase();
      const customer = String(order.customer?.name || '').toLowerCase();
      return !query || orderNum.includes(query) || customer.includes(query);
    });

    if (!query) return results;

    // Reordering logic: Exact matches or "Starts with" first
    return [...results].sort((a, b) => {
      const aNum = String(a.order_number).toLowerCase();
      const bNum = String(b.order_number).toLowerCase();
      const aStartsWith = aNum.startsWith(query) ? 1 : 0;
      const bStartsWith = bNum.startsWith(query) ? 1 : 0;
      return bStartsWith - aStartsWith;
    });
  }, [orders, debouncedSearchQuery, shipTab, matchesCarrierFilter]);

  // Auto-select the most recently completed order if none selected AND no
  // external jump pending — that's the one a picker most likely just
  // finished and wants to print/verify, not just the latest created row.
  // Sourced from filteredOrders (not raw `orders`) so a combined "general"
  // group auto-selects as the merged pseudo-order, not a lone sibling.
  useEffect(() => {
    if (filteredOrders.length === 0 || selectedOrderRef.current || externalOrderId) return;
    const lastCompleted = filteredOrders.find((o) => o.status === 'completed');
    setSelectedOrder(lastCompleted || filteredOrders[0]);
  }, [filteredOrders, externalOrderId]);

  // Self-heal: the realtime UPDATE handler (and any future/edge-case path)
  // re-fetches a single row via fetchOrderDetails/fetchSingleLightweightOrder
  // and sets it as selectedOrder directly — bypassing group-collapsing. Any
  // save on a combined order triggers exactly this via its own realtime echo,
  // which is why edits to pallets/units/weight appeared to "revert" to a lone
  // sibling's numbers. combine_meta.is_combined is only ever true on our own
  // merged pseudo-order (real DB rows always have combine_meta null here), so
  // its absence is a reliable signal to re-resolve from filteredOrders.
  useEffect(() => {
    if (!selectedOrder?.group_id || selectedOrder.combine_meta?.is_combined) return;
    const isGeneralGroup =
      (selectedOrder.order_group as { group_type?: string } | null)?.group_type === 'general';
    if (!isGeneralGroup) return;
    const combined = filteredOrders.find((o) => o.group_id === selectedOrder.group_id);
    if (combined) setSelectedOrder(combined);
  }, [selectedOrder, filteredOrders]);

  // Handle external selections (e.g. from DoubleCheckHeader or VerificationBoard)
  useEffect(() => {
    if (!externalOrderId) return;
    if (!hasLoadedOnceRef.current) return;

    const targetId = externalOrderId;
    // Clear it immediately to avoid re-triggering
    setExternalOrderId(null);

    const rawOrder = orders.find((o) => o.id === targetId);
    // Deep-links (Edit Label, DoubleCheckHeader, VerificationBoard) pass a
    // single sibling's raw id. For "general" combined groups that must
    // resolve to the SAME merged pseudo-order filteredOrders already built —
    // matching by group_id (shared across every sibling), not by the raw id,
    // so it works regardless of which sibling was clicked. FedEx groups stay
    // ungrouped by design, so they're excluded here.
    const isGeneralGroup =
      rawOrder?.group_id &&
      (rawOrder.order_group as { group_type?: string } | null)?.group_type === 'general';
    const order = isGeneralGroup
      ? (filteredOrders.find((o) => o.group_id === rawOrder.group_id) ?? rawOrder)
      : rawOrder;
    if (order) {
      setSelectedOrder(order);
    } else {
      fetchOrderDetails(targetId as string).then((fetched) => {
        if (fetched) {
          setOrders((prev) => {
            if (prev.some((o) => o.id === fetched.id)) return prev;
            return [fetched, ...prev];
          });
          setSelectedOrder(fetched);
        }
      });
    }
  }, [externalOrderId, orders, filteredOrders, setExternalOrderId, fetchOrderDetails]);

  const visibleOrders = useMemo(() => filteredOrders, [filteredOrders]);

  // Auto-select the first result's tab and order when a search query is active
  useEffect(() => {
    if (debouncedSearchQuery && filteredOrders.length > 0) {
      const firstResult = filteredOrders[0];
      if (firstResult) {
        setShipTab(firstResult.is_shipped ? 'shipped' : 'to_ship');
        setSelectedOrder(firstResult);
      }
    }
  }, [debouncedSearchQuery, filteredOrders]);

  const ordersGroupedByDate = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const o of visibleOrders) {
      const d = new Date(o.created_at);
      const key = Number.isNaN(d.getTime()) ? 'unknown' : dayKey(d);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          label: Number.isNaN(d.getTime()) ? 'Unknown date' : dayLabel(d),
          orders: [],
        };
        map.set(key, group);
      }
      group.orders.push(o);
    }
    return Array.from(map.values());
  }, [visibleOrders]);

  const toShipCount = useMemo(() => {
    if (shipTab === 'to_ship') return filteredOrders.length;

    const toShipOrders = orders.filter(
      (o) => o.status !== 'cancelled' && !o.is_shipped && matchesCarrierFilter(o)
    );

    const byGroup = new Map<string, OrderWithRelations[]>();
    const ungrouped: OrderWithRelations[] = [];
    for (const o of toShipOrders) {
      const isGeneralGroup =
        o.group_id && (o.order_group as { group_type?: string } | null)?.group_type === 'general';
      if (isGeneralGroup) {
        const arr = byGroup.get(o.group_id!) ?? [];
        arr.push(o);
        byGroup.set(o.group_id!, arr);
      } else {
        ungrouped.push(o);
      }
    }

    return ungrouped.length + byGroup.size;
  }, [shipTab, filteredOrders.length, orders, matchesCarrierFilter]);

  const shippedCount = useMemo(() => {
    if (shipTab === 'shipped') return filteredOrders.length;

    const todayStr = dayKey(new Date());
    const shippedTodayOrders = orders.filter((o) => {
      if (o.status === 'cancelled' || !o.is_shipped) return false;
      if (dayKey(new Date(o.updated_at)) !== todayStr) return false;
      return matchesCarrierFilter(o);
    });

    const byGroup = new Map<string, OrderWithRelations[]>();
    const ungrouped: OrderWithRelations[] = [];
    for (const o of shippedTodayOrders) {
      const isGeneralGroup =
        o.group_id && (o.order_group as { group_type?: string } | null)?.group_type === 'general';
      if (isGeneralGroup) {
        const arr = byGroup.get(o.group_id!) ?? [];
        arr.push(o);
        byGroup.set(o.group_id!, arr);
      } else {
        ungrouped.push(o);
      }
    }

    return ungrouped.length + byGroup.size;
  }, [shipTab, filteredOrders.length, orders, matchesCarrierFilter]);

  const readyToShipVisibleCount = useMemo(
    () => visibleOrders.filter((o) => !o.is_waiting_inventory && o.status === 'completed').length,
    [visibleOrders]
  );

  const eligibleShippingOrders = useMemo(
    () => visibleOrders.filter((o) => !o.is_waiting_inventory && o.status === 'completed'),
    [visibleOrders]
  );

  const shippingPreviewOrders = useMemo(
    () =>
      eligibleShippingOrders.map((order) => {
        const created = new Date(order.created_at);
        const today = new Date();
        const createdDay = new Date(created.getFullYear(), created.getMonth(), created.getDate());
        const todayDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const delayedDays = Math.max(
          0,
          Math.round((todayDay.getTime() - createdDay.getTime()) / 86_400_000)
        );

        return {
          id: order.id,
          orderNumber: order.order_number,
          customerName: order.customer?.name ?? null,
          transportCompany: order.transport_company ?? (isFedexLane(order) ? 'FEDEX' : null),
          palletsQty: order.pallets_qty,
          totalUnits: order.total_units,
          createdAt: order.created_at,
          delayedDays,
        };
      }),
    [eligibleShippingOrders]
  );

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (searchQuery.trim()) parts.push(`search: "${searchQuery.trim()}"`);
    parts.push(`${visibleOrders.length} visible`);
    return parts.join(' · ');
  }, [searchQuery, visibleOrders.length]);

  const handleBatchShip = async (idsToShip: string[]) => {
    if (idsToShip.length === 0) return;

    setIsShippingBatch(true);
    const toastId = toast.loading(`Shipping ${idsToShip.length} orders...`);
    const previousOrders = [...orders];
    const previousSelectedOrder = selectedOrder;

    try {
      const groupIds = idsToShip
        .map((id) => orders.find((o) => o.id === id)?.group_id)
        .filter((gid): gid is string => !!gid);
      const siblingIds = orders
        .filter((o) => o.group_id && groupIds.includes(o.group_id))
        .map((o) => o.id);
      const allIds = [...new Set([...idsToShip, ...siblingIds])];

      // Optimistic update
      setOrders((prev) =>
        prev.map((o) =>
          allIds.includes(o.id)
            ? { ...o, status: 'completed', is_shipped: true, is_waiting_inventory: false }
            : o
        )
      );
      if (selectedOrder && allIds.includes(selectedOrder.id)) {
        setSelectedOrder((prev) =>
          prev
            ? { ...prev, status: 'completed', is_shipped: true, is_waiting_inventory: false }
            : null
        );
      }

      const { error } = await supabase
        .from('picking_lists')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ status: 'completed', is_shipped: true, is_waiting_inventory: false } as any)
        .in('id', allIds);

      if (error) throw error;

      toast.success(`Successfully marked ${idsToShip.length} orders as Shipped!`, {
        id: toastId,
      });
      setShowShippingPreview(false);
    } catch (err) {
      console.error('Error bulk shipping orders:', err);
      toast.error('Failed to ship orders', { id: toastId });
      // Rollback
      setOrders(previousOrders);
      setSelectedOrder(previousSelectedOrder);
    } finally {
      setIsShippingBatch(false);
    }
  };

  // Print shortcut only — Ctrl+P / Cmd+P is the sole way to print now that
  // the Print Labels button is gone.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!((e.ctrlKey || e.metaKey) && e.key === 'p')) return;
      e.preventDefault();
      handlePrintRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  /**
   * Persist the current form (with optional per-call overrides) to the DB.
   * Shared by the print flow AND the per-field auto-save in ShipOrderCard,
   * so both write to the same places: the `customers` row (name + address —
   * this is what the form reads back on reload), the `customer_addresses`
   * history, and the `picking_lists` row (pallets, units, weight, load,
   * carrier, customer link).
   *
   * `pickedCustomerId` is set when the user selected an existing customer
   * from the autocomplete — we link it as-is instead of running the
   * changed-name/changed-address heuristics (which would otherwise clone it
   * as a "new" customer).
   *
   * Returns true when everything saved, false otherwise (already toasted).
   */
  const persistOrderDetails = async (
    overrides: Partial<typeof formData> = {},
    pickedCustomerId?: string | null
  ): Promise<boolean> => {
    if (!selectedOrder) return false;
    const fd = { ...formData, ...overrides };

    const palletsNum = parseInt(fd.pallets, 10) || 1;
    const bikes = fd.bikes !== '' ? parseInt(fd.bikes, 10) || 0 : autoBikeCount;
    const parts = fd.parts !== '' ? parseInt(fd.parts, 10) || 0 : autoPartCount;
    const unitsNum = bikes + parts;
    const manualWeight = fd.weight.trim() === '' ? NaN : parseFloat(fd.weight);
    const weightNum =
      !Number.isNaN(manualWeight) && manualWeight >= 0 ? Math.round(manualWeight) : totalWeight;

    const previousOrders = [...orders];
    const previousSelectedOrder = selectedOrder;
    const previousCustomerId = selectedCustomerId;
    const previousCustomerParams = originalCustomerParams;

    try {
      let finalCustomerId = selectedCustomerId;

      if (pickedCustomerId !== undefined) {
        // Existing customer chosen from the autocomplete — link directly,
        // don't mutate its record with the heuristics below.
        finalCustomerId = pickedCustomerId;
      } else {
        // Logic to determine if we Update Existing, Create New, or Unlink
        if (finalCustomerId && originalCustomerParams) {
          const nameChanged = fd.customerName.trim() !== originalCustomerParams.name.trim();
          const addressChanged =
            fd.street.trim() !== (originalCustomerParams.street || '').trim() ||
            fd.city.trim() !== (originalCustomerParams.city || '').trim() ||
            fd.state.trim() !== (originalCustomerParams.state || '').trim() ||
            fd.zip.trim() !== (originalCustomerParams.zip_code || '').trim();

          if (nameChanged && addressChanged) {
            // Both changed -> Treat as NEW Customer
            finalCustomerId = null; // Will trigger create below
          }
        }

        // Create New Customer if needed
        if (!finalCustomerId && fd.customerName.trim()) {
          const { data: newCust, error: createError } = await supabase
            .from('customers')
            .insert({
              name: fd.customerName,
              street: fd.street,
              city: fd.city,
              state: fd.state,
              zip_code: fd.zip,
            })
            .select()
            .single();

          if (createError) throw createError;
          finalCustomerId = newCust.id;
        } else if (finalCustomerId) {
          // Update existing customer record (Reflecting "Moved" or "Renamed")
          const { error: updateError } = await supabase
            .from('customers')
            .update({
              name: fd.customerName,
              street: fd.street,
              city: fd.city,
              state: fd.state,
              zip_code: fd.zip,
            })
            .eq('id', finalCustomerId);

          if (updateError) console.error('Failed to update customer record:', updateError);
        }
      }

      // Auto-save address to customer_addresses (idea-012)
      if (finalCustomerId && fd.street.trim()) {
        saveCustomerAddress({
          customerId: finalCustomerId,
          street: fd.street,
          city: fd.city,
          state: fd.state,
          zip: fd.zip,
        }).catch(() => {}); // Silent — non-blocking
      }

      // Optimistic update of local orders list & selectedOrder
      setOrders((prev) =>
        prev.map((o) =>
          o.id === selectedOrder.id
            ? {
                ...o,
                pallets_qty: palletsNum,
                total_units: unitsNum,
                total_weight_lbs: weightNum || null,
                load_number: fd.loadNumber || null,
                transport_company: fd.transportCompany || null,
                customer_id: finalCustomerId,
                customer: {
                  id: finalCustomerId || '',
                  name: fd.customerName,
                  street: fd.street,
                  city: fd.city,
                  state: fd.state,
                  zip_code: fd.zip,
                },
                customer_details: {
                  id: finalCustomerId || '',
                  name: fd.customerName,
                  street: fd.street,
                  city: fd.city,
                  state: fd.state,
                  zip_code: fd.zip,
                },
              }
            : o
        )
      );

      if (selectedOrder) {
        setSelectedOrder((prev) =>
          prev
            ? {
                ...prev,
                pallets_qty: palletsNum,
                total_units: unitsNum,
                total_weight_lbs: weightNum || null,
                load_number: fd.loadNumber || null,
                transport_company: fd.transportCompany || null,
                customer_id: finalCustomerId,
                customer: {
                  id: finalCustomerId || '',
                  name: fd.customerName,
                  street: fd.street,
                  city: fd.city,
                  state: fd.state,
                  zip_code: fd.zip,
                },
                customer_details: {
                  id: finalCustomerId || '',
                  name: fd.customerName,
                  street: fd.street,
                  city: fd.city,
                  state: fd.state,
                  zip_code: fd.zip,
                },
              }
            : null
        );
      }

      // Update Picking List
      const { error: orderError } = await supabase
        .from('picking_lists')
        .update({
          pallets_qty: palletsNum,
          total_units: unitsNum,
          total_weight_lbs: weightNum || null,
          load_number: fd.loadNumber || null,
          transport_company: fd.transportCompany || null,
          customer_id: finalCustomerId, // Link to the customer (new or existing)
        })
        .eq('id', selectedOrder.id);

      if (orderError) {
        // Handle Unique Constraint Violation for Load Number
        if (orderError.code === '23505' && orderError.message.includes('load_number')) {
          toast.error(`Load Number "${fd.loadNumber}" matches another order! Must be unique.`, {
            duration: 5000,
          });
          return false;
        }
        throw orderError;
      }

      // pallets_qty is the one field combining always SUMS across the whole
      // group (bikes/parts/weight are local overrides, not resummed). Left
      // alone, saving palletsNum only on the anchor means the next combine
      // adds it back to the OTHER siblings' untouched pallets_qty — e.g. type
      // "1" for a group where the other order still has 9, and it reads back
      // as "10". Zeroing the other siblings' pallets_qty keeps the sum equal
      // to exactly what was just typed.
      const groupId = selectedOrder.group_id;
      const isGeneralGroup =
        (selectedOrder.order_group as { group_type?: string } | null)?.group_type === 'general';
      if (groupId && isGeneralGroup) {
        const { error: siblingError } = await supabase
          .from('picking_lists')
          .update({ pallets_qty: 0 })
          .eq('group_id', groupId)
          .neq('id', selectedOrder.id);
        if (siblingError) console.error('Failed to zero sibling pallets_qty:', siblingError);
      }

      // Re-baseline so subsequent per-field saves compare against what's now
      // in the DB — without this, editing name then address across two saves
      // would spawn a duplicate customer on every save.
      setSelectedCustomerId(finalCustomerId);
      setOriginalCustomerParams({
        id: finalCustomerId || '',
        name: fd.customerName,
        street: fd.street,
        city: fd.city,
        state: fd.state,
        zip_code: fd.zip,
      });

      return true;
    } catch (error) {
      console.error('Error saving order details:', error);
      // Rollback
      setOrders(previousOrders);
      setSelectedOrder(previousSelectedOrder);
      setSelectedCustomerId(previousCustomerId);
      setOriginalCustomerParams(previousCustomerParams);

      const err = error as { code?: string };
      if (err?.code === '23505') {
        toast.error(`Load Number "${fd.loadNumber}" already exists!`, { duration: 5000 });
      } else {
        toast.error('Failed to save changes');
      }
      return false;
    }
  };

  // Always-fresh ref so the auto-save closures inside ShipOrderCard (and any
  // debounced/async callers) never persist a stale snapshot of the form.
  const persistOrderDetailsRef = useRef(persistOrderDetails);
  useEffect(() => {
    persistOrderDetailsRef.current = persistOrderDetails;
  });

  const handleAutoSave = useCallback(
    async (overrides?: Partial<typeof formData>, pickedCustomerId?: string | null) => {
      setAutoSaveStatus('saving');
      try {
        const result = await persistOrderDetailsRef.current(overrides, pickedCustomerId);
        setAutoSaveStatus(result ? 'saved' : 'error');
        return result;
      } catch {
        setAutoSaveStatus('error');
        return false;
      }
    },
    []
  );

  const handlePrint = async () => {
    if (!selectedOrder || isPrinting) return;

    // Build warnings for missing data
    const palletsNum = parseInt(String(formData.pallets)) || 0;

    if (palletsNum < 0) {
      toast.error('Pallets cannot be negative');
      return;
    }

    const warnings: string[] = [];
    if (!formData.loadNumber.trim()) warnings.push('Load Number');
    if (!formData.street.trim()) warnings.push('Street Address');
    if (!formData.city.trim()) warnings.push('City');

    if (warnings.length > 0) {
      toast(`Missing: ${warnings.join(', ')}`, {
        icon: '⚠️',
        style: {
          background: '#fef3c7',
          color: '#92400e',
          border: '1px solid #f59e0b',
          fontWeight: 600,
        },
        duration: 4000,
      });
    }

    setIsPrinting(true);
    try {
      const saved = await persistOrderDetails();
      if (!saved) {
        setIsPrinting(false);
        return;
      }

      const blobUrl = await generateShipLabel({
        customerName: formData.customerName || null,
        street: formData.street || null,
        city: formData.city || null,
        state: formData.state || null,
        zip: formData.zip || null,
        orderNumber: selectedOrder?.order_number ?? null,
        pallets: palletsNum,
        bikeCount,
        partCount,
        weightLbs: effectiveWeight,
        loadNumber: formData.loadNumber || null,
      });
      // Open the label in a new tab AND trigger the print dialog immediately
      // — previously the operator had to press Ctrl+P a second time inside
      // the new tab's PDF viewer. `load` fires once Chrome's built-in
      // viewer has rendered the blob; the timeout is a safety net for
      // browsers where that event doesn't fire reliably for PDF documents.
      const printWindow = window.open(blobUrl, '_blank');
      if (printWindow) {
        const triggerPrint = () => {
          try {
            printWindow.focus();
            printWindow.print();
          } catch {
            // Some browsers refuse programmatic print on a PDF viewer tab —
            // the operator still has the tab open to print manually.
          }
        };
        printWindow.addEventListener('load', triggerPrint);
        setTimeout(triggerPrint, 800);
      }
    } catch (error) {
      console.error('Error generating PDF:', error);
      const err = error as { code?: string };
      if (err?.code === '23505') {
        toast.error(`Load Number "${formData.loadNumber}" already exists!`, { duration: 5000 });
      } else {
        toast.error('Failed to update/print order');
      }
    } finally {
      setIsPrinting(false);
    }
  };

  // The document-level Ctrl+P listener is bound once (see the effect below)
  // — but formData lands ONE RENDER LATER (its sync effect), so a closure
  // captured at bind time would keep the PREVIOUS order's customer, address
  // and load number: the printed label would carry another order's name and
  // handlePrint would even persist that stale form to the DB. The ref is
  // re-pointed at the fresh handler on every render, so the shortcut always
  // prints exactly what the screen shows.
  const handlePrintRef = useRef(handlePrint);
  useEffect(() => {
    handlePrintRef.current = handlePrint;
  });

  const handleReopenOrder = () => {
    if (!selectedOrder) return;
    setReopenReason('');
    setReopenReasonModal(true);
  };

  const handleConfirmReopen = async () => {
    if (!selectedOrder || !reopenReason) return;
    setReopenReasonModal(false);
    try {
      await loadReopenedOrder(selectedOrder.id, reopenReason);
      // Navigate to home so the drawer renders and auto-opens for reopened mode
      setViewMode('picking');
      navigate('/');
    } catch {
      // Error already toasted in loadReopenedOrder
    }
  };

  const handleRestoreOrder = () => {
    if (!selectedOrder) return;
    setRestoreReason('');
    setRestoreReasonModal(true);
  };

  const handleConfirmRestore = async () => {
    if (!selectedOrder || !restoreReason) return;
    setRestoreReasonModal(false);
    try {
      await restoreCancelledOrder(selectedOrder.id, restoreReason);
    } catch {
      // Error already toasted in restoreCancelledOrder
    }
  };

  const openOrderInDoubleCheck = useCallback(
    (order: OrderWithRelations, initialAction: 'edit' | 'photo' | null = null) => {
      setExternalActionTrigger(initialAction);
      setExternalDoubleCheckId(order.id);
      setViewMode('picking');
      navigate('/');
    },
    [navigate, setExternalActionTrigger, setExternalDoubleCheckId, setViewMode]
  );

  const handleResumeWaitingOrder = useCallback(
    async (order: OrderWithRelations) => {
      await unmarkWaiting.mutateAsync({ listId: order.id, action: 'resume' });
      openOrderInDoubleCheck(order);
    },
    [openOrderInDoubleCheck, unmarkWaiting]
  );

  const handleShipOrderClick = async (order: OrderWithRelations) => {
    if (order.status !== 'completed' && !order.is_waiting_inventory) {
      toast.error(
        `Order #${order.order_number} must be verified on the Live Board before shipping.`
      );
      return;
    }

    if (order.is_waiting_inventory) {
      const confirmWaiting = window.confirm(
        `⚠️ WARNING: Order #${order.order_number} is "Waiting for Inventory".\n\nDo you want to take it out of waiting, take a proof photo, and mark it as Shipped?`
      );
      if (confirmWaiting) {
        setPendingShipmentOrder(order);
        setTimeout(() => {
          shipCameraInputRef.current?.click();
        }, 100);
      }
    } else {
      const confirmShip = window.confirm(
        `Mark order #${order.order_number} as Shipped? This completes the order and removes it from the Live Board.`
      );
      if (confirmShip) {
        const previousOrders = [...orders];
        const previousSelectedOrder = selectedOrder;

        try {
          // Collect all IDs to update: this order + all siblings in the same group
          const idsToUpdate = order.group_id
            ? orders.filter((o) => o.group_id === order.group_id).map((o) => o.id)
            : [order.id];

          // Optimistic update
          setOrders((prev) =>
            prev.map((o) =>
              idsToUpdate.includes(o.id)
                ? { ...o, status: 'completed', is_shipped: true, is_waiting_inventory: false }
                : o
            )
          );
          if (selectedOrder && idsToUpdate.includes(selectedOrder.id)) {
            setSelectedOrder((prev) =>
              prev
                ? { ...prev, status: 'completed', is_shipped: true, is_waiting_inventory: false }
                : null
            );
          }

          const { error } = await supabase
            .from('picking_lists')
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .update({ status: 'completed', is_shipped: true, is_waiting_inventory: false } as any)
            .in('id', idsToUpdate);
          if (error) throw error;
          toast.success(`Order #${order.order_number} marked as Shipped!`);
        } catch (err) {
          console.error('Error completing order:', err);
          toast.error('Failed to complete order');
          // Rollback
          setOrders(previousOrders);
          setSelectedOrder(previousSelectedOrder);
        }
      }
    }
  };

  const handleUndoShipOrder = async (order: OrderWithRelations) => {
    const confirmUndo = window.confirm(
      `Undo Shipped status for order #${order.order_number}? This returns it to the Live Board.`
    );
    if (confirmUndo) {
      const previousOrders = [...orders];
      const previousSelectedOrder = selectedOrder;

      try {
        const idsToUpdate = order.group_id
          ? orders.filter((o) => o.group_id === order.group_id).map((o) => o.id)
          : [order.id];

        // Optimistic update
        setOrders((prev) =>
          prev.map((o) => (idsToUpdate.includes(o.id) ? { ...o, is_shipped: false } : o))
        );
        if (selectedOrder && idsToUpdate.includes(selectedOrder.id)) {
          setSelectedOrder((prev) => (prev ? { ...prev, is_shipped: false } : null));
        }

        const { error } = await supabase
          .from('picking_lists')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .update({ is_shipped: false } as any)
          .in('id', idsToUpdate);
        if (error) throw error;
        toast.success(`Order #${order.order_number} marked as not shipped!`);
      } catch (err) {
        console.error('Error undoing shipping:', err);
        toast.error('Failed to undo shipping');
        // Rollback
        setOrders(previousOrders);
        setSelectedOrder(previousSelectedOrder);
      }
    }
  };

  const handleShipCameraChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingShipmentOrder) return;
    e.target.value = ''; // reset

    const toastId = toast.loading('Compressing and uploading photo...');
    const previousOrders = [...orders];
    const previousSelectedOrder = selectedOrder;

    try {
      const { image, thumbnail } = await compressImage(file);
      const photoId = crypto.randomUUID();
      const isLocal = window.location.hostname === 'localhost';

      let photoUrl: string | null = null;
      try {
        const { data: uploadResult, error: uploadErr } = await supabase.functions.invoke(
          'upload-photo',
          {
            body: { gallery: true, photoId, image, thumbnail },
          }
        );
        if (uploadErr) throw uploadErr;
        photoUrl = (uploadResult as { url?: string } | null)?.url ?? null;
      } catch (err) {
        if (!isLocal) throw err;
        console.warn('R2 upload failed in local — using blob URL fallback');
      }

      if (!photoUrl && isLocal) {
        photoUrl = base64ToBlobUrl(image);
      }

      if (!photoUrl) throw new Error('Failed to generate photo URL');

      // Get existing photos from order, append the new photo
      const { data: current } = await supabase
        .from('picking_lists')
        .select('pallet_photos')
        .eq('id', pendingShipmentOrder.id)
        .single();

      const existing = Array.isArray(current?.pallet_photos)
        ? (current.pallet_photos as string[])
        : [];
      const updatedPhotos = [...existing, photoUrl];

      // Combined orders ship as one unit — every sibling in the group needs
      // to flip to shipped, not just the anchor the photo was attached to.
      const idsToUpdate = pendingShipmentOrder.group_id
        ? orders.filter((o) => o.group_id === pendingShipmentOrder.group_id).map((o) => o.id)
        : [pendingShipmentOrder.id];
      const siblingIds = idsToUpdate.filter((id) => id !== pendingShipmentOrder.id);

      // Optimistic update
      setOrders((prev) =>
        prev.map((o) =>
          idsToUpdate.includes(o.id)
            ? {
                ...o,
                status: 'completed',
                is_shipped: true,
                is_waiting_inventory: false,
                ...(o.id === pendingShipmentOrder.id ? { pallet_photos: updatedPhotos } : {}),
              }
            : o
        )
      );
      if (selectedOrder && idsToUpdate.includes(selectedOrder.id)) {
        setSelectedOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'completed',
                is_shipped: true,
                is_waiting_inventory: false,
                pallet_photos: updatedPhotos,
              }
            : null
        );
      }

      // Update Database — anchor gets the photo, siblings just flip status.
      const { error } = await supabase
        .from('picking_lists')
        .update({
          status: 'completed',
          is_shipped: true,
          is_waiting_inventory: false,
          pallet_photos: updatedPhotos,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
        .eq('id', pendingShipmentOrder.id);

      if (error) throw error;

      if (siblingIds.length > 0) {
        const { error: siblingError } = await supabase
          .from('picking_lists')
          .update({
            status: 'completed',
            is_shipped: true,
            is_waiting_inventory: false,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
          .in('id', siblingIds);
        if (siblingError) throw siblingError;
      }

      toast.success(`Order #${pendingShipmentOrder.order_number} marked as Shipped!`, {
        id: toastId,
      });
    } catch (err) {
      console.error('Failed to ship order with photo:', err);
      toast.error('Failed to upload photo & ship order', { id: toastId });
      // Rollback
      setOrders(previousOrders);
      setSelectedOrder(previousSelectedOrder);
    } finally {
      setPendingShipmentOrder(null);
    }
  };

  const handleContinueEditing = async () => {
    if (!selectedOrder) return;
    try {
      // Take over if not the owner
      if (selectedOrder.user_id !== user?.id) {
        await takeOverOrder(selectedOrder.id);
      }
      // Resume without calling reopen RPC again — order is already reopened
      await resumeReopenedOrder(selectedOrder.id);
      // Navigate to home in picking mode so the drawer renders and auto-opens
      setViewMode('picking');
      navigate('/');
    } catch {
      // Errors already toasted
    }
  };

  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden bg-bg-main font-body">
      {/* Header — title, carrier filter, then full-width search, like Orders */}
      <header className="shrink-0 ios-glass !border-none !shadow-none px-4 md:px-6 py-4 z-[100]">
        <div className="w-full flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-black uppercase tracking-tight text-content">Ship</h1>
            <DoubleCheckHeader />
          </div>
          <SearchInput
            variant="inline"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search orders or customer..."
            preferenceId="ship"
          />
          {availableCarriers.length > 0 && (
            <CarrierFilter
              selectedCarriers={selectedCarriers}
              includeUnassigned={includeUnassigned}
              hasUnassignedOrders={hasUnassignedOrders}
              availableCarriers={availableCarriers}
              carrierCounts={carrierCounts}
              unassignedCount={unassignedCount}
              onCarrierToggle={handleCarrierToggle}
              onUnassignedToggle={setIncludeUnassigned}
            />
          )}
        </div>
      </header>

      {/* Main scroll area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto no-scrollbar relative bg-bg-main px-4 md:px-6 pb-32"
      >
        <div className="w-full flex flex-col md:flex-row gap-4 md:gap-6 pt-4 items-start">
          {/* Selected order — desktop 60% / mobile full width */}
          <div className="w-full md:basis-[60%] md:max-w-[60%] min-w-0 flex flex-col gap-6 pb-8 order-first">
            <OrderDetailsContainer
              selectedOrderId={selectedOrder?.id ?? null}
              isLoadingDetails={isLoadingDetails || loading}
            >
              {selectedOrder && (
                <>
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsActionsMenuOpen(true)}
                      className="absolute top-0 right-0 p-1.5 rounded-full text-muted hover:text-content hover:bg-card transition-colors z-10"
                      title="More actions"
                      aria-haspopup="true"
                      aria-expanded={isActionsMenuOpen}
                    >
                      <MoreVertical size={18} />
                    </button>

                    <LivePrintPreview
                      orderNumber={selectedOrder.order_number ?? undefined}
                      watcherNote={selectedOrder.notes}
                      customerName={formData.customerName}
                      street={formData.street}
                      city={formData.city}
                      state={formData.state}
                      zip={formData.zip}
                      pallets={formData.pallets}
                      bikeCount={bikeCount}
                      partCount={partCount}
                      loadNumber={formData.loadNumber}
                      totalWeight={effectiveWeight}
                      completedAt={selectedOrder.updated_at}
                      transportCompany={formData.transportCompany}
                      notesSlot={<OrderNotesInline listId={selectedOrder.id} />}
                      screenOnly
                    />

                    <div className="-mt-2 px-1 pr-8 flex justify-between items-start">
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-subtle bg-card px-3 py-1 text-[10px] font-black uppercase tracking-wider text-muted">
                        <span className="text-content">{selectedOrder.status}</span>
                        <span>·</span>
                        <span>{formData.pallets || '0'} pallets</span>
                        <span>·</span>
                        <span>{formData.units || '0'} units</span>
                        <span>·</span>
                        <OrderAutoSaveIndicator status={autoSaveStatus} />
                      </div>
                      {selectedOrder.is_shipped ? (
                        <ShippedTruckBadge
                          key={selectedOrder.id}
                          isFedex={formData.transportCompany.trim().toUpperCase() === 'FEDEX'}
                        />
                      ) : (
                        <button
                          onClick={() => setExternalDoubleCheckId(selectedOrder.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-accent hover:bg-accent hover:text-white border border-accent/30 transition-all active:scale-95 group shadow-sm shrink-0"
                        >
                          <ShoppingCart
                            size={14}
                            className="group-hover:scale-110 transition-transform"
                          />
                          <span className="text-[10px] font-black uppercase tracking-widest mt-0.5">
                            Cart
                          </span>
                        </button>
                      )}
                    </div>

                    {isActionsMenuOpen && (
                      <OrderActionsMenu
                        orderNumber={selectedOrder.order_number}
                        fallbackId={selectedOrder.id.slice(-6).toUpperCase()}
                        status={selectedOrder.status}
                        onClose={() => setIsActionsMenuOpen(false)}
                        onMarkPickup={() => {
                          setIsActionsMenuOpen(false);
                          setFormData({ ...formData, transportCompany: 'PICK UP' });
                          void handleAutoSave({ transportCompany: 'PICK UP' });
                        }}
                        onAddNote={() => {
                          setIsActionsMenuOpen(false);
                          openModal({
                            type: 'order-notes',
                            listId: selectedOrder.id,
                            autoFocusComposer: true,
                          });
                        }}
                        onViewNotes={() => {
                          setIsActionsMenuOpen(false);
                          openModal({ type: 'order-notes', listId: selectedOrder.id });
                        }}
                      />
                    )}
                  </div>

                  <ShipOrderCard
                    formData={formData}
                    setFormData={setFormData}
                    selectedOrder={
                      selectedOrder as React.ComponentProps<typeof ShipOrderCard>['selectedOrder']
                    }
                    selectedCustomerId={selectedCustomerId}
                    user={user}
                    onRefresh={fetchOrders}
                    onAutoSave={handleAutoSave}
                    onViewOrder={() => openOrderInDoubleCheck(selectedOrder)}
                    onDelete={() => {
                      if (filteredOrders.length <= 1) {
                        setSelectedOrder(null);
                        return;
                      }
                      const currentIndex = filteredOrders.findIndex(
                        (o) => o.id === selectedOrder?.id
                      );
                      if (currentIndex < filteredOrders.length - 1) {
                        setSelectedOrder(filteredOrders[currentIndex + 1]);
                      } else {
                        setSelectedOrder(filteredOrders[currentIndex - 1]);
                      }
                    }}
                    onShowPickingSummary={() => {
                      setExternalOrderId(selectedOrder?.id ?? null);
                      navigate('/orders', {
                        state: {
                          searchOrderNumber: selectedOrder?.order_number,
                          targetId: selectedOrder?.id,
                        },
                      });
                    }}
                    onSplitOrder={() => setIsShowingSplitModal(true)}
                    onReopenOrder={handleReopenOrder}
                    onRestoreOrder={handleRestoreOrder}
                    onContinueEditing={handleContinueEditing}
                    onAddPhoto={() => shipCameraInputRef.current?.click()}
                    isAddingPhoto={false}
                    autoBikeCount={autoBikeCount}
                    autoPartCount={autoPartCount}
                    autoWeight={totalWeight}
                  />

                  {/* Parts Weight Editor (idea-028) */}
                  {partsWithWeights.length > 0 && (
                    <div className="w-full max-w-md bg-surface rounded-2xl border border-subtle overflow-hidden">
                      <div className="px-4 py-3 border-b border-subtle">
                        <h3 className="text-[10px] font-black uppercase tracking-widest text-muted">
                          Parts Weight
                        </h3>
                      </div>
                      <div className="divide-y divide-subtle">
                        {partsWithWeights.map((part) => (
                          <div
                            key={part.sku}
                            className="flex items-center justify-between px-4 py-3 gap-3"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="font-mono font-bold text-xs text-content truncate">
                                {part.sku}
                              </span>
                              <span className="text-[10px] text-muted font-bold shrink-0">
                                ×{part.qty}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <input
                                type="number"
                                value={part.weight || ''}
                                onChange={(e) => {
                                  const val = parseFloat(e.target.value);
                                  if (isNaN(val) || val < 0) return;
                                  setSkuMeta((prev) => ({
                                    ...prev,
                                    [part.sku]: { ...prev[part.sku], weight_lbs: val },
                                  }));
                                  supabase
                                    .from('sku_metadata')
                                    .upsert(
                                      { sku: part.sku, weight_lbs: val },
                                      { onConflict: 'sku' }
                                    );
                                }}
                                step="0.1"
                                min="0"
                                className="w-16 text-right bg-main border border-subtle rounded-lg px-2 py-1.5 text-xs font-mono font-bold text-content focus:outline-none focus:border-accent [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                              />
                              <span className="text-[10px] text-muted font-bold">lbs</span>
                              <span className="text-[10px] text-muted/40 font-bold">
                                ={((part.weight || 0) * part.qty).toFixed(1)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </OrderDetailsContainer>
          </div>

          {/* Vertical order list — desktop 40% / mobile full width */}
          <div className="w-full md:basis-[40%] md:max-w-[40%] md:min-w-[22rem] shrink-0 md:sticky md:top-0 order-last">
            <div className="bg-card border border-subtle rounded-3xl p-3 flex flex-col gap-2">
              <div className="px-2 pb-1 flex items-center justify-between min-h-[24px] gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted/50">
                    Orders
                  </span>
                </div>
                {shipTab === 'to_ship' && eligibleShippingOrders.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setShowShippingPreview(true)}
                      className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border border-accent/30 bg-accent/10 text-accent hover:bg-accent hover:text-white transition-all select-none"
                    >
                      Start Shipping ({eligibleShippingOrders.length})
                    </button>
                  </div>
                )}
              </div>

              {/* Tab Switcher */}
              <div className="relative grid grid-cols-2 p-0.5 bg-bg-main rounded-xl border border-subtle text-[10px] select-none overflow-visible">
                <button
                  onClick={() => {
                    setShipTab('to_ship');
                    if (selectedOrder?.is_shipped) {
                      const firstUnshipped = filteredOrders.find((o) => !o.is_shipped);
                      setSelectedOrder(firstUnshipped || null);
                    }
                  }}
                  className={`py-1 rounded-lg font-black uppercase tracking-wider text-center transition-all ${
                    shipTab === 'to_ship'
                      ? 'bg-card text-accent border border-subtle shadow-sm'
                      : 'text-muted hover:text-content'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    To Ship ({toShipCount})
                    <span className="relative inline-flex items-center">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="How To Ship is calculated"
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          setHoveredTabInfo('to_ship');
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation();
                          setHoveredTabInfo((current) => (current === 'to_ship' ? null : current));
                        }}
                        onFocus={() => setHoveredTabInfo('to_ship')}
                        onBlur={() =>
                          setHoveredTabInfo((current) => (current === 'to_ship' ? null : current))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setHoveredTabInfo('to_ship');
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-subtle bg-bg-main px-1.5 py-0.5 text-[10px] font-black text-content/80 hover:border-accent/40 hover:text-accent cursor-help"
                      >
                        <Info size={10} className="text-current" />
                      </span>
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShipTab('shipped');
                    if (!selectedOrder?.is_shipped) {
                      const todayStr = dayKey(new Date());
                      const firstShipped = orders.find(
                        (o) =>
                          o.status !== 'cancelled' &&
                          !!o.is_shipped &&
                          dayKey(new Date(o.updated_at)) === todayStr
                      );
                      setSelectedOrder(firstShipped || null);
                    }
                  }}
                  className={`py-1 rounded-lg font-black uppercase tracking-wider text-center transition-all ${
                    shipTab === 'shipped'
                      ? 'bg-card text-emerald-400 border border-subtle shadow-sm'
                      : 'text-muted hover:text-content'
                  }`}
                >
                  <span className="inline-flex items-center gap-1">
                    Shipped ({shippedCount})
                    <span className="relative inline-flex items-center">
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label="How Shipped is calculated"
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={(e) => {
                          e.stopPropagation();
                          setHoveredTabInfo('shipped');
                        }}
                        onMouseLeave={(e) => {
                          e.stopPropagation();
                          setHoveredTabInfo((current) => (current === 'shipped' ? null : current));
                        }}
                        onFocus={() => setHoveredTabInfo('shipped')}
                        onBlur={() =>
                          setHoveredTabInfo((current) => (current === 'shipped' ? null : current))
                        }
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setHoveredTabInfo('shipped');
                          }
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-subtle bg-bg-main px-1.5 py-0.5 text-[10px] font-black text-content/80 hover:border-accent/40 hover:text-accent cursor-help"
                      >
                        <Info size={10} className="text-current" />
                      </span>
                    </span>
                  </span>
                </button>
              </div>

              {hoveredTabInfo && (
                <div className="px-2 pb-1">
                  <div className="rounded-2xl border border-subtle bg-surface px-3 py-2 text-[10px] font-bold leading-relaxed text-content shadow-lg">
                    {hoveredTabInfo === 'to_ship'
                      ? `To Ship shows every order that has not been marked as shipped yet${searchQuery.trim() ? ` and matches "${searchQuery.trim()}"` : ''}.`
                      : `Shipped shows only orders marked as shipped today${searchQuery.trim() ? ` that also match "${searchQuery.trim()}"` : ''}.`}
                  </div>
                </div>
              )}

              <div className="px-2 -mt-0.5 mb-1 space-y-1">
                {shipTab === 'to_ship' ? (
                  <p className="text-[10px] font-bold text-muted">
                    {readyToShipVisibleCount} ready to ship
                  </p>
                ) : (
                  <p className="text-[10px] font-bold text-muted">Today only</p>
                )}
                {searchQuery.trim() && (
                  <p className="text-[10px] font-bold text-muted/80 truncate" title={filterSummary}>
                    search: "{searchQuery.trim()}"
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 max-h-[40vh] md:max-h-[calc(100vh-16rem)] overflow-y-auto no-scrollbar">
                {loading ? (
                  <ShipOrderListSkeleton />
                ) : ordersGroupedByDate.length > 0 ? (
                  <div className="space-y-3">
                    {ordersGroupedByDate.map((group) => (
                      <div key={group.key} className="space-y-1.5">
                        <div className="sticky top-0 z-[1] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-muted/60 bg-card/80 backdrop-blur-sm">
                          {group.label}
                        </div>
                        {group.orders.map((order) => {
                          const isSelected = selectedOrder?.id === order.id;
                          const isFedex = isFedexLane(order);
                          return (
                            <div
                              key={order.id}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl border transition-all ${
                                isSelected
                                  ? 'bg-accent/10 border-accent/30'
                                  : 'bg-surface border-transparent hover:border-subtle'
                              }`}
                            >
                              <div
                                className="min-w-0 flex-1 flex flex-col cursor-pointer"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setShipTab(order.is_shipped ? 'shipped' : 'to_ship');
                                }}
                              >
                                <span
                                  className="font-mono text-sm font-black text-content flex items-center gap-1 flex-wrap"
                                  title={
                                    order.order_number?.includes(' / ')
                                      ? order.order_number
                                          .split(' / ')
                                          .map((n) => n.trim())
                                          .sort((a, b) =>
                                            b.localeCompare(a, undefined, { numeric: true })
                                          )
                                          .map((n) => `#${n}`)
                                          .join(', ')
                                      : undefined
                                  }
                                >
                                  {order.order_number?.includes(' / ') ? (
                                    <span>
                                      <span className="text-muted/60">#</span>
                                      {order.order_number
                                        .split(' / ')
                                        .map((n) => n.trim())
                                        .sort((a, b) =>
                                          b.localeCompare(a, undefined, { numeric: true })
                                        )
                                        .map((num, i, arr) => (
                                          <Fragment key={`${num}-${i}`}>
                                            {i > 0 && <span className="text-muted/50"> / </span>}
                                            <span
                                              style={{ color: orderColorFor(num.trim(), arr).hex }}
                                            >
                                              {num.trim().slice(-3)}
                                            </span>
                                          </Fragment>
                                        ))}
                                    </span>
                                  ) : (
                                    <>#{order.order_number}</>
                                  )}
                                </span>

                                <span className="text-[11px] text-muted truncate">
                                  {order.customer?.name || '—'}
                                </span>
                                <div className="flex flex-col gap-0.5 mt-1 text-[9px] text-muted">
                                  {!order.is_shipped && (
                                    <span>
                                      Created:{' '}
                                      {new Date(order.created_at).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                      })}
                                    </span>
                                  )}
                                </div>
                                <OrderProgressBar
                                  status={order.status}
                                  isShipped={order.is_shipped ?? false}
                                  items={order.items}
                                  verifiedKeys={order.verified_item_keys ?? null}
                                  totalUnits={order.total_units || 0}
                                  className="mt-2 w-full"
                                />
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <TransportLogo
                                  company={order.transport_company || (isFedex ? 'FEDEX' : null)}
                                  height={14}
                                  className="select-none shrink-0"
                                />
                                {shipTab === 'shipped' ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUndoShipOrder(order);
                                    }}
                                    className="p-1 rounded bg-amber-500/15 border border-amber-500/30 text-amber-500 hover:bg-amber-500 hover:text-white transition-all active:scale-95 flex items-center justify-center"
                                    title="Undo Shipped"
                                  >
                                    <RotateCcw size={14} />
                                  </button>
                                ) : (
                                  <>
                                    {order.status === 'completed' ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleShipOrderClick(order);
                                        }}
                                        className="px-2 py-1 rounded-lg bg-accent/15 border border-accent/30 text-accent hover:bg-accent hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                                        title="Mark as Shipped"
                                      >
                                        <Truck size={14} />
                                      </button>
                                    ) : order.status === 'reopened' ? (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          if (order.id !== selectedOrder?.id) {
                                            setSelectedOrder(order);
                                          }
                                          try {
                                            if (order.user_id !== user?.id) {
                                              await takeOverOrder(order.id);
                                            }
                                            await resumeReopenedOrder(order.id);
                                            setViewMode('picking');
                                            navigate('/');
                                          } catch {
                                            // Errors are handled by the shared actions.
                                          }
                                        }}
                                        className="px-2 py-1 rounded-lg bg-orange-500/10 border border-orange-500/30 text-orange-400 hover:bg-orange-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                                        title={
                                          order.user_id !== user?.id
                                            ? 'Take Over Order'
                                            : 'Continue Editing'
                                        }
                                      >
                                        {order.user_id !== user?.id
                                          ? 'Take Over Order'
                                          : 'Continue Editing'}
                                      </button>
                                    ) : order.is_waiting_inventory ? (
                                      <button
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          try {
                                            await handleResumeWaitingOrder(order);
                                          } catch {
                                            // Error toast comes from the waiting mutation.
                                          }
                                        }}
                                        className="px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                                        title="Resume Order"
                                      >
                                        Resume Order
                                      </button>
                                    ) : ['ready_to_double_check', 'double_checking'].includes(
                                        order.status
                                      ) ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openOrderInDoubleCheck(order);
                                        }}
                                        className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                                        title="Double Check"
                                      >
                                        Double Check
                                      </button>
                                    ) : (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openOrderInDoubleCheck(order, 'edit');
                                        }}
                                        className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-400 hover:bg-sky-500 hover:text-white transition-all active:scale-95 flex items-center justify-center text-[9px] font-black uppercase tracking-wider"
                                        title="Edit Order"
                                      >
                                        Edit Order
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ) : shipTab === 'shipped' ? (
                  <div className="flex flex-col items-center justify-center text-center py-6 px-3 gap-3">
                    <p className="text-xs text-muted">No orders were marked as shipped today.</p>
                    <button
                      onClick={() => navigate('/orders')}
                      className="px-3 py-2 rounded-xl border border-subtle bg-surface text-content text-[10px] font-black uppercase tracking-widest hover:border-accent/40 hover:text-accent transition-all active:scale-95"
                    >
                      View all orders
                    </button>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-4 py-8">
                    <p className="font-heading text-xl font-bold opacity-30">No orders found</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Global Actions — Floating at bottom right */}
      <div className="absolute bottom-10 right-6 md:right-10 flex flex-col gap-3 z-[110]">
        {/* Resend Ship-Out SMS — only renders when the feature is enabled in Settings */}
        {isShipSmsEnabled && selectedOrder && (
          <button
            onClick={() => void triggerShipOutSms(selectedOrder.id)}
            title="Resend Ship-Out SMS"
            aria-label="Resend Ship-Out SMS"
            className="w-14 h-14 flex items-center justify-center rounded-full bg-surface border-2 border-subtle text-emerald-400 hover:text-emerald-300 transition-all duration-300 shadow-xl active:scale-95"
          >
            <MessageSquare size={24} />
          </button>
        )}
      </div>

      {/* Picking Summary Modal */}
      {isShowingPickingSummary && selectedOrder && (
        <PickingSummaryModal
          listId={selectedOrder.id}
          orderNumber={selectedOrder.order_number || ''}
          customerName={selectedOrder.customer?.name ?? undefined}
          items={selectedOrder.items || []}
          completedAt={selectedOrder.updated_at}
          pickedBy={selectedOrder.user?.full_name ?? undefined}
          checkedBy={selectedOrder.checker?.full_name ?? undefined}
          palletPhotos={selectedOrder.pallet_photos ?? undefined}
          status={selectedOrder.status ?? undefined}
          onClose={() => setIsShowingPickingSummary(false)}
        />
      )}

      {/* Split Order Modal */}
      {isShowingSplitModal && selectedOrder && (
        <SplitOrderModal
          order={selectedOrder as React.ComponentProps<typeof SplitOrderModal>['order']}
          onClose={() => setIsShowingSplitModal(false)}
          onSplitComplete={() => {
            setIsShowingSplitModal(false);
            setSelectedOrder(null);
            fetchOrders();
          }}
        />
      )}

      {/* Restore reason modal */}
      {restoreReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-main/60 backdrop-blur-md p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-black text-orange-400 uppercase tracking-widest mb-4">
              Why are you restoring this order?
            </h3>
            <ReasonPicker
              actionType="restore"
              selectedReason={restoreReason}
              onReasonChange={setRestoreReason}
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setRestoreReasonModal(false)}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={!restoreReason}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-orange-500 text-white border border-orange-500 transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reopen reason modal */}
      {reopenReasonModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-main/60 backdrop-blur-md p-4">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <h3 className="text-sm font-black text-orange-400 uppercase tracking-widest mb-4">
              Why are you reopening this order?
            </h3>
            <ReasonPicker
              actionType="reopen"
              selectedReason={reopenReason}
              onReasonChange={setReopenReason}
            />
            <div className="flex items-center gap-2 mt-4">
              <button
                onClick={() => setReopenReasonModal(false)}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-surface text-muted border border-subtle transition-all hover:bg-surface/80 active:scale-[0.97]"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReopen}
                disabled={!reopenReason}
                className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-orange-500 text-white border border-orange-500 transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-50"
              >
                Reopen
              </button>
            </div>
          </div>
        </div>
      )}

      <input
        ref={shipCameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleShipCameraChange}
        className="hidden"
      />

      {showShippingPreview && (
        <ShippingFlowPreviewModal
          orders={shippingPreviewOrders}
          onClose={() => setShowShippingPreview(false)}
          onConfirm={handleBatchShip}
          isSubmitting={isShippingBatch}
        />
      )}
    </div>
  );
};
