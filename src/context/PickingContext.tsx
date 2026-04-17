import React, {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode,
  useCallback,
  useMemo,
} from 'react';
import { useAuth } from './AuthContext';
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
  shippingType: string | null;
  isWaitingInventory: boolean;
  setIsWaitingInventory: (val: boolean) => void;
  checkedBy: string | null;
  ownerId: string | null;
  correctionNotes: string | null;
  notes: PickingNote[];
  isNotesLoading: boolean;
  addNote: (message: string) => Promise<void>;
  sessionMode: 'idle' | 'picking' | 'double_checking' | 'reopened';
  setSessionMode: (mode: 'idle' | 'picking' | 'double_checking' | 'reopened') => void;
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
  loadReopenedOrder: (id: string, reason?: string) => Promise<void>;
  resumeReopenedOrder: (id: string) => Promise<void>;

  generatePickingPath: () => Promise<void>;

  reopenOrder: (listId: string, reason?: string) => Promise<void>;
  recompleteOrder: (listId: string, palletsQty: number, totalUnits: number) => Promise<void>;
  cancelReopen: (listId: string) => Promise<void>;

  // returnToBuilding removed (idea-032) — Edit Order replaces it

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
  const [isWaitingInventory, setIsWaitingInventory] = useState(false);
  const [shippingType, setShippingType] = useState<string | null>(null);
  const [checkedBy, setCheckedBy] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [correctionNotes, setCorrectionNotes] = useState<string | null>(null);
  const [sessionMode, setSessionMode] = useState<
    'idle' | 'picking' | 'double_checking' | 'reopened'
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
        setIsWaitingInventory(false);
        setShippingType(null);
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
    setIsWaitingInventory,
    setShippingType,
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
    reopenOrder,
    recompleteOrder,
    cancelReopen,
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

  const loadReopenedOrder = useCallback(
    async (listId: string, reason?: string) => {
      isInWorkflowRef.current = true;
      try {
        await reopenOrder(listId, reason);
        await loadExternalList(listId);
        // Override the 'double_checking' that loadExternalList hardcodes
        setSessionMode('reopened');
      } catch (err) {
        console.error('Failed to load reopened order:', err);
      } finally {
        isInWorkflowRef.current = false;
      }
    },
    [reopenOrder, loadExternalList, setSessionMode, isInWorkflowRef]
  );

  const resumeReopenedOrder = useCallback(
    async (listId: string) => {
      isInWorkflowRef.current = true;
      try {
        await loadExternalList(listId);
        setSessionMode('reopened');
      } catch (err) {
        console.error('Failed to resume reopened order:', err);
      } finally {
        isInWorkflowRef.current = false;
      }
    },
    [loadExternalList, setSessionMode, isInWorkflowRef]
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

  const onStartSession = useCallback(() => {
    if (sessionMode === 'idle') startManualSession();
  }, [sessionMode, startManualSession]);

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
      shippingType,
      isWaitingInventory,
      setIsWaitingInventory,
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
      loadReopenedOrder,
      resumeReopenedOrder,
      generatePickingPath,
      reopenOrder,
      recompleteOrder,
      cancelReopen,
      takeOverOrder,
      claimAsPicker,
      isLoaded,
      isSaving,
      lastSaved,
      resetSession,
      onStartSession,
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
      shippingType,
      isWaitingInventory,
      setIsWaitingInventory,
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
      loadReopenedOrder,
      resumeReopenedOrder,
      generatePickingPath,
      reopenOrder,
      recompleteOrder,
      cancelReopen,
      isLoaded,
      isSaving,
      lastSaved,
      resetSession,
      updateCustomerDetails,
      startNewSession,
      isInitializing,
      setIsInitializing,
      pendingItem,
      onStartSession,
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
