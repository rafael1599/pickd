import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { useAuth } from '../../context/AuthContext.tsx';

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
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart';
import { ShipOrderCard } from '../../components/orders/ShipOrderCard.tsx';
import { ShippedTruckBadge } from '../../components/orders/ShippedTruckBadge.tsx';
import { useShipOutSms } from './hooks/useShipOutSms';
import { withSupabaseRetry } from '../../lib/supabaseRetry';
import type { PickingListItem, CombineMeta } from '../../schemas/picking.schema';
import { saveCustomerAddress } from '../../lib/customerAddresses';
import { mergeSiblingPalletPhotos } from '../../utils/mergeSiblingPalletPhotos';
import { skuDefaultsFor } from '../../utils/skuDefaults';
import { fetchGroupSiblings } from './utils/fetchGroupSiblings';
import { useCombinedOrderFilter } from '../../hooks/useCombinedOrderFilter';
import { ActiveFilterPill } from '../../components/orders/CombinedOrderNumbers';

import { ShipHeader } from './ship/components/header/ShipHeader';
import { PartsWeightEditor } from './ship/components/details/PartsWeightEditor';
import { OrderItemsTable } from './ship/components/details/OrderItemsTable';
import { CombineSuggestionBanner } from './ship/components/details/CombineSuggestionBanner';
import { ShipFeedCard } from './ship/components/feed/ShipFeedCard';
import { FeedHeaderToolbar } from './ship/components/feed/FeedHeaderToolbar';
import { ShipModalsManager } from './ship/components/modals/ShipModalsManager';
import { useShipOrdersData } from './ship/hooks/useShipOrdersData';
import { compressImage, base64ToBlobUrl } from '../../services/photoUpload.service';
import { useUnmarkWaiting } from './hooks/useWaitingOrders';
import { CarrierFilter } from './components/board/CarrierFilter';
import { OrderNotesInline } from './components/OrderNotesInline';
import { OrderActionsMenu } from './components/OrderActionsMenu';
import { useModal } from '../../context/ModalContext';
import {
  isFedexOrder as isFedexOrderShared,
  isDeliberateCombineGroupType,
  getCarrierLabel as getCarrierLabelShared,
} from '../../utils/shippingClassification';
import { useOrderGroups } from './hooks/useOrderGroups';

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
  const nyTimeZone = 'America/New_York';
  const now = new Date();
  const todayKey = dayKey(now);
  const targetKey = dayKey(date);

  if (targetKey === todayKey) return 'Today';

  const todayDate = new Date(todayKey + 'T00:00:00');
  const targetDate = new Date(targetKey + 'T00:00:00');
  const diffDays = Math.round((todayDate.getTime() - targetDate.getTime()) / 86_400_000);

  if (diffDays === 1) return 'Yesterday';

  const opts: Intl.DateTimeFormatOptions = {
    timeZone: nyTimeZone,
    month: 'short',
    day: 'numeric',
  };

  const nowYear = new Intl.DateTimeFormat('en-US', {
    timeZone: nyTimeZone,
    year: 'numeric',
  }).format(now);
  const targetYear = new Intl.DateTimeFormat('en-US', {
    timeZone: nyTimeZone,
    year: 'numeric',
  }).format(date);

  if (targetYear !== nowYear) opts.year = 'numeric';

  return date.toLocaleDateString('en-US', opts);
}

import { isBikeSku } from '../../utils/bikeDetection';

/**
 * Bike vs part classification for an item: `sku_metadata.is_bike === true` is the
 * canonical source of truth in DB.
 */
function isLikelyBike(sku: string, meta?: { is_bike: boolean }): boolean {
  if (meta && typeof meta.is_bike === 'boolean') return meta.is_bike;
  return isBikeSku(sku, meta);
}

/**
 * True when an order ships via FedEx — delegates to the canonical classifier
 * shared with Orders and the Live Board, so the same order can't read FedEx
 * on one screen and Regular/unassigned on another (previously this only
 * checked group_type/transport_company, missing the shipping_type + item
 * auto-classify signals the Live Board already used to decide FedEx).
 */
function isFedexLane(order: OrderWithRelations): boolean {
  return isFedexOrderShared(order);
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
  // Tag each sibling's items with which order they came from (unless a
  // finer-grained tag already exists, e.g. this sibling is itself a
  // DB-merge) — this is what lets OrderItemsTable filter by sub-order, the
  // same way DoubleCheckView's pallets memo already does.
  const combinedItems = sorted.flatMap((s) =>
    (Array.isArray(s.items) ? s.items : []).map((item) => {
      const tagged = item as PickingListItem & { source_order?: string };
      return tagged.source_order
        ? tagged
        : { ...tagged, source_order: s.order_number ?? 'unknown' };
    })
  );
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
  // Raw group_id-merged rows always have combine_meta null — reconstruct
  // source_orders from the siblings on every call instead of spreading the
  // anchor's (null) combine_meta, otherwise ShipOrderCard's "Combined Order
  // Info" panel silently renders empty for every group_id merge.
  const sourceOrders = sorted.map((s) => ({
    order_number: s.order_number ?? '',
    added_at: s.created_at,
    item_count: (Array.isArray(s.items) ? s.items : []).reduce(
      (sum, i) => sum + (i.pickingQty || 0),
      0
    ),
    pallets_qty: s.pallets_qty ?? 0,
  }));
  const combinedPalletPhotos = mergeSiblingPalletPhotos(sorted).photos;

  return {
    ...anchor,
    order_number: combinedOrderNumber || anchor.order_number,
    created_at: newestCreatedAt,
    updated_at: newestUpdatedAt,
    pallets_qty: combinedPalletsQty,
    total_units: combinedTotalUnits,
    items: combinedItems,
    pallet_photos: combinedPalletPhotos,
    verified_item_keys: combinedVerifiedKeys,
    is_shipped: allShipped,
    combined_member_ids: sorted.map((s) => s.id),
    combine_meta: { is_combined: true, source_orders: sourceOrders } as CombineMeta,
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
  notes,
  pallet_photos,
  customer:customers(id, name, street, city, state, zip_code),
  user:profiles!user_id(full_name),
  checker:profiles!checked_by(full_name),
  presence:user_presence!user_id(last_seen_at),
  order_group:order_groups(group_type)
`;

/** Thin wrapper over the shared carrier-label classifier (shared with
 *  Orders and the Live Board), typed to this screen's OrderWithRelations. */
function getCarrierLabel(order: OrderWithRelations): string | null {
  return getCarrierLabelShared(order.transport_company, isFedexLane(order));
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
  /** Set only on a client-merged pseudo-order (general group or same-customer
   *  FedEx cluster) — every raw member id, used to expand ship actions and
   *  to re-resolve the merged view on realtime updates. */
  combined_member_ids?: string[];
}

export const ShipScreen = () => {
  const { user } = useAuth();
  const { open: openModal } = useModal();
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const { createGroup, addToGroup, removeFromGroup, resolveMixedShippingType } = useOrderGroups();
  const [pendingShippingResolutionGroupId, setPendingShippingResolutionGroupId] = useState<
    string | null
  >(null);
  const [dismissedCombineSuggestionIds, setDismissedCombineSuggestionIds] = useState<Set<string>>(
    new Set()
  );
  const [isAcceptingCombineSuggestion, setIsAcceptingCombineSuggestion] = useState(false);
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
  const {
    orders,
    setOrders,
    loading,
    searchQuery,
    debouncedSearchQuery,
    setSearchQuery,
    pendingSelectedCarriers,
    pendingIncludeUnassigned,
    setPendingIncludeUnassigned,
    pendingShowWaiting,
    setPendingShowWaiting,
    shippedSelectedCarriers,
    shippedIncludeUnassigned,
    setShippedIncludeUnassigned,
    includeShipped,
    setIncludeShipped,
    handlePendingCarrierToggle,
    handleShippedCarrierToggle,
    matchesPendingCarrierFilter,
    matchesShippedCarrierFilter,
    fetchOrders,
  } = useShipOrdersData();

  const waitingCount = useMemo(() => {
    return orders.filter(
      (o) => !o.is_shipped && o.status !== 'cancelled' && !!o.is_waiting_inventory
    ).length;
  }, [orders]);

  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>('idle');
  const [selectedOrder, setSelectedOrder] = useState<OrderWithRelations | null>(null);
  const {
    combinedNumbers: selectedOrderCombinedNumbers,
    activeOrderFilter: selectedOrderFilter,
    toggleOrderFilter: toggleSelectedOrderFilter,
    clearOrderFilter: clearSelectedOrderFilter,
    presetFilterForNextOrder,
  } = useCombinedOrderFilter(selectedOrder?.order_number);

  // A number click on a feed-list row needs to both select that order AND
  // filter to that sub-order — presetFilterForNextOrder arms the filter for
  // the order_number about to become selected (see its own doc comment for
  // why this can't just be onSelect + toggleOrderFilter in the same click).
  const handleSelectSubOrder = useCallback(
    (order: OrderWithRelations, subOrderNumber: string) => {
      if (selectedOrder?.id === order.id) {
        toggleSelectedOrderFilter(subOrderNumber);
      } else {
        if (order.order_number) {
          presetFilterForNextOrder(order.order_number, subOrderNumber);
        }
        setSelectedOrder(order);
      }
    },
    [selectedOrder?.id, toggleSelectedOrderFilter, presetFilterForNextOrder]
  );
  const navigate = useNavigate();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [reopenReasonModal, setReopenReasonModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [restoreReasonModal, setRestoreReasonModal] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [pendingShipmentOrder, setPendingShipmentOrder] = useState<OrderWithRelations | null>(null);
  const shipCameraInputRef = useRef<HTMLInputElement>(null);
  const [showShippingPreview, setShowShippingPreview] = useState(false);
  const [isShippingBatch, setIsShippingBatch] = useState(false);

  useEffect(() => {
    if (loading || orders.length === 0) return;
    const hasUnshipped = orders.some((o) => o.status !== 'cancelled' && !o.is_shipped);
    if (!hasUnshipped) {
      setIncludeShipped(true);
    }
  }, [orders, loading]);
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

  // Auto-assign default weight to SKUs missing weight in sku_metadata.
  // Bikes → 45 lbs, Parts → 1 lb, from the shared table that mirrors the
  // sku_metadata trigger. This used to say 0.1 for parts while two other call
  // sites said 0 and 45, so the same pedal weighed three different things
  // depending on which screen touched it first.
  useEffect(() => {
    if (!weightsReady || itemsMissingWeight.length === 0) return;
    const skusToFix = itemsMissingWeight.map((i: PickingListItem) => i.sku);

    Promise.all(
      skusToFix.map((sku: string) => {
        const defaultWeight = skuDefaultsFor(skuMeta[sku]?.is_bike).weight_lbs;
        return supabase
          .from('sku_metadata')
          .upsert({ sku, weight_lbs: defaultWeight }, { onConflict: 'sku' });
      })
    ).then(() => {
      setSkuMeta((prev) => {
        const updated = { ...prev };
        skusToFix.forEach((sku: string) => {
          updated[sku] = {
            ...updated[sku],
            weight_lbs: skuDefaultsFor(updated[sku]?.is_bike).weight_lbs,
          };
        });
        return updated;
      });
    });
  }, [weightsReady, itemsMissingWeight, skuMeta]);

  // FedEx orders don't use pallets — skip pallet weight. Previously only
  // checked group_type, missing orders classified FedEx via shipping_type
  // or transport_company alone.
  const isFedexOrder = !!selectedOrder && isFedexLane(selectedOrder);

  // Calculate total weight live from the Pallets/Bikes/Parts fields shown in
  // this view — not just the raw item list — so overriding Bikes or Parts
  // actually moves the weight instead of silently ignoring the edit. Average
  // weight-per-unit comes from the real items + sku_metadata (bikes and
  // parts weigh very differently), then gets multiplied by whatever count is
  // currently shown (edited or auto), same fallback order as autoBikeCount/
  // autoPartCount and the same 45/0.1 lbs defaults used to backfill missing
  // sku_metadata weights.
  // When filtered to one sub-order, every stat below is computed purely
  // from that sub-order's own items — the saved formData.bikes/parts/weight
  // fields describe the WHOLE combined order and can't be sliced, so while a
  // filter is active they're bypassed entirely in favor of live numbers.
  const filteredItems = useMemo(() => {
    const items = selectedOrder?.items;
    if (!Array.isArray(items)) return [];
    if (!selectedOrderFilter) return items;
    return items.filter(
      (item) =>
        (item as PickingListItem & { source_order?: string }).source_order === selectedOrderFilter
    );
  }, [selectedOrder?.items, selectedOrderFilter]);

  const totalWeight = useMemo(() => {
    const items = filteredItems;
    const palletCount = selectedOrderFilter
      ? (selectedOrder?.combine_meta?.source_orders?.find(
          (s) => s.order_number === selectedOrderFilter
        )?.pallets_qty ?? 0)
      : parseInt(formData.pallets, 10) || 0;
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

    const bikesCount =
      !selectedOrderFilter && formData.bikes !== '' ? parseInt(formData.bikes, 10) || 0 : bikeUnits;
    const partsCount =
      !selectedOrderFilter && formData.parts !== '' ? parseInt(formData.parts, 10) || 0 : partUnits;
    const productWeight = bikesCount * avgBikeWeight + partsCount * avgPartWeight;

    return Math.round(productWeight + palletWeight);
  }, [
    filteredItems,
    skuMeta,
    formData.pallets,
    formData.bikes,
    formData.parts,
    isFedexOrder,
    selectedOrderFilter,
    selectedOrder?.combine_meta?.source_orders,
  ]);

  // Manual override: if the user typed a value in the Weight field, use it.
  // Otherwise fall back to the auto-calculated total. Used by preview, PDF,
  // and DB persistence so all three stay in sync. Bypassed while filtered —
  // same reasoning as above.
  const effectiveWeight = useMemo(() => {
    if (selectedOrderFilter) return totalWeight;
    const trimmed = formData.weight.trim();
    if (trimmed === '') return totalWeight;
    const manual = parseFloat(trimmed);
    if (Number.isNaN(manual) || manual < 0) return totalWeight;
    return Math.round(manual);
  }, [formData.weight, totalWeight, selectedOrderFilter]);

  // Split item counts: bikes vs parts (auto-calculated, from filteredItems
  // so this already reflects the active sub-order filter when one is set)
  const { autoBikeCount, autoPartCount } = useMemo(() => {
    let bikes = 0,
      parts = 0;
    filteredItems.forEach((item: PickingListItem) => {
      const qty = item.pickingQty || 0;
      if (isLikelyBike(item.sku, skuMeta[item.sku])) bikes += qty;
      else parts += qty;
    });
    return { autoBikeCount: bikes, autoPartCount: parts };
  }, [filteredItems, skuMeta]);

  // Effective counts: manual override takes priority over auto-calculated,
  // but only when unfiltered — see filteredItems comment above.
  const bikeCount =
    !selectedOrderFilter && formData.bikes !== ''
      ? parseInt(formData.bikes, 10) || 0
      : autoBikeCount;
  const partCount =
    !selectedOrderFilter && formData.parts !== ''
      ? parseInt(formData.parts, 10) || 0
      : autoPartCount;

  // Pill display (pallets/units next to the status badge) — same
  // filtered-vs-whole-order split as the stats above.
  const pillPallets = selectedOrderFilter
    ? (selectedOrder?.combine_meta?.source_orders?.find(
        (s) => s.order_number === selectedOrderFilter
      )?.pallets_qty ?? 0)
    : parseInt(formData.pallets, 10) || 0;
  const pillUnits = selectedOrderFilter
    ? (selectedOrder?.combine_meta?.source_orders?.find(
        (s) => s.order_number === selectedOrderFilter
      )?.item_count ?? 0)
    : parseInt(formData.units, 10) || 0;

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

  // Fetches every non-cancelled sibling of a "general" combined group fresh
  // from the DB — used so the realtime handler can resolve straight to the
  // properly combined pseudo-order instead of setting selectedOrder to a
  // lone raw sibling and waiting a render cycle for the self-heal effect to
  // catch it. excludeStatuses defaults to ['cancelled'] (this screen's own
  // baseline, matching fetchOrders) — previously this had NO status filter
  // at all, so a cancelled sibling could show up here but nowhere else,
  // making the merged view's membership depend on realtime timing.
  const fetchOrderGroupSiblings = useCallback(async (groupId: string) => {
    try {
      const data = await fetchGroupSiblings<{ id: string } & Record<string, unknown>>(groupId, {
        columns: `
          *,
          customer:customers(id, name, street, city, state, zip_code),
          user:profiles!user_id(full_name),
          checker:profiles!checked_by(full_name),
          presence:user_presence!user_id(last_seen_at),
          order_group:order_groups(group_type)
        `,
        label: 'OrdersScreen.fetchGroupSiblings',
      });
      return data.map((d) => ({
        ...d,
        customer_details: (d as { customer?: unknown }).customer || {},
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
                      isDeliberateCombineGroupType(details.order_group?.group_type);
                    if (isGeneralGroup) {
                      // Resolve straight to the combined pseudo-order — don't
                      // set the raw lone sibling even momentarily, that's
                      // exactly what let one field's save flash the others
                      // back to a single sibling's numbers.
                      const siblings = await fetchOrderGroupSiblings(details.group_id as string);
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
  }, [fetchOrders, fetchSingleLightweightOrder, fetchOrderDetails, fetchOrderGroupSiblings]);

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
        // No explicit carrier yet but already classified FedEx (auto by
        // weight/bike-count, or a 'fedex' group) — default the selector to
        // FEDEX instead of making the user pick what the system already knows.
        transportCompany:
          selectedOrder.transport_company || (isFedexLane(selectedOrder) ? 'FEDEX' : ''),
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

  // Collapsed pending orders (excluding cancelled and shipped orders, with deliberate groups combined into single cards)
  const collapsedPendingOrders = useMemo(() => {
    const notCancelledOrShipped = orders.filter((o) => o.status !== 'cancelled' && !o.is_shipped);

    const byGroup = new Map<string, typeof notCancelledOrShipped>();
    const ungrouped: typeof notCancelledOrShipped = [];
    for (const o of notCancelledOrShipped) {
      const isGeneralGroup = o.group_id && isDeliberateCombineGroupType(o.order_group?.group_type);
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
    return collapsed;
  }, [orders]);

  const pendingCarrierStats = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of collapsedPendingOrders) {
      // Waiting orders are NEVER counted as unassigned under any circumstances
      if (o.is_waiting_inventory) {
        if (pendingShowWaiting) {
          const carrier = getCarrierLabel(o);
          if (carrier) {
            counts.set(carrier, (counts.get(carrier) || 0) + 1);
          }
        }
        continue;
      }
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
  }, [collapsedPendingOrders, pendingShowWaiting]);

  const shippedCarrierStats = useMemo(() => {
    const todayStr = dayKey(new Date());
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of orders) {
      if (o.status === 'cancelled' || !o.is_shipped) continue;
      if (dayKey(new Date(o.updated_at)) !== todayStr) continue;
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

  // Shared pipeline behind both columns — To Ship and Shipped are always
  // built independently (never one replacing the other) so the split view
  // can show both at once without either one hiding orders from the other.
  const buildOrdersForTab = useCallback(
    (tab: 'to_ship' | 'shipped') => {
      const todayStr = dayKey(new Date());
      const query = debouncedSearchQuery.toLowerCase().trim();

      let targetList: OrderWithRelations[];
      if (tab === 'to_ship') {
        targetList = collapsedPendingOrders;
      } else {
        const shippedOrders = orders.filter((o) => o.status !== 'cancelled' && !!o.is_shipped);
        const byGroup = new Map<string, typeof shippedOrders>();
        const ungrouped: typeof shippedOrders = [];
        for (const o of shippedOrders) {
          const isGeneralGroup =
            o.group_id && isDeliberateCombineGroupType(o.order_group?.group_type);
          if (isGeneralGroup) {
            const arr = byGroup.get(o.group_id!) ?? [];
            arr.push(o);
            byGroup.set(o.group_id!, arr);
          } else {
            ungrouped.push(o);
          }
        }
        targetList = [...ungrouped];
        for (const siblings of byGroup.values()) {
          targetList.push(combineGeneralGroupSiblings(siblings));
        }
      }

      const byCarrier = targetList.filter((o) => {
        if (query) {
          // While searching, route by actual shipped status only — drop the
          // "shipped TODAY" date window so an order shipped last week is
          // still findable in the Shipped column instead of being filtered
          // out before the search query is even consulted.
          return tab === 'shipped' ? !!o.is_shipped : !o.is_shipped;
        }

        const shippedToday = !!o.is_shipped && dayKey(new Date(o.updated_at)) === todayStr;
        const matchTab = tab === 'shipped' ? shippedToday : !o.is_shipped;
        if (!matchTab) return false;

        return tab === 'shipped' ? matchesShippedCarrierFilter(o) : matchesPendingCarrierFilter(o);
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
    },
    [
      orders,
      collapsedPendingOrders,
      debouncedSearchQuery,
      matchesPendingCarrierFilter,
      matchesShippedCarrierFilter,
    ]
  );

  const filteredOrders = useMemo(() => buildOrdersForTab('to_ship'), [buildOrdersForTab]);
  const shippedFilteredOrders = useMemo(() => buildOrdersForTab('shipped'), [buildOrdersForTab]);

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
    if (!isDeliberateCombineGroupType(selectedOrder.order_group?.group_type)) return;
    const combined = filteredOrders.find((o) => o.group_id === selectedOrder.group_id);
    if (combined) setSelectedOrder(combined);
  }, [selectedOrder, filteredOrders]);

  // Combining is manual/suggested, never automatic: when the open order's
  // customer has another completed, unshipped order that isn't already in
  // the same group, offer to combine them instead of silently merging
  // anything — same-customer FedEx orders included (previously those were
  // auto-merged for display only; now every combine goes through the real
  // group flow so it stays user-reversible via Ungroup).
  const combineSuggestionCandidate = useMemo(() => {
    if (!selectedOrder || selectedOrder.is_shipped || !selectedOrder.customer_id) return null;
    if (dismissedCombineSuggestionIds.has(selectedOrder.id)) return null;

    const normalizeAddr = (addr?: string | null) =>
      (addr || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const selStreet = normalizeAddr(selectedOrder.customer?.street);

    // Same-customer + same-address alone isn't enough — a repeat customer's
    // order from weeks ago being unshipped (stuck waiting, forgotten, etc.)
    // isn't "the other half of a split shipment" just because it hasn't
    // shipped yet. Cutoff is 3 days: within it, still suggest; past it,
    // don't — staff can always combine manually regardless, this only
    // gates the automatic suggestion. Wider than the watchdog's own 24h
    // same-customer auto-combine window on purpose — this path is always
    // human-reviewed (a person sees the banner and chooses), the watchdog's
    // isn't, so it can afford to stay eligible a bit longer.
    const COMBINE_SUGGESTION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
    const isRecent = (createdAt: string) =>
      Date.now() - new Date(createdAt).getTime() <= COMBINE_SUGGESTION_WINDOW_MS;

    return (
      orders.find((o) => {
        if (o.customer_id !== selectedOrder.customer_id) return false;
        if (o.id === selectedOrder.id) return false;
        if (o.is_shipped) return false;
        if (selectedOrder.group_id && o.group_id === selectedOrder.group_id) return false;
        if (!isRecent(o.created_at)) return false;

        // Do not suggest combining if they have different street addresses
        const oStreet = normalizeAddr(o.customer?.street);
        if (selStreet && oStreet && selStreet !== oStreet) {
          return false;
        }
        return true;
      }) ?? null
    );
  }, [selectedOrder, orders, dismissedCombineSuggestionIds]);

  const handleAcceptCombineSuggestion = useCallback(async () => {
    if (!selectedOrder || !combineSuggestionCandidate) return;
    setIsAcceptingCombineSuggestion(true);
    try {
      // Only join an EXISTING group if it's already a deliberate combine
      // (general/pickup) — a 'fedex' group_id is a shared operational bucket
      // (often holding unrelated customers' orders), so joining it here
      // would pull in whoever else is in that bucket and
      // resolveMixedShippingType would then rewrite THEIR shipping_type too.
      // Always start a fresh, isolated group for exactly this pair otherwise.
      let groupId: string | null;
      if (
        selectedOrder.group_id &&
        isDeliberateCombineGroupType(selectedOrder.order_group?.group_type)
      ) {
        await addToGroup(selectedOrder.group_id, combineSuggestionCandidate.id);
        groupId = selectedOrder.group_id;
      } else if (
        combineSuggestionCandidate.group_id &&
        isDeliberateCombineGroupType(combineSuggestionCandidate.order_group?.group_type)
      ) {
        await addToGroup(combineSuggestionCandidate.group_id, selectedOrder.id);
        groupId = combineSuggestionCandidate.group_id;
      } else {
        groupId = await createGroup('general', [selectedOrder.id, combineSuggestionCandidate.id]);
      }
      if (groupId) {
        const resolution = await resolveMixedShippingType(groupId);
        if (resolution === 'needs-prompt') setPendingShippingResolutionGroupId(groupId);
        toast.success(`Combined with #${combineSuggestionCandidate.order_number}`);
        fetchOrders();
      }
    } finally {
      setIsAcceptingCombineSuggestion(false);
    }
  }, [
    selectedOrder,
    combineSuggestionCandidate,
    addToGroup,
    createGroup,
    resolveMixedShippingType,
    fetchOrders,
  ]);

  // Members of the selected order's group, for the kebab menu's Ungroup
  // picker — combining is always reversible manually, whether it was
  // created via a suggestion or the older merge flows.
  const selectedOrderGroupMembers = useMemo(() => {
    if (!selectedOrder?.group_id) return [];
    return orders
      .filter((o) => o.group_id === selectedOrder.group_id)
      .map((o) => ({ id: o.id, order_number: o.order_number }));
  }, [selectedOrder, orders]);

  const handleUngroupOrder = useCallback(
    async (orderId: string, groupId: string) => {
      const ok = await removeFromGroup(orderId, groupId);
      if (ok) fetchOrders();
    },
    [removeFromGroup, fetchOrders]
  );

  // Handle external selections (e.g. from DoubleCheckHeader or VerificationBoard)
  useEffect(() => {
    if (!externalOrderId) return;

    const targetId = externalOrderId;

    const rawOrder = orders.find((o) => o.id === targetId || o.order_number === targetId);
    // Deep-links (Edit Label, DoubleCheckHeader, VerificationBoard) pass a
    // single sibling's raw id — resolve to whichever merged card in
    // filteredOrders or shippedFilteredOrders lists it as a member (general combine OR same-customer
    // FedEx cluster), so it works regardless of which sibling was clicked.
    const order =
      filteredOrders.find(
        (o) =>
          o.id === targetId ||
          o.order_number === targetId ||
          o.combined_member_ids?.includes(targetId as string)
      ) ??
      shippedFilteredOrders.find(
        (o) =>
          o.id === targetId ||
          o.order_number === targetId ||
          o.combined_member_ids?.includes(targetId as string)
      ) ??
      rawOrder;

    if (order) {
      setSelectedOrder(order);
      setExternalOrderId(null);
    } else if (hasLoadedOnceRef.current) {
      fetchOrderDetails(targetId as string).then((fetched) => {
        if (fetched) {
          setOrders((prev) => {
            if (prev.some((o) => o.id === fetched.id)) return prev;
            return [fetched, ...prev];
          });
          setSelectedOrder(fetched);
        }
        setExternalOrderId(null);
      });
    }
  }, [
    externalOrderId,
    orders,
    filteredOrders,
    shippedFilteredOrders,
    setExternalOrderId,
    fetchOrderDetails,
  ]);

  const visibleOrders = useMemo(() => filteredOrders, [filteredOrders]);

  // Auto-select the first search result — To Ship first, falling back to
  // Shipped, so a search for an already-shipped order still opens it even
  // when the Shipped column isn't checked on.
  useEffect(() => {
    if (!debouncedSearchQuery) return;
    const firstResult = filteredOrders[0] ?? shippedFilteredOrders[0];
    if (firstResult) setSelectedOrder(firstResult);
  }, [debouncedSearchQuery, filteredOrders, shippedFilteredOrders]);

  const groupOrdersByDate = useCallback((list: OrderWithRelations[]): DayGroup[] => {
    const map = new Map<string, DayGroup>();
    for (const o of list) {
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
  }, []);

  // Both columns render at once (split view), each grouped independently.
  const ordersGroupedByDate = useMemo(
    () => groupOrdersByDate(visibleOrders),
    [visibleOrders, groupOrdersByDate]
  );
  const shippedGroupedByDate = useMemo(
    () => groupOrdersByDate(shippedFilteredOrders),
    [shippedFilteredOrders, groupOrdersByDate]
  );

  // filteredOrders/shippedFilteredOrders already collapse combined groups
  // into one pseudo-order each, so .length is the right-facing count for
  // both columns — no separate grouped-count fallback needed anymore now
  // that both are always computed (not gated behind a mutually-exclusive tab).
  const toShipCount = filteredOrders.length;
  const shippedCount = shippedFilteredOrders.length;

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

      // Optimistic update — updated_at must move to "now" locally too, not
      // just is_shipped: the Shipped column keys off `shipped today` via
      // updated_at, so a stale timestamp here makes the order vanish from
      // both columns until the realtime echo catches up.
      const shippedAt = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) =>
          allIds.includes(o.id)
            ? {
                ...o,
                status: 'completed',
                is_shipped: true,
                is_waiting_inventory: false,
                updated_at: shippedAt,
              }
            : o
        )
      );
      if (selectedOrder && allIds.includes(selectedOrder.id)) {
        setSelectedOrder((prev) =>
          prev
            ? {
                ...prev,
                status: 'completed',
                is_shipped: true,
                is_waiting_inventory: false,
                updated_at: shippedAt,
              }
            : null
        );
      }

      const { error } = await supabase
        .from('picking_lists')
        // updated_at is set explicitly — no DB trigger stamps it on UPDATE
        // (update_activity_timestamp only touches last_activity_at), and the
        // Shipped column's "shipped today" filter depends entirely on it.

        .update({
          status: 'completed',
          is_shipped: true,
          is_waiting_inventory: false,
          updated_at: shippedAt,
        } as any)
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
          const addressChanged =
            fd.street.trim() !== (originalCustomerParams.street || '').trim() ||
            fd.city.trim() !== (originalCustomerParams.city || '').trim() ||
            fd.state.trim() !== (originalCustomerParams.state || '').trim() ||
            fd.zip.trim() !== (originalCustomerParams.zip_code || '').trim();

          if (addressChanged) {
            // Address changed -> Treat as NEW/OTHER Customer to avoid overwriting
            // the shared customer record's address for other orders.
            finalCustomerId = null; // Will trigger lookup or create below
          }
        }

        // Create or Link Customer if needed
        if (!finalCustomerId && fd.customerName.trim()) {
          // Look up if a customer with the same name and address already exists
          const { data: existingCust, error: findError } = await supabase
            .from('customers')
            .select('id')
            .eq('name', fd.customerName.trim())
            .eq('street', fd.street.trim())
            .eq('city', fd.city.trim())
            .eq('state', fd.state.trim())
            .eq('zip_code', fd.zip.trim())
            .limit(1);

          if (!findError && existingCust && existingCust.length > 0) {
            finalCustomerId = existingCust[0].id;
          } else {
            const { data: newCust, error: createError } = await supabase
              .from('customers')
              .insert({
                name: fd.customerName.trim(),
                street: fd.street.trim(),
                city: fd.city.trim(),
                state: fd.state.trim(),
                zip_code: fd.zip.trim(),
              })
              .select()
              .single();

            if (createError) throw createError;
            finalCustomerId = newCust.id;
          }
        } else if (finalCustomerId) {
          // Only update the customer record if the address didn't change (e.g. name update)
          const { error: updateError } = await supabase
            .from('customers')
            .update({
              name: fd.customerName.trim(),
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
      const isGeneralGroup = isDeliberateCombineGroupType(selectedOrder.order_group?.group_type);
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
          // Collect all IDs to update: every raw member behind this card —
          // group siblings (general combine) or same-customer FedEx cluster
          // members — falling back to group_id for safety, then the order
          // itself if it was never merged.
          const idsToUpdate =
            order.combined_member_ids ??
            (order.group_id
              ? orders.filter((o) => o.group_id === order.group_id).map((o) => o.id)
              : [order.id]);

          // Optimistic update — see handleBatchShip for why updated_at is
          // bumped locally alongside is_shipped.
          const shippedAt = new Date().toISOString();
          setOrders((prev) =>
            prev.map((o) =>
              idsToUpdate.includes(o.id)
                ? {
                    ...o,
                    status: 'completed',
                    is_shipped: true,
                    is_waiting_inventory: false,
                    updated_at: shippedAt,
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
                    updated_at: shippedAt,
                  }
                : null
            );
          }

          const { error } = await supabase
            .from('picking_lists')
            // updated_at is set explicitly — see handleBatchShip for why.

            .update({
              status: 'completed',
              is_shipped: true,
              is_waiting_inventory: false,
              updated_at: shippedAt,
            } as any)
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
        const idsToUpdate =
          order.combined_member_ids ??
          (order.group_id
            ? orders.filter((o) => o.group_id === order.group_id).map((o) => o.id)
            : [order.id]);

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

      // Combined orders ship as one unit — every member behind this card
      // (group siblings or same-customer FedEx cluster) needs to flip to
      // shipped, not just the anchor the photo was attached to.
      const idsToUpdate =
        pendingShipmentOrder.combined_member_ids ??
        (pendingShipmentOrder.group_id
          ? orders.filter((o) => o.group_id === pendingShipmentOrder.group_id).map((o) => o.id)
          : [pendingShipmentOrder.id]);
      const siblingIds = idsToUpdate.filter((id) => id !== pendingShipmentOrder.id);

      // Optimistic update — see handleBatchShip for why updated_at is
      // bumped locally alongside is_shipped.
      const shippedAt = new Date().toISOString();
      setOrders((prev) =>
        prev.map((o) =>
          idsToUpdate.includes(o.id)
            ? {
                ...o,
                status: 'completed',
                is_shipped: true,
                is_waiting_inventory: false,
                updated_at: shippedAt,
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
                updated_at: shippedAt,
                pallet_photos: updatedPhotos,
              }
            : null
        );
      }

      // Update Database — anchor gets the photo, siblings just flip status.
      // updated_at is set explicitly — see handleBatchShip for why.
      const { error } = await supabase
        .from('picking_lists')
        .update({
          status: 'completed',
          is_shipped: true,
          is_waiting_inventory: false,
          updated_at: shippedAt,
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
            updated_at: shippedAt,
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
      <ShipHeader />

      {/* Main scroll area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto no-scrollbar relative bg-bg-main px-4 md:px-6 pb-20"
      >
        <div className="w-full flex flex-col md:flex-row gap-4 md:gap-6 pt-1 md:pt-2 items-start">
          {/* Selected order — desktop 40% / mobile full width */}
          <div className="w-full md:basis-[40%] md:max-w-[40%] min-w-0 flex flex-col gap-6 pb-8 order-first">
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
                      notesSlot={
                        <OrderNotesInline
                          listId={selectedOrder.combined_member_ids ?? selectedOrder.id}
                          watcherNote={selectedOrder.notes}
                          combinedNumbers={selectedOrderCombinedNumbers}
                        />
                      }
                      screenOnly
                      combinedNumbers={selectedOrderCombinedNumbers}
                      activeOrderFilter={selectedOrderFilter}
                      onToggleOrderFilter={toggleSelectedOrderFilter}
                    />

                    <div className="-mt-2 px-1 pr-8 flex justify-between items-start">
                      <div className="inline-flex flex-wrap items-center gap-2 rounded-full border border-subtle bg-card px-3 py-1 text-[10px] font-black uppercase tracking-wider text-muted">
                        <span className="text-content">{selectedOrder.status}</span>
                        <span>·</span>
                        <span>{pillPallets} pallets</span>
                        <span>·</span>
                        <span>{pillUnits} units</span>
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

                    {combineSuggestionCandidate && (
                      <CombineSuggestionBanner
                        candidate={combineSuggestionCandidate}
                        isAccepting={isAcceptingCombineSuggestion}
                        onAccept={handleAcceptCombineSuggestion}
                        onDismiss={() =>
                          setDismissedCombineSuggestionIds((prev) =>
                            new Set(prev).add(selectedOrder.id)
                          )
                        }
                      />
                    )}

                    {isActionsMenuOpen && (
                      <OrderActionsMenu
                        orderNumber={selectedOrder.order_number}
                        fallbackId={selectedOrder.id.slice(-6).toUpperCase()}
                        status={selectedOrder.status}
                        groupId={selectedOrder.group_id}
                        groupMembers={selectedOrderGroupMembers}
                        onUngroup={async (orderId, groupId) => {
                          setIsActionsMenuOpen(false);
                          await handleUngroupOrder(orderId, groupId);
                        }}
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
                            listId: selectedOrder.combined_member_ids ?? selectedOrder.id,
                            autoFocusComposer: true,
                            watcherNote: selectedOrder.notes,
                          });
                        }}
                        onViewNotes={() => {
                          setIsActionsMenuOpen(false);
                          openModal({
                            type: 'order-notes',
                            listId: selectedOrder.combined_member_ids ?? selectedOrder.id,
                            watcherNote: selectedOrder.notes,
                          });
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
                    onShowPickingSummary={() => setIsShowingPickingSummary(true)}
                    onSplitOrder={() => setIsShowingSplitModal(true)}
                    onReopenOrder={handleReopenOrder}
                    onRestoreOrder={handleRestoreOrder}
                    onContinueEditing={handleContinueEditing}
                    onAddPhoto={() => shipCameraInputRef.current?.click()}
                    isAddingPhoto={false}
                    autoBikeCount={autoBikeCount}
                    autoPartCount={autoPartCount}
                    autoWeight={totalWeight}
                    activeOrderFilter={selectedOrderFilter}
                    onToggleOrderFilter={toggleSelectedOrderFilter}
                    isFedexOrder={isFedexOrder}
                  />

                  <PartsWeightEditor
                    partsWithWeights={partsWithWeights}
                    onWeightChange={(sku, weight) => {
                      setSkuMeta((prev) => ({
                        ...prev,
                        [sku]: { ...prev[sku], weight_lbs: weight },
                      }));
                    }}
                  />

                  {selectedOrder && (
                    <OrderItemsTable
                      order={selectedOrder}
                      bikeCount={bikeCount}
                      partCount={partCount}
                      activeOrderFilter={selectedOrderFilter}
                    />
                  )}
                </>
              )}
            </OrderDetailsContainer>
            <ActiveFilterPill
              activeOrderFilter={selectedOrderFilter}
              combinedNumbers={selectedOrderCombinedNumbers}
              onClear={clearSelectedOrderFilter}
            />
          </div>

          {/* Vertical order list — desktop 60% / mobile full width */}
          <div className="w-full md:basis-[60%] md:max-w-[60%] md:min-w-[22rem] shrink-0 md:sticky md:top-0 order-last">
            <div className="bg-card border border-subtle rounded-3xl p-3 flex flex-col gap-2">
              <FeedHeaderToolbar
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                shippedCount={shippedCount}
                eligibleShippingCount={eligibleShippingOrders.length}
                includeShipped={includeShipped}
                onIncludeShippedChange={setIncludeShipped}
                onStartShippingClick={() => setShowShippingPreview(true)}
              />

              {(() => {
                const renderOrderCard = (order: OrderWithRelations, isShippedColumn: boolean) => (
                  <ShipFeedCard
                    key={order.id}
                    order={order}
                    isSelected={selectedOrder?.id === order.id}
                    isShippedColumn={isShippedColumn}
                    isFedex={isFedexLane(order)}
                    userId={user?.id}
                    onSelect={setSelectedOrder}
                    onSelectSubOrder={handleSelectSubOrder}
                    onUndoShip={handleUndoShipOrder}
                    onShipClick={handleShipOrderClick}
                    onResumeWaiting={handleResumeWaitingOrder}
                    onOpenDoubleCheck={openOrderInDoubleCheck}
                    onResumeReopened={async (ord) => {
                      if (ord.id !== selectedOrder?.id) {
                        setSelectedOrder(ord);
                      }
                      try {
                        if (ord.user_id !== user?.id) {
                          await takeOverOrder(ord.id);
                        }
                        await resumeReopenedOrder(ord.id);
                        setViewMode('picking');
                        navigate('/');
                      } catch {
                        // Errors handled by shared actions
                      }
                    }}
                  />
                );

                const renderOrderColumn = (
                  groups: DayGroup[],
                  isShippedColumn: boolean,
                  emptyState: React.ReactNode
                ) => (
                  <div className="flex flex-col gap-2 max-h-[40vh] md:max-h-[calc(100vh-16rem)] overflow-y-auto no-scrollbar">
                    {loading ? (
                      <ShipOrderListSkeleton />
                    ) : groups.length > 0 ? (
                      <div className="space-y-3">
                        {groups.map((group) => (
                          <div key={group.key} className="space-y-1.5">
                            <div className="sticky top-0 z-[1] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-muted/60 bg-card/80 backdrop-blur-sm">
                              {group.label}
                            </div>
                            {group.orders.map((order) => renderOrderCard(order, isShippedColumn))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      emptyState
                    )}
                  </div>
                );

                return (
                  <div className={`flex flex-col gap-3 ${includeShipped ? 'md:flex-row' : ''}`}>
                    {/* Pending Ship — twin column 1 */}
                    <div className={includeShipped ? 'md:flex-1 md:min-w-0' : 'w-full'}>
                      <div className="px-2 mb-2 flex items-center justify-between min-h-[20px]">
                        <span className="text-xs font-black uppercase tracking-wider text-content">
                          Pending Ship ({toShipCount})
                        </span>
                        {searchQuery.trim() && (
                          <span className="text-[10px] font-bold text-muted/80 truncate">
                            search: "{searchQuery.trim()}"
                          </span>
                        )}
                      </div>

                      {(pendingCarrierStats.availableCarriers.length > 0 ||
                        pendingCarrierStats.hasUnassignedOrders ||
                        waitingCount > 0) && (
                        <div className="px-2 mb-2">
                          <CarrierFilter
                            selectedCarriers={pendingSelectedCarriers}
                            includeUnassigned={pendingIncludeUnassigned}
                            hasUnassignedOrders={pendingCarrierStats.hasUnassignedOrders}
                            availableCarriers={pendingCarrierStats.availableCarriers}
                            carrierCounts={pendingCarrierStats.carrierCounts}
                            unassignedCount={pendingCarrierStats.unassignedCount}
                            onCarrierToggle={handlePendingCarrierToggle}
                            onUnassignedToggle={setPendingIncludeUnassigned}
                            showWaitingFilter={true}
                            isWaitingFilterActive={pendingShowWaiting}
                            waitingCount={waitingCount}
                            onWaitingToggle={() => setPendingShowWaiting((prev) => !prev)}
                          />
                        </div>
                      )}

                      {renderOrderColumn(
                        ordersGroupedByDate,
                        false,
                        <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-4 py-8">
                          <p className="font-heading text-xl font-bold opacity-30">
                            No orders found
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Shipped — twin column 2 */}
                    {includeShipped && (
                      <div className="md:flex-1 md:min-w-0 md:border-l md:border-subtle md:pl-3">
                        <div className="px-2 mb-2 flex items-center justify-between min-h-[20px]">
                          <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                            Shipped Today ({shippedCount})
                          </span>
                        </div>

                        {shippedCarrierStats.availableCarriers.length > 0 && (
                          <div className="px-2 mb-2">
                            <CarrierFilter
                              selectedCarriers={shippedSelectedCarriers}
                              includeUnassigned={shippedIncludeUnassigned}
                              hasUnassignedOrders={shippedCarrierStats.hasUnassignedOrders}
                              availableCarriers={shippedCarrierStats.availableCarriers}
                              carrierCounts={shippedCarrierStats.carrierCounts}
                              unassignedCount={shippedCarrierStats.unassignedCount}
                              onCarrierToggle={handleShippedCarrierToggle}
                              onUnassignedToggle={setShippedIncludeUnassigned}
                            />
                          </div>
                        )}

                        {renderOrderColumn(
                          shippedGroupedByDate,
                          true,
                          <div className="flex flex-col items-center justify-center text-center py-6 px-3 gap-3">
                            <p className="text-xs text-muted">
                              No orders were marked as shipped today.
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
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

      <ShipModalsManager
        selectedOrder={selectedOrder}
        isShowingPickingSummary={isShowingPickingSummary}
        onClosePickingSummary={() => setIsShowingPickingSummary(false)}
        isShowingSplitModal={isShowingSplitModal}
        onCloseSplitModal={() => setIsShowingSplitModal(false)}
        onSplitComplete={() => {
          setIsShowingSplitModal(false);
          setSelectedOrder(null);
          fetchOrders();
        }}
        restoreReasonModal={restoreReasonModal}
        restoreReason={restoreReason}
        onRestoreReasonChange={setRestoreReason}
        onCloseRestoreReasonModal={() => setRestoreReasonModal(false)}
        onConfirmRestore={handleConfirmRestore}
        reopenReasonModal={reopenReasonModal}
        reopenReason={reopenReason}
        onReopenReasonChange={setReopenReason}
        onCloseReopenReasonModal={() => setReopenReasonModal(false)}
        onConfirmReopen={handleConfirmReopen}
        shipCameraInputRef={shipCameraInputRef}
        onShipCameraChange={handleShipCameraChange}
        showShippingPreview={showShippingPreview}
        shippingPreviewOrders={shippingPreviewOrders}
        onCloseShippingPreview={() => setShowShippingPreview(false)}
        onConfirmBatchShip={handleBatchShip}
        isShippingBatch={isShippingBatch}
        pendingShippingResolutionGroupId={pendingShippingResolutionGroupId}
        onCloseShippingResolution={() => setPendingShippingResolutionGroupId(null)}
        onShippingResolutionResolved={() => {
          setPendingShippingResolutionGroupId(null);
          fetchOrders();
        }}
      />
    </div>
  );
};
