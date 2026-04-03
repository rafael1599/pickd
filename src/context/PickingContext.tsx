import React, {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode,
  useCallback,
  useMemo,
} from 'react';
import toast from 'react-hot-toast';
import { useAuth } from './AuthContext';
import { supabase } from '../lib/supabase';
import { useInventory } from '../features/inventory/hooks/useInventoryData';
import { useError } from './ErrorContext';
import { usePickingCart, CartItem } from '../features/picking/hooks/usePickingCart';
import { usePickingSync } from '../features/picking/hooks/usePickingSync';
import { usePickingActions } from '../features/picking/hooks/usePickingActions';
import { usePickingNotes, PickingNote } from '../features/picking/hooks/usePickingNotes';
import type { Customer } from '../types/schema';
import type { InventoryItem } from '../schemas/inventory.schema';
import { useLocationManagement } from '../features/inventory/hooks/useLocationManagement';
import { getOptimizedPickingPath, calculatePallets, type Pallet } from '../utils/pickingLogic';

interface PickingContextType {
  cartItems: CartItem[];
  setCartItems: React.Dispatch<React.SetStateAction<CartItem[]>>;
  activeListId: string | null;
  setActiveListId: (id: string | null) => void;
  orderNumber: string | null;
  setOrderNumber: (num: string | null) => void;
  customer: Customer | null;
  setCustomer: (cust: Customer | null) => void;
  loadNumber: string | null;
  setLoadNumber: (num: string | null) => void;
  listStatus: string;
  checkedBy: string | null;
  ownerId: string | null;
  correctionNotes: string | null;
  notes: PickingNote[];
  isNotesLoading: boolean;
  addNote: (message: string) => Promise<void>;
  sessionMode: 'idle' | 'building' | 'picking' | 'double_checking';
  setSessionMode: (mode: 'idle' | 'building' | 'picking' | 'double_checking') => void;
  pallets: Pallet[];

  onStartSession: () => void;

  addToCart: (item: InventoryItem) => void;
  updateCartQty: (item: InventoryItem, change: number) => void;
  setCartQty: (item: InventoryItem, qty: number) => void;
  removeFromCart: (item: Partial<InventoryItem>) => void;
  clearCart: () => void;
  getAvailableStock: (item: Partial<InventoryItem>) => {
    available: number;
    reservedByOthers: number;
    totalStock: number;
    inMyCart: number;
  };

  completeList: (
    metrics?: { pallets_qty: number; total_units: number },
    id?: string
  ) => Promise<void>;
  markAsReady: (items?: CartItem[], orderNum?: string) => Promise<string | null>;
  lockForCheck: (id: string) => Promise<void>;
  releaseCheck: (id: string) => Promise<void>;
  returnToPicker: (id: string, notes: string) => Promise<void>;
  revertToPicking: () => Promise<void>;
  deleteList: (id: string | null, keepLocalState?: boolean) => Promise<void>;
  takeOverOrder: (id: string) => Promise<void>;
  claimAsPicker: (listId?: string) => Promise<void>;

  loadExternalList: (id: string) => Promise<unknown>;

  generatePickingPath: () => Promise<void>;

  returnToBuilding: (id?: string | null) => Promise<void>;

  isLoaded: boolean;
  isSaving: boolean;
  lastSaved: Date | null;
  resetSession: () => void;

  isInitializing: boolean;
  setIsInitializing: (val: boolean) => void;
  pendingItem: InventoryItem | null;
  startManualSession: () => void;
  cancelInitialization: () => void;
  startNewSession: (
    strategy: 'auto' | 'manual' | 'resume',
    manualOrderNumber?: string,
    customerData?: Customer | string
  ) => Promise<void>;
  updateCustomerDetails: (customerId: string, details: Partial<Customer>) => Promise<void>;
}

const PickingContext = createContext<PickingContextType | undefined>(undefined);

export const PickingProvider = ({ children }: { children: ReactNode }) => {
  // 1. External dependencies
  const { user } = useAuth();
  const { reservedQuantities } = useInventory();
  const { showError } = useError();
  const { locations } = useLocationManagement();

  // 2. Shared/Lifted State
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<string>('active');
  const [checkedBy, setCheckedBy] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [correctionNotes, setCorrectionNotes] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<
    'idle' | 'building' | 'picking' | 'double_checking'
  >('idle');

  // Workflow Lock: prevents loadSession from overwriting activeListId during a workflow
  const isInWorkflowRef = useRef(false);

  // Initialization State
  const [isInitializing, setIsInitializing] = useState(false);
  const [pendingItem, setPendingItem] = useState<InventoryItem | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // 3. Hook Integration
  const {
    cartItems,
    setCartItems,
    orderNumber,
    setOrderNumber,
    customer,
    setCustomer,
    loadNumber,
    setLoadNumber,
    addToCart: addToCartInternal,
    updateCartQty,
    setCartQty,
    removeFromCart,
    clearCart,
    loadFromLocalStorage,
    getAvailableStock,
  } = usePickingCart({
    sessionMode,
    reservedQuantities,
  });

  // 4. Automated Pallet Calculation
  // This calculates pallets once the session moves into picking/double_checking mode
  // fulfilling the requirement of grouping "when receiving from DB"
  const pallets = useMemo(() => {
    if (sessionMode === 'idle' || cartItems.length === 0) return [];
    const optimizedItems = getOptimizedPickingPath(cartItems, locations);
    return calculatePallets(optimizedItems);
  }, [cartItems, locations, sessionMode]);

  const resetSession = useCallback(
    (skipState = false) => {
      // Atomic Reset
      if (!skipState) {
        clearCart();
        setActiveListId(null);
        setListStatus('active');
        setCheckedBy(null);
        setOwnerId(null);
        setCorrectionNotes(null);
        setSessionMode('idle');
        setOrderNumber(null);
        setCustomer(null);
        setLoadNumber(null);
        setIsInitializing(false);
      }

      // Comprehensive localStorage cleanup
      const keysToRemove = [
        'picking_cart_items',
        'picking_order_number',
        'picking_customer_obj',
        'picking_load_number',
        'active_picking_list_id',
        'picking_session_mode',
      ];

      keysToRemove.forEach((k) => localStorage.removeItem(k));

      // Also clean up double check progress if any
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('double_check_progress_')) {
          localStorage.removeItem(key);
        }
      });

      console.log('🧹 [Atomic Reset] Session cleared');
    },
    [
      clearCart,
      setOrderNumber,
      setCustomer,
      setLoadNumber,
      setActiveListId,
      setListStatus,
      setCheckedBy,
      setOwnerId,
      setCorrectionNotes,
      setSessionMode,
      setIsInitializing,
    ]
  );

  const { loadExternalList } = usePickingSync({
    user,
    sessionMode,
    cartItems,
    orderNumber,
    activeListId,
    customer,
    setCustomer,
    loadNumber,
    setLoadNumber,
    listStatus,
    correctionNotes,
    checkedBy,
    setCartItems,
    setActiveListId,
    setOrderNumber,
    setListStatus,
    setCheckedBy,
    ownerId,
    setOwnerId,
    setCorrectionNotes,
    setSessionMode,
    loadFromLocalStorage,
    showError,
    resetSession,
    setIsSaving,
    setIsLoaded,
    setLastSaved,
    isSaving,
    isLoaded,
    lastSaved,
    isInWorkflowRef,
  });

  const {
    completeList,
    markAsReady,
    lockForCheck,
    releaseCheck,
    returnToPicker,
    revertToPicking,
    deleteList,
    generatePickingPath,
    updateCustomerDetails,
    takeOverOrder,
    claimAsPicker,
  } = usePickingActions({
    user,
    activeListId,
    cartItems,
    orderNumber,
    customer,
    sessionMode,
    setCartItems,
    setActiveListId,
    setOrderNumber,
    setCustomer,
    setListStatus,
    setCheckedBy,
    setOwnerId,
    setCorrectionNotes,
    setSessionMode,
    setIsSaving,
    resetSession,
    ownerId,
    loadNumber,
    setLoadNumber,
    isInWorkflowRef,
  });

  const { notes, isLoading: isNotesLoading, addNote: addNoteRaw } = usePickingNotes(activeListId);

  const addNote = useCallback(
    async (message: string) => {
      if (!user) return;
      await addNoteRaw(user.id, message);
    },
    [user, addNoteRaw]
  );

  // Return to Building: Revert from Picking mode back to Building mode
  const returnToBuilding = useCallback(
    async (id?: string | null) => {
      const targetId = id || activeListId;

      if (!targetId) {
        // If we really have no ID but we have items in cart, we might already be in building mode
        // or in a transition state. Let's force mode to building.
        setSessionMode('building');
        localStorage.setItem('picking_session_mode', 'building');
        return;
      }

      isInWorkflowRef.current = true;
      try {
        // If we are in verification/picking, maybe we don't want to DELETE,
        // just go back to building while keeping the DB record as 'active' or 'needs_correction'
        // To keep it simple and safe: Let's only delete if it's strictly necessary.
        // If the user wants to EDIT, we should keep the list ID but change status.

        const { data: current } = await supabase
          .from('picking_lists')
          .select('status, group_id')
          .eq('id', targetId)
          .maybeSingle();

        if (current?.status === 'ready_to_double_check' || current?.status === 'double_checking') {
          // Just move it back to 'active' (picking) so it doesn't disappear from the DB
          await supabase
            .from('picking_lists')
            .update({ status: 'active', checked_by: null })
            .eq('id', targetId);

          // Release group siblings back to queue (matches releaseCheck pattern)
          if (current.group_id) {
            await supabase
              .from('picking_lists')
              .update({ status: 'ready_to_double_check', checked_by: null })
              .eq('group_id', current.group_id)
              .neq('id', targetId)
              .neq('status', 'completed')
              .neq('status', 'cancelled');
          }

          // Keep activeListId so generatePickingPath() can UPDATE instead of INSERT (bug-004 fix)
          setListStatus('active');
          setSessionMode('building');
          localStorage.setItem('picking_session_mode', 'building');
          localStorage.setItem('active_picking_list_id', targetId);

          toast('Returned to building mode. You can correct items and re-generate.', {
            icon: '↩️',
            duration: 3000,
          });
        } else if (current?.status === 'completed') {
          // Already finished, don't touch DB
          console.log('⚠️ [returnToBuilding] List is already completed. Skipping DB update.');
          setSessionMode('building');
          setActiveListId(null);
          localStorage.setItem('picking_session_mode', 'building');
          localStorage.removeItem('active_picking_list_id');
        } else {
          // For other states (like initial picking), delete to release reservations
          await deleteList(targetId, true);
          setSessionMode('building');
          setActiveListId(null);
          localStorage.setItem('picking_session_mode', 'building');
          localStorage.removeItem('active_picking_list_id');

          toast('Returned to building mode. Stock reservations released.', {
            icon: '↩️',
            duration: 3000,
          });
        }
      } catch (err) {
        console.error('Failed to return to building:', err);
        toast.error('Failed to return to building mode');
      } finally {
        isInWorkflowRef.current = false;
      }
    },
    [activeListId, deleteList, setSessionMode, setActiveListId]
  );

  const addToCart = useCallback(
    (item: InventoryItem) => {
      // If idle and no order number, store item and show modal
      if (sessionMode === 'idle' && !orderNumber) {
        setPendingItem(item);
        setIsInitializing(true);
        return;
      }

      // Transition to picking mode if idle (with order number)
      if (sessionMode === 'idle') {
        setSessionMode('picking');
        localStorage.setItem('picking_session_mode', 'picking');
      }

      addToCartInternal(item);
    },
    [sessionMode, orderNumber, setSessionMode, addToCartInternal]
  );

  const startNewSession = useCallback(
    async (
      strategy: 'auto' | 'manual' | 'resume',
      manualOrderNumber?: string,
      customerData?: Customer | string
    ) => {
      // Capture pending item before reset
      const itemToAdd = pendingItem;

      // Clear initialization state
      setIsInitializing(false);
      setPendingItem(null);

      // Clean slate for new session
      resetSession(true);

      let newOrderNumber = manualOrderNumber;

      if (strategy === 'auto') {
        const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 1000)
          .toString()
          .padStart(3, '0');
        newOrderNumber = `ORD-${dateStr}-${random}`;
      }

      if (newOrderNumber) {
        setOrderNumber(newOrderNumber);
        localStorage.setItem('picking_order_number', newOrderNumber);
      }

      if (customerData) {
        if (typeof customerData === 'string') {
          // Temporary customer object for quick sessions
          const quickCustomer = { name: customerData } as Customer;
          setCustomer(quickCustomer);
          localStorage.setItem('picking_customer_obj', JSON.stringify(quickCustomer));
        } else {
          setCustomer(customerData);
          localStorage.setItem('picking_customer_obj', JSON.stringify(customerData));
        }
      }

      // Start in Picking Mode (direct to active, no building step)
      setSessionMode('picking');
      localStorage.setItem('picking_session_mode', 'picking');

      // Now add the pending item to cart
      if (itemToAdd) {
        addToCartInternal(itemToAdd);
      }
    },
    [pendingItem, addToCartInternal, resetSession, setOrderNumber, setCustomer, setSessionMode]
  );

  const startManualSession = useCallback(() => {
    setIsInitializing(true);
  }, []);

  const cancelInitialization = useCallback(() => {
    setIsInitializing(false);
    setPendingItem(null);
  }, []);

  const value: PickingContextType = useMemo(
    () => ({
      cartItems,
      setCartItems,
      activeListId,
      setActiveListId,
      orderNumber,
      setOrderNumber,
      customer,
      setCustomer,
      loadNumber,
      setLoadNumber,
      listStatus,
      checkedBy,
      ownerId,
      correctionNotes,
      notes,
      isNotesLoading,
      addNote,
      sessionMode,
      setSessionMode,
      pallets,
      addToCart,
      updateCartQty,
      setCartQty,
      removeFromCart,
      clearCart,
      getAvailableStock,
      completeList,
      markAsReady,
      lockForCheck,
      releaseCheck,
      returnToPicker,
      revertToPicking,
      deleteList,
      loadExternalList,
      generatePickingPath,
      takeOverOrder,
      claimAsPicker,
      returnToBuilding,
      isLoaded,
      isSaving,
      lastSaved,
      resetSession,
      onStartSession: () => {
        if (sessionMode === 'idle') startManualSession();
      },
      updateCustomerDetails,
      // removed duplicate updateCustomerDetails
      startNewSession,
      isInitializing,
      setIsInitializing,
      pendingItem,
      startManualSession,
      cancelInitialization,
    }),
    [
      cartItems,
      setCartItems,
      activeListId,
      setActiveListId,
      orderNumber,
      setOrderNumber,
      customer,
      setCustomer,
      loadNumber,
      setLoadNumber,
      listStatus,
      checkedBy,
      ownerId,
      correctionNotes,
      notes,
      isNotesLoading,
      addNote,
      sessionMode,
      setSessionMode,
      pallets,
      addToCart,
      updateCartQty,
      setCartQty,
      removeFromCart,
      clearCart,
      getAvailableStock,
      completeList,
      markAsReady,
      lockForCheck,
      releaseCheck,
      returnToPicker,
      revertToPicking,
      takeOverOrder,
      claimAsPicker,
      deleteList,
      loadExternalList,
      generatePickingPath,
      returnToBuilding,
      isLoaded,
      isSaving,
      lastSaved,
      resetSession,
      updateCustomerDetails,
      startNewSession,
      isInitializing,
      setIsInitializing,
      pendingItem,
      startManualSession,
      cancelInitialization,
    ]
  );

  return <PickingContext.Provider value={value}>{children}</PickingContext.Provider>;
};

export const usePickingSession = () => {
  const context = useContext(PickingContext);
  if (!context) {
    throw new Error('usePickingSession must be used within a PickingProvider');
  }
  return context;
};
