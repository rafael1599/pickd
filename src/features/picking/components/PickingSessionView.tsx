import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import Package from 'lucide-react/dist/esm/icons/package';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import { getOptimizedPickingPath, calculatePallets } from '../../../utils/pickingLogic.ts';
import { generatePickingPdf } from '../../../utils/pickingPdf.ts';
import { useLocationManagement } from '../../inventory/hooks/useLocationManagement.ts';
import { SlideToConfirm } from '../../../components/ui/SlideToConfirm.tsx';
import { useError } from '../../../context/ErrorContext.tsx';
import { useConfirmation } from '../../../context/ConfirmationContext.tsx';
import { useAuth } from '../../../context/AuthContext.tsx';
import { supabase } from '../../../lib/supabase.ts';
import { CorrectionNotesTimeline } from './CorrectionNotesTimeline.tsx';
import { OrderBuilderMode } from './OrderBuilderMode.tsx';
import { usePickingSession } from '../../../context/PickingContext.tsx';
import { useAutoSelect } from '../../../hooks/useAutoSelect.ts';
import toast from 'react-hot-toast';

// Define explicit interfaces
import { type CartItem } from '../hooks/usePickingCart.ts';

interface PickingSessionViewProps {
  cartItems: CartItem[];
  activeListId?: string | null;
  orderNumber?: string | null;
  customer?: import('../../../types/schema.ts').Customer | null;
  correctionNotes?: string | null;
  notes?: any[]; // Keep as any if complex timeline object not defined
  isNotesLoading?: boolean;
  onUpdateOrderNumber: (newOrder: string | null) => void;
  onUpdateCustomer?: (details: Partial<import('../../../types/schema.ts').Customer>) => void;
  onGoToDoubleCheck: (orderId: string | null) => void;
  onUpdateQty: (item: CartItem, delta: number) => void;
  onRemoveItem: (item: CartItem) => void;
  onClose: () => void;
  onDelete?: (id: string | null) => void;
}

export const PickingSessionView: React.FC<PickingSessionViewProps> = ({
  cartItems,
  activeListId,
  orderNumber,
  customer,
  correctionNotes,
  notes = [],
  isNotesLoading = false,
  onUpdateOrderNumber,
  onUpdateCustomer,
  onGoToDoubleCheck,
  onUpdateQty,
  onRemoveItem,
  onClose,
  onDelete,
}) => {
  const { locations } = useLocationManagement();
  const { showError } = useError();
  const { showConfirmation } = useConfirmation();
  const { user } = useAuth();

  const { sessionMode, generatePickingPath, returnToBuilding } = usePickingSession();
  const autoSelect = useAutoSelect();

  // State
  const [isDeducting] = useState(false);
  const [editingItemKey, setEditingItemKey] = useState<string | null>(null);
  const [editingQuantity, setEditingQuantity] = useState('');
  const [isEditingOrder, setIsEditingOrder] = useState(false);
  const [isEditingCustomer, setIsEditingCustomer] = useState(false);
  const [isValidatingOrder, setIsValidatingOrder] = useState(false);
  const [tempOrder, setTempOrder] = useState(orderNumber || '');
  const [tempCustomer, setTempCustomer] = useState(customer?.name || '');

  const inputRef = useRef<HTMLInputElement>(null);
  const prevItemCountRef = useRef(cartItems.length);

  // Detect when new items are added (e.g., from auto-combine)
  useEffect(() => {
    if (cartItems.length > prevItemCountRef.current) {
      toast('New items added to this order', { icon: '🔗', duration: 4000 });
    }
    prevItemCountRef.current = cartItems.length;
  }, [cartItems.length]);
  const orderInputRef = useRef<HTMLInputElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);

  const optimizedItems = useMemo(() => {
    return getOptimizedPickingPath(cartItems, locations);
  }, [cartItems, locations]);

  // Calculate Pallets
  const pallets = useMemo(() => {
    return calculatePallets(optimizedItems);
  }, [optimizedItems]);

  const totalUnits = cartItems.reduce((acc, item) => acc + (item.pickingQty || 0), 0);

  // Effect to focus input when editing starts
  useEffect(() => {
    if (editingItemKey && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingItemKey]);

  useEffect(() => {
    if (isEditingOrder && orderInputRef.current) {
      orderInputRef.current.focus();
      orderInputRef.current.select();
    }
  }, [isEditingOrder]);

  // Sync temp states when props change
  useEffect(() => {
    if (!isEditingOrder) {
      setTempOrder(orderNumber || '');
    }
  }, [orderNumber, isEditingOrder]);

  useEffect(() => {
    if (!isEditingCustomer) {
      setTempCustomer(customer?.name || '');
    }
  }, [customer?.name, isEditingCustomer]);

  const getItemKey = (palletId: number | string, item: CartItem) =>
    `${palletId}-${item.sku}-${item.location}`;

  const handleQuantityClick = (palletId: number | string, item: CartItem) => {
    const key = getItemKey(palletId, item);
    setEditingItemKey(key);
    setEditingQuantity(item.pickingQty?.toString() || '0');
  };

  const handleQuantitySubmit = (item: CartItem) => {
    const newQty = parseInt(editingQuantity, 10);
    const maxStock =
      typeof item.quantity === 'string' ? parseInt(item.quantity, 10) : item.quantity;

    if (isNaN(newQty) || newQty < 0) {
      showError('Invalid Quantity', 'Please enter a non-negative number.');
      setEditingQuantity(item.pickingQty?.toString() || '0');
    } else if (newQty > maxStock) {
      showError('Quantity Exceeded', `Cannot exceed stock of ${maxStock}.`);
      onUpdateQty(item, maxStock - (item.pickingQty || 0));
    } else if (newQty === 0) {
      onRemoveItem(item);
    } else {
      const delta = newQty - (item.pickingQty || 0);
      onUpdateQty(item, delta);
    }
    setEditingItemKey(null);
  };

  const handleQuantityKeyDown = (e: React.KeyboardEvent, item: CartItem) => {
    if (e.key === 'Enter') {
      handleQuantitySubmit(item);
    } else if (e.key === 'Escape') {
      setEditingItemKey(null);
      setEditingQuantity(item.pickingQty?.toString() || '0');
    }
  };

  const handleOrderClick = () => {
    setTempOrder(orderNumber || (activeListId ? activeListId.slice(-6).toUpperCase() : ''));
    setIsEditingOrder(true);
  };

  const handleCustomerClick = () => {
    setTempCustomer(customer?.name || '');
    setIsEditingCustomer(true);
  };

  // Check if order number is already in use by another user
  const checkOrderAvailability = useCallback(
    async (orderNum: string): Promise<boolean> => {
      if (!orderNum || orderNum.trim() === '' || !user) return true;

      setIsValidatingOrder(true);
      try {
        const { data, error } = await supabase
          .from('picking_lists')
          .select('id, user_id, profiles!user_id(full_name)')
          .eq('order_number', orderNum.trim())
          .in('status', ['active', 'needs_correction', 'ready_to_double_check', 'double_checking'])
          .neq('user_id', user.id) // Exclude our own sessions
          .maybeSingle();

        if (error) throw error;

        if (data) {
          // Another session is active with this order number
          const ownerName = (data.profiles as any)?.full_name || 'Another user';

          const confirmed = await new Promise<boolean>((resolve) => {
            showConfirmation(
              'Order In Use',
              `${ownerName} is currently working on order #${orderNum}. Do you want to take over ? This will reset their session.`,
              () => resolve(true),
              () => resolve(false),
              'Take Over',
              'Cancel'
            );
          });

          if (confirmed) {
            // Transfer session: update user_id to current user
            await supabase.from('picking_lists').update({ user_id: user.id }).eq('id', data.id);

            toast.success('You took control of the order');
            return true;
          }

          return false; // User cancelled
        }

        return true; // No conflict
      } catch (err) {
        console.error('Error checking order:', err);
        showError('Error', 'Could not verify order availability');
        return false;
      } finally {
        setIsValidatingOrder(false);
      }
    },
    [user, showConfirmation, showError]
  );

  const handleOrderSubmit = async () => {
    if (!tempOrder.trim()) {
      setIsEditingOrder(false);
      return;
    }

    // Prevent double submission
    if (isValidatingOrder) return;

    // Validate availability before updating
    const isAvailable = await checkOrderAvailability(tempOrder.trim());
    if (!isAvailable) {
      // User cancelled or error occurred
      setTempOrder(orderNumber || ''); // Restore previous value
      setIsEditingOrder(false);
      return;
    }

    // Proceed with update
    onUpdateOrderNumber(tempOrder.trim());
    setIsEditingOrder(false);
  };

  const handleOrderKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleOrderSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingOrder(false);
    }
  };

  const handleCustomerSubmit = () => {
    if (onUpdateCustomer) {
      onUpdateCustomer({ name: tempCustomer.trim() || '' });
    }
    setIsEditingCustomer(false);
  };

  const handleCustomerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCustomerSubmit();
    } else if (e.key === 'Escape') {
      setIsEditingCustomer(false);
    }
  };

  const finalSequence = useMemo(() => {
    const sequence: any[] = [];
    cartItems.forEach((cartItem) => {
      // Find all instances of this item across all pallets
      pallets.forEach((p: any) => {
        const palletItem = p.items.find(
          (pi: any) => pi.sku === cartItem.sku && pi.location === cartItem.location
        );
        if (palletItem) {
          const key = getItemKey(p.id, palletItem);
          sequence.push({
            ...palletItem,
            key,
            palletId: p.id,
            isPicked: false, // Redundant in Review Picking list
          });
        }
      });
    });
    return sequence;
  }, [cartItems, pallets]);

  const handleConfirm = () => {
    onGoToDoubleCheck(tempOrder.trim());
  };

  // Early return for Building Mode
  if (sessionMode === 'building') {
    return (
      <div className="flex flex-col h-full bg-card overflow-hidden">
        {/* Header for Order Builder */}
        <div
          data-drag-handle="true"
          className="bg-surface px-4 py-3 border-b border-subtle flex items-center justify-between sticky top-0 z-50 touch-none shrink-0"
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-accent rounded-xl flex items-center justify-center shadow-lg shadow-accent/20">
              <span className="text-white font-black text-lg">#</span>
            </div>
            <div>
              <h2 className="text-lg font-black text-content leading-none">
                {orderNumber || 'NEW ORDER'}
              </h2>
              <p className="text-[10px] font-bold text-muted uppercase tracking-widest mt-1">
                BUILDING ORDER
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-card hover:bg-accent/10 text-muted hover:text-accent transition-all border border-subtle"
              title="Minimize"
            >
              <ChevronDown className="w-6 h-6" />
            </button>
            <button
              onClick={() => {
                showConfirmation(
                  'Delete Draft',
                  'Are you sure you want to delete this draft? Any inventory reservations will be released.',
                  async () => {
                    if (onDelete) {
                      await onDelete(activeListId ?? null);
                    }
                    onClose();
                  },
                  undefined,
                  'Delete Draft',
                  'Keep Draft'
                );
              }}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-card hover:bg-red-500/10 text-muted hover:text-red-500 transition-all border border-subtle ml-1"
              title="Delete Draft"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 min-h-0 relative">
          <OrderBuilderMode cartItems={cartItems} onGeneratePath={generatePickingPath} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card">
      {/* Header */}
      <div
        data-drag-handle="true"
        className="px-4 py-2 border-b border-subtle flex items-center justify-between shrink-0 bg-surface/50 backdrop-blur-sm sticky top-0 z-10 touch-none"
      >
        <button
          onClick={() => returnToBuilding(activeListId ?? null)}
          className="p-2 hover:bg-surface rounded-lg text-muted transition-colors shrink-0 mr-1"
          title="Return to Building"
        >
          <ArrowLeft size={24} />
        </button>
        <div className="flex-1 mx-2">
          <div className="flex items-center justify-center gap-2">
            <h2 className="text-base font-black text-content uppercase tracking-tight">
              Review Picking
            </h2>
            {isEditingOrder ? (
              <div className="relative">
                <input
                  ref={orderInputRef}
                  type="text"
                  value={tempOrder}
                  onChange={(e) => setTempOrder(e.target.value)}
                  onBlur={handleOrderSubmit}
                  onKeyDown={handleOrderKeyDown}
                  {...autoSelect}
                  className="text-[9px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded border border-accent/20 w-20 focus:outline-none focus:border-accent"
                  placeholder="#"
                  disabled={isValidatingOrder}
                />
                {isValidatingOrder && (
                  <div className="absolute right-0 top-0 w-3 h-3">
                    <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-accent"></div>
                  </div>
                )}
              </div>
            ) : (
              <span
                onClick={handleOrderClick}
                className="text-[9px] font-mono bg-accent/10 text-accent px-1.5 py-0.5 rounded border border-accent/20 cursor-pointer hover:bg-accent/20 transition-colors"
              >
                {orderNumber
                  ? `#${orderNumber} `
                  : activeListId
                    ? `#${activeListId.slice(-6).toUpperCase()} `
                    : 'SET ORDER #'}
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted font-bold uppercase tracking-widest text-center mt-1 flex items-center justify-center gap-1">
            {isEditingCustomer ? (
              <input
                ref={customerInputRef}
                type="text"
                value={tempCustomer}
                onChange={(e) => setTempCustomer(e.target.value)}
                onBlur={handleCustomerSubmit}
                onKeyDown={handleCustomerKeyDown}
                {...autoSelect}
                className="text-[10px] font-bold bg-accent/5 text-accent px-2 py-0.5 rounded border border-accent/10 w-32 focus:outline-none focus:border-accent text-center"
                placeholder="Customer Name"
              />
            ) : (
              <span
                onClick={handleCustomerClick}
                className="cursor-pointer hover:text-accent transition-colors"
              >
                {customer?.name || 'No Customer Set'}
              </span>
            )}
            <span className="opacity-30 mx-1">•</span>
            <span>{pallets.length} Pallets</span>
            <span className="opacity-30 mx-1">•</span>
            <span>{totalUnits} Units</span>
          </p>
        </div>
        <button
          onClick={() => {
            showConfirmation(
              'Cancel Order',
              'Are you sure you want to cancel this order? This action cannot be undone.',
              async () => {
                if (onDelete) {
                  await onDelete(activeListId ?? null);
                }
                onClose();
              },
              undefined,
              'Yes, Cancel',
              'Keep Order'
            );
          }}
          className="p-2 bg-red-500/10 border border-red-500/20 text-red-500 rounded-xl hover:bg-red-500/20 transition-all shrink-0 mr-2"
          title="Cancel Order"
        >
          <Trash2 size={20} />
        </button>
        <button
          onClick={() =>
            generatePickingPdf(
              finalSequence,
              orderNumber || activeListId || 'PICKLIST',
              pallets.length
            )
          }
          className="p-2 bg-surface border border-subtle text-content rounded-xl hover:border-accent transition-all shrink-0"
          title="Download PDF"
        >
          <Printer size={20} />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-3 min-h-0">
        {/* Correction Notes Banner */}
        {(correctionNotes || notes.length > 0) && (
          <div className="mb-6 space-y-4 animate-in fade-in slide-in-from-top-2 duration-500">
            {/* Summary of last note if exists as legacy flag */}
            {correctionNotes && (
              <div className="p-4 bg-amber-500/5 border border-amber-500/10 rounded-2xl flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                  <AlertCircle size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-black text-amber-500/70 uppercase tracking-widest mb-1">
                    Latest Instruction
                  </p>
                  <p className="text-sm font-medium text-content italic leading-relaxed">
                    "{correctionNotes}"
                  </p>
                </div>
              </div>
            )}

            {/* Detailed Timeline */}
            {notes.length > 0 && (
              <div className="px-1 pt-2">
                <CorrectionNotesTimeline notes={notes} isLoading={isNotesLoading} />
              </div>
            )}
          </div>
        )}

        {pallets.map((pallet: any, pIdx: number) => (
          <section key={pallet.id} className="mb-4">
            <div className="flex items-center justify-between mb-3 sticky top-0 bg-card z-10 py-2">
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full bg-accent text-main flex items-center justify-center font-black text-sm shadow-lg shadow-accent/20">
                  {pallet.id}
                </span>
                <h3 className="text-sm font-black text-content uppercase tracking-wider">
                  Pallet {pallet.id}
                </h3>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 bg-surface rounded-full overflow-hidden border border-subtle">
                    <div
                      className="h-full bg-accent transition-all duration-500"
                      style={{ width: `${(pallet.totalUnits / pallet.limitPerPallet) * 100}%` }}
                    />
                  </div>
                  <span className="font-mono font-bold text-xs text-accent">
                    {pallet.totalUnits}/{pallet.limitPerPallet}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid gap-1.5">
              {pallet.items.map((item: any) => {
                const maxStock = parseInt(item.quantity, 10) || 0;
                const isAtMax = (item.pickingQty || 0) >= maxStock;

                return (
                  <div
                    key={`${pallet.id} -${item.sku} -${item.location} `}
                    className="bg-surface/50 border border-subtle rounded-xl p-2 hover:border-accent/30 transition-all"
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-[10px] text-muted font-bold uppercase tracking-widest">
                        {item.warehouse}
                      </span>
                      <div className="flex items-center gap-1 px-1.5 py-0.5 bg-accent/10 border border-accent/20 rounded">
                        <MapPin size={10} className="text-accent" />
                        <span className="text-[10px] text-accent font-black uppercase">
                          {item.location}
                        </span>
                      </div>
                    </div>

                    {/* SKU, Stock Info and Controls */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 bg-main rounded-lg flex items-center justify-center border border-subtle shrink-0">
                          <Package className="w-4 h-4 text-muted" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-content text-sm truncate flex items-center gap-2">
                            {item.sku}
                            {item.insufficient_stock && (
                              <span className="text-[8px] bg-amber-500/20 text-amber-500 px-1 py-0.5 rounded font-black uppercase tracking-tighter">
                                Low Stock ({item.available_qty || 0})
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] text-muted font-bold uppercase tracking-tighter">
                              Stock: {maxStock}
                            </span>
                            {item.sku_metadata &&
                              (item.sku_metadata.length_in ||
                                item.sku_metadata.width_in ||
                                item.sku_metadata.height_in) && (
                                <span className="hidden md:inline-block bg-accent/5 text-accent/70 text-[8px] px-1 rounded border border-accent/10 font-bold">
                                  {item.sku_metadata.length_in || 0} x{' '}
                                  {item.sku_metadata.width_in || 0} x{' '}
                                  {item.sku_metadata.height_in || 0} in
                                </span>
                              )}
                          </div>
                        </div>
                      </div>

                      {/* PICKING MODE: READ ONLY QUANTITY (Option B) */}
                      {sessionMode === 'picking' ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="px-3 py-1 bg-surface border border-subtle rounded-lg">
                            <span className="font-mono font-black text-accent text-lg">
                              {item.pickingQty}
                            </span>
                            <span className="text-[10px] text-muted font-bold uppercase ml-1">
                              UNITS
                            </span>
                          </div>
                          {/* No delete button allowed in picking mode */}
                        </div>
                      ) : (
                        /* BUILDING MODE: FULL CONTROLS */
                        <div className="flex items-center gap-2 shrink-0">
                          <div className="flex items-center bg-main rounded-lg p-0.5 gap-0.5 border border-subtle">
                            <button
                              onClick={() => onUpdateQty(item, -1)}
                              className="w-7 h-7 flex items-center justify-center text-muted hover:text-content rounded active:bg-surface transition-colors"
                            >
                              <Minus size={14} />
                            </button>
                            {editingItemKey === getItemKey(pallet.id, item) ? (
                              <input
                                ref={inputRef}
                                type="number"
                                value={editingQuantity}
                                onChange={(e) => setEditingQuantity(e.target.value)}
                                onBlur={() => handleQuantitySubmit(item)}
                                onKeyDown={(e) => handleQuantityKeyDown(e, item)}
                                {...autoSelect}
                                className="w-10 text-center font-mono font-black text-accent text-base bg-transparent border-none focus:outline-none"
                                min="0"
                                max={maxStock.toString()}
                              />
                            ) : (
                              <div
                                onClick={() => handleQuantityClick(pallet.id, item)}
                                className="w-10 text-center font-mono font-black text-accent text-base cursor-pointer hover:bg-surface/50 rounded transition-colors"
                              >
                                {item.pickingQty}
                              </div>
                            )}
                            <button
                              onClick={() => onUpdateQty(item, 1)}
                              disabled={isAtMax}
                              className={`w-7 h-7 flex items-center justify-center rounded transition-colors ${
                                isAtMax
                                  ? 'text-subtle cursor-not-allowed'
                                  : 'text-muted hover:text-content active:bg-surface'
                              } `}
                            >
                              <Plus size={14} />
                            </button>
                          </div>
                          <button
                            onClick={() => onRemoveItem(item)}
                            className="p-2 text-muted hover:text-red-500 transition-colors"
                            title="Remove item"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {pIdx < pallets.length - 1 && (
              <div className="flex justify-center py-4 opacity-20">
                <div className="w-px h-8 bg-gradient-to-b from-accent to-transparent" />
              </div>
            )}
          </section>
        ))}
      </div>

      {/* Footer */}
      <div className="px-12 py-2 pb-20 border-t border-subtle bg-surface/30 backdrop-blur-xl shrink-0">
        <SlideToConfirm
          onConfirm={handleConfirm}
          isLoading={isDeducting}
          text="READY TO DOUBLE CHECK"
          confirmedText="PREPARING..."
        />
      </div>
    </div>
  );
};
