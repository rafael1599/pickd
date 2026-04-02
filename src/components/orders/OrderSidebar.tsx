import React, { useState } from 'react';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Hash from 'lucide-react/dist/esm/icons/hash';
import HandMetal from 'lucide-react/dist/esm/icons/hand-metal';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Scissors from 'lucide-react/dist/esm/icons/scissors';
import Wand2 from 'lucide-react/dist/esm/icons/wand-2';
import { CustomerAutocomplete } from '../../features/picking/components/CustomerAutocomplete';
import { usePickingSession } from '../../context/PickingContext';
import { useConfirmation } from '../../context/ConfirmationContext';
import { parseUSAddress } from '../../utils/parseUSAddress';
import type { CombineMeta, PickingList, PickingListItem } from '../../schemas/picking.schema';
import type { Customer } from '../../types/schema';
import type { User } from '@supabase/supabase-js';

interface OrderFormData {
  customerName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  loadNumber: string;
  pallets: string;
  units: string;
}

interface SelectedOrder extends PickingList {
  user?: { full_name?: string } | null;
  combine_meta?: CombineMeta;
}

interface OrderSidebarProps {
  formData: OrderFormData;
  setFormData: (data: OrderFormData) => void;
  selectedOrder: SelectedOrder;
  user: User | null;
  takeOverOrder: (id: string) => Promise<void>;
  onRefresh: () => void;
  onDelete: () => void;
  onShowPickingSummary?: () => void;
  onSplitOrder?: () => void;
  collapsible?: boolean;
}

export const OrderSidebar: React.FC<OrderSidebarProps> = ({
  formData,
  setFormData,
  selectedOrder,
  user,
  takeOverOrder,
  onRefresh,
  onDelete,
  onShowPickingSummary,
  onSplitOrder,
  collapsible = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { deleteList } = usePickingSession();
  const { showConfirmation } = useConfirmation();

  if (!selectedOrder) return null;

  const handleStreetChange = (value: string) => {
    const parsed = parseUSAddress(value);
    if (parsed) {
      setFormData({ ...formData, ...parsed });
      return;
    }
    setFormData({ ...formData, street: value });
  };

  const handleDelete = () => {
    showConfirmation(
      'Delete Order',
      'Are you sure you want to delete this order? It will be marked as cancelled and will no longer reserve inventory.',
      async () => {
        onDelete();
        await deleteList(selectedOrder.id);
        onRefresh();
      },
      () => {},
      'Delete',
      'Cancel'
    );
  };

  return (
    <aside className="w-full md:w-80 2xl:w-[400px] h-full border-r border-subtle flex flex-col p-5 md:p-8 shrink-0 overflow-y-auto bg-card backdrop-blur-3xl z-40 no-scrollbar rounded-3xl md:rounded-none mb-8 md:mb-0 relative">
      {/* Soft Ambient Glow inside sidebar */}
      <div className="absolute -top-20 -right-20 w-40 h-40 bg-accent/5 blur-[80px] pointer-events-none" />

      {/* Header — always visible */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => window.history.back()}
          className="w-11 h-11 flex items-center justify-center bg-surface hover:bg-main border border-subtle rounded-2xl text-muted transition-all active:scale-95 shadow-sm"
          title="Back"
        >
          <ChevronLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-text-muted">
            Order Details
          </h2>
          <p className="text-lg font-black text-content tracking-tight truncate">
            #{selectedOrder.order_number}
            {formData.customerName && (
              <span className="text-muted font-semibold text-sm ml-2">{formData.customerName}</span>
            )}
          </p>
        </div>
        {collapsible && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-11 h-11 flex items-center justify-center bg-surface border border-subtle rounded-2xl text-muted transition-all active:scale-95 shadow-sm"
          >
            <ChevronDown
              size={20}
              className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}
      </div>

      {/* Collapsible content */}
      <div
        className={collapsible && !isExpanded ? 'max-h-0 overflow-hidden' : ''}
        style={
          collapsible
            ? {
                transition: 'max-height 300ms ease-in-out',
                maxHeight: isExpanded ? '2000px' : undefined,
              }
            : undefined
        }
      >
        {selectedOrder.user_id !== user?.id &&
          ['active', 'ready_to_double_check', 'double_checking'].includes(selectedOrder.status) && (
            <div className="p-5 bg-amber-500/10 border border-amber-500/20 rounded-2xl mb-6 space-y-3">
              <div className="flex items-center gap-2 text-amber-600">
                <HandMetal size={16} />
                <p className="text-xs font-black uppercase tracking-tight">
                  Owned by {selectedOrder.user?.full_name || 'Another User'}
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await takeOverOrder(selectedOrder.id);
                  onRefresh();
                }}
                className="w-full py-3 bg-amber-500 text-white text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm active:scale-95 transition-all"
              >
                Take Over Order
              </button>
            </div>
          )}

        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <div className="space-y-2 group">
            <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] transition-colors group-focus-within:text-accent">
              Customer Name
            </label>
            <CustomerAutocomplete
              value={formData.customerName ? ({ name: formData.customerName } as Customer) : null}
              onChange={(customer) => {
                if (customer) {
                  setFormData({
                    ...formData,
                    customerName: customer.name,
                    street: customer.street || formData.street,
                    city: customer.city || formData.city,
                    state: customer.state || formData.state,
                    zip: customer.zip_code || formData.zip,
                  });
                } else {
                  setFormData({ ...formData, customerName: '' });
                }
              }}
            />
          </div>

          <div className="space-y-2 group">
            <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] flex items-center gap-1 group-focus-within:text-accent">
              <MapPin size={10} /> Shipping Address
            </label>
            <div className="relative flex items-center">
              <input
                type="text"
                value={formData.street}
                onChange={(e) => handleStreetChange(e.target.value)}
                placeholder="Paste full address to auto-fill..."
                className="w-full bg-main border border-subtle rounded-3xl px-5 py-3.5 pr-12 text-lg text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
              />
              <button
                type="button"
                onClick={() => handleStreetChange(formData.street)}
                title="Parse address"
                className="absolute right-2 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-accent hover:bg-accent/10 transition-all active:scale-90"
              >
                <Wand2 size={16} />
              </button>
            </div>
          </div>

          <div className="space-y-2 group">
            <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] group-focus-within:text-accent">
              City
            </label>
            <input
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              placeholder="City..."
              className="w-full bg-main border border-subtle rounded-3xl px-5 py-3.5 text-lg text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2 group">
              <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] group-focus-within:text-accent">
                State
              </label>
              <input
                type="text"
                maxLength={2}
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                placeholder="CA"
                className="w-full bg-main border border-subtle rounded-3xl px-5 py-3.5 text-lg text-content ios-transition font-medium text-center focus:border-accent focus:bg-surface shadow-sm"
              />
            </div>
            <div className="space-y-2 group">
              <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] group-focus-within:text-accent">
                Zip Code
              </label>
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                placeholder="00000"
                className="w-full bg-main border border-subtle rounded-3xl px-5 py-3.5 text-lg text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
              />
            </div>
          </div>

          {/* Load Number moved above Pallets/Units */}
          <div className="space-y-2 group">
            <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] flex items-center gap-1 group-focus-within:text-accent">
              <Hash size={10} /> Load Number
            </label>
            <input
              type="text"
              placeholder="E.G. 127035968"
              value={formData.loadNumber}
              onChange={(e) =>
                setFormData({ ...formData, loadNumber: e.target.value.toUpperCase() })
              }
              className="w-full bg-main border border-subtle rounded-3xl px-5 py-3.5 text-lg text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-5 mt-2">
            <div className="flex flex-col gap-2 group">
              <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] text-center group-focus-within:text-accent">
                Pallets
              </label>
              <input
                type="number"
                min="1"
                value={formData.pallets}
                onChange={(e) => setFormData({ ...formData, pallets: e.target.value })}
                className="w-full bg-main border border-subtle rounded-3xl py-4 text-center font-heading text-3xl font-bold text-[#22c55e] ios-transition focus:border-[#22c55e] shadow-sm focus:bg-surface"
              />
            </div>
            <div className="flex flex-col gap-2 group">
              <label className="text-xs uppercase text-text-muted font-black tracking-[0.2em] text-center group-focus-within:text-accent">
                Total Units
              </label>
              <input
                type="number"
                min="0"
                value={formData.units}
                onChange={(e) => setFormData({ ...formData, units: e.target.value })}
                className="w-full bg-main border border-subtle rounded-3xl py-4 text-center font-heading text-3xl font-bold text-content ios-transition focus:border-accent shadow-sm focus:bg-surface"
              />
            </div>
          </div>
        </form>

        {/* Combined Order Info */}
        {selectedOrder.combine_meta?.is_combined && (
          <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 flex items-center gap-1.5">
              🔗 Combined Order
            </p>
            <div className="flex flex-col gap-1">
              {selectedOrder.combine_meta?.source_orders?.map((src, i) => {
                const unitCount = (selectedOrder.items || [])
                  .filter(
                    (item) =>
                      (item as PickingListItem & { source_order?: string }).source_order ===
                      src.order_number
                  )
                  .reduce((sum, item) => sum + (item.pickingQty || 0), 0);
                return (
                  <span key={i} className="text-xs text-blue-300/70 font-mono">
                    #{src.order_number} — {unitCount || src.item_count || '?'} units
                  </span>
                );
              })}
            </div>
            {onSplitOrder && selectedOrder.status !== 'completed' && (
              <button
                onClick={onSplitOrder}
                className="w-full mt-2 flex items-center justify-center gap-2 h-10 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-400 transition-all active:scale-95"
              >
                <Scissors size={12} />
                <span>Split Orders</span>
              </button>
            )}
          </div>
        )}

        <div className="mt-auto pt-8 flex flex-col gap-3">
          <button
            onClick={onShowPickingSummary}
            className="w-full flex items-center justify-center gap-2 h-12 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-amber-500 transition-all active:scale-95 shadow-[0_0_20px_rgba(245,158,11,0.1)]"
          >
            <span>Picking Summary</span>
          </button>

          <button
            onClick={handleDelete}
            className="w-full flex items-center justify-center gap-2 h-12 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-red-500 transition-all active:scale-95"
          >
            <Trash2 size={14} />
            <span>Delete Order</span>
          </button>
        </div>
      </div>
      {/* end collapsible */}
    </aside>
  );
};
