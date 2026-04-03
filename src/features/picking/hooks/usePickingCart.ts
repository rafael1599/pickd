import { useState, useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import type { InventoryItem, InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import type { Customer } from '../../../types/schema';

export interface CartItem extends InventoryItemWithMetadata {
  pickingQty: number;
  source_order?: string;
}

const LOCAL_STORAGE_KEY = 'picking_cart_items';
const LOCAL_STORAGE_ORDER_KEY = 'picking_order_number';
const LOCAL_STORAGE_CUSTOMER_KEY = 'picking_customer_obj';
const LOCAL_STORAGE_LOAD_KEY = 'picking_load_number';

interface UsePickingCartProps {
  sessionMode: 'idle' | 'picking' | 'double_checking' | 'reopened';
  reservedQuantities: Record<string, number>;
}

export const usePickingCart = ({ sessionMode, reservedQuantities }: UsePickingCartProps) => {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loadNumber, setLoadNumber] = useState<string | null>(null);

  // Initial load from local storage only for picking mode demos or fallbacks
  // The main sync hook will handle loading from DB
  const loadFromLocalStorage = useCallback(() => {
    try {
      const localData = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (localData) {
        const parsed = JSON.parse(localData);
        if (Array.isArray(parsed)) setCartItems(parsed);
      }
      const localOrder = localStorage.getItem(LOCAL_STORAGE_ORDER_KEY);
      if (localOrder) setOrderNumber(localOrder);

      const localCustomer = localStorage.getItem(LOCAL_STORAGE_CUSTOMER_KEY);
      if (localCustomer) setCustomer(JSON.parse(localCustomer));

      const localLoad = localStorage.getItem(LOCAL_STORAGE_LOAD_KEY);
      if (localLoad) setLoadNumber(localLoad);
    } catch (e) {
      console.warn('Failed to parse local cart', e);
    }
  }, []);

  // Persist to local storage (for offline resilience in picking mode)
  useEffect(() => {
    if (sessionMode === 'picking') {
      if (cartItems.length > 0) {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cartItems));
      } else {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
      }

      if (orderNumber) {
        localStorage.setItem(LOCAL_STORAGE_ORDER_KEY, orderNumber);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_ORDER_KEY);
      }

      if (customer) {
        localStorage.setItem(LOCAL_STORAGE_CUSTOMER_KEY, JSON.stringify(customer));
      } else {
        localStorage.removeItem(LOCAL_STORAGE_CUSTOMER_KEY);
      }

      if (loadNumber) {
        localStorage.setItem(LOCAL_STORAGE_LOAD_KEY, loadNumber);
      } else {
        localStorage.removeItem(LOCAL_STORAGE_LOAD_KEY);
      }
    }
  }, [cartItems, orderNumber, customer, loadNumber, sessionMode]);

  const isSameItem = useCallback((a: Partial<InventoryItem>, b: Partial<InventoryItem>) => {
    if (a.id && b.id) return a.id === b.id;
    return a.sku === b.sku && a.location === b.location && a.warehouse === b.warehouse;
  }, []);

  const addToCart = useCallback(
    (item: InventoryItem) => {
      if (sessionMode !== 'picking' && sessionMode !== 'idle') return;

      const key = `${item.sku}|${item.warehouse}|${item.location}`;
      const totalReserved = reservedQuantities[key] || 0;
      const currentInMyCart = cartItems.find((i) => isSameItem(i, item))?.pickingQty || 0;
      const stock = item.quantity || 0;
      const reservedByOthers = Math.max(0, totalReserved - currentInMyCart);
      const available = stock - reservedByOthers;

      if (stock <= 0) {
        toast.error(`This item is out of stock. 🚫`);
        return;
      }

      if (available <= 0) {
        toast.error(`This item is fully reserved by other active orders. 🚫`);
        return;
      }

      if (currentInMyCart + 1 > available) {
        toast.error(`Only ${available} available (others reserved).`);
        return;
      }

      setCartItems((prev) => {
        const existingIndex = prev.findIndex((i) => isSameItem(i, item));
        if (existingIndex >= 0) {
          const newCart = [...prev];
          newCart[existingIndex] = {
            ...newCart[existingIndex],
            pickingQty: (newCart[existingIndex].pickingQty || 0) + 1,
          };
          return newCart;
        } else {
          return [...prev, { ...item, pickingQty: 1 }];
        }
      });
    },
    [cartItems, reservedQuantities, isSameItem, sessionMode]
  );

  // Helper to get available stock for an item (exported for UI usage)
  const getAvailableStock = useCallback(
    (item: Partial<InventoryItem>) => {
      const key = `${item.sku}|${item.warehouse}|${item.location}`;
      const totalReserved = reservedQuantities[key] || 0;
      const currentInMyCart = cartItems.find((i) => isSameItem(i, item))?.pickingQty || 0;
      const reservedByOthers = Math.max(0, totalReserved - currentInMyCart);
      const stock = item.quantity || 0;
      const available = stock - reservedByOthers;

      return {
        available,
        reservedByOthers,
        totalStock: stock,
        inMyCart: currentInMyCart,
      };
    },
    [cartItems, reservedQuantities, isSameItem]
  );

  const updateCartQty = useCallback(
    (item: InventoryItem, change: number) => {
      if (sessionMode !== 'picking') return;

      const key = `${item.sku}|${item.warehouse}|${item.location}`;
      const totalReserved = reservedQuantities[key] || 0;
      const currentInMyCart = cartItems.find((i) => isSameItem(i, item))?.pickingQty || 0;

      const stock = item.quantity || 0;
      const reservedByOthers = Math.max(0, totalReserved - currentInMyCart);
      const available = stock - reservedByOthers;

      setCartItems((prev) =>
        prev.map((i) => {
          if (isSameItem(i, item)) {
            const currentQty = i.pickingQty || 0;
            const newQty = Math.max(1, Math.min(currentQty + change, available));

            if (currentQty + change > available) {
              toast.error(`Cannot exceed ${available} available units.`);
            }

            return { ...i, pickingQty: newQty };
          }
          return i;
        })
      );
    },
    [cartItems, reservedQuantities, isSameItem, sessionMode]
  );

  const setCartQty = useCallback(
    (item: InventoryItem, newAbsoluteQty: number) => {
      if (sessionMode !== 'picking') return;

      const key = `${item.sku}|${item.warehouse}|${item.location}`;
      const totalReserved = reservedQuantities[key] || 0;
      const currentInMyCart = cartItems.find((i) => isSameItem(i, item))?.pickingQty || 0;

      const stock = item.quantity || 0;
      const reservedByOthers = Math.max(0, totalReserved - currentInMyCart);
      const available = stock - reservedByOthers;

      setCartItems((prev) =>
        prev.map((i) => {
          if (isSameItem(i, item)) {
            const newQty = Math.max(1, Math.min(newAbsoluteQty, available));
            if (newAbsoluteQty > available) {
              toast.error(`Cannot exceed ${available} available units.`);
            }
            return { ...i, pickingQty: newQty };
          }
          return i;
        })
      );
    },
    [cartItems, reservedQuantities, isSameItem, sessionMode]
  );

  const removeFromCart = useCallback(
    (item: Partial<InventoryItem>) => {
      if (sessionMode !== 'picking') return;
      setCartItems((prev) => prev.filter((i) => !isSameItem(i, item)));
    },
    [isSameItem, sessionMode]
  );

  const clearCart = useCallback(() => {
    setCartItems([]);
    setOrderNumber(null);
    setCustomer(null);
    setLoadNumber(null);
    localStorage.removeItem(LOCAL_STORAGE_LOAD_KEY);
    localStorage.removeItem('picking_session_mode');
    localStorage.setItem('picking_session_mode', 'idle');
  }, []);

  return {
    cartItems,
    setCartItems,
    orderNumber,
    setOrderNumber,
    customer,
    setCustomer,
    loadNumber,
    setLoadNumber,
    addToCart,
    updateCartQty,
    setCartQty,
    removeFromCart,
    clearCart,
    loadFromLocalStorage,
    getAvailableStock,
  };
};
