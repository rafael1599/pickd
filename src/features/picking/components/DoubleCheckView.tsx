import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
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
import Lock from 'lucide-react/dist/esm/icons/lock';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import { scanImageForQRCodes } from '../../../hooks/useQRScanner';
import { parseQRPayload, aggregateScanResults } from '../utils/parseQRPayload';
import Camera from 'lucide-react/dist/esm/icons/camera';
import { compressImage, base64ToBlobUrl } from '../../../services/photoUpload.service';
import { useAuth } from '../../../context/AuthContext';
import { useMarkWaiting, useUnmarkWaiting, useTakeOverSku } from '../hooks/useWaitingOrders';
import { useWaitingConflicts, type WaitingConflict } from '../hooks/useWaitingConflicts';
import { WaitingConflictModal } from './WaitingConflictModal';
import { ReasonPicker } from './ReasonPicker';
import Hourglass from 'lucide-react/dist/esm/icons/hourglass';
import Play from 'lucide-react/dist/esm/icons/play';

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
  onRecomplete?: (items: PickingItem[]) => Promise<void>;
  onCancelReopen?: () => void;
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
  onRecomplete,
  onCancelReopen,
  correctionNotes: correctionNotesProp,
}) => {
  const {
    ludlowData,
    atsData,
    inventoryData: inventoryDataCtx,
    updateItem,
    deleteItem,
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
  const markWaiting = useMarkWaiting();
  const unmarkWaiting = useUnmarkWaiting();
  const takeOverSku = useTakeOverSku();
  const { data: waitingConflicts } = useWaitingConflicts(
    cartItems,
    activeListId ?? null,
    customer?.name ?? null
  );
  const [conflictDismissed, setConflictDismissed] = useState(false);
  const [isDeducting, setIsDeducting] = useState(false);
  const [showWaitingPicker, setShowWaitingPicker] = useState(false);
  const [waitingReason, setWaitingReason] = useState('');
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

  // Track original items snapshot for reopened orders to detect changes
  const [reopenedSnapshot] = useState(() =>
    status === 'reopened'
      ? JSON.stringify(cartItems.map((i) => ({ sku: i.sku, qty: i.pickingQty })))
      : null
  );
  const hasReopenedChanges =
    status === 'reopened' &&
    reopenedSnapshot !== null &&
    reopenedSnapshot !== JSON.stringify(cartItems.map((i) => ({ sku: i.sku, qty: i.pickingQty })));

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
    if (bikeSkuSet.size === 0) {
      return palletOverrides.size === 0
        ? originalPallets
        : redistributeWithOverrides(originalPallets, palletOverrides);
    }
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
  const editCallbacksRef = useRef({ updateItem, deleteItem, fetchDistributions: async () => {} });
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
          toast.error('Item not found in inventory');
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
    editCallbacksRef.current = { updateItem, deleteItem, fetchDistributions };
  }, [updateItem, deleteItem, fetchDistributions]);

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

  const problemItems = useMemo(
    () => cartItems.filter((i) => i.sku_not_found || i.insufficient_stock),
    [cartItems]
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
    () => editingCartItems.filter((i) => i.sku_not_found || i.insufficient_stock),
    [editingCartItems]
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
        const [bikes, parts] = await Promise.all([
          inventoryApi.fetchInventoryWithMetadata({ search: sku, showParts: false, limit: 10 }),
          inventoryApi.fetchInventoryWithMetadata({ search: sku, showParts: true, limit: 10 }),
        ]);
        const total = [...bikes.data, ...parts.data]
          .filter((inv) => inv.sku === sku)
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

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono font-bold text-accent/90 tracking-widest bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
              {orderNumber
                ? `#${orderNumber}`
                : activeListId
                  ? `#${activeListId.slice(-6).toUpperCase()}`
                  : 'STOCK DEDUCTION'}
            </span>
            {activeListId && <ShippingTypeToggle listId={activeListId} />}
          </div>
          {/* Progress Text */}
          <div className="flex items-center gap-3 mt-1">
            <span
              className={`text-lg font-black uppercase tracking-[0.15em] ${
                totalUnitsCount === 0
                  ? 'text-muted/70'
                  : verifiedUnitsCount === 0
                    ? 'text-red-400'
                    : verifiedUnitsCount === totalUnitsCount
                      ? 'text-emerald-400'
                      : 'text-amber-400'
              }`}
            >
              {`${verifiedUnitsCount} / ${totalUnitsCount} Units Verified`}
            </span>
            {!isReviewMode && onSelectAll && totalUnitsCount > 0 && (
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
                className="text-xs text-accent font-black uppercase tracking-widest hover:opacity-70 transition-opacity flex items-center gap-1.5 bg-accent/5 px-2 py-0.5 rounded-full border border-accent/10"
              >
                {verifiedUnitsCount === totalUnitsCount ? (
                  <>
                    <X size={10} strokeWidth={4} />
                    Deselect All
                  </>
                ) : (
                  <>
                    <Check size={10} strokeWidth={4} />
                    Select All
                  </>
                )}
              </button>
            )}
          </div>

          {/* Order Summary Brief */}
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1 bg-card px-2 py-0.5 rounded border border-subtle">
              <span className="text-[11px] font-black text-muted/60 uppercase tracking-tighter">
                Units:
              </span>
              <span className="text-[11px] font-black text-blue-400 uppercase">
                {totalUnitsCount}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-card px-2 py-0.5 rounded border border-subtle">
              <span className="text-[11px] font-black text-muted/60 uppercase tracking-tighter">
                SKUs:
              </span>
              <span className="text-[11px] font-black text-content/70 uppercase">
                {cartItems.length}
              </span>
            </div>
            <div className="flex items-center gap-1 bg-card px-2 py-0.5 rounded border border-subtle">
              <span className="text-[11px] font-black text-muted/60 uppercase tracking-tighter">
                Pallets:
              </span>
              <span className="text-[11px] font-black text-content/70 uppercase">
                {pallets.length}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
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

      {/* Clean Item List */}
      <div className="flex-1 overflow-y-auto p-4 bg-main min-h-0 pb-32">
        <div className="flex items-center gap-2 mb-6">
          <button
            onClick={() => openEditFlow()}
            className={`flex-1 p-4 border rounded-2xl flex items-center justify-between gap-3 active:scale-[0.98] transition-all ${
              problemItems.length > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-card border-subtle'
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-xl ${
                  problemItems.length > 0 ? 'bg-red-500/20' : 'bg-card'
                }`}
              >
                <Pencil
                  size={18}
                  className={problemItems.length > 0 ? 'text-red-400' : 'text-muted'}
                />
              </div>
              <div className="text-left">
                <span
                  className={`text-xs font-black uppercase tracking-widest block ${
                    problemItems.length > 0 ? 'text-red-400' : 'text-muted'
                  }`}
                >
                  {problemItems.length > 0
                    ? `${problemItems.length} issue${problemItems.length > 1 ? 's' : ''} — Edit Order`
                    : 'Edit Order'}
                </span>
                <span className="text-xs text-muted/70 font-bold">
                  Add, remove, or adjust items
                </span>
              </div>
            </div>
            <ChevronDown
              size={16}
              className={`rotate-[-90deg] ${problemItems.length > 0 ? 'text-red-400/60' : 'text-muted/40'}`}
            />
          </button>
          <button
            onClick={() => openCancelFlow()}
            className="h-full p-4 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 rounded-2xl text-red-500 transition-all active:scale-95 self-stretch flex items-center justify-center"
            title="Cancel Order"
          >
            <Trash2 size={18} />
          </button>
        </div>

        {/* Waiting for Inventory — admin-only (idea-053) */}
        {isAdmin && status !== 'completed' && status !== 'cancelled' && (
          <>
            {isWaitingInventory ? (
              <div className="flex items-center gap-2 p-3 rounded-2xl border border-amber-500/30 bg-amber-500/10">
                <Hourglass size={16} className="text-amber-500 shrink-0" />
                <span className="text-xs font-black text-amber-500 uppercase tracking-wider flex-1">
                  Waiting for Inventory
                </span>
                <button
                  onClick={() => {
                    if (!activeListId) return;
                    unmarkWaiting.mutate(
                      { listId: activeListId, action: 'resume' },
                      {
                        onSuccess: () => onSetWaitingInventory?.(false),
                      }
                    );
                  }}
                  disabled={unmarkWaiting.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase tracking-wider text-accent bg-accent/10 border border-accent/30 rounded-xl hover:bg-accent/20 transition-all active:scale-95"
                >
                  <Play size={12} />
                  Resume
                </button>
                <button
                  onClick={() => {
                    showConfirmation(
                      'Cancel Waiting Order',
                      'This will cancel the entire order. Items will be released back to inventory.',
                      () => {
                        if (!activeListId) return;
                        unmarkWaiting.mutate(
                          { listId: activeListId, action: 'cancel' },
                          {
                            onSuccess: () => onClose(),
                          }
                        );
                      },
                      () => {},
                      'Cancel Order',
                      'Go Back',
                      'danger'
                    );
                  }}
                  disabled={unmarkWaiting.isPending}
                  className="px-3 py-1.5 text-xs font-black uppercase tracking-wider text-red-500 bg-red-500/10 border border-red-500/30 rounded-xl hover:bg-red-500/20 transition-all active:scale-95"
                >
                  Cancel
                </button>
              </div>
            ) : !showWaitingPicker ? (
              <button
                onClick={() => setShowWaitingPicker(true)}
                className={`flex items-center justify-center gap-2 w-full p-3 rounded-2xl border transition-all active:scale-[0.98] ${
                  problemItems.length > 0
                    ? // Highlighted when the order has missing/short stock — the
                      // operator should consider sending this to Waiting instead
                      // of pushing forward.
                      'border-amber-500/60 bg-amber-500/15 text-amber-400 hover:bg-amber-500/20 animate-pulse'
                    : 'border-dashed border-amber-500/20 text-amber-500/60 hover:text-amber-500 hover:border-amber-500/40 hover:bg-amber-500/5'
                }`}
                title={
                  problemItems.length > 0
                    ? `This order has ${problemItems.length} item(s) with stock issues — consider waiting for inventory`
                    : undefined
                }
              >
                <Hourglass size={14} />
                <span className="text-xs font-black uppercase tracking-wider">
                  Mark as Waiting for Inventory
                </span>
              </button>
            ) : (
              <div className="p-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-amber-500 uppercase tracking-wider">
                    Why is this order waiting?
                  </span>
                  <button
                    onClick={() => {
                      setShowWaitingPicker(false);
                      setWaitingReason('');
                    }}
                    className="p-1 text-muted hover:text-content transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
                <ReasonPicker
                  actionType="waiting"
                  selectedReason={waitingReason}
                  onReasonChange={setWaitingReason}
                />
                <button
                  onClick={() => {
                    if (!activeListId || !waitingReason.trim()) return;
                    markWaiting.mutate(
                      { listId: activeListId, reason: waitingReason.trim() },
                      {
                        onSuccess: () => {
                          setShowWaitingPicker(false);
                          setWaitingReason('');
                          onSetWaitingInventory?.(true);
                        },
                      }
                    );
                  }}
                  disabled={!waitingReason.trim() || markWaiting.isPending}
                  className="w-full p-3 rounded-xl text-xs font-black uppercase tracking-wider text-white bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
                >
                  {markWaiting.isPending ? 'Marking...' : 'Confirm — Mark as Waiting'}
                </button>
              </div>
            )}
          </>
        )}

        {/* Hidden camera input for pallet scan */}
        <input
          ref={scanInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScanPallet}
          className="hidden"
        />
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <button
            onClick={() => scanInputRef.current?.click()}
            disabled={isScanning}
            className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/20 rounded-xl text-accent text-xs font-black uppercase tracking-widest active:scale-95 transition-all disabled:opacity-50"
          >
            {isScanning ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {isScanning
              ? 'Processing...'
              : palletPhotosCount !== null &&
                  palletPhotosCount > 0 &&
                  palletPhotosCount < pallets.length
                ? `Take Photo ${palletPhotosCount + 1} of ${pallets.length}`
                : 'Take Photo'}
          </button>
          {palletPhotosCount !== null && pallets.length > 0 && (
            <span
              className={`text-xs font-black px-2 py-1 rounded-md ${
                palletPhotosCount >= pallets.length
                  ? 'bg-emerald-500/15 text-emerald-400'
                  : palletPhotosCount > 0
                    ? 'bg-amber-500/15 text-amber-400'
                    : 'bg-red-500/15 text-red-400'
              }`}
            >
              {palletPhotosCount} / {pallets.length}
            </span>
          )}
          {scanStatus && <p className="text-xs text-accent font-bold">{scanStatus}</p>}
        </div>

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
                    className={`text-xs font-black uppercase tracking-[0.2em] px-3 py-1 rounded-full border flex items-center gap-1.5 ${isLocked ? 'text-amber-400/80 border-amber-500/30 bg-amber-500/5' : 'text-muted/70 border-subtle'}`}
                  >
                    {isLocked && <Lock size={8} />}
                    Pallet {pallet.id}
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
                  const similarity = skuSimilarityMap[item.sku];
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
                        className={`transition-all duration-200 rounded-2xl p-4 flex items-center justify-between gap-3 ${isReviewMode ? '' : 'active:scale-[0.98] cursor-pointer'} border ${
                          isReviewMode
                            ? item.sku_not_found
                              ? 'bg-red-500/5 border-red-500/20'
                              : item.insufficient_stock
                                ? 'bg-amber-500/5 border-amber-500/20'
                                : 'bg-card border-subtle'
                            : isChecked
                              ? item.sku_not_found
                                ? 'bg-red-500/20 border-red-500/50'
                                : 'bg-green-500/10 border-green-500/30'
                              : item.sku_not_found
                                ? 'bg-red-500/5 border-red-500/20 shadow-[0_0_10px_rgba(239,68,68,0.1)]'
                                : 'bg-card border-subtle hover:border-subtle'
                        }`}
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {/* Qty on the far left */}
                          <div className="flex flex-col items-center justify-center min-w-[3rem] shrink-0 border-r border-subtle pr-3">
                            <span className="text-[10px] font-black uppercase tracking-widest text-muted/60 mb-0.5">
                              QTY
                            </span>
                            <span
                              className={`text-2xl font-black leading-none transition-all ${
                                item.pickingQty !== 1
                                  ? 'text-amber-500 animate-pulse-warning'
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
                          <div className="flex flex-col gap-1 min-w-0">
                            {/* SKU row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`font-black text-2xl tracking-tight leading-none break-all ${isReviewMode ? (item.sku_not_found || item.insufficient_stock ? 'text-red-500' : 'text-content') : isChecked ? (item.sku_not_found || item.insufficient_stock ? 'text-red-400' : 'text-green-400') : item.sku_not_found || item.insufficient_stock ? 'text-red-500' : 'text-content'}`}
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
                              {item.sku_not_found && (
                                <span className="text-[10px] bg-red-500 text-white px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">
                                  UNREG
                                </span>
                              )}
                              {item.insufficient_stock && !item.sku_not_found && (
                                <span className="text-[10px] bg-amber-500 text-black px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">
                                  LOW STOCK
                                </span>
                              )}
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
                            {/* Product name — item_name from DB, or description from PDF */}
                            {(item.item_name || item.description) && (
                              <span className="text-[13px] font-semibold text-muted uppercase tracking-wide leading-none">
                                {(item.item_name || item.description || '').slice(0, 17)}
                              </span>
                            )}
                            {/* Distribution-based pick plan */}
                            {pickPlanMap[item.sku] ? (
                              <div
                                className={`${
                                  distributionInconsistencyMap[item.sku] === 'over'
                                    ? 'text-red-400/90'
                                    : distributionInconsistencyMap[item.sku] === 'under'
                                      ? 'text-orange-400/90'
                                      : 'text-emerald-400/70'
                                }`}
                              >
                                <span className="text-sm font-bold uppercase tracking-wider leading-none">
                                  {pickPlanMap[item.sku].map((step, i) => (
                                    <span key={i}>
                                      {i > 0 && ', '}
                                      {step.icon} {step.type} has {step.units_each}u
                                    </span>
                                  ))}
                                </span>
                                {distributionInconsistencyMap[item.sku] === 'over' && (
                                  <span className="text-[11px]"> ⚠ dist mismatch</span>
                                )}
                                {distributionInconsistencyMap[item.sku] === 'under' && (
                                  <span className="text-[11px]"> ~ approx</span>
                                )}
                              </div>
                            ) : (
                              item.insufficient_stock && (
                                <span className="text-xs font-black text-amber-500 uppercase tracking-wider leading-none">
                                  {stockMap[item.sku] !== undefined
                                    ? `${stockMap[item.sku]} in stock (need ${item.pickingQty})`
                                    : `Need ${item.pickingQty}, checking...`}
                                </span>
                              )
                            )}
                          </div>
                        </div>

                        {/* Location Info on the right - No checkbox to maximize space */}
                        <div className="flex items-center gap-3 shrink-0 ml-auto pl-2 border-l border-subtle">
                          <div className="flex flex-col items-end">
                            <span className="text-[10px] text-muted/60 font-black uppercase tracking-widest mb-0.5">
                              {item.location?.toLowerCase().includes('row') ? 'ROW' : 'LOC'}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <div
                                className={`font-mono font-black text-amber-500 leading-none ${
                                  (item.location || '').length > 8 ? 'text-lg' : 'text-2xl'
                                }`}
                              >
                                {(item.location || '')
                                  .toLowerCase()
                                  .replace('row', '')
                                  .trim()
                                  .slice(0, 5) || '-'}
                                {(() => {
                                  const subs =
                                    item.sublocation ||
                                    sublocationMap[
                                      `${item.sku}-${(item.location || '').toUpperCase()}`
                                    ];
                                  return subs && subs.length > 0 ? (
                                    <span className="text-xs font-black bg-amber-500/15 text-amber-400 px-1 py-0.5 rounded ml-1 border border-amber-500/20 align-middle">
                                      {subs.join(',')}
                                    </span>
                                  ) : null;
                                })()}
                              </div>
                              {!isReviewMode && isChecked && (
                                <div
                                  className={`flex items-center justify-center ${item.sku_not_found ? 'text-red-500' : 'text-green-500'}`}
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
          /* Reopened order — show Re-Complete and Cancel */
          <div className="flex gap-3">
            <button
              onClick={() => onCancelReopen?.()}
              className="flex-1 py-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all"
            >
              Cancel Edit
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
              disabled={isDeducting || cartItems.length === 0 || !hasReopenedChanges}
              className="flex-[2] py-4 bg-orange-500 text-white font-black uppercase tracking-widest text-xs rounded-2xl shadow-lg shadow-orange-500/20 active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-30"
            >
              <Check size={16} strokeWidth={3} />
              {isDeducting ? 'Re-Completing...' : 'Re-Complete Order'}
            </button>
          </div>
        ) : verifiedUnitsCount === totalUnitsCount ? (
          /* All verified — show slide to complete (requires at least 1 pallet photo) */
          <>
            {palletPhotosCount === 0 && (
              <div className="mb-3 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center gap-2">
                <Camera size={16} className="text-amber-500 shrink-0" />
                <p className="text-xs font-bold text-amber-500 uppercase tracking-wider">
                  Take at least 1 pallet photo before completing
                </p>
              </div>
            )}
            <SlideToConfirm
              onConfirm={handleConfirm}
              isLoading={isDeducting}
              text={palletPhotosCount === 0 ? 'PHOTO REQUIRED TO COMPLETE' : 'SLIDE TO COMPLETE'}
              confirmedText="COMPLETING..."
              variant="default"
              disabled={cartItems.length === 0 || palletPhotosCount === 0}
            />
          </>
        ) : (
          /* Not all verified — show action buttons */
          <div className="flex gap-3">
            <button
              onClick={() => onSendToVerifyQueue?.()}
              className="flex-1 py-4 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-xs rounded-2xl active:scale-95 transition-all"
            >
              Send to Verify
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
