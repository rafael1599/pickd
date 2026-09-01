import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Check from 'lucide-react/dist/esm/icons/check';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import X from 'lucide-react/dist/esm/icons/x';
import Send from 'lucide-react/dist/esm/icons/send';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import { CorrectionModeView } from './CorrectionModeView';
import { ShippingTypeToggle } from './ShippingTypeToggle';
import { SelectSubOrderModal, type SubOrderOption } from './SelectSubOrderModal';
import { PhotoLightbox } from '../../../components/ui/PhotoLightbox';
import { supabase } from '../../../lib/supabase';
import { inventoryApi } from '../../inventory/api/inventoryApi';
import { CorrectionNotesTimeline, Note } from './CorrectionNotesTimeline.tsx';
import { SlideToConfirm } from '../../../components/ui/SlideToConfirm.tsx';
import { useConfirmation } from '../../../context/ConfirmationContext.tsx';
import { usePickingSession } from '../../../context/PickingContext.tsx';
import { useInventory } from '../../inventory/hooks/InventoryProvider.tsx';
import { orderHeaderLabel } from '../../../utils/orderLabel';
import { orderColorFor } from '../../../utils/orderColors';
import { useCombinedOrderFilter } from '../../../hooks/useCombinedOrderFilter';
import {
  CombinedOrderNumbers,
  ActiveFilterPill,
} from '../../../components/orders/CombinedOrderNumbers';
import {
  mergeSiblingPalletPhotos,
  type PhotoOwnerRow,
} from '../../../utils/mergeSiblingPalletPhotos';
import { OrderActionsMenu } from './OrderActionsMenu';
import { FedexRecipientChip } from './FedexRecipientChip';
import { meaningfulNote } from '../utils/meaningfulNote.ts';
import {
  type DistributionItem,
  STORAGE_TYPE_LABELS,
  type InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema.ts';
import {
  type Pallet,
  redistributeWithOverrides,
  calculatePalletsWithBikeAwareness,
} from '../../../utils/pickingLogic.ts';
import { useModal } from '../../../context/ModalContext';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Lock from 'lucide-react/dist/esm/icons/lock';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import { scanImageForQRCodes } from '../../../hooks/useQRScanner';
import { parseQRPayload, aggregateScanResults } from '../utils/parseQRPayload';
import Camera from 'lucide-react/dist/esm/icons/camera';
import { compressImage, base64ToBlobUrl } from '../../../services/photoUpload.service';
import { useAuth } from '../../../context/AuthContext';
import { useUnmarkWaiting, useTakeOverSku } from '../hooks/useWaitingOrders';
import { withSupabaseRetry } from '../../../lib/supabaseRetry';
import { autoClassifyShippingType } from '../../../utils/shippingClassification';
import { fedexCartonGap, fedexCartonState } from '../../../utils/fedexCarton';
import { UnratedCartonsBanner, type UnratedCarton } from './UnratedCartonsBanner';
import { useWaitingConflicts, type WaitingConflict } from '../hooks/useWaitingConflicts';
import { StockIssuePanel } from './StockIssuePanel';
import { byPickPreference, toPickingOrderMap, type PickingOrderMap } from '../utils/pickLocation';
import { diagnoseStockIssue, type StockIssue } from '../utils/stockIssue';
import { findSimilarSkus } from '../utils/findSimilarSkus';
import { variantSiblingBase } from '../../../utils/skuNormalize';
import type { StockRow } from '../utils/stockSubstitute';
import type { ActivePanel as CorrectionPanel } from './CorrectionModeView';
import { useStockReservations, buildReservationKey } from '../hooks/useStockReservations';
import { useStaleLocationCheck } from '../hooks/useStaleLocationCheck';
import { useCanonicalSkuResolution } from '../hooks/useCanonicalSkuResolution';
import type { PickSplit } from '../utils/pickLocation';
import { AS400_SKU_ALIASES } from '../../../utils/skuNormalize';
import { DistributionGlyph } from '../../inventory/components/DistributionJengaViz';
import { WaitingConflictModal } from './WaitingConflictModal';
import { WaitingReasonModal } from './WaitingReasonModal';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import { useParkedLocations } from '../hooks/useParkedLocations';
import { supabase as supabaseClient } from '../../../lib/supabase';

/** Priority: lower number = pick first. Pallets are overstock we want gone ASAP. */
const DISTRIBUTION_PRIORITY: Record<string, number> = { PALLET: 0, LINE: 1, TOWER: 2, OTHER: 3 };

/** The sku_metadata columns this view reads for the cart, in one query. */
interface SkuMetaRow {
  sku: string;
  is_bike: boolean | null;
  is_scratch_dent: boolean | null;
  serial_number: string | null;
  model: string | null;
  size: string | null;
  length_in: number | null;
  width_in: number | null;
  height_in: number | null;
  dimensions_verified: boolean | null;
  dimensions_measured_at: string | null;
}

// Define PickingItem Interface
export interface PickingItem {
  sku: string;
  location: string | null;
  sublocation?: string[] | null;
  pickingQty: number;
  quantity?: string | number;
  warehouse?: string;
  sku_not_found?: boolean;
  insufficient_stock?: boolean;
  item_name?: string | null;
  description?: string | null;
  source_order?: string;
  source_list_id?: string;
  isStackedPart?: boolean;
  /** Present when no single shelf covered the pick — see rebaseToActualStock. */
  pickSplit?: PickSplit | null;
  sku_metadata?: {
    image_url?: string | null;
    length_in?: number | null;
    width_in?: number | null;
    height_in?: number | null;
    is_bike?: boolean | null;
  } | null;
}

export type CorrectionAction =
  | {
      type: 'swap';
      originalSku: string;
      replacement: {
        sku: string;
        location: string | null;
        warehouse: string;
        item_name: string | null;
      };
      /** Optional override for pickingQty on the swap; preserves original qty when omitted. */
      newQty?: number;
      /**
       * Post-swap problem-flag state. Omitted → both cleared (the normal "this
       * is now fixed" case). Used by Edit Order's Undo to restore the original
       * out-of-stock flag when reverting an auto-resolved substitution.
       */
      flags?: { sku_not_found?: boolean; insufficient_stock?: boolean };
      reason?: string;
    }
  | { type: 'adjust_qty'; sku: string; newQty: number; reason?: string }
  | { type: 'remove'; sku: string; reason?: string }
  | {
      type: 'add';
      item: {
        sku: string;
        location: string | null;
        warehouse: string;
        item_name: string | null;
        pickingQty: number;
      };
      reason?: string;
    };

interface DoubleCheckViewProps {
  cartItems: PickingItem[];
  orderNumber?: string | null;
  activeListId?: string | null;
  checkedItems: Set<string>;
  onToggleCheck: (item: PickingItem, palletId: number | string) => void;
  onDeduct: (items: PickingItem[], isFullyVerified: boolean) => Promise<boolean>;
  onClose: () => void;
  onBack: (id?: string | null) => void;
  onRelease: () => void;
  onReturnToPicker: (notes: string) => void;
  isOwner?: boolean;
  notes?: Note[];
  isNotesLoading?: boolean;
  /** True once notes have loaded at least once — gates the [AUTO] dedup, which
   *  would otherwise write a duplicate note off an empty list. */
  isNotesFetched?: boolean;
  onAddNote: (note: string) => Promise<void> | void;
  customer?: { name: string } | null;
  onSelectAll?: (keys: string[]) => void;
  onPalletCountChange?: (count: number) => void;
  status?: string | null;
  onCorrectItem?: (action: CorrectionAction, targetListId?: string) => Promise<void>;
  inventoryData?: InventoryItemWithMetadata[];
  isWaitingInventory?: boolean;
  onSetWaitingInventory?: (val: boolean) => void;
  onMarkAsReady?: () => void;
  onSendToVerifyQueue?: () => void;
  initialAction?: 'edit' | 'photo' | 'cancel' | null;
  onClearInitialAction?: () => void;
  onRecomplete?: (items: PickingItem[]) => Promise<void>;
  onCancelReopen?: () => void;
  /** idea-067 Phase 2 / Option A: opens the AddOn target picker in
   *  "combine-any" mode (any order, completed or open). Parent handles the
   *  actual group/reopen wiring. */
  onCombineWith?: () => void;
  /** Removes one order from the current combined group. Parent unbinds the
   *  group_id and reloads the merged cart so the combined view updates. */
  onUngroup?: (orderId: string, groupId: string) => Promise<void> | void;
  correctionNotes?: string | null;
  isReadOnly?: boolean;
  onTakeover?: () => Promise<void> | void;
}

export const DoubleCheckView: React.FC<DoubleCheckViewProps> = ({
  cartItems,
  orderNumber,
  activeListId,
  checkedItems,
  onToggleCheck,
  onDeduct,
  onClose,
  onBack,
  onRelease,
  onReturnToPicker,
  notes = [],
  isNotesLoading = false,
  isNotesFetched = false,
  customer,
  onAddNote,
  onSelectAll,
  onPalletCountChange,
  status,
  isWaitingInventory = false,
  onSetWaitingInventory,
  onCorrectItem,
  inventoryData: inventoryDataProp,
  onMarkAsReady,
  onSendToVerifyQueue,
  onRecomplete,
  onCancelReopen,
  onCombineWith,
  onUngroup,
  correctionNotes: correctionNotesProp,
  initialAction,
  onClearInitialAction,
  isReadOnly = false,
  onTakeover,
}) => {
  const {
    ludlowData,
    atsData,
    inventoryData: inventoryDataCtx,
    updateItem,
    deleteItem,
    addItem,
  } = useInventory();
  const inventoryData = inventoryDataProp ?? inventoryDataCtx;

  const handleToggleCheck = useCallback(
    (item: PickingItem, palletId: number | string) => {
      if (isReadOnly) {
        toast('You are in view-only mode. Takeover the order to make changes.', { icon: '👁️' });
        return;
      }
      onToggleCheck(item, palletId);
    },
    [isReadOnly, onToggleCheck]
  );

  // Direct sublocation data fetched alongside distributions (covers all cart SKUs)
  const [directSublocationMap, setDirectSublocationMap] = useState<Record<string, string[]>>({});

  // Fetch real stock for insufficient_stock items (client-side inventoryData is paginated)
  const [stockMap, setStockMap] = useState<Record<string, number>>({});
  useEffect(() => {
    const insufficientSkus = cartItems
      .filter((i) => i.insufficient_stock && !i.sku_not_found)
      .map((i) => i.sku);
    if (insufficientSkus.length === 0) return;

    const uniqueSkus = [...new Set(insufficientSkus)];
    Promise.all(
      uniqueSkus.map(async (sku) => {
        // AS400-alias SKUs: the physical stock lives under the alias SKU.
        const target = AS400_SKU_ALIASES[sku] ?? sku;
        const [bikes, parts] = await Promise.all([
          inventoryApi.fetchInventoryWithMetadata({ search: target, showParts: false, limit: 10 }),
          inventoryApi.fetchInventoryWithMetadata({ search: target, showParts: true, limit: 10 }),
        ]);
        const total = [...bikes.data, ...parts.data]
          .filter((inv) => inv.sku === target)
          .reduce((sum, inv) => sum + (inv.quantity || 0), 0);
        return [sku, total] as const;
      })
    ).then((entries) => {
      setStockMap(Object.fromEntries(entries));
    });
  }, [cartItems]);

  // Build sublocation lookup — prefer direct DB fetch (covers all cart SKUs),
  // fall back to paginated inventoryData for any extras
  const sublocationMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (inventoryData) {
      for (const inv of inventoryData) {
        if (inv.sublocation && inv.sublocation.length > 0 && inv.location) {
          map[`${inv.sku}-${(inv.location || '').toUpperCase()}`] = inv.sublocation;
        }
      }
    }
    // Direct fetch overrides paginated data (more complete)
    for (const [key, subs] of Object.entries(directSublocationMap)) {
      map[key] = subs;
    }
    return map;
  }, [inventoryData, directSublocationMap]);

  const { showConfirmation } = useConfirmation();
  const { pallets: originalPallets, deleteList, loadExternalList } = usePickingSession();
  const { isAdmin, user } = useAuth();
  const unmarkWaiting = useUnmarkWaiting();
  const takeOverSku = useTakeOverSku();
  // idea-119: fetch the active list's group_id so cross-order hooks can skip
  // siblings of the same combined order. Without this, the picker sees false
  // "reserved by another order" / "waiting in another order" warnings for
  // items that are actually part of the same combined cart.
  const { data: activeListMeta = null } = useQuery({
    queryKey: ['picking_list_meta', activeListId],
    enabled: !!activeListId,
    staleTime: 60_000,
    queryFn: async (): Promise<{
      group_id: string | null;
      shipping_type: string | null;
      source_order_date: string | null;
    } | null> => {
      if (!activeListId) return null;
      const { data, error } = await supabase
        .from('picking_lists')
        .select('group_id, shipping_type, source_order_date')
        .eq('id', activeListId)
        .single();
      if (error) throw error;
      return {
        group_id: data?.group_id ?? null,
        shipping_type: data?.shipping_type ?? null,
        source_order_date: data?.source_order_date ?? null,
      };
    },
  });
  const activeGroupId = activeListMeta?.group_id ?? null;

  // Members of the current combined group — drives the Ungroup picker in the
  // actions menu (id needed to unbind a specific order from the group).
  const queryClient = useQueryClient();
  const { data: groupMembers = [] } = useQuery({
    queryKey: ['group_members', activeGroupId],
    enabled: !!activeGroupId,
    staleTime: 30_000,
    queryFn: async (): Promise<Array<{ id: string; order_number: string | null }>> => {
      if (!activeGroupId) return [];
      const { data, error } = await supabase
        .from('picking_lists')
        .select('id, order_number')
        .eq('group_id', activeGroupId);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Watcher-origin note: the import daemon stores the AS400 "Order Comments"
  // (e.g. "FREE FREIGHT") in picking_lists.notes. Manual notes live elsewhere
  // (correction_notes / picking_list_notes), so this column is the watcher's —
  // shown in red below the order header.
  const { data: watcherNote = null } = useQuery({
    queryKey: ['picking_list_watcher_note', activeListId],
    enabled: !!activeListId,
    staleTime: 60_000,
    queryFn: async (): Promise<string | null> => {
      if (!activeListId) return null;
      const { data, error } = await supabase
        .from('picking_lists')
        .select('notes')
        .eq('id', activeListId)
        .single();
      if (error) throw error;
      // Filter freight/billing noise (e.g. a bare "FREE FREIGHT") while keeping
      // any note that carries a real instruction (ship/not/wait/hold/…).
      return meaningfulNote(data?.notes);
    },
  });

  const { data: waitingConflicts } = useWaitingConflicts(
    cartItems,
    activeListId ?? null,
    customer?.name ?? null,
    activeGroupId
  );
  const [conflictDismissed, setConflictDismissed] = useState(false);

  // idea-105 Phase 3 — cross-order reservation visibility
  const reservationKeys = useMemo(
    () =>
      cartItems
        .filter((i) => !i.sku_not_found && i.warehouse && i.location)
        .map((i) => buildReservationKey(i.sku, i.warehouse, i.location)),
    [cartItems]
  );
  const { data: reservationsMap } = useStockReservations(
    reservationKeys,
    activeListId ?? null,
    activeGroupId
  );
  // Drift guard (#1): flag items whose frozen location is now empty while the
  // SKU has stock elsewhere, and persist a deduped [AUTO] note (#3) for analysis.
  const staleLocations = useStaleLocationCheck(
    cartItems,
    activeListId ?? null,
    notes,
    isNotesFetched,
    onAddNote
  );
  // Resolve items whose SKU has a spurious extra trailing letter (e.g. watcher
  // produced "03-3768BLD" for "03-3768BL") to their canonical inventory, so we
  // can show WHERE to pick instead of flagging them not-found.
  const canonicalResolution = useCanonicalSkuResolution(cartItems);

  const [isDeducting, setIsDeducting] = useState(false);
  const [showWaitingPicker, setShowWaitingPicker] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const { combinedNumbers, activeOrderFilter, toggleOrderFilter, clearOrderFilter } =
    useCombinedOrderFilter(orderNumber);
  const [scanResults, setScanResults] = useState<Map<string, Set<string>>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  // Pallet photos are per-row (`pallet_photos` on picking_lists), but a
  // group_id-merged combined order is really N rows. photoRows holds each
  // owning row's own array; palletPhotos/ownerByUrl below merge them for
  // display while keeping enough ownership info that a delete can still
  // target the correct row instead of corrupting a sibling's photos.
  const [photoRows, setPhotoRows] = useState<PhotoOwnerRow[]>([]);
  const { photos: palletPhotos, ownerByUrl } = useMemo(
    () => mergeSiblingPalletPhotos(photoRows),
    [photoRows]
  );
  const palletPhotosCount = palletPhotos.length;
  const setOwnerPhotos = useCallback((ownerId: string, photos: string[]) => {
    setPhotoRows((prev) => {
      if (prev.some((row) => row.id === ownerId)) {
        return prev.map((row) => (row.id === ownerId ? { ...row, pallet_photos: photos } : row));
      }
      return [...prev, { id: ownerId, pallet_photos: photos }];
    });
  }, []);
  const [palletLightboxIndex, setPalletLightboxIndex] = useState<number | null>(null);

  const handleDeletePalletPhoto = useCallback(
    (index: number) => {
      if (!activeListId) return;
      const url = palletPhotos[index];
      const ownerId = (url && ownerByUrl.get(url)) || activeListId;
      showConfirmation(
        'Delete Photo',
        'Are you sure you want to delete this pallet photo? This cannot be undone.',
        async () => {
          const previous = photoRows;
          const nextRows = photoRows.map((row) =>
            row.id === ownerId
              ? { ...row, pallet_photos: (row.pallet_photos ?? []).filter((u) => u !== url) }
              : row
          );
          const ownerRow = nextRows.find((row) => row.id === ownerId);
          setPhotoRows(nextRows); // optimistic
          try {
            await supabase
              .from('picking_lists')
              .update({ pallet_photos: ownerRow?.pallet_photos ?? [] })
              .eq('id', ownerId);
          } catch (err) {
            console.error('Delete pallet photo failed:', err);
            setPhotoRows(previous);
            toast.error('Failed to delete photo');
          }
        },
        () => {},
        'Delete',
        'Cancel',
        'danger'
      );
    },
    [activeListId, palletPhotos, ownerByUrl, photoRows, showConfirmation]
  );
  const scanInputRef = useRef<HTMLInputElement>(null);

  // Reopened-changes detection was used to gate Re-Complete (forced the user
  // to add a SKU before completing). Step B removed the gate — keeping the
  // hook removed so we don't compute unused state on every re-render.

  // idea-067 Phase 2: Add-On mode detection. The reopened source carries a
  // group_id pointing to a 'general' order_groups row when the user came in
  // through the Add-On flow. We track:
  //   - isAddonMode: switches the bottom CTA copy + adds a "new photo" gate.
  //   - addonInitialPhotoCount: captured once, so newPhotosTaken = current - initial.
  // The "must take at least 1 new photo" rule replaces hasReopenedChanges
  // as the gate to enable Re-Complete in Add-On mode (items can be unchanged
  // if the add-on items live solely on the target row, but new photos are
  // mandatory evidence).
  const [isAddonMode, setIsAddonMode] = useState(false);
  const [addonInitialPhotoCount, setAddonInitialPhotoCount] = useState<number | null>(null);
  useEffect(() => {
    if (status !== 'reopened' || !activeListId) {
      setIsAddonMode(false);
      setAddonInitialPhotoCount(null);
      return;
    }
    let cancelled = false;
    (async () => {
      // Both queries wrapped in retry — Add-On detection running once
      // at DoubleCheckView mount; a single flaky-network failure
      // left the order rendering without its Add-On context.
      const { data: src } = await withSupabaseRetry(
        () => supabase.from('picking_lists').select('group_id').eq('id', activeListId).single(),
        { label: 'DoubleCheckView.addonDetect.list' }
      );
      if (cancelled) return;
      const groupId = src?.group_id;
      if (!groupId) {
        setIsAddonMode(false);
        return;
      }
      const { data: grp } = await withSupabaseRetry(
        () => supabase.from('order_groups').select('group_type').eq('id', groupId).single(),
        { label: 'DoubleCheckView.addonDetect.group' }
      );
      if (cancelled) return;
      setIsAddonMode(grp?.group_type === 'general');
    })();
    return () => {
      cancelled = true;
    };
  }, [status, activeListId]);

  // Capture the initial photo count the first time we observe addon-mode +
  // photos loaded, so we can later compute "new photos taken in this session".
  useEffect(() => {
    if (isAddonMode && addonInitialPhotoCount === null && palletPhotosCount >= 0) {
      setAddonInitialPhotoCount(palletPhotosCount);
    }
  }, [isAddonMode, addonInitialPhotoCount, palletPhotosCount]);

  const addonNewPhotosTaken =
    isAddonMode && addonInitialPhotoCount !== null
      ? Math.max(palletPhotosCount - addonInitialPhotoCount, 0)
      : 0;
  const addonGateBlocked = isAddonMode && addonNewPhotosTaken < 1;

  // All statuses use full verification mode (checkboxes, select all).
  // The picker checks off items as they collect them, then sends to verify.
  const isReviewMode = false;
  const [showCorrectionMode, setShowCorrectionMode] = useState(false);

  // Sub-order picker state — for combined FedEx orders, Edit Order and Cancel Order
  // both route through a chooser so the user picks one sub-order at a time (prevents
  // the qty duplication bug on edit + the orphan-siblings problem on cancel).
  const [subOrderPickerMode, setSubOrderPickerMode] = useState<'edit' | 'cancel' | null>(null);
  const [subOrders, setSubOrders] = useState<SubOrderOption[]>([]);
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingOrderNumber, setEditingOrderNumber] = useState<string | null>(null);

  // A merged FedEx cart tags every item with source_order (see usePickingSync.loadExternalList).
  const isCombined = useMemo(() => cartItems.some((i) => i.source_order), [cartItems]);
  // combinedNumbers (full order numbers of the combined set, driving the
  // per-order color coding) now comes from useCombinedOrderFilter above.

  const orderQuantities = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!isCombined) return counts;
    for (const item of cartItems) {
      if (item.source_order) {
        counts[item.source_order] = (counts[item.source_order] || 0) + (item.pickingQty || 0);
      }
    }
    return counts;
  }, [cartItems, isCombined]);

  // Per-source qty shares for each SKU in a combined cart. The pallet calc
  // merges same-SKU rows from different orders into ONE display row, so the
  // stripe must show EVERY owner's color, sized by each order's quantity —
  // a single color would read as "the other order is missing items".
  const skuSourceShares = useMemo(() => {
    if (!isCombined) return null;
    const byKey = new Map<string, { order: string; qty: number }[]>();
    const bySku = new Map<string, { order: string; qty: number }[]>();
    const add = (
      map: Map<string, { order: string; qty: number }[]>,
      key: string,
      ci: PickingItem
    ) => {
      const arr = map.get(key) ?? [];
      const entry = arr.find((e) => e.order === ci.source_order);
      if (entry) entry.qty += ci.pickingQty || 0;
      else arr.push({ order: ci.source_order!, qty: ci.pickingQty || 0 });
      map.set(key, arr);
    };
    for (const ci of cartItems) {
      if (!ci.source_order) continue;
      add(byKey, `${ci.sku}|${ci.location ?? ''}`, ci);
      add(bySku, ci.sku, ci);
    }
    return { byKey, bySku };
  }, [isCombined, cartItems]);

  // Pallet override state: palletId → desired total units
  const [palletOverrides, setPalletOverrides] = useState<Map<number, number>>(new Map());
  const [editingPalletId, setEditingPalletId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  // Infer which cart SKUs are bikes so parts can stack on the last bike pallet.
  // Watchdog ingests orders from PDFs and doesn't tag items as bike/part, so we
  // discern it here: (1) sku_metadata.is_bike when the SKU is cataloged, and
  // (2) SKU prefix "03-" as a fallback for uncataloged SKUs (every "03-" SKU in
  // sku_metadata is is_bike=true — reliable heuristic for sku_not_found items).
  const cartSkusKey = useMemo(
    () =>
      Array.from(new Set(cartItems.map((i) => i.sku).filter(Boolean)))
        .sort()
        .join(','),
    [cartItems]
  );
  const [bikeSkuSet, setBikeSkuSet] = useState<Set<string>>(new Set());
  // When the FedEx Dimensions table was last refreshed from Pickd. A measurement
  // newer than this has not reached Ship Manager, however verified it looks --
  // which is the difference the warning below exists to show. Read through an
  // RPC because fedex_dimension_exports is admin-only and this screen is not.
  const { data: exportedAt = null } = useQuery({
    queryKey: ['fedex-dimensions', 'exported-at'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('fedex_dimensions_exported_at');
      // Not deployed yet, or unreachable: treat as "no export has run", which
      // over-warns rather than under-warns. A broken lookup must not be the
      // reason a wrong carton ships quietly.
      if (error) return null;
      return (data as string | null) ?? null;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  // idea-079: S/D (scratch-and-dent) SKUs carry a physical serial number. In
  // the big item header we display the serial instead of the SKU so pickers
  // can match the tag visually. Scanning still uses the SKU.
  const [sdSerialMap, setSdSerialMap] = useState<Map<string, string>>(new Map());
  // Cart SKUs FedEx Ship Manager has no carton for. Same gate the Dimensions
  // export applies, so a SKU it silently held back is named here instead --
  // while the box is still in front of someone and can be measured.
  const [unratedCartons, setUnratedCartons] = useState<UnratedCarton[]>([]);
  useEffect(() => {
    if (!cartSkusKey) {
      setBikeSkuSet(new Set());
      setSdSerialMap(new Map());
      setUnratedCartons([]);
      return;
    }
    let cancelled = false;
    const skus = cartSkusKey.split(',');
    const prefixInferred = new Set(skus.filter((s) => s.startsWith('03-')));
    // Seed immediately with prefix-inferred bikes so stacking applies before the fetch resolves
    setBikeSkuSet(prefixInferred);
    (async () => {
      const { data } = await supabase
        .from('sku_metadata')
        .select(
          'sku, is_bike, is_scratch_dent, serial_number, model, size, length_in, width_in, height_in, dimensions_verified, dimensions_measured_at'
        )
        .in('sku', skus);
      if (cancelled) return;
      const next = new Set<string>(prefixInferred);
      const serials = new Map<string, string>();
      const gaps: UnratedCarton[] = [];
      (data as SkuMetaRow[] | null)?.forEach((row) => {
        if (row.is_bike) next.add(row.sku);
        if (row.is_scratch_dent && row.serial_number) serials.set(row.sku, row.serial_number);
        // Scope matches the export's own row filter: it ships bikes and skips
        // Scratch & Dent, so a used one-off has no FSM record by design and
        // warning about it would be noise on every order that carries one.
        if (!row.is_bike || row.is_scratch_dent) return;
        const carton = {
          model: row.model,
          length_in: row.length_in,
          width_in: row.width_in,
          height_in: row.height_in,
          dimensions_verified: row.dimensions_verified ?? false,
          dimensions_measured_at: row.dimensions_measured_at,
        };
        const state = fedexCartonState(carton, exportedAt);
        if (state === 'synced') return;
        gaps.push({
          sku: row.sku,
          model: row.model,
          size: row.size,
          state,
          gap: fedexCartonGap(carton),
          stored: { length: row.length_in, width: row.width_in, height: row.height_in },
        });
      });
      setBikeSkuSet(next);
      setSdSerialMap(serials);
      setUnratedCartons(gaps.sort((a, b) => a.sku.localeCompare(b.sku)));
    })();
    return () => {
      cancelled = true;
    };
  }, [cartSkusKey, exportedAt]);

  // Effective shipping type: persisted override, else auto-classify from the
  // cart (count-only — no weight map here, mirroring VerificationBoard). Drives
  // the purple FedEx accent on the pallet badges.
  //
  // Declared here, below bikeSkuSet, and not up by activeListMeta where it
  // reads more naturally: the classifier needs the canonical is_bike lookup,
  // and reaching for it earlier would hit the temporal dead zone. Passing it is
  // what the order actually buys. Watchdog orders written before the
  // 20260820150000 stamp carry no sku_metadata on their items, and without the
  // lookup every one of them counted as a part — a 13-bike order painted FedEx
  // here while the Board showed Regular.
  const effectiveShippingType: 'fedex' | 'regular' =
    activeListMeta?.shipping_type === 'fedex' || activeListMeta?.shipping_type === 'regular'
      ? activeListMeta.shipping_type
      : autoClassifyShippingType(
          cartItems.map((i) => ({
            sku: i.sku,
            pickingQty: i.pickingQty || 0,
            source_order: i.source_order,
            sku_metadata: i.sku_metadata,
          })),
          {},
          bikeSkuSet
        );
  const isFedexOrder = effectiveShippingType === 'fedex';

  // Compute display pallets. When bikes are present, pallet count is sized by
  // BIKE units only and parts stack on top of the last bike pallet. When no
  // bikes are present, upstream pallets (parts-only) are used as-is.
  const pallets = useMemo(() => {
    // Bikes paginate by capacity; parts always consolidate into one pallet.
    // calculatePalletsWithBikeAwareness handles the no-bikes case (parts-only → 1 pallet).
    const allItems = originalPallets.flatMap((p) => p.items);
    const bikeAware = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);
    const redistributed =
      palletOverrides.size === 0
        ? bikeAware
        : redistributeWithOverrides(bikeAware, palletOverrides);

    if (!activeOrderFilter) return redistributed;

    // Filter items inside the computed pallets so pallet IDs stay consistent
    // with what they would be if unfiltered, preserving checkmarks.
    return redistributed
      .map((p) => ({
        ...p,
        items: p.items.filter((item) => item.source_order === activeOrderFilter),
      }))
      .filter((p) => p.items.length > 0);
  }, [originalPallets, palletOverrides, bikeSkuSet, activeOrderFilter]);

  const physicalPalletCount = useMemo(() => pallets.filter((p) => !p.isParts).length, [pallets]);

  // Notify parent of pallet count changes
  useEffect(() => {
    onPalletCountChange?.(physicalPalletCount);
  }, [physicalPalletCount, onPalletCountChange]);

  // Every distinct row a currently-loaded item is tagged as belonging to —
  // for a group_id-merged combined order this is every sibling, not just
  // the anchor (source_list_id is only ever set on merged items; a
  // non-combined order's items carry none, so activeListId alone covers it).
  const photoOwnerIdsKey = useMemo(() => {
    const ids = new Set<string>();
    if (activeListId) ids.add(activeListId);
    for (const item of cartItems) {
      if (item.source_list_id) ids.add(item.source_list_id);
    }
    return Array.from(ids).sort().join(',');
  }, [activeListId, cartItems]);

  // Fetch pallet photos for every owning row of the active (possibly
  // combined) order, merged for display — previously this only ever
  // queried activeListId, so a group_id sibling's photos silently never
  // showed up.
  useEffect(() => {
    const ids = photoOwnerIdsKey ? photoOwnerIdsKey.split(',') : [];
    if (ids.length === 0) {
      setPhotoRows([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('picking_lists')
        .select('id, pallet_photos')
        .in('id', ids);
      if (cancelled) return;
      setPhotoRows(
        (data ?? []).map((row) => ({
          id: row.id as string,
          pallet_photos: Array.isArray(row.pallet_photos) ? (row.pallet_photos as string[]) : [],
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [photoOwnerIdsKey]);

  // Migrate checked items by SKU when redistribution changes pallet assignments
  const prevPalletsRef = useRef<Pallet[]>(originalPallets);
  useEffect(() => {
    if (palletOverrides.size === 0) return;
    const prev = prevPalletsRef.current;
    if (prev === pallets) return;
    prevPalletsRef.current = pallets;

    // Build SKU-based check set from old checked items
    const checkedSkuLocations = new Set<string>();
    prev.forEach((p) => {
      p.items.forEach((item) => {
        const oldKey = `${p.id}-${item.sku}-${item.location}`;
        if (checkedItems.has(oldKey)) {
          checkedSkuLocations.add(`${item.sku}-${item.location}`);
        }
      });
    });

    if (checkedSkuLocations.size === 0) return;

    // Map checked SKUs to new pallet keys
    const newKeys: string[] = [];
    pallets.forEach((p) => {
      p.items.forEach((item) => {
        if (checkedSkuLocations.has(`${item.sku}-${item.location}`)) {
          newKeys.push(`${p.id}-${item.sku}-${item.location}`);
        }
      });
    });

    if (newKeys.length > 0) {
      onSelectAll?.(newKeys);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pallets, palletOverrides.size]);

  const handlePalletEdit = (palletId: number, currentUnits: number) => {
    setEditingPalletId(palletId);
    setEditingValue(String(currentUnits));
  };

  const handlePalletEditConfirm = () => {
    if (editingPalletId === null) return;
    const newQty = parseInt(editingValue, 10);
    if (isNaN(newQty) || newQty < 0) {
      setEditingPalletId(null);
      return;
    }

    const totalUnits = originalPallets.reduce(
      (sum, p) => sum + p.items.reduce((s, i) => s + (i.pickingQty || 0), 0),
      0
    );

    // Don't allow override larger than total units
    const clampedQty = Math.min(newQty, totalUnits);

    setPalletOverrides((prev) => {
      const next = new Map(prev);
      if (clampedQty === 0) {
        next.delete(editingPalletId);
      } else {
        next.set(editingPalletId, clampedQty);
      }
      return next;
    });
    setEditingPalletId(null);
  };
  const [correctionNotes, setCorrectionNotes] = useState('');
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  const [isAssignPickupOpen, setIsAssignPickupOpen] = useState(false);
  const [pickupLocation, setPickupLocation] = useState('');
  const [isSavingPickup, setIsSavingPickup] = useState(false);
  const { locations: suggestedLocations } = useParkedLocations();
  const { open: openModal } = useModal();

  const handleAssignPickup = async () => {
    if (!pickupLocation.trim() || !user || !activeListId) return;
    setIsSavingPickup(true);
    try {
      // 1. Update carrier to PICK UP
      const { error: updateError } = await supabaseClient
        .from('picking_lists')
        .update({ transport_company: 'PICK UP' })
        .eq('id', activeListId);

      if (updateError) throw updateError;

      // 2. Add parked location note via RPC (safer with RLS)
      const { error: rpcError } = await supabaseClient.rpc('add_parked_location_note', {
        p_list_id: activeListId,
        p_location: pickupLocation.trim(),
      });

      if (rpcError) throw rpcError;

      toast.success(`Assigned as PICK UP at ${pickupLocation}`);
      setIsAssignPickupOpen(false);
      setPickupLocation('');
    } catch (err) {
      console.error('Failed to assign pickup:', err);
      toast.error('Failed to assign pickup');
    } finally {
      setIsSavingPickup(false);
    }
  };

  // Ref keeps modal callbacks fresh without re-binding handlePointerDown.
  // Modal lives at root via ModalProvider — must call latest hook callbacks
  // even if this component unmounts after the modal opens.
  const editCallbacksRef = useRef({
    updateItem,
    deleteItem,
    addItem,
    fetchDistributions: async () => {},
  });
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevItemCountRef = useRef(cartItems.length);

  // Detect when new items are added (e.g., from auto-combine)
  useEffect(() => {
    if (cartItems.length > prevItemCountRef.current) {
      toast('New items added to this order', { icon: '🔗', duration: 4000 });
    }
    prevItemCountRef.current = cartItems.length;
  }, [cartItems.length]);
  const longPressTriggered = useRef(false);

  // "Where is it, really?" — every row the SKU is stocked in, the order's
  // address first, Edit per row, and the Bike/Part register flow when the
  // SKU has no row at all. Reached by a long-press on the card and by the
  // Register button of the stock-issue panel.
  const openSkuLocations = useCallback(
    (item: PickingItem, location: string | null) => {
      const editRow = (row: InventoryItemWithMetadata) =>
        openModal({
          type: 'item-detail',
          item: row,
          mode: 'edit',
          screenType: row.warehouse,
          onSave: async (formData) => {
            await editCallbacksRef.current.updateItem(row, formData);
            await editCallbacksRef.current.fetchDistributions();
            toast.success(`Updated ${row.sku}`);
          },
          onDelete: () => {
            editCallbacksRef.current.deleteItem(row.warehouse, row.sku, row.location);
            toast.success(`Deleted ${row.sku}`);
          },
        });
      // Not in the DB inventory (typically an `sku_not_found` / UNREG item
      // the picker found on the floor). Open New Item pre-filled with what
      // the order already knows so they only enter the missing bits.
      const registerSku = (prefill: InventoryItemWithMetadata) =>
        openModal({
          type: 'item-detail',
          item: prefill,
          mode: 'add',
          screenType: prefill.warehouse,
          onSave: async (formData) => {
            await editCallbacksRef.current.addItem(formData.warehouse, formData);
            await editCallbacksRef.current.fetchDistributions();
            toast.success(`Registered ${formData.sku}`);
          },
        });
      openModal({
        type: 'sku-locations',
        sku: item.sku,
        // A watchdog item the catalogue could not match carries the AS400
        // description; it is the only name there is to register it under.
        itemName: item.item_name || item.description || null,
        pickLocation: location,
        pickWarehouse: item.warehouse ?? null,
        onEdit: editRow,
        onRegister: registerSku,
      });
    },
    [openModal]
  );

  const handlePointerDown = useCallback(
    (item: PickingItem, location: string | null) => {
      longPressTriggered.current = false;
      longPressTimer.current = setTimeout(() => {
        longPressTriggered.current = true;
        if (navigator.vibrate) navigator.vibrate(100);

        // Every row this SKU is stocked in, the order's own address marked —
        // not one row chosen by a rule. A SKU stocked in two places
        // (03-4066BK: ROW 6 A ×4, ROW 41 F ×78) had the card saying ROW 6 and
        // the detail opening ROW 41, and the picker read that as the card
        // being wrong. Editing is a second, deliberate tap on the row to
        // change; the modal replaces itself with the editor (single-slot
        // Modal Manager), and the editor's callbacks go through the ref so
        // they stay fresh if this view unmounts underneath it.
        openSkuLocations(item, location);
      }, 500);
    },
    [openSkuLocations]
  );

  const handlePointerUp = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const totalUnitsCount = useMemo(() => {
    return pallets.reduce(
      (sum: number, p: Pallet) =>
        sum + p.items.reduce((pSum: number, i: PickingItem) => pSum + (i.pickingQty || 0), 0),
      0
    );
  }, [pallets]);

  const verifiedUnitsCount = useMemo(() => {
    let count = 0;
    pallets.forEach((p) => {
      p.items.forEach((item) => {
        const itemKey = `${p.id}-${item.sku}-${item.location}`;
        if (checkedItems.has(itemKey)) {
          count += item.pickingQty || 0;
        }
      });
    });
    return count;
  }, [pallets, checkedItems]);

  // SKU Similarity Mapping (Now checks against ALL known SKUs in warehouse)
  const skuSimilarityMap = useMemo(() => {
    const orderSkus = pallets.flatMap((p: Pallet) => p.items.map((i: PickingItem) => i.sku));
    const warehouseSkus = Array.from(new Set([...ludlowData, ...atsData].map((i) => i.sku)));
    const map: Record<string, { prefix: boolean; suffix: boolean }> = {};

    orderSkus.forEach((sku) => {
      if (!sku || sku.length < 5) return;
      if (!map[sku]) map[sku] = { prefix: false, suffix: false };

      const core = sku.substring(2, sku.length - 2);

      // Check against warehouse inventory for ANY confusable twins
      for (const other of warehouseSkus) {
        if (sku === other) continue;
        if (other.length !== sku.length) continue;

        if (other.substring(2, other.length - 2) === core) {
          if (sku.substring(0, 2) !== other.substring(0, 2)) {
            map[sku].prefix = true;
          }
          if (sku.substring(sku.length - 2) !== other.substring(other.length - 2)) {
            map[sku].suffix = true;
          }
        }
      }
    });
    return map;
  }, [pallets, ludlowData, atsData]);

  // ── Fetch distribution data for ALL cart SKUs directly from DB ──
  // This is the single source of truth — works regardless of where the SKU came from
  // (picking, watchdog, Edit Order). Replaces dependency on paginated inventoryData.
  const [skuInventoryMap, setSkuInventoryMap] = useState<
    Record<
      string,
      {
        distribution: DistributionItem[];
        quantity: number;
        location: string | null;
        warehouse: string;
      }[]
    >
  >({});
  const [skuLocationsMap, setSkuLocationsMap] = useState<Record<string, string>>({});

  // A registered SKU is one with an inventory row, whatever its quantity — the
  // same test the DB applies when it derives sku_not_found (migration
  // 20260826180000). Read from the rows fetchDistributions already loads for
  // every cart SKU, so the card heals the moment the register form closes
  // instead of waiting for the re-stamped row to round-trip through realtime.
  // Returns the units those rows hold, or undefined when there is no row.
  const registeredStock = useCallback(
    (sku: string): number | undefined => {
      const rows = skuInventoryMap[sku];
      if (!rows || rows.length === 0) return undefined;
      return rows.reduce((sum, r) => sum + (r.quantity ?? 0), 0);
    },
    [skuInventoryMap]
  );

  const fetchDistributions = useCallback(async () => {
    const skus = [...new Set(cartItems.map((i) => i.sku))];
    if (skus.length === 0) return;

    const { data } = await supabase
      .from('inventory')
      .select('sku, quantity, distribution, location, sublocation, warehouse')
      .in('sku', skus);

    const map: Record<
      string,
      {
        distribution: DistributionItem[];
        quantity: number;
        location: string | null;
        warehouse: string;
      }[]
    > = {};
    const subMap: Record<string, string[]> = {};
    const locRows: Record<string, { location: string; quantity: number }[]> = {};

    (data || []).forEach((row) => {
      const r = row as {
        sku: string;
        quantity: number;
        distribution: DistributionItem[] | null;
        location: string | null;
        sublocation: string[] | null;
        warehouse: string;
      };
      if (!map[r.sku]) map[r.sku] = [];
      map[r.sku].push({
        distribution: Array.isArray(r.distribution) ? r.distribution : [],
        quantity: r.quantity ?? 0,
        location: r.location ?? null,
        warehouse: r.warehouse ?? 'LUDLOW',
      });
      if (r.sublocation && r.sublocation.length > 0 && r.location) {
        subMap[`${r.sku}-${r.location.toUpperCase()}`] = r.sublocation;
      }
      if (r.location) {
        if (!locRows[r.sku]) locRows[r.sku] = [];
        locRows[r.sku].push({ location: r.location, quantity: r.quantity ?? 0 });
      }
    });

    const locMap: Record<string, string> = {};
    // RETURN TO STOCK first, then quantity desc, then location name asc. The
    // returns floor outranks the fullest shelf on purpose: those units are
    // loose and owe a put-away trip, so the next order that needs the SKU is
    // that trip (Rafael, 1 Sep 2026). No locations map is needed for that tier
    // — it is recognised by name — and this map only ever fills in a location
    // the line is missing, so the buried-shelf tier never applied here.
    const preferred = byPickPreference<{ location: string; quantity: number }>();
    Object.entries(locRows).forEach(([sku, rows]) => {
      const sorted = rows.sort((a, b) => preferred(a, b) || a.location.localeCompare(b.location));
      if (sorted[0]) {
        locMap[sku] = sorted[0].location;
      }
    });

    setSkuInventoryMap(map);
    setDirectSublocationMap(subMap);
    setSkuLocationsMap(locMap);
  }, [cartItems]);

  const cartSkuKey = cartItems
    .map((i) => i.sku)
    .sort()
    .join(',');
  useEffect(() => {
    fetchDistributions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSkuKey]);

  // Auto-resolve null locations and static low-stock flags in the database
  useEffect(() => {
    if (!activeListId || isReadOnly) return;
    if (Object.keys(skuLocationsMap).length === 0) return;
    if (!reservationsMap) return;

    let needsUpdate = false;
    const updated = cartItems.map((item) => {
      const newItem = { ...item };
      let changed = false;

      // 0. Registered since intake. The DB derives this on every write of
      // items, but the local copy only learns it from the round-trip — and
      // this effect's own write is a round-trip.
      if (newItem.sku_not_found && registeredStock(newItem.sku) !== undefined) {
        newItem.sku_not_found = false;
        changed = true;
      }

      // 1. If location is null but we resolved it dynamically
      if (!newItem.location && skuLocationsMap[newItem.sku]) {
        newItem.location = skuLocationsMap[newItem.sku];

        // Resolve sublocation
        const subKey = `${newItem.sku}-${newItem.location.toUpperCase()}`;
        if (sublocationMap[subKey] && sublocationMap[subKey].length > 0) {
          newItem.sublocation = sublocationMap[subKey];
        }
        changed = true;
      }

      // 2. If insufficient_stock is true but we now have enough stock in vivo
      if (newItem.insufficient_stock) {
        // stockMap is only fetched for items that were not UNREG; a SKU
        // registered mid-session reads its stock from the rows just loaded.
        const totalStock =
          stockMap[newItem.sku] ??
          (item.sku_not_found ? registeredStock(newItem.sku) : undefined) ??
          0;
        const totalReservedElsewhere = Array.from(reservationsMap?.entries() || [])
          .filter(([key]) => key.startsWith(`${newItem.sku}::${newItem.warehouse || 'LUDLOW'}::`))
          .reduce((sum, [, info]) => sum + info.reserved, 0);

        const liveInsufficient = totalStock - totalReservedElsewhere < (newItem.pickingQty || 0);
        if (!liveInsufficient) {
          newItem.insufficient_stock = false;
          changed = true;
        }
      }

      if (changed) {
        needsUpdate = true;
      }
      return newItem;
    });

    if (needsUpdate) {
      // Sort the updated items alphanumerically by location so they display in order
      const sorted = [...updated].sort((a, b) => {
        const locA = a.location || '';
        const locB = b.location || '';
        if (locA !== locB) {
          return locA.localeCompare(locB, undefined, { numeric: true, sensitivity: 'base' });
        }
        const subA =
          Array.isArray(a.sublocation) && a.sublocation.length > 0 ? a.sublocation[0] : '';
        const subB =
          Array.isArray(b.sublocation) && b.sublocation.length > 0 ? b.sublocation[0] : '';
        return subA.localeCompare(subB);
      });

      // Write back to the database
      void supabase
        .from('picking_lists')
        .update({ items: sorted })
        .eq('id', activeListId)
        .then(({ error }) => {
          if (error) {
            console.error('Error auto-resolving locations/stock in DB:', error);
          } else {
            console.log('Successfully auto-resolved locations and stock in database!');
          }
        });
    }
  }, [
    cartItems,
    skuLocationsMap,
    stockMap,
    reservationsMap,
    sublocationMap,
    activeListId,
    isReadOnly,
    registeredStock,
  ]);

  // Keep edit-callbacks ref fresh — see editCallbacksRef declaration above
  useEffect(() => {
    editCallbacksRef.current = { updateItem, deleteItem, addItem, fetchDistributions };
  }, [updateItem, deleteItem, addItem, fetchDistributions]);

  /**
   * Pick Plan Map: For each SKU, build a full picking plan that covers the order quantity.
   * Priority: PALLET > LINE > TOWER > OTHER, then fewest units_each within same type.
   */
  const pickPlanMap = useMemo(() => {
    const map: Record<string, { type: string; units: number; units_each: number; icon: string }[]> =
      {};

    // Aggregate total pickingQty per SKU across all pallets
    const skuQtyMap: Record<string, number> = {};
    pallets.forEach((p: Pallet) =>
      p.items.forEach((i: PickingItem) => {
        skuQtyMap[i.sku] = (skuQtyMap[i.sku] || 0) + (i.pickingQty || 0);
      })
    );

    Object.entries(skuQtyMap).forEach(([sku, neededQty]) => {
      const entries = skuInventoryMap[sku]?.filter((e) => e.distribution.length > 0) ?? [];
      if (entries.length === 0) return;

      // Flatten all distribution groups with count × units_each
      const groups: { type: string; count: number; units_each: number; priority: number }[] = [];
      entries.forEach((inv) => {
        inv.distribution.forEach((d) => {
          groups.push({
            type: d.type,
            count: d.count,
            units_each: d.units_each,
            priority: DISTRIBUTION_PRIORITY[d.type] ?? 99,
          });
        });
      });

      // Sort: by priority (PALLET first), then fewest units_each
      groups.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.units_each - b.units_each;
      });

      // Build pick plan consuming groups until neededQty is covered
      let remaining = neededQty;
      const steps: { type: string; units: number; units_each: number; icon: string }[] = [];

      for (const g of groups) {
        if (remaining <= 0) break;
        const availableUnits = g.count * g.units_each;
        const take = Math.min(remaining, availableUnits);
        steps.push({
          type: g.type,
          units: take,
          units_each: g.units_each,
          icon: STORAGE_TYPE_LABELS[g.type as keyof typeof STORAGE_TYPE_LABELS]?.icon || '🔹',
        });
        remaining -= take;
      }

      if (steps.length > 0) map[sku] = steps;
    });

    return map;
  }, [pallets, skuInventoryMap]);

  /** Detect distribution ↔ quantity inconsistencies per SKU+location */
  const distributionInconsistencyMap = useMemo(() => {
    const map: Record<string, 'over' | 'under'> = {};
    const orderSkus = new Set(
      pallets.flatMap((p: Pallet) => p.items.map((i: PickingItem) => i.sku))
    );

    orderSkus.forEach((sku) => {
      const entries = skuInventoryMap[sku] ?? [];
      entries.forEach((inv) => {
        if (inv.quantity === 0) return;
        const dist = inv.distribution;
        if (!dist || dist.length === 0) return;
        const distTotal = dist.reduce((sum, d) => sum + d.count * d.units_each, 0);
        if (distTotal > inv.quantity) {
          map[sku] = 'over';
        } else if (distTotal < inv.quantity) {
          if (!map[sku]) map[sku] = 'under';
        }
      });
    });

    return map;
  }, [pallets, skuInventoryMap]);

  // AS400-alias items (e.g. 03-4070BL stocked as 03-4070BK) whose alias SKU
  // covers the requested qty are not real stock problems — only a warning chip.
  const isUnresolvedProblem = useCallback(
    (i: {
      sku: string;
      pickingQty?: number;
      sku_not_found?: boolean;
      insufficient_stock?: boolean;
      warehouse?: string;
    }) => {
      if (i.sku_not_found && registeredStock(i.sku) === undefined) return true;
      if (!i.insufficient_stock) return false;

      const resolved = AS400_SKU_ALIASES[i.sku] ? canonicalResolution.get(i.sku) : undefined;
      if (resolved && resolved.quantity >= (i.pickingQty || 0)) return false;

      const totalStock = stockMap[i.sku] ?? (i.sku_not_found ? registeredStock(i.sku) : undefined);
      if (totalStock !== undefined) {
        const totalReservedElsewhere = Array.from(reservationsMap?.entries() || [])
          .filter(([key]) => key.startsWith(`${i.sku}::${i.warehouse || 'LUDLOW'}::`))
          .reduce((sum, [, info]) => sum + info.reserved, 0);
        return totalStock - totalReservedElsewhere < (i.pickingQty || 0);
      }

      return !!i.insufficient_stock;
    },
    [canonicalResolution, stockMap, reservationsMap, registeredStock]
  );

  const problemItems = useMemo(
    () => cartItems.filter(isUnresolvedProblem),
    [cartItems, isUnresolvedProblem]
  );

  // When a sub-order is selected, filter the cart down to only its items.
  // For grouped orders: show ALL items (the user edits the merged view, same as
  // double check). Each item has a source_order tag for routing corrections to
  // the correct picking_list. For single sub-order editing (picker modal), filter.
  const editingCartItems = useMemo(() => {
    if (!isCombined || !editingOrderNumber) return cartItems;
    // If editingOrderNumber contains ' / ', it's the combined group — show all
    if (editingOrderNumber.includes(' / ')) return cartItems;
    // Single sub-order selected via picker
    return cartItems.filter((i) => i.source_order === editingOrderNumber);
  }, [cartItems, editingOrderNumber, isCombined]);

  const editingProblemItems = useMemo(
    () => editingCartItems.filter(isUnresolvedProblem),
    [editingCartItems, isUnresolvedProblem]
  );

  // Map source_order → picking_list id for routing corrections in group edit
  const [sourceOrderMap, setSourceOrderMap] = useState<Map<string, string>>(new Map());

  const openEditDirectly = useCallback((listId: string | null, orderNum: string | null) => {
    setEditingListId(listId);
    setEditingOrderNumber(orderNum);
    setShowCorrectionMode(true);
  }, []);

  /**
   * Fetches the live sub-orders of the current order's group. Returns null when
   * the current order isn't combined or has no sibling candidates left — the
   * caller should fall back to single-order behavior in that case.
   */
  const fetchSubOrderOptions = useCallback(async (): Promise<SubOrderOption[] | null> => {
    if (!activeListId || !isCombined) return null;
    const { data: main } = await supabase
      .from('picking_lists')
      .select('group_id')
      .eq('id', activeListId)
      .single();
    if (!main?.group_id) return null;
    const { data: subs } = await supabase
      .from('picking_lists')
      .select('id, order_number, items')
      .eq('group_id', main.group_id)
      .neq('status', 'completed')
      .neq('status', 'cancelled')
      .order('order_number', { ascending: true });
    if (!subs || subs.length <= 1) return null;
    return subs.map((s) => {
      const items = Array.isArray(s.items) ? (s.items as unknown as PickingItem[]) : [];
      return {
        id: s.id,
        order_number: s.order_number,
        itemCount: items.length,
        totalQty: items.reduce((sum, it) => sum + (Number(it.pickingQty) || 0), 0),
      };
    });
  }, [activeListId, isCombined]);

  const openEditFlow = useCallback(async () => {
    if (!activeListId) return;

    // For grouped orders: build source_order → list_id map so corrections route correctly
    if (isCombined) {
      const { data: main } = await supabase
        .from('picking_lists')
        .select('group_id')
        .eq('id', activeListId)
        .single();
      if (main?.group_id) {
        const { data: subs } = await supabase
          .from('picking_lists')
          .select('id, order_number')
          .eq('group_id', main.group_id)
          .neq('status', 'completed')
          .neq('status', 'cancelled');
        if (subs && subs.length > 0) {
          const map = new Map<string, string>();
          for (const s of subs) {
            if (s.order_number) map.set(s.order_number, s.id);
          }
          setSourceOrderMap(map);
          // Open edit with combined order number → shows all items
          openEditDirectly(activeListId, orderNumber ?? null);
          return;
        }
      }
    }

    // Non-grouped or fallback
    setSourceOrderMap(new Map());
    const options = await fetchSubOrderOptions();
    if (!options) {
      openEditDirectly(activeListId, orderNumber ?? null);
      return;
    }
    setSubOrders(options);
    setSubOrderPickerMode('edit');
  }, [activeListId, orderNumber, isCombined, fetchSubOrderOptions, openEditDirectly]);

  // ── Stock issues: diagnose every LOW STOCK / UNREG line right here ──────
  // Edit Order used to own the auto-swap and the suggestions, so the picker
  // saw a badge and had to open it to learn which of five situations they
  // were in. The facts are all loaded by this view already; the variant
  // family and the shelf ranking are fetched once per problem SKU.
  const [siblingRowsMap, setSiblingRowsMap] = useState<Record<string, StockRow[]>>({});
  const [pickingOrderMap, setPickingOrderMap] = useState<PickingOrderMap | undefined>(undefined);
  const siblingFetchRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const pending = problemItems.filter(
      (i) => variantSiblingBase(i.sku) && !siblingFetchRef.current.has(i.sku)
    );
    if (pending.length === 0) return;
    pending.forEach((i) => siblingFetchRef.current.add(i.sku));
    void (async () => {
      try {
        if (!pickingOrderMap) {
          const { data } = await supabase
            .from('locations')
            .select('warehouse, location, picking_order');
          if (data) setPickingOrderMap(toPickingOrderMap(data));
        }
        const families = await Promise.all(
          pending.map(async (i) => {
            const base = variantSiblingBase(i.sku) as string;
            const [bikes, parts] = await Promise.all([
              inventoryApi.fetchInventoryWithMetadata({
                search: base,
                showParts: false,
                limit: 20,
              }),
              inventoryApi.fetchInventoryWithMetadata({ search: base, showParts: true, limit: 20 }),
            ]);
            return [i.sku, [...bikes.data, ...parts.data] as StockRow[]] as const;
          })
        );
        setSiblingRowsMap((prev) => {
          const next = { ...prev };
          for (const [sku, rows] of families) next[sku] = rows;
          return next;
        });
      } catch {
        // The diagnosis degrades to the exact-SKU facts; nothing to surface.
      }
    })();
  }, [problemItems, pickingOrderMap]);

  const stockIssues = useMemo(() => {
    const out = new Map<string, StockIssue>();
    for (const item of problemItems) {
      const wh = item.warehouse || 'LUDLOW';
      const rows = (skuInventoryMap[item.sku] ?? []).map((e) => ({
        location: e.location ?? null,
        warehouse: e.warehouse ?? wh,
        quantity: e.quantity,
      }));
      let reserved = 0;
      const orders: string[] = [];
      for (const [key, info] of reservationsMap?.entries() ?? []) {
        if (!key.startsWith(`${item.sku}::${wh}::`)) continue;
        reserved += info.reserved;
        for (const o of info.reservingOrders ?? []) {
          if (o.orderNumber && !orders.includes(o.orderNumber)) orders.push(o.orderNumber);
        }
      }
      const [similar] = findSimilarSkus(item.sku, wh, inventoryData, 1);
      out.set(
        item.sku,
        diagnoseStockIssue({
          sku: item.sku,
          pickingQty: item.pickingQty || 0,
          warehouse: wh,
          registered: !item.sku_not_found || registeredStock(item.sku) !== undefined,
          rows,
          reservedElsewhere: reserved,
          reservingOrders: orders,
          siblingRows: siblingRowsMap[item.sku],
          pickingOrder: pickingOrderMap,
          similar: similar
            ? {
                sku: similar.sku,
                location: similar.location,
                quantity: similar.quantity,
                item_name: similar.item_name,
              }
            : null,
        })
      );
    }
    return out;
  }, [
    problemItems,
    skuInventoryMap,
    reservationsMap,
    inventoryData,
    registeredStock,
    siblingRowsMap,
    pickingOrderMap,
  ]);

  const canCorrect =
    !!onCorrectItem &&
    !isReadOnly &&
    !isReviewMode &&
    status !== 'completed' &&
    status !== 'cancelled';
  const targetListFor = useCallback(
    (item: PickingItem) => item.source_list_id ?? activeListId ?? undefined,
    [activeListId]
  );
  const [issueBusySku, setIssueBusySku] = useState<string | null>(null);
  const [autoSwapped, setAutoSwapped] = useState<
    Map<
      string,
      {
        from: string;
        original: { location: string | null; warehouse: string; item_name: string | null };
      }
    >
  >(new Map());
  const autoSwapTriedRef = useRef<Set<string>>(new Set());

  // The one case that resolves itself: the same bike under its other catalog
  // name, with enough on a reachable shelf. Same rule Edit Order applied on
  // open — now it runs the moment the order is on screen. Once per SKU per
  // mount, and Undo puts the line back exactly as it was.
  useEffect(() => {
    if (!canCorrect || !onCorrectItem) return;
    for (const item of problemItems) {
      const issue = stockIssues.get(item.sku);
      if (!issue || issue.kind !== 'auto_swap' || autoSwapTriedRef.current.has(item.sku)) continue;
      autoSwapTriedRef.current.add(item.sku);
      const to = issue.to;
      const original = {
        location: item.location,
        warehouse: item.warehouse || 'LUDLOW',
        item_name: item.item_name ?? null,
      };
      void onCorrectItem(
        {
          type: 'swap',
          originalSku: item.sku,
          replacement: {
            sku: to.sku,
            location: to.location,
            warehouse: to.warehouse,
            item_name: to.item_name ?? null,
          },
          reason: 'Auto-resolved: out-of-stock equivalent',
        },
        targetListFor(item)
      )
        .then(() => {
          setAutoSwapped((prev) => new Map(prev).set(to.sku, { from: item.sku, original }));
          toast.success(`Swapped ${item.sku} → ${to.sku} · ${to.location ?? '?'} (${to.quantity})`);
        })
        .catch(() => toast.error(`Could not swap ${item.sku}`));
    }
  }, [problemItems, stockIssues, canCorrect, onCorrectItem, targetListFor]);

  const runIssueAction = useCallback(async (sku: string, fn: () => Promise<void>) => {
    setIssueBusySku(sku);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the order');
    } finally {
      setIssueBusySku(null);
    }
  }, []);
  const handleUndoAutoSwap = useCallback(
    (toSku: string) => {
      const entry = autoSwapped.get(toSku);
      if (!entry || !onCorrectItem) return;
      const item = cartItems.find((i) => i.sku === toSku);
      void runIssueAction(toSku, async () => {
        await onCorrectItem(
          {
            type: 'swap',
            originalSku: toSku,
            replacement: {
              sku: entry.from,
              location: entry.original.location,
              warehouse: entry.original.warehouse,
              item_name: entry.original.item_name,
            },
            flags: { insufficient_stock: true },
            reason: 'Undo auto-resolve',
          },
          item ? targetListFor(item) : undefined
        );
        setAutoSwapped((prev) => {
          const next = new Map(prev);
          next.delete(toSku);
          return next;
        });
      });
    },
    [autoSwapped, onCorrectItem, cartItems, targetListFor, runIssueAction]
  );
  const handleIssueTake = useCallback(
    (item: PickingItem, qty: number, reason: string) =>
      runIssueAction(item.sku, async () => {
        await onCorrectItem?.(
          { type: 'adjust_qty', sku: item.sku, newQty: qty, reason },
          targetListFor(item)
        );
      }),
    [onCorrectItem, runIssueAction, targetListFor]
  );
  const handleIssueRemove = useCallback(
    (item: PickingItem, reason: string) =>
      runIssueAction(item.sku, async () => {
        await onCorrectItem?.({ type: 'remove', sku: item.sku, reason }, targetListFor(item));
      }),
    [onCorrectItem, runIssueAction, targetListFor]
  );
  const handleIssueSwap = useCallback(
    (item: PickingItem, row: StockRow, qty: number, reason: string) =>
      runIssueAction(item.sku, async () => {
        await onCorrectItem?.(
          {
            type: 'swap',
            originalSku: item.sku,
            replacement: {
              sku: row.sku,
              location: row.location,
              warehouse: row.warehouse,
              item_name: row.item_name ?? null,
            },
            newQty: qty,
            reason,
          },
          targetListFor(item)
        );
      }),
    [onCorrectItem, runIssueAction, targetListFor]
  );
  // "Replace" needs a search; Edit Order already has one — open it straight
  // on this SKU's replace panel instead of the list of problems.
  const [correctionInitialPanel, setCorrectionInitialPanel] = useState<CorrectionPanel>(null);
  const handleIssueReplace = useCallback(
    (item: PickingItem) => {
      setCorrectionInitialPanel({ type: 'replace', sku: item.sku });
      void openEditFlow();
    },
    [openEditFlow]
  );

  const confirmCancelOrder = useCallback(
    (listId: string, orderNum: string | null) => {
      const label = orderNum ? `#${orderNum}` : `#${listId.slice(-6).toUpperCase()}`;
      showConfirmation(
        'Cancel Order',
        `Order ${label} will be cancelled. You can find it later in the cancelled orders list.`,
        async () => {
          try {
            await deleteList(listId);
            if (listId === activeListId) {
              // Cancelled the anchor order → drawer has nothing coherent left to show.
              onClose();
            } else if (activeListId) {
              // Cancelled a sibling → refresh the merged cart to reflect removal.
              await loadExternalList(activeListId);
            }
          } catch {
            toast.error('Failed to cancel order');
          }
        },
        () => {},
        'Cancel Order',
        'Go Back',
        'danger'
      );
    },
    [activeListId, showConfirmation, deleteList, loadExternalList, onClose]
  );

  const openCancelFlow = useCallback(async () => {
    if (!activeListId) return;
    const options = await fetchSubOrderOptions();
    if (!options) {
      confirmCancelOrder(activeListId, orderNumber ?? null);
      return;
    }
    setSubOrders(options);
    setSubOrderPickerMode('cancel');
  }, [activeListId, orderNumber, fetchSubOrderOptions, confirmCancelOrder]);

  // Auto-open edit flow for reopened orders (preserves the previous behavior, but now
  // routes combined orders through the sub-order picker).
  const reopenedAutoOpenedRef = useRef(false);
  useEffect(() => {
    if (
      status === 'reopened' &&
      !reopenedAutoOpenedRef.current &&
      activeListId &&
      cartItems.length > 0
    ) {
      reopenedAutoOpenedRef.current = true;
      openEditFlow();
    }
  }, [status, activeListId, cartItems.length, openEditFlow]);

  // Handle external actions triggered from Verification Board (Edit / Photo / Cancel)
  useEffect(() => {
    if (!activeListId || !initialAction || cartItems.length === 0) return;

    if (initialAction === 'edit') {
      openEditFlow();
    } else if (initialAction === 'photo') {
      // Trigger hidden camera file input click
      setTimeout(() => {
        scanInputRef.current?.click();
      }, 500);
    } else if (initialAction === 'cancel') {
      openCancelFlow();
    }
    onClearInitialAction?.();
  }, [
    activeListId,
    initialAction,
    openEditFlow,
    openCancelFlow,
    onClearInitialAction,
    cartItems.length,
  ]);

  const handleScanPallet = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (isReadOnly) {
        toast('You are in view-only mode. Takeover the order to use the scanner.', { icon: '👁️' });
        return;
      }
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = ''; // reset for re-scan

      // Optimistic: the user took a photo — that's enough to unlock completion.
      // We add a placeholder marker so the burst mode counter advances. The
      // real URL replaces it when the fire-and-forget upload below finishes.
      const newCount = palletPhotosCount + 1;
      const placeholderOwnerId = activeListId ?? 'pending';
      const ownerCurrentPhotos =
        photoRows.find((row) => row.id === placeholderOwnerId)?.pallet_photos ?? [];
      setOwnerPhotos(placeholderOwnerId, [...ownerCurrentPhotos, '']);

      // Burst mode: if we still need more photos to match pallet count,
      // auto-reopen the camera. Browsers preserve user activation briefly
      // after onChange, so this works on most devices.
      if (newCount < physicalPalletCount) {
        setTimeout(() => {
          scanInputRef.current?.click();
        }, 250);
      }

      setIsScanning(true);
      setScanStatus(
        newCount < physicalPalletCount
          ? `Photo ${newCount} of ${physicalPalletCount} — opening camera for next…`
          : 'Processing image...'
      );

      try {
        const rawResults = await scanImageForQRCodes(file);
        setScanStatus(`Detected ${rawResults.length} QR codes. Matching...`);

        const payloads = rawResults.map(parseQRPayload).filter(Boolean) as {
          shortCode: string;
          sku: string;
        }[];
        const orderSkus = cartItems.map((item) => item.sku);
        const { matched, unmatched } = aggregateScanResults(payloads, orderSkus);

        // Accumulate with previous scan results
        setScanResults((prev) => {
          const next = new Map(prev);
          for (const [sku, codes] of matched) {
            const existing = next.get(sku) ?? new Set();
            for (const code of codes) existing.add(code);
            next.set(sku, existing);
          }
          return next;
        });

        // Show warnings for unmatched
        if (unmatched.length > 0) {
          const skuList = [...new Set(unmatched.map((u) => u.sku))].join(', ');
          toast(`${unmatched.length} QR(s) not in this order: ${skuList}`, {
            icon: '⚠️',
            duration: 5000,
          });
        }

        const totalMatched = [...matched.values()].reduce((sum, set) => sum + set.size, 0);
        setScanStatus(`${totalMatched} QR codes matched. Tap "Scan" to add more.`);

        // Upload photo as proof (async, non-blocking)
        if (activeListId) {
          (async () => {
            try {
              const { image, thumbnail } = await compressImage(file);
              const photoId = crypto.randomUUID();
              const isLocal = window.location.hostname === 'localhost';

              let photoUrl: string | null = null;
              try {
                // Use gallery mode (proven working in prod) — same R2 path pattern
                const { data: uploadResult, error: uploadErr } = await supabase.functions.invoke(
                  'upload-photo',
                  {
                    body: { gallery: true, photoId, image, thumbnail },
                  }
                );
                if (uploadErr) throw uploadErr;
                photoUrl = (uploadResult as { url?: string } | null)?.url ?? null;
              } catch (err) {
                if (!isLocal) {
                  console.error('Pallet photo R2 upload failed:', err);
                  throw err;
                }
                console.warn('R2 upload failed in local — using blob URL fallback');
              }

              // Local dev fallback: blob URL so it shows in the UI without R2
              if (!photoUrl && isLocal) {
                photoUrl = base64ToBlobUrl(image);
              }
              if (!photoUrl) return;

              // Read current photos, append new, write back
              const { data: current } = await supabase
                .from('picking_lists')
                .select('pallet_photos')
                .eq('id', activeListId)
                .single();
              const existing = Array.isArray(current?.pallet_photos)
                ? (current.pallet_photos as string[])
                : [];
              const photos = [...existing, photoUrl];
              await supabase
                .from('picking_lists')
                .update({ pallet_photos: photos })
                .eq('id', activeListId);
              // Replace the placeholder with the real URL (or sync from DB)
              setOwnerPhotos(activeListId, photos);
            } catch (err) {
              console.error('Pallet photo upload failed:', err);
            }
          })();
        }
      } catch (err) {
        console.error('Scan failed:', err);
        setScanStatus('Scan failed. Try again.');
      } finally {
        setIsScanning(false);
      }
    },
    [
      cartItems,
      palletPhotosCount,
      physicalPalletCount,
      activeListId,
      isReadOnly,
      photoRows,
      setOwnerPhotos,
    ]
  );

  // Auto-check items where scan count >= pickingQty
  useEffect(() => {
    if (scanResults.size === 0) return;
    for (const [sku, codes] of scanResults) {
      const scannedCount = codes.size;
      const matchingItems = cartItems.filter((item) => item.sku === sku);
      for (const item of matchingItems) {
        if (scannedCount >= item.pickingQty) {
          for (const pallet of pallets) {
            for (const pItem of pallet.items) {
              if (pItem.sku === sku) {
                const key = `${pallet.id}-${pItem.sku}-${pItem.location}`;
                if (!checkedItems.has(key)) {
                  handleToggleCheck(pItem, pallet.id);
                }
              }
            }
          }
        }
      }
    }
  }, [scanResults, cartItems, pallets, checkedItems, handleToggleCheck]);

  const handleConfirm = async () => {
    const isFullyVerified = verifiedUnitsCount === totalUnitsCount;
    setIsDeducting(true);
    try {
      // If status is active and fully verified, do markAsReady + deduct in one step
      if (
        (status === 'active' || status === 'needs_correction') &&
        isFullyVerified &&
        onMarkAsReady
      ) {
        await onMarkAsReady();
        // Small delay for DB status to propagate before deduction
        await new Promise((r) => setTimeout(r, 300));
      }
      await onDeduct(cartItems, isFullyVerified);
      // Ship-Out SMS auto-prompt removed by request — it popped up on every
      // completion and was intrusive. The SMS can still be sent on demand via
      // the "Resend Ship-Out SMS" button (OrdersScreen FAB / PickingSummary).
    } catch (error) {
      console.error(error);
    } finally {
      setIsDeducting(false);
    }
  };

  const handleReturnToPicker = async () => {
    if (!correctionNotes.trim()) return;
    showConfirmation(
      'Confirm Return',
      'Are you sure you want to return this order to the verification list?',
      async () => {
        try {
          await onAddNote(correctionNotes.trim());
          onReturnToPicker(correctionNotes.trim());
          setCorrectionNotes('');
          setIsNotesExpanded(false);
          onClose();
          toast.success('Order returned for correction');
        } catch (error) {
          console.error('Failed to send for correction:', error);
          toast.error('Failed to return order');
        }
      },
      () => {},
      'Return to Verification List',
      'Cancel',
      'warning'
    );
  };

  return (
    <div className="flex flex-col h-full bg-main relative">
      {/* Minimalist Header */}
      <div className="px-3 py-1.5 flex items-center justify-between shrink-0 bg-main/90 backdrop-blur-md sticky top-0 z-10 touch-none border-b border-subtle">
        <button
          onClick={() => onBack()}
          className="p-1.5 -ml-1 hover:bg-card rounded-full text-content/70 transition-colors shrink-0"
          title={isReviewMode ? 'Close' : 'Release to Queue'}
        >
          <ChevronLeft size={24} />
        </button>

        <div className="flex flex-col items-center flex-1 min-w-0">
          {/* Order number + shipping + pallets/units — ALWAYS visible (no auto-hide),
              using the full header width so nothing important disappears. */}
          <div className="flex flex-col items-center transition-all duration-300 overflow-hidden">
            <div className="flex items-center gap-1.5 relative flex-wrap justify-center">
              {(() => {
                const fallback = activeListId
                  ? `#${activeListId.slice(-6).toUpperCase()}`
                  : 'STOCK DEDUCTION';
                // Single (0/1 orders) keeps the plain accent chip. Combined
                // orders render each number in its per-order color (flat, no
                // 3D here) — the same colors used on the board and on the
                // item-row stripes below.
                if (combinedNumbers.length <= 1) {
                  const header = orderHeaderLabel(orderNumber, fallback);
                  return (
                    <span className="text-sm md:text-base font-mono font-black text-accent/90 tracking-widest bg-accent/10 px-2 py-0.5 rounded-lg border border-accent/20 whitespace-nowrap">
                      {header.label}
                    </span>
                  );
                }
                // Combined (2+): every order visible at a glance — last 3 of
                // each in its per-order color. No +N badge, no dropdown.
                return (
                  <CombinedOrderNumbers
                    numbers={combinedNumbers}
                    activeOrderFilter={activeOrderFilter}
                    onToggle={toggleOrderFilter}
                    unitsByOrder={orderQuantities}
                    variant="header"
                  />
                );
              })()}
              {isFedexOrder && <FedexRecipientChip listId={activeListId ?? null} compact />}
              {activeListId && (
                <ShippingTypeToggle listId={activeListId} autoType={effectiveShippingType} />
              )}
              {totalUnitsCount > 0 && (
                <span
                  className="text-sm md:text-base font-black tracking-widest text-muted/80 whitespace-nowrap"
                  title={`${totalUnitsCount} units in this order`}
                >
                  {totalUnitsCount}u
                </span>
              )}
              {/* Order note (e.g. "FF N90") — inline & compact; truncates instead
                  of wrapping the single-line header (full text on tap/hover). */}
              {watcherNote && (
                <span
                  className="text-[10px] font-black uppercase tracking-widest text-red-400 truncate max-w-[30vw]"
                  title={watcherNote}
                >
                  {watcherNote}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 relative">
          {/* Actions kebab — opens dropdown with Edit Order / Combine /
              Mark Waiting / Cancel. Hidden in review mode, read-only mode, and when complete. */}
          {!isReviewMode && status !== 'completed' && (
            <button
              onClick={() => setActionsMenuOpen((v) => !v)}
              className={`p-1.5 rounded-full transition-colors ${
                actionsMenuOpen
                  ? 'bg-card text-content'
                  : 'hover:bg-card text-muted hover:text-content'
              }`}
              title="Actions"
              aria-haspopup="true"
              aria-expanded={actionsMenuOpen}
            >
              <MoreVertical size={20} />
              {problemItems.length > 0 && (
                <span className="absolute top-0.5 right-0.5 w-2 h-2 rounded-full bg-red-500 ring-2 ring-main" />
              )}
            </button>
          )}
          {!correctionNotes.trim() && status !== 'completed' && (
            <button
              onClick={status === 'reopened' ? onCancelReopen : onRelease}
              className="p-1.5 hover:bg-card rounded-full text-muted transition-colors"
              title={status === 'reopened' ? 'Cancel Edit' : 'Park & Close'}
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Shared order actions menu — same component + item set as the Live
          Board's card menu, rendered as a centered modal. */}
      {actionsMenuOpen && (
        <OrderActionsMenu
          orderNumber={orderNumber ?? null}
          fallbackId={activeListId ? String(activeListId).slice(-6).toUpperCase() : undefined}
          status={status ?? ''}
          isWaiting={isWaitingInventory}
          groupId={activeGroupId}
          groupMembers={groupMembers}
          problemCount={problemItems.length}
          photo={{ count: palletPhotosCount, total: physicalPalletCount, isScanning }}
          canWait={isAdmin && status !== 'cancelled'}
          canMerge={
            !isCombined &&
            (status === 'active' ||
              status === 'ready_to_double_check' ||
              status === 'double_checking' ||
              status === 'needs_correction')
          }
          onClose={() => setActionsMenuOpen(false)}
          onEdit={
            !isReadOnly
              ? () => {
                  setActionsMenuOpen(false);
                  openEditFlow();
                }
              : undefined
          }
          onTakePhoto={() => {
            setActionsMenuOpen(false);
            scanInputRef.current?.click();
          }}
          onMarkWaiting={
            !isReadOnly
              ? () => {
                  setActionsMenuOpen(false);
                  setShowWaitingPicker(true);
                }
              : undefined
          }
          onResume={
            !isReadOnly
              ? () => {
                  setActionsMenuOpen(false);
                  if (!activeListId) return;
                  unmarkWaiting.mutate(
                    { listId: activeListId, action: 'resume' },
                    { onSuccess: () => onSetWaitingInventory?.(false) }
                  );
                }
              : undefined
          }
          onMerge={
            !isReadOnly && onCombineWith
              ? () => {
                  setActionsMenuOpen(false);
                  onCombineWith();
                }
              : undefined
          }
          onUngroup={
            !isReadOnly && onUngroup
              ? async (orderId, groupId) => {
                  setActionsMenuOpen(false);
                  await onUngroup(orderId, groupId);
                  queryClient.invalidateQueries({ queryKey: ['picking_list_meta'] });
                  queryClient.invalidateQueries({ queryKey: ['group_members'] });
                }
              : undefined
          }
          onCancel={
            !isReadOnly
              ? () => {
                  setActionsMenuOpen(false);
                  openCancelFlow();
                }
              : undefined
          }
        />
      )}

      {/* Clean Item List */}
      <div className="flex-1 overflow-y-auto p-3 bg-main min-h-0 pb-32">
        {/* Mark-as-Waiting reason modal — centered, blurred-backdrop overlay
            opened from the kebab menu. Portals to <body>, so it stays centered
            even when the item list is scrolled to the bottom (previously it
            rendered inline at the top and appeared off-screen / like a no-op). */}
        {showWaitingPicker &&
          isAdmin &&
          status !== 'completed' &&
          status !== 'cancelled' &&
          !isWaitingInventory &&
          activeListId && (
            <WaitingReasonModal
              listId={activeListId}
              onClose={() => setShowWaitingPicker(false)}
              onMarked={() => onSetWaitingInventory?.(true)}
            />
          )}

        {/* Persistent waiting badge when the order is currently on hold */}
        {isWaitingInventory && status !== 'completed' && status !== 'cancelled' && (
          <div className="mb-4 flex items-center gap-2 p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <Hourglass size={14} className="text-amber-500 shrink-0" />
            <span className="text-[11px] font-black text-amber-500 uppercase tracking-wider">
              Waiting for Inventory
            </span>
          </div>
        )}

        {/* Hidden camera input for pallet scan — triggered by 'Take Photo' in
            the kebab menu. Status text surfaces inline below when scanning. */}
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScanPallet}
          className="hidden"
        />
        {scanStatus && (
          <p className="text-xs text-accent font-bold mb-3 flex items-center gap-2">
            <Loader2 size={12} className="animate-spin" />
            {scanStatus}
          </p>
        )}

        {/* Pallet photo thumbnails with delete */}
        {palletPhotos.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {palletPhotos.map((url, i) => (
              <div key={i} className="relative group">
                <button
                  onClick={() => url && setPalletLightboxIndex(i)}
                  disabled={!url}
                  className="w-16 h-16 rounded-xl overflow-hidden border border-subtle bg-surface flex items-center justify-center"
                >
                  {url ? (
                    <img src={url} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <Loader2 size={16} className="animate-spin text-muted/50" />
                  )}
                </button>
                <button
                  onClick={() => handleDeletePalletPhoto(i)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center shadow-lg hover:bg-red-600 active:scale-90 transition-all"
                  title="Delete photo"
                >
                  <X size={12} className="text-white" strokeWidth={3} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() => scanInputRef.current?.click()}
              disabled={isScanning}
              className="w-16 h-16 rounded-xl border border-dashed border-subtle bg-surface flex items-center justify-center text-content/60 hover:text-accent hover:border-accent transition-colors disabled:opacity-50"
              title="Take another photo"
              aria-label="Take another photo"
            >
              {isScanning ? (
                <Loader2 size={16} className="animate-spin text-accent" />
              ) : (
                <span className="text-2xl font-light leading-none">+</span>
              )}
            </button>
          </div>
        )}

        {palletLightboxIndex !== null && palletPhotos[palletLightboxIndex] && (
          <PhotoLightbox
            photos={palletPhotos.filter(Boolean)}
            index={Math.min(palletLightboxIndex, palletPhotos.filter(Boolean).length - 1)}
            onClose={() => setPalletLightboxIndex(null)}
            onIndexChange={setPalletLightboxIndex}
            caption={orderNumber ? `Order #${orderNumber}` : undefined}
          />
        )}

        {physicalPalletCount === 0 && pallets.length === 0 && cartItems.length > 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <AlertCircle className="text-amber-500 mb-4 opacity-30" size={48} />
            <p className="text-sm font-black text-muted uppercase tracking-widest">
              No pallets generated
            </p>
          </div>
        )}

        {/* Correction notes banner (visible in needs_correction) */}
        {correctionNotesProp && isReviewMode && (
          <div className="mb-4 p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
              <AlertCircle size={18} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-black text-amber-500/70 uppercase tracking-widest mb-1">
                Correction Needed
              </p>
              <p className="text-sm font-medium text-content italic leading-relaxed">
                &ldquo;{correctionNotesProp}&rdquo;
              </p>
            </div>
          </div>
        )}

        {/* Stale pick-location guard (drift): frozen location empty but stock exists elsewhere */}
        {staleLocations.length > 0 && (
          <div className="mb-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
              <AlertCircle size={18} />
            </div>
            <div className="flex-1">
              <p className="text-xs font-black text-amber-500/80 uppercase tracking-widest mb-1">
                Moved since this order was built
              </p>
              <p className="text-[11px] font-medium text-muted mb-2 leading-relaxed">
                {staleLocations.length > 1 ? 'These are' : 'This is'} no longer all in one place.
                Pick from the{' '}
                {staleLocations.some((s) => s.legs.length > 1) ? 'addresses' : 'address'} below —
                that is also where the units come off.
              </p>
              <ul className="space-y-1">
                {staleLocations.map((s) => (
                  <li
                    key={`${s.sku}-${s.frozenLocation}`}
                    className="text-sm font-medium text-content"
                  >
                    <span className="font-black">{s.sku}</span>{' '}
                    <span className="text-amber-500/80 line-through">{s.frozenLocation}</span>{' '}
                    <span className="text-muted">→</span>{' '}
                    {s.legs.length > 1 ? (
                      // Split pick: the whole route, so the banner and the cards
                      // tell the picker the same story.
                      s.legs.map((leg, i) => (
                        <React.Fragment key={`${leg.location}-${i}`}>
                          {i > 0 && <span className="text-muted"> + </span>}
                          <span
                            className={`font-black ${leg.isLastResort ? 'text-amber-400' : 'text-emerald-400'}`}
                          >
                            {leg.location}
                            {leg.sublocation?.length ? ` · ${leg.sublocation.join('/')}` : ''}
                          </span>{' '}
                          <span className="text-muted">(take {leg.qty})</span>
                        </React.Fragment>
                      ))
                    ) : (
                      <>
                        <span className="font-black text-emerald-400">
                          {s.suggestedLocation}
                          {s.suggestedSublocation?.length
                            ? ` · ${s.suggestedSublocation.join('/')}`
                            : ''}
                        </span>{' '}
                        <span className="text-muted">({s.suggestedQty} in stock)</span>
                      </>
                    )}
                    {s.shortfall > 0 && (
                      <span className="text-rose-400 font-black"> · {s.shortfall} short</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/*
          FedEx cannot rate a carton it has no record of. The Dimensions export
          ships only SKUs that pass utils/fedexCarton, so anything it held back
          is missing on the FedEx side -- and nobody finds out until the rate
          comes back wrong and someone has to go dig up the box. Surfaced here
          because this is the last screen where the box is still in front of a
          person. Regular orders are not warned: the record only matters when
          FedEx is quoting it.
        */}
        {isFedexOrder && (
          <UnratedCartonsBanner
            cartons={unratedCartons}
            onMeasured={(sku, stored) =>
              setUnratedCartons((prev) =>
                prev.map((c) =>
                  c.sku === sku ? { ...c, state: 'pending_export' as const, gap: null, stored } : c
                )
              )
            }
          />
        )}

        {pallets.map((pallet: Pallet) => {
          const palletUnits = pallet.items.reduce(
            (sum: number, i: PickingItem) => sum + (i.pickingQty || 0),
            0
          );
          // Per-pallet verified count — replaces the old global "X / Y Pickd"
          // header counter (idea: progress is more useful scoped to the pallet
          // you're working, and "Pallet i/n" already conveys the pallet total).
          const palletVerified = pallet.items.reduce(
            (sum: number, i: PickingItem) =>
              sum +
              (checkedItems.has(`${pallet.id}-${i.sku}-${i.location}`) ? i.pickingQty || 0 : 0),
            0
          );
          const isLocked = palletOverrides.has(pallet.id);
          const isEditing = editingPalletId === pallet.id;

          return (
            <section key={pallet.id} className="mb-4">
              {/* Pallet Header */}
              <div className="flex items-center gap-3 mb-2 sticky top-0 bg-main/95 py-1 z-5 backdrop-blur-sm">
                <div className="h-[1px] flex-1 bg-card" />
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-black uppercase tracking-[0.2em] px-3 py-1 rounded-full border flex items-center gap-1.5 ${
                      isLocked
                        ? 'text-amber-400/80 border-amber-500/30 bg-amber-500/5'
                        : isFedexOrder
                          ? 'text-purple-300 border-purple-500/40 bg-purple-500/10'
                          : 'text-muted/70 border-subtle'
                    }`}
                  >
                    {isLocked && <Lock size={8} />}
                    {pallet.isParts ? 'Parts' : `Pallet ${pallet.id}/${physicalPalletCount}`}
                  </span>
                  {/* Per-pallet progress + edit — single line. The denominator IS the
                      pallet's units, so the old separate "N Units" line was redundant;
                      the pencil (pallet-units override) now sits on the counter. */}
                  {isEditing ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onBlur={handlePalletEditConfirm}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handlePalletEditConfirm();
                          if (e.key === 'Escape') setEditingPalletId(null);
                        }}
                        autoFocus
                        className="w-14 bg-blue-500/20 border border-blue-500/40 rounded-lg px-2 py-0.5 text-center text-[11px] font-black text-blue-300 focus:outline-none focus:border-blue-400"
                      />
                      <span className="text-[11px] font-black text-blue-400/60 uppercase">
                        Units
                      </span>
                    </div>
                  ) : (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePalletEdit(pallet.id, palletUnits);
                      }}
                      className="flex items-center gap-1 group/edit"
                      title="Tap to edit this pallet's units"
                    >
                      <span
                        className={`text-lg font-black tracking-widest tabular-nums ${
                          palletVerified === 0
                            ? 'text-red-400'
                            : palletVerified >= palletUnits
                              ? 'text-emerald-400'
                              : 'text-amber-400'
                        }`}
                      >
                        {palletVerified} / {palletUnits}
                      </span>
                      <Pencil
                        size={10}
                        className="text-muted/40 group-hover/edit:text-muted transition-colors"
                      />
                    </button>
                  )}
                </div>
                <div className="h-[1px] flex-1 bg-card" />
              </div>

              <div className="flex flex-col gap-3">
                {pallet.items.map((item: PickingItem, itemIdx: number) => {
                  const itemKey = `${pallet.id}-${item.sku}-${item.location}`;
                  const isChecked = checkedItems.has(itemKey);
                  // Once an item is checked, collapse its detail (name, distribution
                  // plan, sublocation) so the remaining unchecked rows stand out and
                  // are easier to spot. Review mode keeps everything visible.
                  const hideDetails = isChecked && !isReviewMode;
                  const similarity = skuSimilarityMap[item.sku];
                  // Canonical-SKU fallback: if a not-found item resolves via its
                  // canonical SKU, treat it as found and show its location.
                  const canonResolved = canonicalResolution.get(item.sku);
                  // ...and a SKU registered since intake is found, whatever the
                  // stored flag still says (registeredStock, above).
                  const skuNotFound =
                    !!item.sku_not_found &&
                    !canonResolved &&
                    registeredStock(item.sku) === undefined;
                  // AS400 alias (e.g. 03-4070BL stocked as 03-4070BK): when the
                  // alias SKU covers the qty, drop the out-of-stock alarm — the
                  // small AS400 chip next to the SKU is the only reminder.
                  const aliasTarget = AS400_SKU_ALIASES[item.sku];
                  const aliasCovered =
                    !!aliasTarget &&
                    !!canonResolved &&
                    canonResolved.quantity >= (item.pickingQty || 0);
                  const totalStock =
                    stockMap[item.sku] ??
                    (item.sku_not_found ? registeredStock(item.sku) : undefined);
                  const totalReservedElsewhere = Array.from(reservationsMap?.entries() || [])
                    .filter(([key]) =>
                      key.startsWith(`${item.sku}::${item.warehouse || 'LUDLOW'}::`)
                    )
                    .reduce((sum, [, info]) => sum + info.reserved, 0);
                  const liveInsufficient =
                    totalStock !== undefined
                      ? totalStock - totalReservedElsewhere < (item.pickingQty || 0)
                      : !!item.insufficient_stock;
                  const insufficientStock = liveInsufficient && !aliasCovered;
                  const displayLocation =
                    item.location || skuLocationsMap[item.sku] || canonResolved?.location || null;
                  // SKU font shrinks by length so a long SKU fits its column WHOLE
                  // (no truncation, no overflow into the distribution/location cols).
                  const skuText = sdSerialMap.get(item.sku) ?? item.sku;
                  const skuSizeCls =
                    skuText.length <= 9
                      ? 'text-2xl md:text-5xl'
                      : skuText.length <= 12
                        ? 'text-xl md:text-4xl'
                        : skuText.length <= 15
                          ? 'text-lg md:text-3xl'
                          : 'text-base md:text-2xl';
                  // Pick-plan steps: exact-SKU plan, else the canonical SKU's distribution.
                  const planSteps: { type: string; units_each: number }[] | null =
                    pickPlanMap[item.sku] ??
                    (canonResolved
                      ? [...canonResolved.distribution]
                          .sort(
                            (a, b) =>
                              (DISTRIBUTION_PRIORITY[a.type] ?? 99) -
                                (DISTRIBUTION_PRIORITY[b.type] ?? 99) || a.units_each - b.units_each
                          )
                          .map((d) => ({ type: d.type, units_each: d.units_each }))
                      : null);
                  const prevItem = itemIdx > 0 ? pallet.items[itemIdx - 1] : null;
                  const showPartsDivider =
                    !!item.isStackedPart && (!prevItem || !prevItem.isStackedPart);
                  // Combined orders: left stripe with EVERY owning order's
                  // color, segments sized by each order's qty share — same
                  // palette as the header numbers and the board cards.
                  const stripeShares = isCombined
                    ? (skuSourceShares?.byKey.get(`${item.sku}|${item.location ?? ''}`) ??
                      skuSourceShares?.bySku.get(item.sku) ??
                      (item.source_order ? [{ order: item.source_order, qty: 1 }] : null))
                    : null;

                  return (
                    <React.Fragment key={itemKey}>
                      {showPartsDivider && (
                        <div
                          className="flex items-center gap-3 pt-2 pb-1"
                          data-testid="parts-divider"
                        >
                          <div className="h-[1px] flex-1 bg-emerald-500/20" />
                          <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-400/80 px-2">
                            Parts on section
                          </span>
                          <div className="h-[1px] flex-1 bg-emerald-500/20" />
                        </div>
                      )}
                      <div
                        onPointerDown={() => handlePointerDown(item, displayLocation)}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        onClick={() => {
                          if (isReviewMode) return;
                          if (longPressTriggered.current) return;
                          if (navigator.vibrate) navigator.vibrate(50);
                          handleToggleCheck(item, pallet.id);
                        }}
                        className={`relative overflow-hidden transition-all duration-200 rounded-2xl flex items-center justify-between gap-3 ${isReviewMode ? '' : 'active:scale-[0.98] cursor-pointer'} border ${
                          isChecked && !isReviewMode
                            ? 'px-2 py-4 opacity-70 scale-[0.97]'
                            : 'px-4 py-9'
                        } ${
                          isReviewMode
                            ? skuNotFound
                              ? 'bg-red-500/5 border-red-500/20'
                              : insufficientStock
                                ? 'bg-amber-500/5 border-amber-500/20'
                                : 'bg-card border-subtle'
                            : isChecked
                              ? skuNotFound
                                ? 'bg-red-500/20 border-red-500/50'
                                : 'bg-green-500/10 border-green-500/30'
                              : skuNotFound
                                ? 'bg-red-500/5 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
                                : 'bg-card border-subtle hover:border-subtle'
                        }`}
                      >
                        {stripeShares && stripeShares.length > 0 && (
                          <div
                            className="absolute left-0 top-0 bottom-0 w-[5px] flex flex-col"
                            title={stripeShares.map((s) => `#${s.order}: ${s.qty}`).join('  ·  ')}
                          >
                            {stripeShares.map((s) => (
                              <div
                                key={s.order}
                                style={{
                                  flexGrow: Math.max(s.qty, 1),
                                  backgroundColor: orderColorFor(s.order, combinedNumbers).hex,
                                }}
                              />
                            ))}
                          </div>
                        )}
                        <div
                          className="flex items-center gap-2 min-w-0"
                          style={{ transform: 'scaleY(1.5)' }}
                        >
                          {/* Qty on the far left — the biggest number on the row.
                              Tight width: most qtys are 1 digit, so reserve just
                              enough and let it grow for 2–3 digit cases. */}
                          <div className="flex flex-col items-center justify-center min-w-[1.75rem] shrink-0 border-r border-subtle pr-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-0.5">
                              QTY
                            </span>
                            <span
                              className={`text-4xl md:text-7xl font-black leading-none transition-all ${
                                item.pickingQty !== 1
                                  ? 'text-orange-500 animate-qty-alert'
                                  : isChecked
                                    ? 'text-muted'
                                    : 'text-content'
                              }`}
                            >
                              {item.pickingQty}
                            </span>
                            {/* Split pick: this SKU did not fit on one shelf, so it
                                appears once per address. Without this the two cards
                                read as a duplicated SKU and the picker "fixes" it. */}
                            {item.pickSplit && (
                              <div
                                title={`Stop ${item.pickSplit.part} of ${item.pickSplit.of} — ${item.pickingQty} of ${item.pickSplit.totalQty} units come off ${item.location ?? 'this address'}`}
                                className={`mt-1 flex flex-col items-center rounded px-1 py-0.5 leading-none ${
                                  item.pickSplit.isLastResort
                                    ? 'bg-amber-500/15 text-amber-500'
                                    : 'bg-sky-500/15 text-sky-400'
                                }`}
                              >
                                <span className="text-[9px] font-black uppercase tracking-wider whitespace-nowrap">
                                  {item.pickSplit.part}/{item.pickSplit.of}
                                </span>
                                <span className="text-[8px] font-bold uppercase tracking-wide whitespace-nowrap opacity-80">
                                  of {item.pickSplit.totalQty}
                                </span>
                              </div>
                            )}
                          </div>

                          {item.sku_metadata?.image_url && (
                            <img
                              src={
                                item.sku_metadata.image_url.includes('/catalog/')
                                  ? item.sku_metadata.image_url
                                      .replace('/catalog/', '/catalog/thumbs/')
                                      .replace('.png', '.webp')
                                  : item.sku_metadata.image_url.includes('/photos/')
                                    ? item.sku_metadata.image_url.replace(
                                        '/photos/',
                                        '/photos/thumbs/'
                                      )
                                    : item.sku_metadata.image_url
                              }
                              alt={item.sku}
                              loading="lazy"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                              className="w-9 h-9 object-contain rounded flex-shrink-0 border border-subtle"
                            />
                          )}
                          <div className="flex flex-col gap-2 min-w-0">
                            {/* SKU row */}
                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                              <span
                                className={`font-black ${skuSizeCls} tracking-tight leading-none whitespace-nowrap ${isReviewMode ? (skuNotFound || insufficientStock ? 'text-red-500' : 'text-content') : isChecked ? (skuNotFound || insufficientStock ? 'text-red-400' : 'text-green-400') : skuNotFound || insufficientStock ? 'text-red-500' : 'text-content'}`}
                              >
                                {sdSerialMap.has(item.sku) ? (
                                  // S/D: show the physical serial instead of the SKU.
                                  // Scanning still uses SKU — this is display-only.
                                  sdSerialMap.get(item.sku)
                                ) : (
                                  <>
                                    {similarity?.prefix ? (
                                      <span className="animate-pulse-highlight">
                                        {item.sku.substring(0, 2)}
                                      </span>
                                    ) : (
                                      item.sku.substring(0, 2)
                                    )}
                                    {item.sku.substring(2, item.sku.length - 2)}
                                    {similarity?.suffix ? (
                                      <span className="animate-pulse-highlight">
                                        {item.sku.substring(item.sku.length - 2)}
                                      </span>
                                    ) : (
                                      item.sku.substring(item.sku.length - 2)
                                    )}
                                  </>
                                )}
                              </span>
                              {skuNotFound && (
                                <span className="text-[10px] bg-red-500 text-white px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">
                                  UNREG
                                </span>
                              )}
                              {insufficientStock && !skuNotFound && (
                                <span className="text-[10px] bg-amber-500 text-black px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">
                                  LOW STOCK
                                </span>
                              )}
                              {aliasTarget && (
                                <span
                                  title={`AS400 catalogs this as ${item.sku} — physical stock is ${aliasTarget}`}
                                  className="text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 px-1 py-0.5 rounded font-black uppercase tracking-tighter"
                                >
                                  AS400 → {aliasTarget}
                                </span>
                              )}
                              {(() => {
                                if (item.sku_not_found || !item.warehouse || !item.location)
                                  return null;
                                const key = buildReservationKey(
                                  item.sku,
                                  item.warehouse,
                                  item.location
                                );
                                const info = reservationsMap?.get(key);
                                if (!info) return null;
                                const otherDemand = info.reserved + info.picked;
                                if (otherDemand <= 0) return null;
                                const availableForMe = info.stock - info.reserved;
                                const conflict = availableForMe < item.pickingQty;
                                const orderList = info.reservingOrders
                                  .map(
                                    (o) =>
                                      `${o.picked ? '✓' : '◷'} ${o.qty}× #${o.orderNumber}${o.customerName ? ` (${o.customerName})` : ''}${o.isWaiting ? ' [waiting]' : ''}`
                                  )
                                  .join('\n');
                                return (
                                  <span
                                    title={`Stock: ${info.stock}\nReserved by other orders: ${info.reserved}\nAlready picked by other orders: ${info.picked}\nAvailable for me: ${availableForMe}\n\n${orderList}`}
                                    className={`text-[10px] px-1 py-0.5 rounded font-black uppercase tracking-tighter ${
                                      conflict
                                        ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                                        : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                    }`}
                                  >
                                    🔒 {otherDemand} for #
                                    {info.reservingOrders[0]?.orderNumber ?? '?'}
                                    {info.reservingOrders.length > 1 &&
                                      ` +${info.reservingOrders.length - 1}`}
                                  </span>
                                );
                              })()}
                              {(() => {
                                const scannedCount = scanResults.get(item.sku)?.size ?? 0;
                                if (scannedCount === 0) return null;
                                return (
                                  <span
                                    className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      scannedCount >= item.pickingQty
                                        ? 'bg-green-500/20 text-green-500'
                                        : 'bg-amber-500/20 text-amber-500'
                                    }`}
                                  >
                                    {scannedCount}/{item.pickingQty} scanned
                                  </span>
                                );
                              })()}
                            </div>
                            {/* Product name — item_name from DB, or description from PDF.
                                Smaller/quieter now that distribution moved to its own column. */}
                            {!hideDetails && (item.item_name || item.description) && (
                              <span className="text-[11px] md:text-base font-semibold text-muted uppercase tracking-wide leading-none">
                                {(item.item_name || item.description || '').slice(0, 17)}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Distribution — MIDDLE column (SKU left · distribution center · location right).
                            flex-1 centers it; min-w-0 lets it yield so it never pushes into location. */}
                        <div
                          className="flex-1 flex items-center justify-center px-1 min-w-0 overflow-hidden"
                          style={{ transform: 'scaleY(1.5)' }}
                        >
                          {!hideDetails && planSteps && planSteps.length > 0 ? (
                            <div
                              className={`${
                                distributionInconsistencyMap[item.sku] === 'over'
                                  ? 'text-red-400/90'
                                  : distributionInconsistencyMap[item.sku] === 'under'
                                    ? 'text-orange-400/90'
                                    : 'text-emerald-400/70'
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                {/* idea-137: count OUTSIDE the glyph, big and readable
                                    from afar (like the LOC number) — the glyph shape
                                    alone identifies LINE/TOWER/PALLET. */}
                                {planSteps.map((step, i) => (
                                  <div key={i} className="flex items-center gap-1">
                                    <DistributionGlyph
                                      type={step.type as DistributionItem['type']}
                                      unitsEach={step.units_each}
                                      showNumber={false}
                                    />
                                    <span
                                      className="text-2xl md:text-4xl font-black tabular-nums leading-none"
                                      style={{ fontFamily: 'var(--font-heading)' }}
                                    >
                                      {step.units_each}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            !hideDetails &&
                            insufficientStock && (
                              <span className="text-xs font-black text-amber-500 uppercase tracking-wider leading-none">
                                {stockMap[item.sku] !== undefined
                                  ? `${stockMap[item.sku]} in stock (need ${item.pickingQty})`
                                  : `Need ${item.pickingQty}, checking...`}
                              </span>
                            )
                          )}
                        </div>

                        {/* Location Info on the right - No checkbox to maximize space */}
                        <div
                          className="flex items-center gap-3 shrink-0 pl-2 border-l border-subtle"
                          style={{ transform: 'scaleY(1.5)' }}
                        >
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] md:text-base text-muted/60 font-black uppercase tracking-widest mb-0.5">
                              {displayLocation?.toLowerCase().includes('row') ? 'ROW' : 'LOC'}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <div
                                className={`font-mono font-black text-amber-500 leading-none ${
                                  (displayLocation || '').replace(/row/i, '').trim().length > 4
                                    ? 'text-lg md:text-4xl'
                                    : 'text-3xl md:text-6xl'
                                }`}
                              >
                                {(displayLocation || '')
                                  .replace(/row/i, '')
                                  .trim()
                                  .toUpperCase()
                                  .slice(0, 12) || '-'}
                                {(() => {
                                  const subs =
                                    item.sublocation ||
                                    sublocationMap[
                                      `${item.sku}-${(displayLocation || '').toUpperCase()}`
                                    ] ||
                                    canonResolved?.sublocation;
                                  // Show only first sublocation alphabetically (A before B, C, etc)
                                  // Hidden once checked — frees space for pending rows.
                                  const firstSub =
                                    subs && subs.length > 0 ? [...subs].sort()[0] : null;
                                  return !hideDetails && firstSub ? (
                                    <span className="ml-2">{firstSub}</span>
                                  ) : null;
                                })()}
                              </div>
                              {!isReviewMode && isChecked && (
                                <div
                                  className={`flex items-center justify-center ${skuNotFound ? 'text-red-500' : 'text-green-500'}`}
                                >
                                  <Check size={16} strokeWidth={4} />
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                      {!hideDetails &&
                        !isReviewMode &&
                        (() => {
                          const swapped = autoSwapped.get(item.sku);
                          if (swapped) {
                            return (
                              <div className="-mt-1 mb-1 px-3 py-1.5 rounded-b-2xl bg-emerald-500/10 border border-t-0 border-emerald-500/25 flex items-center justify-between gap-2 text-[11px]">
                                <span className="text-emerald-400 font-bold leading-snug">
                                  Swapped from <span className="font-mono">{swapped.from}</span> —
                                  same bike, this name has the stock
                                </span>
                                {canCorrect && (
                                  <button
                                    type="button"
                                    disabled={issueBusySku === item.sku}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleUndoAutoSwap(item.sku);
                                    }}
                                    className="font-black uppercase tracking-wider text-muted hover:text-content disabled:opacity-40"
                                  >
                                    Undo
                                  </button>
                                )}
                              </div>
                            );
                          }
                          const issue = stockIssues.get(item.sku);
                          if (!issue || issue.kind === 'ok' || issue.kind === 'auto_swap')
                            return null;
                          // Stock for a registered SKU arrives asynchronously. Until
                          // it does the diagnosis reads "0 units in any location"
                          // for a bike that is on the shelf, with Remove one tap
                          // away — the card above says "checking…", so does this.
                          if (!item.sku_not_found && stockMap[item.sku] === undefined) return null;
                          return (
                            <StockIssuePanel
                              issue={issue}
                              busy={issueBusySku === item.sku}
                              readOnly={!canCorrect}
                              onTake={(qty, reason) => handleIssueTake(item, qty, reason)}
                              onRemove={(reason) => handleIssueRemove(item, reason)}
                              onSwap={(row, qty, reason) => handleIssueSwap(item, row, qty, reason)}
                              onReplace={() => handleIssueReplace(item)}
                              onRegister={() => openSkuLocations(item, displayLocation)}
                            />
                          );
                        })()}
                    </React.Fragment>
                  );
                })}

                {/* Take Photo button for this pallet */}
                <button
                  onClick={() => scanInputRef.current?.click()}
                  disabled={isScanning}
                  className="mt-4 w-full py-2.5 px-3 rounded-xl bg-card hover:bg-surface border border-amber-500/30 text-amber-500 font-bold uppercase text-xs tracking-wider active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  title="Take photo of this pallet"
                >
                  {isScanning ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Camera size={14} strokeWidth={3} />
                  )}
                  {isScanning ? 'Scanning...' : 'Take Photo'}
                </button>
              </div>
            </section>
          );
        })}

        <div className="mt-8 mb-6 mx-1">
          <CorrectionNotesTimeline notes={notes} isLoading={isNotesLoading} />
        </div>

        <section className="mt-4 mb-12 border rounded-2xl mx-1 bg-surface border-subtle space-y-1">
          <button
            onClick={() => setIsNotesExpanded(true)}
            className="w-full flex items-center justify-between p-4"
          >
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-muted" />
              <h3 className="text-[13px] font-black uppercase tracking-widest text-muted">
                {notes.length > 0 ? 'Add Another Note' : 'Add Verification Notes'}
              </h3>
            </div>
            <ChevronDown size={14} className="text-muted -rotate-90" />
          </button>

          <div className="border-t border-subtle" />

          <button
            onClick={() => setIsAssignPickupOpen(true)}
            className="w-full flex items-center justify-between p-4"
          >
            <div className="flex items-center gap-2">
              <MapPin size={16} className="text-muted" />
              <h3 className="text-[13px] font-black uppercase tracking-widest text-muted">
                Assign as Pickup
              </h3>
            </div>
            <ChevronDown size={14} className="text-muted -rotate-90" />
          </button>
        </section>
      </div>

      {/* Focused note editor — centered modal with dark backdrop so nothing else
          (the action buttons below) can be tapped by mistake. Bigger typography. */}
      {isNotesExpanded &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-main/70 backdrop-blur-md"
              onClick={() => setIsNotesExpanded(false)}
            />
            <div className="relative w-full max-w-lg bg-surface border border-accent/20 rounded-[2rem] shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <MessageSquare size={24} className="text-accent" />
                  <h3 className="text-xl font-black uppercase tracking-widest text-content">
                    {notes.length > 0 ? 'Add Another Note' : 'Add Verification Notes'}
                  </h3>
                </div>
                <button
                  onClick={() => setIsNotesExpanded(false)}
                  className="p-2 hover:bg-card rounded-full text-muted transition-colors"
                >
                  <X size={24} />
                </button>
              </div>
              <textarea
                value={correctionNotes}
                onChange={(e) => setCorrectionNotes(e.target.value)}
                placeholder="Explain what needs to be fixed..."
                className="w-full h-40 bg-card border border-subtle rounded-2xl p-4 text-lg text-content focus:outline-none focus:border-accent/30 resize-none mb-5 placeholder:text-muted/50"
                autoFocus
              />
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    onAddNote(correctionNotes.trim());
                    setCorrectionNotes('');
                    setIsNotesExpanded(false);
                  }}
                  disabled={!correctionNotes.trim()}
                  className="flex-1 py-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-sm rounded-2xl active:scale-95 transition-all disabled:opacity-30"
                >
                  Save Note Only
                </button>
                <button
                  onClick={handleReturnToPicker}
                  disabled={!correctionNotes.trim()}
                  className="flex-[2] py-4 bg-accent text-main font-black uppercase tracking-widest text-sm rounded-2xl shadow-lg shadow-accent/10 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  <Send size={18} />
                  Return to Verification List
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Assign as Pickup Modal */}
      {isAssignPickupOpen &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-main/70 backdrop-blur-md"
              onClick={() => setIsAssignPickupOpen(false)}
            />
            <div className="relative w-full max-w-md bg-surface border border-red-500/20 rounded-[2rem] shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <MapPin size={24} className="text-red-500" />
                  <h3 className="text-xl font-black uppercase tracking-widest text-content">
                    Assign as Pickup
                  </h3>
                </div>
                <button
                  onClick={() => setIsAssignPickupOpen(false)}
                  className="p-2 hover:bg-card rounded-full text-muted transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <p className="text-xs text-muted/70 mb-4">
                Sets carrier to <span className="font-bold text-red-500">PICK UP</span> and records
                parking location
              </p>

              <div className="mb-5">
                <label className="block text-xs font-bold text-muted uppercase tracking-widest mb-2">
                  Where is it parked?
                </label>
                <input
                  type="text"
                  value={pickupLocation}
                  onChange={(e) => setPickupLocation(e.target.value.toUpperCase())}
                  placeholder="E.g., BAY 1, ROW 42..."
                  className="w-full bg-card border border-subtle rounded-2xl p-4 text-lg text-content focus:outline-none focus:border-accent/30 placeholder:text-muted/50"
                  autoFocus
                />
              </div>

              <div className="mb-5">
                <p className="text-xs font-bold text-muted uppercase tracking-widest mb-2">
                  Most Used ({suggestedLocations.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestedLocations.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => setPickupLocation(loc)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${
                        pickupLocation === loc
                          ? 'bg-red-600 text-white'
                          : 'bg-card border border-subtle text-muted hover:bg-surface'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setIsAssignPickupOpen(false)}
                  className="flex-1 py-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-sm rounded-2xl active:scale-95 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAssignPickup}
                  disabled={!pickupLocation.trim() || isSavingPickup}
                  className="flex-1 py-4 bg-red-600 text-white font-black uppercase tracking-widest text-sm rounded-2xl shadow-lg shadow-red-600/20 active:scale-95 transition-all disabled:opacity-30"
                >
                  {isSavingPickup ? 'Saving...' : 'Assign Pickup'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      <div className="fixed bottom-0 left-0 right-0 px-6 pt-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-main via-main/90 to-transparent shrink-0 z-20">
        {isReadOnly ? (
          <button
            onClick={onTakeover}
            className="w-full h-full min-h-[56px] py-4 rounded-2xl font-black tracking-widest uppercase text-sm bg-orange-500 text-white shadow-xl hover:bg-orange-600 transition-colors flex items-center justify-center gap-2"
          >
            Takeover Order
          </button>
        ) : status === 'reopened' ? (
          /* Reopened order — show Re-Complete and Cancel.
             Step B: removed all gates that block Re-Complete (was forcing the
             user to add a new SKU just to enable the button when items hadn't
             changed vs snapshot). For Add-On the photo is now a soft hint, not
             a blocker. The user can always cancel via the Cancel button. */
          <>
            {isAddonMode && addonGateBlocked && (
              <div className="mb-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2">
                <span className="text-[10px] font-black text-amber-300 uppercase tracking-widest">
                  Add-On — recommended: take at least 1 new pallet photo
                </span>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => onCancelReopen?.()}
                className="flex-1 py-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all"
              >
                {isAddonMode ? 'Cancel Add-On' : 'Cancel Edit'}
              </button>
              <button
                onClick={async () => {
                  if (onRecomplete) {
                    setIsDeducting(true);
                    try {
                      await onRecomplete(cartItems);
                    } finally {
                      setIsDeducting(false);
                    }
                  }
                }}
                disabled={isDeducting || cartItems.length === 0}
                className="flex-[2] py-4 bg-orange-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-lg shadow-orange-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
              >
                <Check size={16} strokeWidth={3} />
                {isDeducting
                  ? isAddonMode
                    ? 'Completing Add-On…'
                    : 'Re-Completing...'
                  : isAddonMode
                    ? 'Complete Add-On'
                    : 'Re-Complete Order'}
              </button>
            </div>
          </>
        ) : verifiedUnitsCount === totalUnitsCount ? (
          /* Estado C — all verified. Two paths:
             - Ready to DC: hand off to a second verifier (status →
               ready_to_double_check, lands in the bottom Ready section).
             - Slide to Complete: close now (requires ≥1 pallet photo).
             Plus Clear: deselect-all so Select All is reversible — without it
             the toggle vanished the moment everything got checked. */
          <div className="flex gap-3">
            {onSelectAll && totalUnitsCount > 0 && (
              <button
                onClick={() => onSelectAll([])}
                className="py-4 px-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-1.5 shrink-0"
                title="Deselect all"
              >
                <X size={16} strokeWidth={3} />
                Clear
              </button>
            )}
            <button
              onClick={() => onSendToVerifyQueue?.()}
              className="flex-1 py-4 bg-card border border-sky-500/40 text-sky-400 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all hover:bg-sky-500/5"
            >
              Ready to DC
            </button>
            <div className="flex-[2]">
              {palletPhotosCount === 0 ? (
                /* No photo yet — replace the disabled slider with the
                   camera trigger so the verifier doesn't need to scroll
                   back up to find the Take Photo button. After capture,
                   palletPhotosCount > 0 → next render swaps in the slide.
                   Single tap finishes the order. */
                <button
                  onClick={() => scanInputRef.current?.click()}
                  disabled={cartItems.length === 0 || isScanning}
                  className="w-full h-full min-h-[56px] py-4 bg-amber-500 text-main font-black uppercase tracking-widest text-xs rounded-2xl shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isScanning ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Camera size={16} strokeWidth={3} />
                  )}
                  {isScanning ? 'Scanning...' : 'Take Photo to Complete'}
                </button>
              ) : (
                <SlideToConfirm
                  onConfirm={handleConfirm}
                  isLoading={isDeducting}
                  text="SLIDE TO COMPLETE"
                  confirmedText="COMPLETING..."
                  variant="default"
                  disabled={cartItems.length === 0}
                />
              )}
            </div>
          </div>
        ) : (
          /* Estado B — partial verification. Parking now lives on the header X
             (close = park: release lock, status untouched, session ends), so
             the footer only offers Complete Now (Select-All → Estado C without
             changing DB status). */
          <div className="flex gap-3">
            {onSelectAll && totalUnitsCount > 0 && (
              <button
                onClick={() => {
                  if (verifiedUnitsCount === totalUnitsCount) {
                    onSelectAll([]);
                  } else {
                    const allKeys = pallets.flatMap((p) =>
                      p.items.map((item) => `${p.id}-${item.sku}-${item.location}`)
                    );
                    onSelectAll(allKeys);
                  }
                }}
                className="py-4 px-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all flex items-center justify-center gap-1.5 shrink-0"
                title={verifiedUnitsCount === totalUnitsCount ? 'Deselect all' : 'Select all'}
              >
                {verifiedUnitsCount === totalUnitsCount ? (
                  <X size={16} strokeWidth={3} />
                ) : (
                  <Check size={16} strokeWidth={3} />
                )}
                {verifiedUnitsCount === totalUnitsCount ? 'Clear' : 'All'}
              </button>
            )}
            <button
              onClick={() => {
                const allKeys = pallets.flatMap((p) =>
                  p.items.map((item) => `${p.id}-${item.sku}-${item.location}`)
                );
                onSelectAll?.(allKeys);
              }}
              className="flex-[2] py-4 bg-accent text-main font-black uppercase tracking-widest text-xs rounded-2xl shadow-lg shadow-accent/20 active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Check size={16} strokeWidth={3} />
              Complete Now
            </button>
          </div>
        )}
      </div>

      {/* ItemDetailView lives in ModalProvider (root) — see docs/modal-pattern.md */}

      {subOrderPickerMode !== null && (
        <SelectSubOrderModal
          subOrders={subOrders}
          variant={subOrderPickerMode === 'cancel' ? 'danger' : 'edit'}
          onSelect={(listId, orderNum) => {
            const mode = subOrderPickerMode;
            setSubOrderPickerMode(null);
            if (mode === 'edit') {
              openEditDirectly(listId, orderNum);
            } else if (mode === 'cancel') {
              confirmCancelOrder(listId, orderNum);
            }
          }}
          onCancel={() => setSubOrderPickerMode(null)}
        />
      )}

      {showCorrectionMode && onCorrectItem && (
        <CorrectionModeView
          problemItems={editingProblemItems}
          allItems={editingCartItems}
          inventoryData={inventoryData}
          onCorrectItem={onCorrectItem}
          onClose={() => {
            setShowCorrectionMode(false);
            setEditingListId(null);
            setEditingOrderNumber(null);
            setSourceOrderMap(new Map());
            setCorrectionInitialPanel(null);
          }}
          initialPanel={correctionInitialPanel}
          orderNumber={editingOrderNumber ?? orderNumber}
          editingListId={editingListId}
          sourceOrderMap={sourceOrderMap}
          isReopened={status === 'reopened'}
          onCancelReopen={onCancelReopen}
        />
      )}

      {/* Waiting conflict modal — blocks until dismissed (idea-053) */}
      {!conflictDismissed && waitingConflicts && waitingConflicts.length > 0 && (
        <WaitingConflictModal
          conflicts={waitingConflicts}
          isAdmin={isAdmin}
          isTakingOver={takeOverSku.isPending}
          onTakeOver={(conflict: WaitingConflict) => {
            if (!activeListId) return;
            takeOverSku.mutate({
              waitingListId: conflict.waitingListId,
              targetListId: activeListId,
              sku: conflict.sku,
              qty: conflict.waitingQty,
            });
          }}
          onEditOrder={() => {
            setConflictDismissed(true);
            openEditFlow();
          }}
          onDismiss={() => setConflictDismissed(true)}
        />
      )}

      <ActiveFilterPill
        activeOrderFilter={activeOrderFilter}
        combinedNumbers={combinedNumbers}
        onClear={clearOrderFilter}
      />
    </div>
  );
};
