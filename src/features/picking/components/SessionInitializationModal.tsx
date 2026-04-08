import { useState, useEffect } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import { usePickingSession } from '../../../context/PickingContext';
import { CustomerAutocomplete } from './CustomerAutocomplete';
import type { Customer } from '../../../types/schema';
import { useAuth } from '../../../context/AuthContext';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';
import { useScrollLock } from '../../../hooks/useScrollLock';

// SessionInitializationModal - handles manual session start
export const SessionInitializationModal = () => {
  const { isInitializing, startNewSession, cancelInitialization, pendingItem } =
    usePickingSession();
  const { user } = useAuth();

  const [manualOrder, setManualOrder] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useScrollLock(isInitializing, cancelInitialization);

  // Reset state when modal opens
  useEffect(() => {
    if (!isInitializing) return;

    setManualOrder('');
    setSelectedCustomer(null);
  }, [isInitializing]);

  if (!isInitializing) return null;

  const handleManualSubmit = async () => {
    if (!manualOrder.trim() || !user) return;
    setIsChecking(true);

    const orderNum = manualOrder.trim();
    const customerData = selectedCustomer || undefined;

    // Check if this order number is already active by SOMEONE ELSE
    try {
      const { data, error } = await supabase
        .from('picking_lists')
        .select('id, user_id, profiles!user_id(full_name)')
        .eq('order_number', orderNum)
        .in('status', ['active', 'needs_correction'])
        .maybeSingle();

      if (error && error.code !== 'PGRST116') {
        // Only log real errors
        console.error('Check failed', error);
      }

      if (data) {
        // If it exists, warn user
        const owner = (data.profiles as { full_name?: string } | null)?.full_name || 'Another User';
        const confirmed = window.confirm(
          `Order #${orderNum} is currently active by ${owner}. Do you want to take it over?`
        );
        if (confirmed) {
          await supabase.from('picking_lists').update({ user_id: user.id }).eq('id', data.id);

          await startNewSession('manual', orderNum, customerData);
          toast.success('You took over the order!');
        }
      } else {
        // Brand new order
        await startNewSession('manual', orderNum, customerData);
      }
    } catch (err) {
      console.error('Check failed', err);
      // Fallback: just allow it
      await startNewSession('manual', orderNum, customerData);
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-surface border border-subtle rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl scale-100 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="px-6 py-4 border-b border-subtle bg-main/50 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-content uppercase tracking-tight">
              Start New Order
            </h3>
            {pendingItem && (
              <p className="text-xs text-muted font-medium mt-1">
                Starting with: <span className="text-accent">{pendingItem.sku}</span>
              </p>
            )}
          </div>
          <button
            onClick={cancelInitialization}
            className="p-2 hover:bg-subtle rounded-full text-muted transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-4 animate-in slide-in-from-right-4 duration-200">
            <div className="space-y-4">
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted font-black text-lg">
                  #
                </span>
                <input
                  autoFocus
                  type="text"
                  value={manualOrder}
                  onChange={(e) => setManualOrder(e.target.value.toUpperCase())}
                  placeholder="Order Number"
                  className="w-full bg-main border-2 border-subtle focus:border-accent text-content rounded-xl pl-10 pr-4 py-4 font-mono text-xl font-bold uppercase tracking-widest outline-none transition-all placeholder:text-muted/50"
                  onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                />
              </div>

              <CustomerAutocomplete
                value={selectedCustomer}
                onChange={setSelectedCustomer}
                className="w-full"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={cancelInitialization}
                className="py-3 px-4 rounded-xl text-muted font-bold hover:bg-subtle transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleManualSubmit}
                disabled={!manualOrder.trim() || isChecking}
                className="py-3 px-4 bg-accent text-white rounded-xl font-black uppercase tracking-widest hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2"
              >
                {isChecking ? 'Checking...' : 'START'}
                {!isChecking && <ArrowRightLeft size={16} />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
