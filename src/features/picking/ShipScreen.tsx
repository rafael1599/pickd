import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Home from 'lucide-react/dist/esm/icons/home';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { LivePrintPreview } from '../../components/orders/LivePrintPreview.tsx';
import { PalletPhotosBlock } from '../../components/orders/PalletPhotosBlock.tsx';
import { generateShipLabel } from '../../components/orders/generateShipLabel';
import { usePickingSession } from '../../context/PickingContext.tsx';
import { useViewMode } from '../../context/ViewModeContext.tsx';
import Search from 'lucide-react/dist/esm/icons/search';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';
import Truck from 'lucide-react/dist/esm/icons/truck';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import { ShipOrderCard } from '../../components/orders/ShipOrderCard.tsx';
import { OrderStatusPill } from '../../components/orders/OrderStatusPill.tsx';
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
import { compressImage, base64ToBlobUrl } from '../../services/photoUpload.service';

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
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
}

export const ShipScreen = () => {
  const { user } = useAuth();
  // Ship-Out SMS resend button on the FAB. The hook gives us `isEnabled`
  // so the button hides cleanly when the user hasn't configured it.
  const { isEnabled: isShipSmsEnabled, triggerForList: triggerShipOutSms } = useShipOutSms();
  const { takeOverOrder, loadReopenedOrder, resumeReopenedOrder, restoreCancelledOrder } =
    usePickingSession();
  const { externalOrderId, setExternalOrderId, setViewMode } = useViewMode();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithRelations | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showFedex, setShowFedex] = useState(false);
  const navigate = useNavigate();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [reopenReasonModal, setReopenReasonModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [restoreReasonModal, setRestoreReasonModal] = useState(false);
  const [restoreReason, setRestoreReason] = useState('');
  const [pendingShipmentOrder, setPendingShipmentOrder] = useState<OrderWithRelations | null>(null);
  const shipCameraInputRef = useRef<HTMLInputElement>(null);
  const [selectedBulkOrderIds, setSelectedBulkOrderIds] = useState<Set<string>>(new Set());
  const [shipTab, setShipTab] = useState<'to_ship' | 'shipped'>('to_ship');

  useEffect(() => {
    setSelectedBulkOrderIds(new Set());
  }, [shipTab]);

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
  }, [weightsReady, itemsMissingWeight]);

  // FedEx orders don't use pallets — skip pallet weight
  const isFedexOrder =
    (selectedOrder?.order_group as { group_type?: string } | null)?.group_type === 'fedex';

  // Calculate total weight from sku_metadata weights + pallet weight (40 lbs each, except FedEx)
  const totalWeight = useMemo(() => {
    const items = selectedOrder?.items;
    if (!Array.isArray(items)) return 0;
    const productWeight = items.reduce((sum: number, item: PickingListItem) => {
      const weight = skuMeta[item.sku]?.weight_lbs ?? 0;
      const qty = item.pickingQty ?? 0;
      return sum + weight * qty;
    }, 0);
    const palletCount = parseInt(formData.pallets, 10) || 0;
    const palletWeight = isFedexOrder ? 0 : palletCount * 40;
    return Math.round(productWeight + palletWeight);
  }, [selectedOrder?.items, skuMeta, formData.pallets, isFedexOrder]);

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
      if (skuMeta[item.sku]?.is_bike) bikes += qty;
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
        if (skuMeta[item.sku]?.is_bike || seen.has(item.sku)) return false;
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

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    if (!hasLoadedOnceRef.current) setLoading(true);
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
        .order('created_at', { ascending: false });

      // Wrap the supabase call so transient network/5xx errors get
      // retried with exponential backoff. Without this, a single
      // flake on a flaky network surfaces as "Failed to load orders"
      // and the picker has to manually refresh.
      const { data, error } = await withSupabaseRetry(() => query, {
        label: 'OrdersScreen.fetchOrders',
      });

      if (error) throw error;

      const mappedData = ((data || []) as unknown as OrderWithRelations[]).map((order) => ({
        ...order,
        customer_details: order.customer || {},
      }));

      setOrders(mappedData);

      // Auto-select the most recently completed order if none selected AND
      // no external jump pending — that's the one a picker most likely just
      // finished and wants to print/verify, not just the latest created row.
      if (mappedData.length > 0 && !selectedOrderRef.current && !externalOrderId) {
        const lastCompleted = mappedData.find((o) => o.status === 'completed');
        setSelectedOrder(lastCompleted || mappedData[0]);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
      toast.error('Failed to load orders');
    } finally {
      hasLoadedOnceRef.current = true;
      setLoading(false);
    }
  }, [user, externalOrderId]); // Include externalOrderId here to ensure consistency

  useEffect(() => {
    fetchOrders();

    // Subscribe to changes in picking lists to keep the UI in sync.
    // Events are coalesced with a short debounce: active picking sessions
    // update picking_lists on every scanned item, and refetching on each
    // event hammers the network for no visual gain.
    let refetchTimeout: NodeJS.Timeout | null = null;
    const channel = supabase
      .channel('orders_realtime_sync')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'picking_lists',
        },
        (payload) => {
          console.log('🔄 [OrdersScreen] Realtime update received:', payload.eventType);
          if (refetchTimeout) clearTimeout(refetchTimeout);
          refetchTimeout = setTimeout(() => {
            fetchOrders();
          }, 500);
        }
      )
      .subscribe((status) => {
        console.log('📡 [OrdersScreen] Realtime status:', status);
      });

    return () => {
      if (refetchTimeout) clearTimeout(refetchTimeout);
      supabase.removeChannel(channel);
    };
  }, [fetchOrders]);

  // Handle external selections (e.g. from DoubleCheckHeader or VerificationBoard)
  useEffect(() => {
    if (externalOrderId && orders.length > 0) {
      const order = orders.find((o) => o.id === externalOrderId);
      if (order) {
        setSelectedOrder(order);
        setExternalOrderId(null);
      }
    }
  }, [externalOrderId, orders, setExternalOrderId]);

  // Sync form data when selectedOrder changes
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
  }, [selectedOrder]);

  const filteredOrders = useMemo(() => {
    // 1. Split by the FedEx checkbox. Checked shows FedEx-grouped orders;
    //    unchecked shows everything that isn't FedEx.
    const byCarrier = orders.filter((o) => {
      if (o.status === 'cancelled') return false;
      const matchTab = searchQuery ? true : shipTab === 'shipped' ? !!o.is_shipped : !o.is_shipped;
      if (!matchTab) return false;
      const isFedex = (o.order_group as { group_type?: string } | null)?.group_type === 'fedex';
      return showFedex ? isFedex : !isFedex;
    });

    // 2. Collapse 'general' group siblings into a single virtual entry per
    //    group_id. We pick the OLDEST (first by created_at ASC) sibling as
    //    the underlying picking_list — clicks/select operate on its id, and
    //    loadExternalList merges sibling items via group_id at open time.
    //    The display order_number becomes "A / B" sorted ascending.
    const byGroup = new Map<string, typeof byCarrier>();
    const ungrouped: typeof byCarrier = [];
    for (const o of byCarrier) {
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
      // Sort siblings by created_at asc — oldest is the "anchor" row.
      siblings.sort((a, b) => a.created_at.localeCompare(b.created_at));
      const anchor = siblings[0];
      const allOrderNumbers = siblings
        .map((s) => s.order_number)
        .filter((n): n is string => !!n)
        .sort((a, b) => a.localeCompare(b));
      const combinedOrderNumber = allOrderNumbers.join(' / ');
      collapsed.push({
        ...anchor,
        order_number: combinedOrderNumber || anchor.order_number,
        // Mark as combined so the order list badges it like the watchdog combines.
        combine_meta: {
          ...(anchor.combine_meta ?? {}),
          is_combined: true,
        } as typeof anchor.combine_meta,
      });
    }

    // Re-sort by created_at desc to preserve the original list ordering.
    collapsed.sort((a, b) => b.created_at.localeCompare(a.created_at));

    const query = searchQuery.toLowerCase().trim();
    const results = collapsed.filter((order) => {
      const orderNum = String(order.order_number || '').toLowerCase();
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
  }, [orders, searchQuery, showFedex, shipTab]);

  const visibleOrders = useMemo(() => {
    const todayStr = dayKey(new Date());

    const todayOrders = filteredOrders.filter((order) => {
      const orderDate = new Date(order.created_at);
      return !Number.isNaN(orderDate.getTime()) && dayKey(orderDate) === todayStr;
    });

    const olderOrders = filteredOrders.filter((order) => {
      const orderDate = new Date(order.created_at);
      return Number.isNaN(orderDate.getTime()) || dayKey(orderDate) !== todayStr;
    });

    if (todayOrders.length < 10) {
      const needed = 10 - todayOrders.length;
      const extra = olderOrders.slice(0, needed);
      return [...todayOrders, ...extra];
    } else {
      return todayOrders;
    }
  }, [filteredOrders]);

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

  const shippableOrders = useMemo(() => {
    if (shipTab === 'shipped') {
      return visibleOrders;
    }
    return visibleOrders.filter((o) => !o.is_waiting_inventory && o.status === 'completed');
  }, [visibleOrders, shipTab]);

  const isAllSelected = useMemo(() => {
    if (shippableOrders.length === 0) return false;
    return shippableOrders.every((o) => selectedBulkOrderIds.has(o.id));
  }, [shippableOrders, selectedBulkOrderIds]);

  const toggleSelectAll = () => {
    setSelectedBulkOrderIds((prev) => {
      const next = new Set(prev);
      const allShippableIds = shippableOrders.map((o) => o.id);
      const areAllCurrentlySelected = allShippableIds.every((id) => next.has(id));

      if (areAllCurrentlySelected) {
        allShippableIds.forEach((id) => next.delete(id));
      } else {
        allShippableIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const handleBulkShip = async () => {
    const idsToShip = Array.from(selectedBulkOrderIds);
    if (idsToShip.length === 0) return;

    const confirmBulk = window.confirm(
      `Are you sure you want to mark ${idsToShip.length} selected orders as Shipped?`
    );
    if (confirmBulk) {
      const toastId = toast.loading(`Shipping ${idsToShip.length} orders...`);
      try {
        const { error } = await supabase
          .from('picking_lists')
          .update({ status: 'completed', is_shipped: true, is_waiting_inventory: false } as any)
          .in('id', idsToShip);

        if (error) throw error;

        toast.success(`Successfully marked ${idsToShip.length} orders as Shipped!`, {
          id: toastId,
        });
        setSelectedBulkOrderIds(new Set());
        fetchOrders();
      } catch (err) {
        console.error('Error bulk shipping orders:', err);
        toast.error('Failed to ship orders', { id: toastId });
      }
    }
  };

  const handleBulkUndoShip = async () => {
    const idsToUndo = Array.from(selectedBulkOrderIds);
    if (idsToUndo.length === 0) return;

    const confirmBulkUndo = window.confirm(
      `Are you sure you want to undo Shipped status for ${idsToUndo.length} selected orders?`
    );
    if (confirmBulkUndo) {
      const toastId = toast.loading(`Undoing shipping for ${idsToUndo.length} orders...`);
      try {
        const { error } = await supabase
          .from('picking_lists')
          .update({ is_shipped: false } as any)
          .in('id', idsToUndo);

        if (error) throw error;

        toast.success(`Successfully restored ${idsToUndo.length} orders!`, { id: toastId });
        setSelectedBulkOrderIds(new Set());
        fetchOrders();
      } catch (err) {
        console.error('Error bulk undoing shipping:', err);
        toast.error('Failed to restore orders', { id: toastId });
      }
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

      // Refresh orders list silently
      fetchOrders();
      return true;
    } catch (error) {
      console.error('Error saving order details:', error);
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
    (overrides?: Partial<typeof formData>, pickedCustomerId?: string | null) =>
      persistOrderDetailsRef.current(overrides, pickedCustomerId),
    []
  );

  const handlePrint = async () => {
    if (!selectedOrder || isPrinting) return;

    // Build warnings for missing data
    const palletsNum = parseInt(String(formData.pallets)) || 0;

    if (palletsNum < 1) {
      toast.error('Must have at least 1 Pallet');
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
      await fetchOrders();
    } catch {
      // Error already toasted in restoreCancelledOrder
    }
  };

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
        try {
          const { error } = await supabase
            .from('picking_lists')
            .update({ status: 'completed', is_shipped: true, is_waiting_inventory: false } as any)
            .eq('id', order.id);
          if (error) throw error;
          toast.success(`Order #${order.order_number} marked as Shipped!`);
          fetchOrders();
        } catch (err) {
          console.error('Error completing order:', err);
          toast.error('Failed to complete order');
        }
      }
    }
  };

  const handleUndoShipOrder = async (order: OrderWithRelations) => {
    const confirmUndo = window.confirm(
      `Undo Shipped status for order #${order.order_number}? This returns it to the Live Board.`
    );
    if (confirmUndo) {
      try {
        const { error } = await supabase
          .from('picking_lists')
          .update({ is_shipped: false } as any)
          .eq('id', order.id);
        if (error) throw error;
        toast.success(`Order #${order.order_number} marked as not shipped!`);
        fetchOrders();
      } catch (err) {
        console.error('Error undoing shipping:', err);
        toast.error('Failed to undo shipping');
      }
    }
  };

  const handleShipCameraChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !pendingShipmentOrder) return;
    e.target.value = ''; // reset

    const toastId = toast.loading('Compressing and uploading photo...');
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

      // Update Database
      const { error } = await supabase
        .from('picking_lists')
        .update({
          status: 'completed',
          is_shipped: true,
          is_waiting_inventory: false,
          pallet_photos: updatedPhotos,
        } as any)
        .eq('id', pendingShipmentOrder.id);

      if (error) throw error;

      toast.success(`Order #${pendingShipmentOrder.order_number} marked as Shipped!`, {
        id: toastId,
      });
      fetchOrders();
    } catch (err) {
      console.error('Failed to ship order with photo:', err);
      toast.error('Failed to upload photo & ship order', { id: toastId });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-bg-main">
        <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col h-screen w-full overflow-hidden bg-bg-main font-body">
      {/* Header — title + FedEx checkbox, then full-width search, like Orders */}
      <header className="shrink-0 ios-glass !border-none !shadow-none px-4 md:px-6 py-4 z-[100]">
        <div className="w-full flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-black uppercase tracking-tight text-content">Ship</h1>
            <div className="flex items-center gap-3">
              <DoubleCheckHeader />
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showFedex}
                  onChange={(e) => setShowFedex(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
                <span className="text-xs font-black uppercase tracking-widest text-muted">
                  FedEx
                </span>
              </label>
            </div>
          </div>
          <SearchInput
            variant="inline"
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search orders or customer..."
            preferenceId="ship"
          />
        </div>
      </header>

      {/* Main scroll area */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto no-scrollbar relative bg-bg-main px-4 md:px-6 pb-32"
      >
        <div className="w-full flex flex-col md:flex-row gap-4 md:gap-6 pt-4 items-start">
          {/* Vertical order list — grouped by date */}
          <div className="w-full md:w-80 shrink-0 md:sticky md:top-0">
            <div className="bg-card border border-subtle rounded-3xl p-3 flex flex-col gap-2">
              <div className="px-2 pb-1 flex items-center justify-between min-h-[24px]">
                <span className="text-[10px] font-black uppercase tracking-widest text-muted/50">
                  Orders
                </span>
                {shippableOrders.length > 0 && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={toggleSelectAll}
                      className="text-[9px] font-black uppercase tracking-wider text-accent hover:underline select-none"
                    >
                      {isAllSelected ? 'None' : 'All'}
                    </button>
                    {selectedBulkOrderIds.size > 0 && (
                      <button
                        onClick={shipTab === 'shipped' ? handleBulkUndoShip : handleBulkShip}
                        className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border transition-all select-none ${
                          shipTab === 'shipped'
                            ? 'text-amber-400 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500 hover:text-white'
                            : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500 hover:text-white'
                        }`}
                      >
                        {shipTab === 'shipped' ? 'Undo' : 'Ship'} ({selectedBulkOrderIds.size})
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Tab Switcher */}
              <div className="grid grid-cols-2 p-0.5 bg-bg-main rounded-xl border border-subtle text-[10px] select-none">
                <button
                  onClick={() => {
                    setShipTab('to_ship');
                    if (selectedOrder?.is_shipped) {
                      const firstUnshipped = orders.find(
                        (o) => o.status !== 'cancelled' && !o.is_shipped
                      );
                      setSelectedOrder(firstUnshipped || null);
                    }
                  }}
                  className={`py-1 rounded-lg font-black uppercase tracking-wider text-center transition-all ${
                    shipTab === 'to_ship'
                      ? 'bg-card text-accent border border-subtle shadow-sm'
                      : 'text-muted hover:text-content'
                  }`}
                >
                  To Ship
                </button>
                <button
                  onClick={() => {
                    setShipTab('shipped');
                    if (!selectedOrder?.is_shipped) {
                      const firstShipped = orders.find(
                        (o) => o.status !== 'cancelled' && o.is_shipped
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
                  Shipped
                </button>
              </div>

              <div className="flex flex-col gap-2 max-h-72 md:max-h-[calc(100vh-16rem)] overflow-y-auto no-scrollbar">
                {ordersGroupedByDate.length > 0 ? (
                  <div className="space-y-3">
                    {ordersGroupedByDate.map((group) => (
                      <div key={group.key} className="space-y-1.5">
                        <div className="sticky top-0 z-[1] px-2 py-1 text-[9px] font-black uppercase tracking-widest text-muted/60 bg-card/80 backdrop-blur-sm">
                          {group.label}
                        </div>
                        {group.orders.map((order) => {
                          const isSelected = selectedOrder?.id === order.id;
                          const isFedex =
                            (order.order_group as { group_type?: string } | null)?.group_type ===
                            'fedex';
                          return (
                            <div
                              key={order.id}
                              className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-2xl border transition-all ${
                                isSelected
                                  ? 'bg-accent/10 border-accent/30'
                                  : 'bg-surface border-transparent hover:border-subtle'
                              }`}
                            >
                              {!order.is_waiting_inventory &&
                                (shipTab === 'shipped'
                                  ? !!order.is_shipped
                                  : !order.is_shipped && order.status === 'completed') && (
                                  <input
                                    type="checkbox"
                                    checked={selectedBulkOrderIds.has(order.id)}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      setSelectedBulkOrderIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(order.id)) {
                                          next.delete(order.id);
                                        } else {
                                          next.add(order.id);
                                        }
                                        return next;
                                      });
                                    }}
                                    className="w-3.5 h-3.5 rounded border-subtle text-accent focus:ring-accent bg-bg-main cursor-pointer shrink-0"
                                  />
                                )}
                              <div
                                className="min-w-0 flex-1 flex flex-col cursor-pointer"
                                onClick={() => {
                                  setSelectedOrder(order);
                                  setShipTab(order.is_shipped ? 'shipped' : 'to_ship');
                                }}
                              >
                                <span className="font-mono text-sm font-black text-content flex items-center gap-1 truncate">
                                  {order.combine_meta?.is_combined && (
                                    <span title="Combined order">🔗</span>
                                  )}
                                  #{order.order_number}
                                </span>
                                <span className="text-[11px] text-muted truncate max-w-[120px]">
                                  {order.customer?.name || '—'}
                                </span>
                                <div className="flex flex-col gap-0.5 mt-1 text-[9px] text-muted">
                                  <span>
                                    Created:{' '}
                                    {new Date(order.created_at).toLocaleDateString('en-US', {
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </span>
                                  {order.is_shipped && (
                                    <span className="text-emerald-400 font-bold">
                                      Shipped:{' '}
                                      {new Date(order.updated_at).toLocaleDateString('en-US', {
                                        month: 'short',
                                        day: 'numeric',
                                      })}{' '}
                                      ·{' '}
                                      {new Date(order.updated_at).toLocaleTimeString('en-US', {
                                        hour: 'numeric',
                                        minute: '2-digit',
                                        hour12: true,
                                      })}
                                    </span>
                                  )}
                                </div>
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
                                    <OrderStatusPill
                                      status={order.status}
                                      is_waiting_inventory={order.is_waiting_inventory}
                                      is_shipped={order.is_shipped}
                                    />
                                    {order.status === 'completed' ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleShipOrderClick(order);
                                        }}
                                        className="p-1 rounded bg-accent/15 border border-accent/30 text-accent hover:bg-accent hover:text-white transition-all active:scale-95 flex items-center justify-center"
                                        title="Mark as Shipped"
                                      >
                                        <Truck size={14} />
                                      </button>
                                    ) : (
                                      <button
                                        disabled
                                        className="p-1 rounded bg-muted/10 border border-muted/20 text-muted/40 cursor-not-allowed flex items-center justify-center"
                                        title="Order must be verified on Live Board before shipping"
                                      >
                                        <Truck size={14} />
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
                ) : (
                  <p className="text-center text-xs text-muted py-6">No orders found.</p>
                )}
              </div>
            </div>
          </div>

          {/* Selected order — card + preview */}
          <div className="flex-1 min-w-0 flex flex-col gap-6 pb-8">
            {selectedOrder ? (
              <>
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
                  screenOnly
                />

                <ShipOrderCard
                  formData={formData}
                  setFormData={setFormData}
                  selectedOrder={
                    selectedOrder as React.ComponentProps<typeof ShipOrderCard>['selectedOrder']
                  }
                  selectedCustomerId={selectedCustomerId}
                  user={user}
                  takeOverOrder={takeOverOrder}
                  onRefresh={fetchOrders}
                  onAutoSave={handleAutoSave}
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
                  autoBikeCount={autoBikeCount}
                  autoPartCount={autoPartCount}
                  autoWeight={totalWeight}
                />

                <PalletPhotosBlock
                  photos={selectedOrder.pallet_photos ?? []}
                  orderNumber={selectedOrder.order_number ?? undefined}
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
            ) : (
              <div className="h-full min-h-[50vh] flex flex-col items-center justify-center text-text-muted space-y-4">
                <div className="w-16 h-16 rounded-full bg-surface border border-subtle flex items-center justify-center shadow-sm">
                  <Search size={32} className="opacity-20" />
                </div>
                <p className="font-heading text-xl font-bold opacity-30">
                  Select an order to preview
                </p>
              </div>
            )}
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

        {/* Home Button */}
        <button
          onClick={() => {
            setViewMode('stock');
            navigate('/');
          }}
          className="w-14 h-14 flex items-center justify-center rounded-full bg-surface border-2 border-subtle text-muted hover:text-accent transition-all duration-300 shadow-xl active:scale-95"
          title="Go to Home"
        >
          <Home size={24} />
        </button>
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
    </div>
  );
};
