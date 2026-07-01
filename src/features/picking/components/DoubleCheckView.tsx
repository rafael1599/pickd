import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { orderHeaderLabel, splitOrderNumbers } from '../utils/orderLabel.ts';
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
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import GitMerge from 'lucide-react/dist/esm/icons/git-merge';
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
import { useWaitingConflicts, type WaitingConflict } from '../hooks/useWaitingConflicts';
import { useStockReservations, buildReservationKey } from '../hooks/useStockReservations';
import { useStaleLocationCheck } from '../hooks/useStaleLocationCheck';
import { useCanonicalSkuResolution } from '../hooks/useCanonicalSkuResolution';
import { AS400_SKU_ALIASES } from '../../../utils/skuNormalize';
import { DistributionGlyph } from '../../inventory/components/DistributionJengaViz';
import { WaitingConflictModal } from './WaitingConflictModal';
import { WaitingReasonModal } from './WaitingReasonModal';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import Play from 'lucide-react/dist/esm/icons/play';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';

/** Priority: lower number = pick first. Pallets are overstock we want gone ASAP. */
const DISTRIBUTION_PRIORITY: Record<string, number> = { PALLET: 0, LINE: 1, TOWER: 2, OTHER: 3 };

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
  sku_metadata?: {
    image_url?: string | null;
    length_in?: number | null;
    width_in?: number | null;
    height_in?: number | null;
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
  onParkOrder?: () => void;
  onRecomplete?: (items: PickingItem[]) => Promise<void>;
  onCancelReopen?: () => void;
  /** idea-067 Phase 2 / Option A: opens the AddOn target picker in
   *  "combine-any" mode (any order, completed or open). Parent handles the
   *  actual group/reopen wiring. */
  onCombineWith?: () => void;
  correctionNotes?: string | null;
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
  onParkOrder,
  onRecomplete,
  onCancelReopen,
  onCombineWith,
  correctionNotes: correctionNotesProp,
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

  // Direct sublocation data fetched alongside distributions (covers all cart SKUs)
  const [directSublocationMap, setDirectSublocationMap] = useState<Record<string, string[]>>({});

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
  const { isAdmin } = useAuth();
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

  // Effective shipping type: persisted override, else auto-classify from the
  // cart (count-only — no weight map here, mirroring VerificationBoard). Drives
  // the purple FedEx accent on the header + pallet badges.
  const effectiveShippingType: 'fedex' | 'regular' =
    activeListMeta?.shipping_type === 'fedex' || activeListMeta?.shipping_type === 'regular'
      ? activeListMeta.shipping_type
      : autoClassifyShippingType(
          cartItems.map((i) => ({ sku: i.sku, pickingQty: i.pickingQty || 0 })),
          {}
        );
  const isFedexOrder = effectiveShippingType === 'fedex';
  const sourceOrderDate = activeListMeta?.source_order_date ?? null;

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
    !isNotesLoading,
    onAddNote
  );
  // Resolve items whose SKU has a spurious extra trailing letter (e.g. watcher
  // produced "03-3768BLD" for "03-3768BL") to their canonical inventory, so we
  // can show WHERE to pick instead of flagging them not-found.
  const canonicalResolution = useCanonicalSkuResolution(cartItems);

  const [isDeducting, setIsDeducting] = useState(false);
  const [showWaitingPicker, setShowWaitingPicker] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [orderListOpen, setOrderListOpen] = useState(false);
  const orderListRef = useRef<HTMLDivElement>(null);
  // Auto-hiding header context (order #, FedEx, date, note): shown on open and on
  // any scroll, then fades 5s after the last scroll so the picking list gets the
  // space. The exit button and the progress line stay visible always.
  const [showHeaderInfo, setShowHeaderInfo] = useState(true);
  const headerHideTimer = useRef<number | undefined>(undefined);
  // Collapsing the header changes the scroll container's geometry: the browser
  // clamps scrollTop and fires synthetic scroll events that would re-show the
  // header in an endless show/hide loop. Scroll bumps are suppressed while the
  // collapse animation (300ms) settles; pointer bumps are always genuine.
  const suppressScrollBumpUntil = useRef(0);
  const bumpHeaderInfo = useCallback(() => {
    // Returning the same value skips a re-render, so scrolling while already
    // shown only resets the timer (no churn).
    setShowHeaderInfo((v) => (v ? v : true));
    if (headerHideTimer.current) window.clearTimeout(headerHideTimer.current);
    headerHideTimer.current = window.setTimeout(() => {
      suppressScrollBumpUntil.current = Date.now() + 600;
      setShowHeaderInfo(false);
    }, 5000);
  }, []);
  const bumpHeaderInfoOnScroll = useCallback(() => {
    if (Date.now() < suppressScrollBumpUntil.current) return;
    bumpHeaderInfo();
  }, [bumpHeaderInfo]);
  useEffect(() => {
    bumpHeaderInfo(); // show briefly on open, then auto-hide
    return () => {
      if (headerHideTimer.current) window.clearTimeout(headerHideTimer.current);
    };
  }, [bumpHeaderInfo]);

  // Close the combined-order list when clicking anywhere outside it.
  useEffect(() => {
    if (!orderListOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (orderListRef.current && !orderListRef.current.contains(e.target as Node)) {
        setOrderListOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [orderListOpen]);

  const [scanResults, setScanResults] = useState<Map<string, Set<string>>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState<string>('');
  const [palletPhotos, setPalletPhotos] = useState<string[]>([]);
  const palletPhotosCount = palletPhotos.length;
  const [palletLightboxIndex, setPalletLightboxIndex] = useState<number | null>(null);

  const handleDeletePalletPhoto = useCallback(
    (index: number) => {
      if (!activeListId) return;
      showConfirmation(
        'Delete Photo',
        'Are you sure you want to delete this pallet photo? This cannot be undone.',
        async () => {
          const next = palletPhotos.filter((_, i) => i !== index);
          const previous = palletPhotos;
          setPalletPhotos(next); // optimistic
          try {
            await supabase
              .from('picking_lists')
              .update({ pallet_photos: next })
              .eq('id', activeListId);
          } catch (err) {
            console.error('Delete pallet photo failed:', err);
            setPalletPhotos(previous);
            toast.error('Failed to delete photo');
          }
        },
        () => {},
        'Delete',
        'Cancel',
        'danger'
      );
    },
    [activeListId, palletPhotos, showConfirmation]
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
  // idea-079: S/D (scratch-and-dent) SKUs carry a physical serial number. In
  // the big item header we display the serial instead of the SKU so pickers
  // can match the tag visually. Scanning still uses the SKU.
  const [sdSerialMap, setSdSerialMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    if (!cartSkusKey) {
      setBikeSkuSet(new Set());
      setSdSerialMap(new Map());
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
        .select('sku, is_bike, is_scratch_dent, serial_number')
        .in('sku', skus);
      if (cancelled) return;
      const next = new Set<string>(prefixInferred);
      const serials = new Map<string, string>();
      (
        data as
          | {
              sku: string;
              is_bike: boolean | null;
              is_scratch_dent: boolean | null;
              serial_number: string | null;
            }[]
          | null
      )?.forEach((row) => {
        if (row.is_bike) next.add(row.sku);
        if (row.is_scratch_dent && row.serial_number) serials.set(row.sku, row.serial_number);
      });
      setBikeSkuSet(next);
      setSdSerialMap(serials);
    })();
    return () => {
      cancelled = true;
    };
  }, [cartSkusKey]);

  // Compute display pallets. When bikes are present, pallet count is sized by
  // BIKE units only and parts stack on top of the last bike pallet. When no
  // bikes are present, upstream pallets (parts-only) are used as-is.
  const pallets = useMemo(() => {
    // Bikes paginate by capacity; parts always consolidate into one pallet.
    // calculatePalletsWithBikeAwareness handles the no-bikes case (parts-only → 1 pallet).
    const allItems = originalPallets.flatMap((p) => p.items);
    const bikeAware = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);
    return palletOverrides.size === 0
      ? bikeAware
      : redistributeWithOverrides(bikeAware, palletOverrides);
  }, [originalPallets, palletOverrides, bikeSkuSet]);

  // Notify parent of pallet count changes
  useEffect(() => {
    onPalletCountChange?.(pallets.length);
  }, [pallets.length, onPalletCountChange]);

  // Fetch initial pallet photos count for the active order
  useEffect(() => {
    if (!activeListId) {
      setPalletPhotos([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('picking_lists')
        .select('pallet_photos')
        .eq('id', activeListId)
        .single();
      if (cancelled) return;
      const photos = Array.isArray(data?.pallet_photos) ? (data.pallet_photos as string[]) : [];
      setPalletPhotos(photos);
    })();
    return () => {
      cancelled = true;
    };
  }, [activeListId]);

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
  const { open: openModal } = useModal();
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

  const handlePointerDown = useCallback(
    (item: PickingItem) => {
      longPressTriggered.current = false;
      longPressTimer.current = setTimeout(async () => {
        longPressTriggered.current = true;
        if (navigator.vibrate) navigator.vibrate(100);

        // Fetch directly from DB — inventoryData is paginated and filtered
        // (LUDLOW-only, ROW locations only, max 50 items) so items in parts
        // bins or beyond page 1 won't be found there.
        const { data } = await supabase
          .from('inventory')
          .select('*, sku_metadata(*)')
          .eq('sku', item.sku)
          .order('quantity', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data) {
          const itemData = data as unknown as InventoryItemWithMetadata;
          openModal({
            type: 'item-detail',
            item: itemData,
            mode: 'edit',
            screenType: itemData.warehouse,
            onSave: async (formData) => {
              await editCallbacksRef.current.updateItem(itemData, formData);
              await editCallbacksRef.current.fetchDistributions();
              toast.success(`Updated ${itemData.sku}`);
            },
            onDelete: () => {
              editCallbacksRef.current.deleteItem(
                itemData.warehouse,
                itemData.sku,
                itemData.location
              );
              toast.success(`Deleted ${itemData.sku}`);
            },
          });
        } else {
          // Not in the DB inventory (typically an `sku_not_found` / UNREG
          // item the picker found on the floor). Open New Item pre-filled with
          // what the order already knows so they only enter the missing bits.
          const prefill = {
            sku: item.sku,
            item_name: item.item_name ?? '',
            warehouse: 'LUDLOW',
          } as unknown as InventoryItemWithMetadata;
          openModal({
            type: 'item-detail',
            item: prefill,
            mode: 'add',
            screenType: 'LUDLOW',
            onSave: async (formData) => {
              await editCallbacksRef.current.addItem(formData.warehouse, formData);
              await editCallbacksRef.current.fetchDistributions();
              toast.success(`Registered ${formData.sku}`);
            },
          });
        }
      }, 500);
    },
    [openModal]
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
    Record<string, { distribution: DistributionItem[]; quantity: number }[]>
  >({});

  const fetchDistributions = useCallback(async () => {
    const skus = [...new Set(cartItems.map((i) => i.sku))];
    if (skus.length === 0) return;

    const { data } = await supabase
      .from('inventory')
      .select('sku, quantity, distribution, location, sublocation')
      .in('sku', skus)
      .gt('quantity', 0);

    const map: Record<string, { distribution: DistributionItem[]; quantity: number }[]> = {};
    const subMap: Record<string, string[]> = {};
    (data || []).forEach((row) => {
      const r = row as {
        sku: string;
        quantity: number;
        distribution: DistributionItem[] | null;
        location: string | null;
        sublocation: string[] | null;
      };
      if (!map[r.sku]) map[r.sku] = [];
      map[r.sku].push({
        distribution: Array.isArray(r.distribution) ? r.distribution : [],
        quantity: r.quantity ?? 0,
      });
      if (r.sublocation && r.sublocation.length > 0 && r.location) {
        subMap[`${r.sku}-${r.location.toUpperCase()}`] = r.sublocation;
      }
    });
    setSkuInventoryMap(map);
    setDirectSublocationMap(subMap);
  }, [cartItems]);

  const cartSkuKey = cartItems
    .map((i) => i.sku)
    .sort()
    .join(',');
  useEffect(() => {
    fetchDistributions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartSkuKey]);

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
    }) => {
      if (!i.sku_not_found && !i.insufficient_stock) return false;
      const resolved = AS400_SKU_ALIASES[i.sku] ? canonicalResolution.get(i.sku) : undefined;
      return !(resolved && resolved.quantity >= (i.pickingQty || 0));
    },
    [canonicalResolution]
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

  const handleScanPallet = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = ''; // reset for re-scan

      // Optimistic: the user took a photo — that's enough to unlock completion.
      // We add a placeholder marker so the burst mode counter advances. The
      // real URL replaces it when the fire-and-forget upload below finishes.
      const newCount = palletPhotosCount + 1;
      setPalletPhotos((prev) => [...prev, '']);

      // Burst mode: if we still need more photos to match pallet count,
      // auto-reopen the camera. Browsers preserve user activation briefly
      // after onChange, so this works on most devices.
      if (newCount < pallets.length) {
        setTimeout(() => {
          scanInputRef.current?.click();
        }, 250);
      }

      setIsScanning(true);
      setScanStatus(
        newCount < pallets.length
          ? `Photo ${newCount} of ${pallets.length} — opening camera for next…`
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
              setPalletPhotos(photos);
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
    [cartItems, palletPhotosCount, pallets.length, activeListId, orderNumber]
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
                  onToggleCheck(pItem, pallet.id);
                }
              }
            }
          }
        }
      }
    }
  }, [scanResults, cartItems, pallets, checkedItems, onToggleCheck]);

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
      <div className="px-5 py-4 flex items-center justify-between shrink-0 bg-main/90 backdrop-blur-md sticky top-0 z-10 touch-none border-b border-subtle">
        <button
          onClick={() => onBack()}
          className="p-2 -ml-2 hover:bg-card rounded-full text-content/70 transition-colors shrink-0"
          title={isReviewMode ? 'Close' : 'Release to Queue'}
        >
          <ChevronLeft size={28} />
        </button>

        <div className="flex flex-col items-center flex-1 min-w-0">
          {/* Order number + shipping + pallets/units — ALWAYS visible (no auto-hide),
              using the full header width so nothing important disappears. */}
          <div
            className={`flex flex-col items-center transition-all duration-300 ${
              orderListOpen ? 'overflow-visible' : 'overflow-hidden'
            }`}
          >
            <div
              ref={orderListRef}
              className="flex items-center gap-2 relative flex-wrap justify-center"
            >
              {(() => {
                const fallback = activeListId
                  ? `#${activeListId.slice(-6).toUpperCase()}`
                  : 'STOCK DEDUCTION';
                const header = orderHeaderLabel(orderNumber, fallback);
                // single (0/1 orders) and pair (exactly 2 → "083 / 121") both render
                // as a static chip; only 3+ get the +N badge + dropdown.
                if (header.kind !== 'many') {
                  return (
                    <span className="text-base md:text-lg font-mono font-black text-accent/90 tracking-widest bg-accent/10 px-3 py-1 rounded-lg border border-accent/20">
                      {header.label}
                    </span>
                  );
                }
                const label = header.label;
                const orderList = splitOrderNumbers(orderNumber);
                return (
                  <button
                    onClick={() => setOrderListOpen((v) => !v)}
                    className="text-base md:text-lg font-mono font-black text-accent/90 tracking-widest bg-accent/10 px-3 py-1 rounded-lg border border-accent/20 flex items-center gap-1.5 hover:bg-accent/20 transition-colors"
                    title={`${orderList.length} orders combined`}
                    aria-haspopup="true"
                    aria-expanded={orderListOpen}
                  >
                    <span>{label}</span>
                    <span className="text-xs font-black bg-accent/20 text-accent px-1.5 rounded">
                      +{orderList.length - 1}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`transition-transform ${orderListOpen ? 'rotate-180' : ''}`}
                    />
                  </button>
                );
              })()}
              {activeListId && (
                <ShippingTypeToggle listId={activeListId} autoType={effectiveShippingType} />
              )}
              {totalUnitsCount > 0 && (
                <span className="text-sm md:text-base font-black uppercase tracking-widest text-muted/80 whitespace-nowrap">
                  {pallets.length} {pallets.length === 1 ? 'pallet' : 'pallets'} · {totalUnitsCount}{' '}
                  units
                </span>
              )}
              {orderListOpen && orderNumber && orderNumber.includes(' / ') && (
                <div className="absolute top-full left-0 mt-1 bg-card border border-subtle rounded-xl shadow-2xl overflow-hidden z-20 min-w-[140px] animate-in fade-in slide-in-from-top-2 duration-150">
                  {orderNumber
                    .split(' / ')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((num) => (
                      <div
                        key={num}
                        className="px-3 py-2 text-xs font-mono font-bold text-content tracking-widest border-b border-subtle last:border-b-0"
                      >
                        #{num}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
          {/* Meaningful order note — ALWAYS visible (noise like a bare "FREE
              FREIGHT" is filtered out upstream; important ones must not hide). */}
          {watcherNote && (
            <div
              className="mt-1 max-w-[90%] text-center text-xs font-bold text-red-400"
              title="Order note from import"
            >
              {watcherNote}
            </div>
          )}
          {/* Progress Text — ALWAYS visible. Select All moved to the bottom action bar. */}
          <div className="flex items-center gap-3 mt-1">
            <span
              className={`text-2xl md:text-3xl font-black uppercase tracking-[0.15em] ${
                totalUnitsCount === 0
                  ? 'text-muted/70'
                  : verifiedUnitsCount === 0
                    ? 'text-red-400'
                    : verifiedUnitsCount === totalUnitsCount
                      ? 'text-emerald-400'
                      : 'text-amber-400'
              }`}
            >
              {`${verifiedUnitsCount} / ${totalUnitsCount} Pickd`}
            </span>
          </div>
          {showHeaderInfo && sourceOrderDate && (
            <div className="text-[10px] text-muted/60 font-bold uppercase tracking-widest mt-0.5">
              Order date:{' '}
              {new Date(`${sourceOrderDate}T00:00:00`).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 relative">
          {/* Actions kebab — opens dropdown with Edit Order / Combine /
              Mark Waiting / Cancel. Hidden in review mode and when complete. */}
          {!isReviewMode && status !== 'completed' && (
            <button
              onClick={() => setActionsMenuOpen((v) => !v)}
              className={`p-2 rounded-full transition-colors ${
                actionsMenuOpen
                  ? 'bg-card text-content'
                  : 'hover:bg-card text-muted hover:text-content'
              }`}
              title="Actions"
              aria-haspopup="true"
              aria-expanded={actionsMenuOpen}
            >
              <MoreVertical size={22} />
              {problemItems.length > 0 && (
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500 ring-2 ring-main" />
              )}
            </button>
          )}
          {!correctionNotes.trim() && status !== 'completed' && (
            <button
              onClick={status === 'reopened' ? onCancelReopen : onRelease}
              className="p-2 hover:bg-card rounded-full text-muted transition-colors"
              title={status === 'reopened' ? 'Cancel Edit' : 'Release to Queue'}
            >
              <X size={24} />
            </button>
          )}
        </div>
      </div>

      {/* Actions menu — kebab dropdown (Edit Order / Combine / Mark Waiting /
          Cancel Order). Backdrop catches outside-clicks; menu is anchored
          relative to the viewport top-right since the header itself is
          sticky. */}
      {actionsMenuOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setActionsMenuOpen(false)}>
          <div
            className="absolute right-3 top-20 md:top-24 w-72 bg-card border border-subtle rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => {
                setActionsMenuOpen(false);
                openEditFlow();
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 transition-colors text-left ${
                problemItems.length > 0 ? 'bg-red-500/10 hover:bg-red-500/15' : 'hover:bg-main/40'
              }`}
            >
              <Pencil
                size={16}
                className={problemItems.length > 0 ? 'text-red-400' : 'text-muted'}
              />
              <div className="flex-1">
                <div
                  className={`text-sm font-bold ${problemItems.length > 0 ? 'text-red-400' : 'text-content'}`}
                >
                  Edit Order
                </div>
                <div className="text-[11px] text-muted/70">Add, remove, or adjust items</div>
              </div>
              {problemItems.length > 0 && (
                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 uppercase tracking-wider">
                  {problemItems.length} issue{problemItems.length > 1 ? 's' : ''}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActionsMenuOpen(false);
                scanInputRef.current?.click();
              }}
              disabled={isScanning}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-main/40 transition-colors text-left border-t border-subtle disabled:opacity-50"
            >
              {isScanning ? (
                <Loader2 size={16} className="text-accent animate-spin" />
              ) : (
                <Camera
                  size={16}
                  className={
                    pallets.length > 0 && palletPhotosCount >= pallets.length
                      ? 'text-emerald-400'
                      : palletPhotosCount > 0
                        ? 'text-amber-400'
                        : 'text-accent'
                  }
                />
              )}
              <div className="flex-1">
                <div className="text-sm font-bold text-content">
                  {isScanning
                    ? 'Processing…'
                    : pallets.length > 0 &&
                        palletPhotosCount > 0 &&
                        palletPhotosCount < pallets.length
                      ? `Take Photo ${palletPhotosCount + 1} of ${pallets.length}`
                      : 'Take Photo'}
                </div>
                <div className="text-[11px] text-muted/70">
                  {pallets.length > 0
                    ? `${palletPhotosCount} of ${pallets.length} pallet${pallets.length > 1 ? 's' : ''} captured`
                    : 'Capture pallet photos'}
                </div>
              </div>
              {pallets.length > 0 && (
                <span
                  className={`text-[10px] font-black px-2 py-0.5 rounded-full uppercase tracking-wider ${
                    palletPhotosCount >= pallets.length
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : palletPhotosCount > 0
                        ? 'bg-amber-500/20 text-amber-400'
                        : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {palletPhotosCount}/{pallets.length}
                </span>
              )}
            </button>

            {onCombineWith &&
              !isCombined &&
              (status === 'active' ||
                status === 'ready_to_double_check' ||
                status === 'double_checking' ||
                status === 'needs_correction') && (
                <button
                  onClick={() => {
                    setActionsMenuOpen(false);
                    onCombineWith();
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-main/40 transition-colors text-left border-t border-subtle"
                >
                  <GitMerge size={16} className="text-emerald-400" />
                  <div className="flex-1">
                    <div className="text-sm font-bold text-content">Combine</div>
                    <div className="text-[11px] text-muted/70">Merge with another order</div>
                  </div>
                </button>
              )}

            {isAdmin && status !== 'cancelled' && (
              <>
                {isWaitingInventory ? (
                  <>
                    <button
                      onClick={() => {
                        setActionsMenuOpen(false);
                        if (!activeListId) return;
                        unmarkWaiting.mutate(
                          { listId: activeListId, action: 'resume' },
                          { onSuccess: () => onSetWaitingInventory?.(false) }
                        );
                      }}
                      disabled={unmarkWaiting.isPending}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-main/40 transition-colors text-left border-t border-subtle disabled:opacity-50"
                    >
                      <Play size={16} className="text-accent" />
                      <div className="flex-1">
                        <div className="text-sm font-bold text-content">Resume Order</div>
                        <div className="text-[11px] text-muted/70">
                          Currently waiting for inventory
                        </div>
                      </div>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setActionsMenuOpen(false);
                      setShowWaitingPicker(true);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-amber-500/10 transition-colors text-left border-t border-subtle ${
                      problemItems.length > 0 ? 'bg-amber-500/5' : ''
                    }`}
                  >
                    <Hourglass size={16} className="text-amber-400" />
                    <div className="flex-1">
                      <div className="text-sm font-bold text-content">Mark as Waiting</div>
                      <div className="text-[11px] text-muted/70">
                        {problemItems.length > 0
                          ? `${problemItems.length} stock issue${problemItems.length > 1 ? 's' : ''} — consider this`
                          : 'Hold for inventory'}
                      </div>
                    </div>
                  </button>
                )}
              </>
            )}

            <button
              onClick={() => {
                setActionsMenuOpen(false);
                openCancelFlow();
              }}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-red-500/10 transition-colors text-left border-t border-subtle"
            >
              <Trash2 size={16} className="text-red-500" />
              <div className="flex-1">
                <div className="text-sm font-bold text-red-400">Cancel Order</div>
                <div className="text-[11px] text-muted/70">Release items back to stock</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Clean Item List */}
      <div
        className="flex-1 overflow-y-auto p-4 bg-main min-h-0 pb-32"
        onScroll={bumpHeaderInfoOnScroll}
        onPointerDown={bumpHeaderInfo}
      >
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

        {pallets.length === 0 && cartItems.length > 0 && (
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
                Stale pick location{staleLocations.length > 1 ? 's' : ''}
              </p>
              <p className="text-[11px] font-medium text-muted mb-2 leading-relaxed">
                The frozen location is empty but stock exists elsewhere — pick from the suggested
                location (verify physically before picking).
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
                    <span className="font-black text-emerald-400">{s.suggestedLocation}</span>{' '}
                    <span className="text-muted">({s.suggestedQty} in stock)</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {pallets.map((pallet: Pallet) => {
          const palletUnits = pallet.items.reduce(
            (sum: number, i: PickingItem) => sum + (i.pickingQty || 0),
            0
          );
          const isLocked = palletOverrides.has(pallet.id);
          const isEditing = editingPalletId === pallet.id;

          return (
            <section key={pallet.id} className="mb-8">
              {/* Pallet Header */}
              <div className="flex items-center gap-3 mb-4 sticky top-0 bg-main/95 py-2 z-5 backdrop-blur-sm">
                <div className="h-[1px] flex-1 bg-card" />
                <div className="flex flex-col items-center">
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
                    Pallet {pallet.id}/{pallets.length}
                  </span>
                  {isEditing ? (
                    <div className="flex items-center gap-1.5 mt-1">
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
                      className="flex items-center gap-1 mt-1 group/edit"
                    >
                      <span
                        className={`text-[11px] font-black uppercase tracking-widest ${isLocked ? 'text-amber-400' : 'text-blue-400'}`}
                      >
                        {palletUnits} Units
                      </span>
                      <Pencil
                        size={8}
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
                  const skuNotFound = !!item.sku_not_found && !canonResolved;
                  // AS400 alias (e.g. 03-4070BL stocked as 03-4070BK): when the
                  // alias SKU covers the qty, drop the out-of-stock alarm — the
                  // small AS400 chip next to the SKU is the only reminder.
                  const aliasTarget = AS400_SKU_ALIASES[item.sku];
                  const aliasCovered =
                    !!aliasTarget &&
                    !!canonResolved &&
                    canonResolved.quantity >= (item.pickingQty || 0);
                  const insufficientStock = !!item.insufficient_stock && !aliasCovered;
                  const displayLocation = item.location || canonResolved?.location || null;
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
                        onPointerDown={() => handlePointerDown(item)}
                        onPointerUp={handlePointerUp}
                        onPointerCancel={handlePointerUp}
                        onClick={() => {
                          if (isReviewMode) return;
                          if (longPressTriggered.current) return;
                          if (navigator.vibrate) navigator.vibrate(50);
                          onToggleCheck(item, pallet.id);
                        }}
                        className={`transition-all duration-200 rounded-2xl flex items-center justify-between gap-3 ${isReviewMode ? '' : 'active:scale-[0.98] cursor-pointer'} border ${
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
                        <div
                          className="flex items-center gap-3 min-w-0"
                          style={{ transform: 'scaleY(1.5)' }}
                        >
                          {/* Qty on the far left — the biggest number on the row */}
                          <div className="flex flex-col items-center justify-center min-w-[4rem] shrink-0 border-r border-subtle pr-3">
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
                                className={`font-black text-2xl md:text-5xl tracking-tight leading-none whitespace-nowrap ${isReviewMode ? (skuNotFound || insufficientStock ? 'text-red-500' : 'text-content') : isChecked ? (skuNotFound || insufficientStock ? 'text-red-400' : 'text-green-400') : skuNotFound || insufficientStock ? 'text-red-500' : 'text-content'}`}
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

                        {/* Distribution — MIDDLE column (SKU left · distribution center · location right) */}
                        <div
                          className="flex-1 flex items-center justify-center px-1 min-w-0"
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
                                      className="text-3xl md:text-5xl font-black tabular-nums leading-none"
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
                                  // Sublocation reads like part of the location: same
                                  // size/color as the big number, no chip container.
                                  // Hidden once checked — frees space for pending rows.
                                  return !hideDetails && subs && subs.length > 0 ? (
                                    <span className="ml-2">{subs.join(',')}</span>
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
                    </React.Fragment>
                  );
                })}
              </div>
            </section>
          );
        })}

        <div className="mt-8 mb-6 mx-1">
          <CorrectionNotesTimeline notes={notes} isLoading={isNotesLoading} />
        </div>

        <section
          className={`mt-4 mb-12 border rounded-2xl mx-1 transition-all duration-300 ${isNotesExpanded ? 'bg-surface border-accent/20' : 'bg-surface border-subtle'}`}
        >
          <button
            onClick={() => setIsNotesExpanded(!isNotesExpanded)}
            className="w-full flex items-center justify-between p-4"
          >
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className={isNotesExpanded ? 'text-accent' : 'text-muted'} />
              <h3
                className={`text-[13px] font-black uppercase tracking-widest ${isNotesExpanded ? 'text-accent/70' : 'text-muted'}`}
              >
                {notes.length > 0 ? 'Add Another Note' : 'Add Verification Notes'}
              </h3>
            </div>
            <ChevronDown
              size={14}
              className={`text-muted transition-transform duration-300 ${isNotesExpanded ? 'rotate-180' : ''}`}
            />
          </button>

          {isNotesExpanded && (
            <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2 duration-300">
              <textarea
                value={correctionNotes}
                onChange={(e) => setCorrectionNotes(e.target.value)}
                placeholder="Explain what needs to be fixed..."
                className="w-full h-24 bg-card border border-subtle rounded-xl p-3 text-sm text-content focus:outline-none focus:border-accent/30 resize-none transition-all mb-3 placeholder:text-muted/50"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    onAddNote(correctionNotes.trim());
                    setCorrectionNotes('');
                  }}
                  disabled={!correctionNotes.trim()}
                  className="flex-1 py-3 bg-surface border border-subtle text-muted font-black uppercase tracking-widest text-[11px] rounded-xl active:scale-95 transition-all disabled:opacity-30"
                >
                  Save Note Only
                </button>
                <button
                  onClick={handleReturnToPicker}
                  disabled={!correctionNotes.trim()}
                  className="flex-[2] py-3 bg-accent text-main font-black uppercase tracking-widest text-[11px] rounded-xl shadow-lg shadow-accent/10 active:scale-95 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                >
                  <Send size={14} />
                  Return to Verification List
                </button>
              </div>
            </div>
          )}
        </section>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-6 pt-6 pb-28 bg-gradient-to-t from-main via-main/90 to-transparent shrink-0 z-20">
        {status === 'reopened' ? (
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
             - Slide to Complete: close now (requires ≥1 pallet photo). */
          <div className="flex gap-3">
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
          /* Estado B — partial verification. Two paths:
             - Park Order: release lock, status untouched. Order returns to
               its FedEx/Regular lane in the top section so anyone can take it.
             - Complete Now: just Select-All everything (transitions UI to
               Estado C without changing DB status). */
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
              onClick={() => onParkOrder?.()}
              className="flex-1 py-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all"
            >
              Park Order
            </button>
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
          }}
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
    </div>
  );
};
