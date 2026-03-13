import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import type { CartItem } from './usePickingCart';
import type { Customer } from '../../../types/schema';
import { getOptimizedPickingPath, calculatePallets } from '../../../utils/pickingLogic';

interface UsePickingActionsProps {
  user: any;
  activeListId: string | null;
  cartItems: CartItem[];
  orderNumber: string | null;
  customer: Customer | null;
  sessionMode: 'building' | 'picking' | 'double_checking' | 'idle';
  setCartItems: (items: any[]) => void;
  setActiveListId: (id: string | null) => void;
  setOrderNumber: (num: string | null) => void;
  setCustomer: (cust: Customer | null) => void;
  setListStatus: (status: string) => void;
  setCheckedBy: (id: string | null) => void;
  setOwnerId: (id: string | null) => void;
  ownerId: string | null;
  loadNumber: string | null;
  setLoadNumber: (num: string | null) => void;
  setCorrectionNotes: (notes: string | null) => void;
  setSessionMode: (mode: 'building' | 'picking' | 'double_checking') => void;
  setIsSaving: (val: boolean) => void;
  resetSession: (skipState?: boolean) => void;
}

export const usePickingActions = ({
  user,
  activeListId,
  cartItems,
  orderNumber,
  customer,
  setCartItems,
  setActiveListId,
  setOrderNumber,
  setCustomer,
  setListStatus,
  setCheckedBy,
  setOwnerId,
  ownerId,
  setCorrectionNotes,
  setSessionMode,
  setIsSaving,
  resetSession,
  loadNumber,
}: UsePickingActionsProps) => {
  const completeList = useCallback(
    async (metrics?: { pallets_qty: number; total_units: number }, listIdOverride?: string) => {
      const targetId = listIdOverride || activeListId;

      if (!targetId || !user) return;
      setIsSaving(true);
      try {
        const updateData: any = {
          status: 'completed',
          checked_by: user.id, // Record who verified it
        };

        if (metrics) {
          updateData.pallets_qty = metrics.pallets_qty;
          updateData.total_units = metrics.total_units;
        }

        const { error } = await supabase
          .from('picking_lists')
          .update(updateData)
          .eq('id', targetId);

        if (error) throw error;
      } catch (err) {
        console.error('Failed to complete list:', err);
        toast.error('Failed to complete order properly');
        throw err;
      } finally {
        setIsSaving(false);
      }
    },
    [activeListId, user, resetSession, setIsSaving]
  );

  const markAsReady = useCallback(
    async (items?: CartItem[], orderNum?: string) => {
      if (!activeListId || !user) return null;

      const finalItems = items || cartItems;
      const finalOrderNum = orderNum || orderNumber;

      if (finalItems.length === 0) {
        toast.error('Cannot mark an empty order as ready.');
        return null;
      }

      setIsSaving(true);
      try {
        // Enforcement: Release any other list this user might be checking
        const { error: releaseError } = await supabase
          .from('picking_lists')
          .update({
            status: 'ready_to_double_check',
            checked_by: null,
          } as any)
          .eq('checked_by', user.id)
          .neq('status', 'completed')
          .neq('status', 'cancelled')
          .neq('id', activeListId); // Don't release the one we are about to lock

        if (releaseError) console.error('Error releasing previous locks:', releaseError);

        // 1. Validation Logic: Check for concurrency conflicts
        // We must ensure that (Stock - ReservedByOthers) >= MyQty
        const skuList = finalItems.map((i) => i.sku);

        // A. Fetch current stock
        const { data: currentStock, error: stockError } = await supabase
          .from('inventory')
          .select('sku, quantity, warehouse, location')
          .in('sku', skuList);

        if (stockError) throw stockError;

        // NEW: Fetch locations picking order for optimization
        const locationsToFetch = Array.from(new Set(finalItems.map(i => i.location).filter((loc): loc is string => !!loc)));
        const { data: locationsData, error: locsError } = await supabase
          .from('locations')
          .select('warehouse, location, picking_order')
          .in('location', locationsToFetch);

        if (locsError) console.error('Error fetching picking orders:', locsError);

        // B. Fetch ALL active allocations for these SKUs (excluding self)
        const { data: activeLists, error: listsError } = await supabase
          .from('picking_lists')
          .select('id, items, order_number')
          .in('status', ['active', 'needs_correction', 'ready_to_double_check', 'double_checking'])
          .neq('id', activeListId);

        if (listsError) throw listsError;

        // C. Calculate availability
        const stockMap = new Map<string, { stock: number; reserved: number }>();

        // Fill stock
        currentStock?.forEach((row: any) => {
          const key = `${row.sku}-${row.warehouse}-${(row.location || '').toUpperCase()}`;
          stockMap.set(key, { stock: Number(row.quantity || 0), reserved: 0, reservingOrders: new Set() } as any);
        });

        // Fill reservations
        activeLists?.forEach((list: any) => {
          const listItems = list.items || [];
          if (Array.isArray(listItems)) {
            listItems.forEach((li: any) => {
              const key = `${li.sku}-${li.warehouse}-${(li.location || '').toUpperCase()}`;
              if (stockMap.has(key)) {
                const entry = stockMap.get(key) as any;
                entry.reserved += li.pickingQty || 0;
                if (list.order_number) entry.reservingOrders.add(list.order_number);
              }
            });
          }
        });

        // D. Validate my cart
        for (const myItem of finalItems) {
          const key = `${myItem.sku}-${myItem.warehouse}-${(myItem.location || '').toUpperCase()}`;
          const entry = stockMap.get(key);

          // If item not found in stock (deleted?), fail
          if (!entry) {
            toast.error(`Item ${myItem.sku} no longer exists in inventory.`);
            return null;
          }

          const availableForMe = entry.stock - entry.reserved;
          const myQty = myItem.pickingQty || 0;

          if (myQty > availableForMe) {
            const orders = Array.from((entry as any).reservingOrders).join(', ');
            const reservedInfo = orders ? `is reserved in ${orders}.` : 'is reserved.';
            const availabilityInfo = availableForMe > 0 ? `There is only ${availableForMe} available.` : 'There are no more items available.';

            toast.error(
              `${myItem.sku} ${reservedInfo} ${availabilityInfo} (You need ${myQty}).`,
              { duration: 6000 }
            );
            return null; // Abort
          }
        }
        // --- End Validation ---

        // Calculate Pallets using the same logic as UI
        const optimizedItems = getOptimizedPickingPath(finalItems, (locationsData as any) || []);
        const pallets = calculatePallets(optimizedItems);
        const palletsQty = pallets.length;

        // Transition to double_checking immediately
        const { error } = await supabase
          .from('picking_lists')
          .update({
            status: 'double_checking',
            checked_by: user.id, // Auto-assign to self for verification
            items: finalItems as any,
            order_number: finalOrderNum,
            customer_id: customer?.id,
            load_number: loadNumber,
            correction_notes: null,
            pallets_qty: palletsQty, // AUTOMATION: Save the calculated pallets count
          } as any)
          .eq('id', activeListId);

        if (error) throw error;

        const listId = activeListId;
        setCartItems(finalItems);
        setOrderNumber(finalOrderNum); // Ensure local state matches
        setCorrectionNotes(null);
        setListStatus('double_checking');
        setCheckedBy(user.id);
        setSessionMode('double_checking');
        toast.success('Order ready! You can now verify it.');
        return listId;
      } catch (err: any) {
        console.error('Failed to mark as ready:', err);
        toast.error('Failed to mark order ready');
        return null;
      } finally {
        setIsSaving(false);
      }
    },
    [activeListId, user, cartItems, orderNumber, setCartItems, setOrderNumber, setCorrectionNotes, setListStatus, setCheckedBy, setSessionMode, setIsSaving]
  );

  const lockForCheck = useCallback(
    async (listId: string) => {
      if (!user) return;
      const { error: releaseError } = await supabase
        .from('picking_lists')
        .update({
          status: 'ready_to_double_check',
          checked_by: null,
        } as any)
        .eq('checked_by', user.id)
        .neq('status', 'completed')
        .neq('status', 'cancelled')
        .neq('id', listId);

      if (releaseError) console.error('Error releasing previous locks:', releaseError);

      const { error } = await supabase
        .from('picking_lists')
        .update({
          status: 'double_checking',
          checked_by: user.id,
        } as any)
        .eq('id', listId)
        .neq('status', 'completed');
      if (error) throw error;
    },
    [user]
  );

  const releaseCheck = useCallback(
    async (listId: string) => {
      const { error } = await supabase
        .from('picking_lists')
        .update({
          status: 'ready_to_double_check',
          checked_by: null,
        } as any)
        .eq('id', listId)
        .neq('status', 'completed');
      if (error) throw error;

      resetSession();
    },
    [resetSession]
  );

  const returnToPicker = useCallback(
    async (listId: string, notes: string) => {
      if (!user) {
        console.error('No user found for returnToPicker');
        return;
      }

      try {
        // 1. Update list status (deprecating legacy notes column)
        const { error: listError } = await supabase
          .from('picking_lists')
          .update({
            status: 'needs_correction',
            checked_by: null,
          } as any)
          .eq('id', listId)
          .neq('status', 'completed');

        if (listError) throw listError;

        // 2. Add to historical notes timeline
        const { error: noteError } = await supabase.from('picking_list_notes' as any).insert({
          list_id: listId,
          user_id: user.id,
          message: notes,
        });

        if (noteError) {
          console.error('Failed to log historical note:', noteError);
        }

        // Clear local state
        resetSession();
        toast.success('Sent back to picker.');
      } catch (err) {
        console.error('Failed to return to picker:', err);
        toast.error('Failed to update order status');
      }
    },
    [user, resetSession]
  );

  const revertToPicking = useCallback(async () => {
    if (!activeListId || !user) return;
    setIsSaving(true);
    try {
      const { error } = await supabase
        .from('picking_lists')
        .update({
          status: 'active',
          checked_by: null,
        } as any)
        .eq('id', activeListId);

      if (error) throw error;

      setListStatus('active');
      setCheckedBy(null);
      setSessionMode('picking');
      toast.success('Returned to picking mode.');
    } catch (err) {
      console.error('Failed to revert to picking:', err);
    } finally {
      setIsSaving(false);
    }
  }, [activeListId, user, setListStatus, setCheckedBy, setSessionMode, setIsSaving]);

  const deleteList = useCallback(
    async (listId: string | null, keepLocalState = false) => {
      if (!listId) {
        if (!keepLocalState) resetSession();
        toast.success('Local session reset');
        return;
      }

      try {
        const { data: currentList } = await supabase
          .from('picking_lists')
          .select('status')
          .eq('id', listId)
          .maybeSingle();

        if (currentList?.status === 'completed') {
          console.log('🛡️ Blocked deletion of a completed order to protect inventory history.');
          if (listId === activeListId && !keepLocalState) {
            resetSession();
          }
          return;
        }

        // If the order is already in picking/verification, we should probably CANCEL it
        // instead of physically deleting it, to keep a record.
        const inProgressStatuses = ['active', 'ready_to_double_check', 'double_checking', 'needs_correction'];
        if (currentList?.status && inProgressStatuses.includes(currentList.status)) {
          // Instead of hard delete, we mark as cancelled
          const { error: cancelError } = await supabase
            .from('picking_lists')
            .update({
              status: 'cancelled',
              notes: (currentList as any).notes ? (currentList as any).notes + ' [User Cancelled]' : 'User Cancelled'
            } as any)
            .eq('id', listId);

          if (cancelError) throw cancelError;

          if (listId === activeListId && !keepLocalState) {
            resetSession();
          }
          toast.success('Order cancelled and moved to history');
          return;
        }

        const { error: logsError } = await supabase
          .from('inventory_logs')
          .delete()
          .eq('list_id', listId);

        if (logsError) {
          console.error('Failed to delete related inventory logs:', logsError);
          throw logsError;
        }

        const { error } = await supabase.from('picking_lists').delete().eq('id', listId);

        if (error) throw error;

        if (listId === activeListId && !keepLocalState) {
          resetSession();
        }
        if (!keepLocalState) {
          toast.success('Order deleted successfully');
        }
      } catch (err) {
        console.error('Failed to delete list:', err);
        toast.error('Failed to delete order');
        throw err;
      }
    },
    [activeListId, resetSession]
  );

  const generatePickingPath = useCallback(async () => {
    if (!user || cartItems.length === 0) {
      toast.error('Add items to your cart first.');
      return;
    }

    setIsSaving(true);
    try {
      const skuList = cartItems.map((i) => i.sku);

      const { data: currentStock, error: stockError } = await supabase
        .from('inventory')
        .select('sku, quantity, warehouse, location')
        .in('sku', skuList);

      if (stockError) throw stockError;

      const { data: activeLists, error: listsError } = await supabase
        .from('picking_lists')
        .select('id, items, order_number')
        .in('status', ['active', 'needs_correction', 'ready_to_double_check', 'double_checking']);

      if (listsError) throw listsError;

      const stockMap = new Map<string, { stock: number; reserved: number }>();

      currentStock?.forEach((row: any) => {
        const key = `${row.sku}-${row.warehouse}-${row.location}`;
        stockMap.set(key, { stock: Number(row.quantity || 0), reserved: 0, reservingOrders: new Set() } as any);
      });

      activeLists?.forEach((list: any) => {
        const listItems = list.items || [];
        if (Array.isArray(listItems)) {
          listItems.forEach((li: any) => {
            const key = `${li.sku}-${li.warehouse}-${li.location}`;
            if (stockMap.has(key)) {
              const entry = stockMap.get(key) as any;
              entry.reserved += li.pickingQty || 0;
              if (list.order_number) entry.reservingOrders.add(list.order_number);
            }
          });
        }
      });

      for (const myItem of cartItems) {
        const key = `${myItem.sku}-${myItem.warehouse}-${myItem.location}`;
        const entry = stockMap.get(key);

        if (!entry) {
          toast.error(`Item ${myItem.sku} no longer exists in inventory.`);
          return;
        }

        const availableAcrossSystem = entry.stock - entry.reserved;
        const myQty = myItem.pickingQty || 0;

        if (myQty > availableAcrossSystem) {
          const orders = Array.from((entry as any).reservingOrders).join(', ');
          const reservedInfo = orders ? `is reserved in ${orders}.` : 'is reserved.';
          const availabilityInfo = availableAcrossSystem > 0 ? `There is only ${availableAcrossSystem} available.` : 'There are no more items available.';

          toast.error(
            `${myItem.sku} ${reservedInfo} ${availabilityInfo} (You need ${myQty}).`,
            { duration: 6000 }
          );
          return;
        }
      }

      // Ensure customer exists if it's a new one (name only)
      let customerId = customer?.id;
      if (!customerId && customer?.name) {
        const normalizedName = customer.name.trim();

        // 1. Try to find existing customer by name first
        const { data: existing } = await supabase
          .from('customers')
          .select('id')
          .eq('name', normalizedName)
          .maybeSingle();

        if (existing) {
          customerId = existing.id;
        } else {
          // 2. Create new customer if not found
          const { data: newCust, error: createError } = await supabase
            .from('customers')
            .insert({ name: normalizedName })
            .select('id')
            .single();

          if (createError) {
            console.error('Failed to create customer:', createError);
            throw createError;
          }
          customerId = newCust.id;
        }
      }

      const { data, error } = await supabase
        .from('picking_lists')
        .insert({
          user_id: user.id || user.user_id,
          items: cartItems as any,
          status: 'active',
          order_number: orderNumber,
          customer_id: customerId,
          load_number: loadNumber,
        } as any)
        .select()
        .single();

      if (error) throw error;

      if (data) {
        setActiveListId(data.id);
        const ownerId = (data as any).user_id; // Keeping as any to avoid type fight if needed, but ideally typed
        setListStatus('active');
        setOwnerId(ownerId);
        setSessionMode('picking');

        // CRITICAL FIX: Update local customer state with the RESOLVED ID so the UI knows it's real
        if (customerId && customer?.name) {
          setCustomer({
            ...customer,
            id: customerId,
            name: customer.name.trim() // Ensure consistent trimming
          });
        }

        localStorage.setItem('picking_session_mode', 'picking');
        localStorage.setItem('active_picking_list_id', data.id);

        toast.success('Path generated! Stock reserved.');
      }
    } catch (err) {
      console.error('Failed to generate picking path:', err);
      toast.error('Failed to start picking session.');
    } finally {
      setIsSaving(false);
    }
  }, [user, cartItems, orderNumber, customer, setCustomer, setActiveListId, setListStatus, setOwnerId, setSessionMode, setIsSaving]);

  const updateCustomerDetails = useCallback(
    async (customerId: string, details: Partial<Customer>) => {
      try {
        const { error } = await supabase
          .from('customers')
          .update(details)
          .eq('id', customerId);

        if (error) throw error;

        // Update local state if it's the current customer
        if (customer && customer.id === customerId) {
          setCustomer({ ...customer, ...details });
        }

        toast.success('Customer details updated');
      } catch (err) {
        console.error('Failed to update customer details:', err);
        toast.error('Failed to update customer details');
        throw err;
      }
    },
    [customer, setCustomer]
  );

  // Claim the order as picker if the current owner is "Warehouse Team" (script account)
  const claimAsPicker = useCallback(
    async (listIdOverride?: string) => {
      const targetId = listIdOverride || activeListId;
      if (!targetId || !user) return;

      // Already the owner — nothing to claim
      if (ownerId === user.id) return;

      // Check if the current owner is the script account ("Warehouse Team")
      if (ownerId) {
        const { data: ownerProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', ownerId)
          .single();

        if (ownerProfile?.full_name !== 'Warehouse Team') return;
      }

      // Claim: update user_id to the current user
      const { error } = await supabase
        .from('picking_lists')
        .update({ user_id: user.id } as any)
        .eq('id', targetId);

      if (error) {
        console.error('Failed to claim order as picker:', error);
        return;
      }

      setOwnerId(user.id);
    },
    [activeListId, user, ownerId, setOwnerId]
  );

  const takeOverOrder = useCallback(
    async (listId: string) => {
      if (!user) return;
      setIsSaving(true);
      try {
        const { error } = await supabase
          .from('picking_lists')
          .update({
            user_id: user.id,
            last_activity_at: new Date().toISOString(),
          } as any)
          .eq('id', listId);

        if (error) throw error;

        toast.success('You have taken over this order.');
      } catch (err) {
        console.error('Failed to take over order:', err);
        toast.error('Failed to take over order');
      } finally {
        setIsSaving(false);
      }
    },
    [user, setIsSaving]
  );

  return {
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
  };
};
