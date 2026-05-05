import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase.ts';
import { useAuth } from '../../context/AuthContext.tsx';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Home from 'lucide-react/dist/esm/icons/home';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { LivePrintPreview, unitsLines } from '../../components/orders/LivePrintPreview.tsx';
import { usePickingSession } from '../../context/PickingContext.tsx';
import { useViewMode } from '../../context/ViewModeContext.tsx';
import Search from 'lucide-react/dist/esm/icons/search';
import Filter from 'lucide-react/dist/esm/icons/filter';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { OrderChip } from '../../components/orders/OrderChip.tsx';
import { OrderSidebar } from '../../components/orders/OrderSidebar.tsx';
import { FloatingActionButtons } from '../../components/orders/FloatingActionButtons.tsx';
import { PickingSummaryModal } from '../../components/orders/PickingSummaryModal.tsx';
import { SplitOrderModal } from '../../components/orders/SplitOrderModal.tsx';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import type { PickingListItem, CombineMeta } from '../../schemas/picking.schema';
import { saveCustomerAddress } from '../../lib/customerAddresses';
import { ReasonPicker, REOPEN_REASON_ADDON } from './components/ReasonPicker';
import {
  AddOnTargetPickerModal,
  type AddOnTargetCandidate,
} from './components/AddOnTargetPickerModal';
import { useOrderGroups } from './hooks/useOrderGroups';

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
  order_group: { group_type: string | null } | null;
}

export const OrdersScreen = () => {
  const { user } = useAuth();
  const {
    takeOverOrder,
    loadReopenedOrder,
    resumeReopenedOrder,
    reopenOrder,
    loadExternalList,
    setSessionMode,
  } = usePickingSession();
  const { createGroup } = useOrderGroups();
  const { externalOrderId, setExternalOrderId, setViewMode } = useViewMode();
  const [orders, setOrders] = useState<OrderWithRelations[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OrderWithRelations | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeFilter, setTimeFilter] = useState('ALL');
  const navigate = useNavigate();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [isSearchExpanded, setIsSearchExpanded] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isMobileOrderListOpen, setIsMobileOrderListOpen] = useState(false);
  const [reopenReasonModal, setReopenReasonModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  // Add-On reopen flow (idea-067 Phase 2): after the user picks the reason,
  // we open a target picker modal listing all open orders, highlighting any
  // from the same customer.
  const [addOnPickerOpen, setAddOnPickerOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);
  const mobileDropdownRef = useRef<HTMLDivElement>(null);
  const searchQueryRef = useRef(searchQuery);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false);
      }
      if (mobileDropdownRef.current && !mobileDropdownRef.current.contains(event.target as Node)) {
        setIsMobileOrderListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  // Auto-open mobile dropdown when search has a query
  useEffect(() => {
    if (searchQuery.trim()) {
      setIsMobileOrderListOpen(true);
    }
  }, [searchQuery]);
  const [isPrinting, setIsPrinting] = useState(false);
  const [pressedKey, setPressedKey] = useState<'left' | 'right' | null>(null);
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

  // Total units always derived from bikes + parts
  const totalUnits = bikeCount + partCount;

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

  const fetchOrders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      let query = supabase
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

      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      if (timeFilter === 'TODAY') {
        query = query.gte('created_at', startOfToday.toISOString());
      } else if (timeFilter === 'YESTERDAY') {
        const startOfYesterday = new Date(startOfToday);
        startOfYesterday.setDate(startOfYesterday.getDate() - 1);
        const endOfYesterday = new Date(startOfToday);
        endOfYesterday.setMilliseconds(-1);
        query = query
          .gte('created_at', startOfYesterday.toISOString())
          .lte('created_at', endOfYesterday.toISOString());
      } else if (timeFilter === 'WEEK') {
        const lastWeek = new Date(startOfToday);
        lastWeek.setDate(lastWeek.getDate() - 7);
        query = query.gte('created_at', lastWeek.toISOString());
      }

      const { data, error } = await query;

      if (error) throw error;

      const mappedData = ((data || []) as unknown as OrderWithRelations[]).map((order) => ({
        ...order,
        customer_details: order.customer || {},
      }));

      setOrders(mappedData);

      // Auto-select first order if none selected AND no external jump pending
      if (mappedData.length > 0 && !selectedOrderRef.current && !externalOrderId) {
        setSelectedOrder(mappedData[0]);
      }
    } catch (err) {
      console.error('Error fetching orders:', err);
      toast.error('Failed to load orders');
    } finally {
      setLoading(false);
    }
  }, [user, timeFilter, externalOrderId]); // Include externalOrderId here to ensure consistency

  useEffect(() => {
    fetchOrders();

    // Subscribe to changes in picking lists to keep the UI in sync
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
          fetchOrders();
        }
      )
      .subscribe((status) => {
        console.log('📡 [OrdersScreen] Realtime status:', status);
      });

    return () => {
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
    const query = searchQuery.toLowerCase().trim();
    const results = orders.filter((order) => {
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
  }, [orders, searchQuery]);

  // Keyboard arrow navigation between orders (placed after filteredOrders is declared)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
        // For inputs, only allow the print shortcut to pass through
        if (!((e.ctrlKey || e.metaKey) && e.key === 'p')) return;
      }

      // Print Shortcut (Ctrl+P or Cmd+P)
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        handlePrint();
        return;
      }

      if (e.key === 'ArrowRight') setPressedKey('right');
      if (e.key === 'ArrowLeft') setPressedKey('left');
      if (filteredOrders.length === 0 || !selectedOrder) return;
      const currentIndex = filteredOrders.findIndex((o) => o.id === selectedOrder?.id);
      if (e.key === 'ArrowRight') {
        if (currentIndex >= filteredOrders.length - 1) {
          toast('No more orders', { icon: '➡️', duration: 1500 });
        } else {
          setSelectedOrder(filteredOrders[currentIndex + 1]);
        }
      }
      if (e.key === 'ArrowLeft') {
        if (currentIndex <= 0) {
          toast('Already at the latest order', { icon: '⬅️', duration: 1500 });
        } else {
          setSelectedOrder(filteredOrders[currentIndex - 1]);
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') setPressedKey(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredOrders, selectedOrder]);

  const handlePrint = async () => {
    if (!selectedOrder) return;

    // Build warnings for missing data
    const palletsNum = parseInt(String(formData.pallets)) || 0;
    const unitsNum = totalUnits;

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
      let finalCustomerId = selectedCustomerId;

      // Logic to determine if we Update Existing, Create New, or Unlink
      if (finalCustomerId && originalCustomerParams) {
        const nameChanged = formData.customerName.trim() !== originalCustomerParams.name.trim();
        const addressChanged =
          formData.street.trim() !== (originalCustomerParams.street || '').trim() ||
          formData.city.trim() !== (originalCustomerParams.city || '').trim() ||
          formData.state.trim() !== (originalCustomerParams.state || '').trim() ||
          formData.zip.trim() !== (originalCustomerParams.zip_code || '').trim();

        if (nameChanged && addressChanged) {
          // Both changed -> Treat as NEW Customer
          finalCustomerId = null; // Will trigger create below
        } else if (nameChanged || addressChanged) {
          // Only one changed -> Update Existing Customer
          // Standard update logic will handle this below
        }
      }

      // Create New Customer if needed
      if (!finalCustomerId && formData.customerName.trim()) {
        const { data: newCust, error: createError } = await supabase
          .from('customers')
          .insert({
            name: formData.customerName,
            street: formData.street,
            city: formData.city,
            state: formData.state,
            zip_code: formData.zip,
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
            name: formData.customerName,
            street: formData.street,
            city: formData.city,
            state: formData.state,
            zip_code: formData.zip,
          })
          .eq('id', finalCustomerId);

        if (updateError) console.error('Failed to update customer record:', updateError);
      }

      // Auto-save address to customer_addresses (idea-012)
      if (finalCustomerId && formData.street.trim()) {
        saveCustomerAddress({
          customerId: finalCustomerId,
          street: formData.street,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
        }).catch(() => {}); // Silent — non-blocking
      }

      // Update Picking List
      const { error: orderError } = await supabase
        .from('picking_lists')
        .update({
          pallets_qty: palletsNum,
          total_units: unitsNum,
          total_weight_lbs: effectiveWeight || null,
          load_number: formData.loadNumber || null,
          transport_company: formData.transportCompany || null,
          customer_id: finalCustomerId, // Link to the customer (new or existing)
        })
        .eq('id', selectedOrder.id);

      if (orderError) {
        // Handle Unique Constraint Violation for Load Number
        if (orderError.code === '23505' && orderError.message.includes('load_number')) {
          toast.error(
            `Load Number "${formData.loadNumber}" matches another order! Must be unique.`,
            { duration: 5000 }
          );
          setIsPrinting(false);
          return; // Stop execution
        }
        throw orderError;
      }

      // Refresh orders list silently
      fetchOrders();
      const { default: jsPDF } = await import('jspdf');

      // 6×4" landscape — matches Zebra label printer, no scaling needed
      const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'in',
        format: [6, 4],
      });

      const pageWidth = 6;
      const pageHeight = 4;
      const PT_TO_IN = 1 / 72;
      const LINE_HEIGHT = 1.1;
      const customerNameName = (formData.customerName || 'GENERIC CUSTOMER').toUpperCase();
      const street = formData.street.toUpperCase();
      const cityStateZip = `${formData.city.toUpperCase()}, ${formData.state.toUpperCase()} ${formData.zip}`;
      const pallets = palletsNum;

      for (let i = 0; i < pallets; i++) {
        // --- PAGE A: COMPANY INFO ---
        if (i > 0) doc.addPage([6, 4], 'landscape');

        const margin = 0.2;
        const maxWidth = pageWidth - margin * 2;
        const maxHeight = pageHeight - margin * 2;

        // Build content lines
        const contentLines: string[] = [];
        contentLines.push(customerNameName);
        if (street) contentLines.push(street);
        if (formData.city) contentLines.push(cityStateZip);
        contentLines.push(''); // spacer
        contentLines.push(`ORDER #: ${selectedOrder?.order_number || 'N/A'}`);
        contentLines.push(`PALLETS: ${pallets}`);
        contentLines.push(...unitsLines(bikeCount, partCount));
        contentLines.push(`LOAD: ${formData.loadNumber || 'N/A'}`);
        contentLines.push(`WEIGHT: ${effectiveWeight > 0 ? `${effectiveWeight} LBS` : 'N/A'}`);
        contentLines.push(''); // spacer
        const thankYouMsg =
          'Please count your shipment carefully that there are no damages due to shipping. Jamis Bicycles thanks you for your order.';

        // Dynamic font sizing: find the largest font that fits all content
        let fontSize = 100; // Start with a larger font to maximize space
        const minFontSize = 12;
        let fits = false;

        doc.setFont('helvetica', 'bold');

        while (fontSize >= minFontSize && !fits) {
          doc.setFontSize(fontSize);
          doc.setLineHeightFactor(LINE_HEIGHT);

          let totalHeight = margin;

          // Calculate height for all main content lines
          for (const line of contentLines) {
            if (line === '') {
              totalHeight += fontSize * PT_TO_IN * 0.3; // spacer
            } else {
              const wrapped = doc.splitTextToSize(line, maxWidth);
              totalHeight += wrapped.length * (fontSize * PT_TO_IN * LINE_HEIGHT);
            }
          }

          // Add thank you message (slightly smaller)
          const msgFontSize = fontSize * 0.7;
          doc.setFontSize(msgFontSize);
          const msgWrapped = doc.splitTextToSize(thankYouMsg.toUpperCase(), maxWidth);
          totalHeight += msgWrapped.length * (msgFontSize * PT_TO_IN * LINE_HEIGHT);

          // Check if it fits
          if (totalHeight <= maxHeight) {
            fits = true;
          } else {
            fontSize -= 1; // Finer precision
          }
        }

        // Render with the calculated font size
        let yPos = margin + fontSize * PT_TO_IN; // Start exactly at margin + CapHeight
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fontSize);
        doc.setLineHeightFactor(LINE_HEIGHT);

        for (const line of contentLines) {
          if (line === '') {
            yPos += fontSize * PT_TO_IN * 0.3; // spacer
          } else {
            const wrapped = doc.splitTextToSize(line, maxWidth);
            doc.text(wrapped, margin, yPos);
            yPos += wrapped.length * (fontSize * PT_TO_IN * LINE_HEIGHT);
          }
        }

        // Thank you message
        const msgFontSize = fontSize * 0.7;
        doc.setFontSize(msgFontSize);
        const msgWrapped = doc.splitTextToSize(thankYouMsg.toUpperCase(), maxWidth);
        doc.text(msgWrapped, margin, yPos);

        // --- PAGE B: PALLET NUMBER ONLY (clean, centered) ---
        if (pallets > 1) {
          doc.addPage([6, 4], 'landscape');
          doc.setFont('helvetica', 'bold');

          // "PALLET" label above the numbers
          doc.setFontSize(48);
          const labelText = 'PALLET';
          const labelWidth = doc.getTextWidth(labelText);
          doc.text(labelText, (pageWidth - labelWidth) / 2, pageHeight / 2 - 0.4);

          // "X of Y" numbers
          doc.setFontSize(80);
          const textNum = `${i + 1} of ${pallets}`;
          const textWidth = doc.getTextWidth(textNum);
          doc.text(textNum, (pageWidth - textWidth) / 2, pageHeight / 2 + 0.8);
        }
      }

      const blob = doc.output('bloburl');
      window.open(blob, '_blank');
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

  const handleNextOrder = () => {
    if (filteredOrders.length === 0 || !selectedOrder) return;
    const currentIndex = filteredOrders.findIndex((o) => o.id === selectedOrder?.id);
    if (currentIndex >= filteredOrders.length - 1) {
      toast('No more orders', { icon: '➡️', duration: 1500 });
    } else {
      setSelectedOrder(filteredOrders[currentIndex + 1]);
    }
  };

  const handlePreviousOrder = () => {
    if (filteredOrders.length === 0 || !selectedOrder) return;
    const currentIndex = filteredOrders.findIndex((o) => o.id === selectedOrder?.id);
    if (currentIndex <= 0) {
      toast('Already at the latest order', { icon: '⬅️', duration: 1500 });
    } else {
      setSelectedOrder(filteredOrders[currentIndex - 1]);
    }
  };

  const handleReopenOrder = () => {
    if (!selectedOrder) return;
    setReopenReason('');
    setReopenReasonModal(true);
  };

  const handleConfirmReopen = async () => {
    if (!selectedOrder || !reopenReason) return;
    setReopenReasonModal(false);

    // idea-067 Phase 2: Add-On flow takes a separate path — instead of going
    // straight into reopened mode, the user must pick which open order to
    // merge into. The actual reopen + group-create + nav happens in
    // handleAddOnTargetPicked once they choose a target.
    if (reopenReason === REOPEN_REASON_ADDON) {
      setAddOnPickerOpen(true);
      return;
    }

    try {
      await loadReopenedOrder(selectedOrder.id, reopenReason);
      // Navigate to home so the drawer renders and auto-opens for reopened mode
      setViewMode('picking');
      navigate('/');
    } catch {
      // Error already toasted in loadReopenedOrder
    }
  };

  const handleAddOnTargetPicked = async (target: AddOnTargetCandidate) => {
    setAddOnPickerOpen(false);
    if (!selectedOrder) return;
    const sourceId = selectedOrder.id;

    // Multi-user guard: don't merge into an order someone else is verifying.
    if (target.status === 'double_checking') {
      toast.error(
        `#${target.order_number} is being verified by another user. Cancel that session first.`,
        { duration: 4500 }
      );
      return;
    }

    try {
      // 0. If the target had a stale singleton group_id (orphan from a prior
      //    canceled flow), free it before creating the new group. The modal
      //    already filtered out genuinely-grouped rows; whatever stale_group_id
      //    we get here is a true orphan.
      if (target.stale_group_id) {
        await supabase.from('picking_lists').update({ group_id: null }).eq('id', target.id);
        await supabase.from('order_groups').delete().eq('id', target.stale_group_id);
      }

      // 1. Reopen the completed source (saves snapshot, status → reopened).
      await reopenOrder(sourceId, REOPEN_REASON_ADDON);

      // 2. Bind both orders into a 'general' group so loadExternalList merges
      //    items for display in DoubleCheckView (idea-053/idea-055/idea-067).
      const groupId = await createGroup('general', [sourceId, target.id]);
      if (!groupId) {
        // createGroup already toasts on failure. Rollback the reopen so the
        // user isn't left with an orphan in 'reopened'.
        toast.error('Could not create the group — undoing reopen.');
        if (user?.id) {
          await supabase.rpc('cancel_reopen', { p_list_id: sourceId, p_user_id: user.id });
        }
        return;
      }

      // 3. Load the merged view and tag the session as reopened so
      //    DoubleCheckView renders the right controls.
      await loadExternalList(sourceId);
      setSessionMode('reopened');

      // 4. Take the user to the home route where PickingCartDrawer mounts.
      setViewMode('picking');
      navigate('/');
    } catch (err) {
      console.error('Add-On flow failed:', err);
      toast.error('Add-On failed. Please try again.');
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
    <div className="relative flex flex-col md:flex-row h-screen w-full overflow-hidden bg-bg-main font-body">
      {/* Left Sidebar - Order Details Form (Desktop) */}
      <div className="hidden md:block">
        <OrderSidebar
          formData={formData}
          setFormData={setFormData}
          selectedOrder={
            selectedOrder as React.ComponentProps<typeof OrderSidebar>['selectedOrder']
          }
          selectedCustomerId={selectedCustomerId}
          user={user}
          takeOverOrder={takeOverOrder}
          onRefresh={fetchOrders}
          onDelete={() => {
            if (filteredOrders.length <= 1) {
              setSelectedOrder(null);
              return;
            }
            const currentIndex = filteredOrders.findIndex((o) => o.id === selectedOrder?.id);
            if (currentIndex < filteredOrders.length - 1) {
              setSelectedOrder(filteredOrders[currentIndex + 1]);
            } else {
              setSelectedOrder(filteredOrders[currentIndex - 1]);
            }
          }}
          onShowPickingSummary={() => setIsShowingPickingSummary(true)}
          onSplitOrder={() => setIsShowingSplitModal(true)}
          onReopenOrder={handleReopenOrder}
          onContinueEditing={handleContinueEditing}
          autoBikeCount={autoBikeCount}
          autoPartCount={autoPartCount}
          totalUnits={totalUnits}
          autoWeight={totalWeight}
        />
      </div>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden h-full">
        {/* Top Navigation Bar */}
        <header className="h-24 ios-glass !border-none !shadow-none shrink-0 flex items-center px-4 md:px-8 z-[100]">
          <div className="flex items-center w-full gap-3 md:gap-6 min-w-0 h-full">
            {/* Search Section */}
            <div
              className={`relative transition-all duration-500 ease-in-out shrink-0 ${isSearchExpanded ? 'flex-1 md:flex-none md:w-80' : 'w-12'}`}
            >
              <SearchInput
                variant="inline"
                isExpandable
                isExpanded={isSearchExpanded}
                onExpandChange={(expanded) => {
                  setIsSearchExpanded(expanded);
                  if (!expanded) setIsMobileOrderListOpen(false);
                }}
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search orders..."
                preferenceId="orders"
                className="w-full h-full"
              />
              {/* Mobile: Search results dropdown */}
              {isSearchExpanded && isMobileOrderListOpen && searchQuery.trim() && (
                <div className="md:hidden absolute top-14 left-0 w-[calc(100vw-2rem)] max-h-[60vh] overflow-y-auto bg-surface border border-subtle rounded-[2rem] shadow-2xl p-4 z-[110] animate-soft-in no-scrollbar">
                  <p className="text-[10px] font-black uppercase tracking-widest text-muted/30 px-4 mb-2">
                    Results ({filteredOrders.length})
                  </p>
                  {filteredOrders.map((order) => (
                    <button
                      key={order.id}
                      onClick={() => {
                        setSelectedOrder(order);
                        setIsMobileOrderListOpen(false);
                        setSearchQuery('');
                        setIsSearchExpanded(false);
                      }}
                      className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-between ${
                        selectedOrder?.id === order.id
                          ? 'bg-accent text-white border border-accent/20'
                          : 'hover:bg-main text-muted'
                      }`}
                    >
                      <span className="truncate">
                        #{order.order_number}
                        {order.customer?.name && (
                          <span
                            className={`ml-1 font-bold normal-case tracking-normal ${selectedOrder?.id === order.id ? 'text-white/60' : 'text-muted/40'}`}
                          >
                            : {order.customer.name}
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Orders Selection — Mobile: Dropdown, Desktop: Horizontal Scroll */}
            <div
              className={`flex-1 flex items-center gap-3 md:gap-6 min-w-0 h-full transition-all duration-500 ${isSearchExpanded ? 'hidden md:flex' : 'flex'}`}
            >
              {/* Mobile: Selected order with dropdown */}
              <div className="md:hidden relative shrink-0" ref={mobileDropdownRef}>
                <button
                  onClick={() => setIsMobileOrderListOpen(!isMobileOrderListOpen)}
                  className="flex items-center gap-2 h-12 px-5 bg-surface border border-subtle rounded-full transition-all active:scale-95 shadow-sm"
                >
                  <span className="text-content font-black text-lg tracking-tight truncate max-w-[120px]">
                    {selectedOrder ? `#${selectedOrder.order_number}` : 'Select'}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-muted transition-transform duration-300 ${isMobileOrderListOpen ? 'rotate-180' : ''}`}
                  />
                </button>
                {isMobileOrderListOpen && (
                  <div className="absolute top-16 left-0 w-[calc(100vw-2rem)] md:w-80 max-h-[70vh] overflow-y-auto bg-surface border border-subtle rounded-[2rem] shadow-2xl p-4 z-[110] animate-soft-in no-scrollbar">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted/30 px-4 mb-2">
                      Orders ({filteredOrders.length})
                    </p>
                    {filteredOrders.map((order) => (
                      <button
                        key={order.id}
                        onClick={() => {
                          setSelectedOrder(order);
                          setIsMobileOrderListOpen(false);
                        }}
                        className={`w-full text-left px-4 py-3 rounded-2xl text-sm font-black uppercase tracking-widest transition-all flex items-center justify-between ${
                          selectedOrder?.id === order.id
                            ? 'bg-accent text-white border border-accent/20'
                            : 'hover:bg-main text-muted'
                        }`}
                      >
                        <span className="truncate">
                          #{order.order_number}
                          {order.customer?.name && (
                            <span
                              className={`ml-1 font-bold normal-case tracking-normal ${selectedOrder?.id === order.id ? 'text-white/60' : 'text-muted/40'}`}
                            >
                              : {order.customer.name}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Desktop: Horizontal Scroll Window */}
              <div className="hidden md:flex flex-1 h-20 bg-main/40 border border-subtle rounded-[2.5rem] items-center px-4 overflow-hidden">
                <div className="flex flex-1 h-full items-center gap-4 overflow-x-auto no-scrollbar py-2 min-w-0">
                  {filteredOrders.map((order) => {
                    const isSelected = selectedOrder?.id === order.id;
                    return (
                      <div
                        key={order.id}
                        ref={(el) => {
                          if (isSelected && el) {
                            el.scrollIntoView({
                              behavior: 'smooth',
                              block: 'nearest',
                              inline: 'center',
                            });
                          }
                        }}
                        className="shrink-0"
                      >
                        <OrderChip
                          orderNumber={order.order_number || ''}
                          status={order.status}
                          isSelected={isSelected}
                          isCombined={!!order.combine_meta?.is_combined}
                          isFedex={
                            (order.order_group as { group_type?: string } | null)?.group_type ===
                            'fedex'
                          }
                          onClick={() => setSelectedOrder(order)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto no-scrollbar relative bg-bg-main p-2 md:p-12 pb-32">
          {selectedOrder ? (
            <div className="max-w-4xl mx-auto w-full">
              {/* Mobile View Toggle/Details (only visible on mobile) */}
              <div className="md:hidden mb-8">
                <OrderSidebar
                  formData={formData}
                  setFormData={setFormData}
                  selectedOrder={
                    selectedOrder as React.ComponentProps<typeof OrderSidebar>['selectedOrder']
                  }
                  selectedCustomerId={selectedCustomerId}
                  user={user}
                  takeOverOrder={takeOverOrder}
                  onRefresh={fetchOrders}
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
                  onReopenOrder={handleReopenOrder}
                  onContinueEditing={handleContinueEditing}
                  collapsible
                  autoBikeCount={autoBikeCount}
                  autoPartCount={autoPartCount}
                  totalUnits={totalUnits}
                  autoWeight={totalWeight}
                />
              </div>

              {/* Weight auto-fix: SKUs without weight get 45 lbs automatically (no banner needed) */}

              <LivePrintPreview
                orderNumber={selectedOrder.order_number ?? undefined}
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
                palletPhotos={selectedOrder.pallet_photos ?? undefined}
              />

              {/* Parts Weight Editor (idea-028) */}
              {partsWithWeights.length > 0 && (
                <div className="w-full max-w-md mx-auto mt-8 mb-8 bg-surface rounded-2xl border border-subtle overflow-hidden">
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
                                .upsert({ sku: part.sku, weight_lbs: val }, { onConflict: 'sku' });
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
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-text-muted space-y-4">
              <div className="w-16 h-16 rounded-full bg-surface border border-subtle flex items-center justify-center shadow-sm">
                <Search size={32} className="opacity-20" />
              </div>
              <p className="font-heading text-xl font-bold opacity-30">
                Select an order to preview
              </p>
            </div>
          )}
        </div>
      </main>

      {/* Island — centered on the preview area (right of the sidebar) */}
      <div className="hidden md:flex absolute bottom-10 left-0 md:left-80 2xl:left-[400px] right-0 justify-center z-[100] pointer-events-none">
        <div className="pointer-events-auto animate-soft-in">
          <FloatingActionButtons
            onPrint={handlePrint}
            onNext={handleNextOrder}
            onPrevious={handlePreviousOrder}
            isPrinting={isPrinting}
            hasOrders={!!selectedOrder}
            pressedKey={pressedKey}
          />
        </div>
      </div>

      {/* Global Actions — Floating at bottom right */}
      <div className="absolute bottom-10 right-6 md:right-10 flex flex-col gap-3 z-[110]">
        {/* Filter Dropdown */}
        <div className="relative" ref={filterRef}>
          {isFilterOpen && (
            <div className="absolute bottom-16 right-0 w-56 bg-surface border border-subtle rounded-[2rem] shadow-2xl p-3 z-[60] animate-soft-in">
              <p className="text-[10px] font-black uppercase tracking-widest text-muted/30 px-4 mb-2">
                Filter by Time
              </p>
              {['TODAY', 'YESTERDAY', 'WEEK', 'ALL'].map((filter) => (
                <button
                  key={filter}
                  onClick={() => {
                    setTimeFilter(filter);
                    setIsFilterOpen(false);
                  }}
                  className={`w-full text-left px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all ${timeFilter === filter ? 'bg-accent text-white' : 'hover:bg-main text-muted'}`}
                >
                  {filter}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setIsFilterOpen(!isFilterOpen)}
            className={`w-14 h-14 flex items-center justify-center rounded-full bg-surface border-2 transition-all duration-300 shadow-xl active:scale-95 ${isFilterOpen ? 'border-accent text-accent' : 'border-subtle text-muted hover:text-accent'}`}
            title="Filter Orders"
          >
            <Filter size={24} />
          </button>
        </div>

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

      {/* Add-On target picker (idea-067 Phase 2) */}
      {addOnPickerOpen && selectedOrder && (
        <AddOnTargetPickerModal
          sourceOrderId={selectedOrder.id}
          sourceCustomerId={selectedOrder.customer_id}
          sourceCustomerName={selectedOrder.customer?.name ?? null}
          onClose={() => setAddOnPickerOpen(false)}
          onPick={handleAddOnTargetPicked}
        />
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
    </div>
  );
};
