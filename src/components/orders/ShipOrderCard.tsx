import React, { useState, useRef, useCallback, useEffect } from 'react';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Hash from 'lucide-react/dist/esm/icons/hash';
import HandMetal from 'lucide-react/dist/esm/icons/hand-metal';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Scissors from 'lucide-react/dist/esm/icons/scissors';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Truck from 'lucide-react/dist/esm/icons/truck';
import Wand2 from 'lucide-react/dist/esm/icons/wand-2';
import Copy from 'lucide-react/dist/esm/icons/copy';
import Check from 'lucide-react/dist/esm/icons/check';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { saveCustomerAddress } from '../../lib/customerAddresses';
import { CustomerAutocomplete } from '../../features/picking/components/CustomerAutocomplete';
import { usePickingSession } from '../../context/PickingContext';
import { useConfirmation } from '../../context/ConfirmationContext';
import { parseUSAddress } from '../../utils/parseUSAddress';
import { useCustomerAddresses } from '../../hooks/useCustomerAddresses';
import { OrderStatusPill } from './OrderStatusPill';
import type { CustomerAddress } from '../../lib/customerAddresses';
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
  transportCompany: string;
  pallets: string;
  units: string;
  bikes: string;
  parts: string;
  weight: string;
}

const TRANSPORT_COMPANIES = [
  'R+L',
  '2-DAY',
  'RIST',
  'TFORCE',
  'DAYLIGHT',
  'PAV EXPRESS',
  'ESTES',
  'FEDEX',
] as const;

interface SelectedOrder extends PickingList {
  user?: { full_name?: string } | null;
  combine_meta?: CombineMeta;
}

interface ShipOrderCardProps {
  formData: OrderFormData;
  setFormData: (data: OrderFormData) => void;
  selectedOrder: SelectedOrder;
  selectedCustomerId: string | null;
  user: User | null;
  takeOverOrder: (id: string) => Promise<void>;
  onRefresh: () => void;
  onDelete: () => void;
  onShowPickingSummary?: () => void;
  onSplitOrder?: () => void;
  onReopenOrder?: () => void;
  onRestoreOrder?: () => void;
  onContinueEditing?: () => void;
  autoBikeCount?: number;
  autoPartCount?: number;
  /** Auto-calculated weight (sum of sku_metadata.weight_lbs × qty + pallets).
   *  Shown as placeholder when the user hasn't entered a manual override. */
  autoWeight?: number;
}

type EditableField =
  | 'customer'
  | 'address'
  | 'load'
  | 'transport'
  | 'bikes'
  | 'parts'
  | 'pallets'
  | 'weight'
  | null;

const CopyButton: React.FC<{ value: string; label: string }> = ({ value, label }) => {
  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value.trim()) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error('Could not copy');
    }
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-accent hover:bg-accent/10 transition-all active:scale-90"
    >
      <Copy size={13} />
    </button>
  );
};

const SaveCheckmark: React.FC<{ show: boolean }> = ({ show }) => {
  if (!show) return null;
  return (
    <div className="animate-in fade-in duration-200">
      <Check size={16} className="text-green-500" />
    </div>
  );
};

const StatField: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  editing: boolean;
  onEdit: () => void;
  onChange: (v: string) => void;
  onBlur?: () => void;
  editRef?: React.Ref<HTMLDivElement>;
  colorClass: string;
  min?: string;
  showSaveCheckmark?: boolean;
}> = ({
  label,
  value,
  placeholder,
  editing,
  onEdit,
  onChange,
  onBlur,
  editRef,
  colorClass,
  min = '0',
  showSaveCheckmark = false,
}) => (
  <div ref={editRef} className="flex flex-col gap-1">
    {editing ? (
      <input
        autoFocus
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        className={`w-20 bg-main border border-subtle rounded-2xl py-2 text-center font-heading text-2xl font-bold ${colorClass} ios-transition focus:border-current shadow-sm focus:bg-surface`}
      />
    ) : (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          className="text-left hover:opacity-80 transition-opacity"
        >
          <span className={`font-heading text-2xl font-bold ${colorClass}`}>
            {value || placeholder || 0}
          </span>
        </button>
        <SaveCheckmark show={showSaveCheckmark} />
      </div>
    )}
    <span className="text-[10px] font-black uppercase tracking-widest text-muted">{label}</span>
  </div>
);

/**
 * Consolidated, always-legible order card for the Ship screen. Every field is
 * editable by clicking directly on it — there is no separate "Edit mode"
 * toggle. Only one field is open for editing at a time; clicking outside the
 * active field closes it back to its read view.
 */
export const ShipOrderCard: React.FC<ShipOrderCardProps> = ({
  formData,
  setFormData,
  selectedOrder,
  selectedCustomerId,
  user,
  takeOverOrder,
  onRefresh,
  onDelete,
  onSplitOrder,
  onReopenOrder,
  onRestoreOrder,
  onContinueEditing,
  autoBikeCount = 0,
  autoPartCount = 0,
  autoWeight = 0,
}) => {
  const [editingField, setEditingField] = useState<EditableField>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isUpdatingCarrier, setIsUpdatingCarrier] = useState(false);
  const [justSavedField, setJustSavedField] = useState<string | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const clearSaveRef = useRef<NodeJS.Timeout | null>(null);
  const { deleteList } = usePickingSession();
  const { showConfirmation } = useConfirmation();
  const navigate = useNavigate();

  const { addresses } = useCustomerAddresses(selectedCustomerId);

  // Close whichever field is being edited when the selected order changes,
  // so switching orders in the list never leaves a stale field open.
  useEffect(() => {
    setEditingField(null);
  }, [selectedOrder?.id]);

  // Close the active field on outside click — same pattern already used
  // elsewhere in this app for dropdowns (mousedown so it fires before the
  // click that opens a different field).
  useEffect(() => {
    if (!editingField) return;
    const handler = (e: MouseEvent) => {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        setEditingField(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingField]);

  const filteredAddresses = addresses.filter((addr) => {
    if (!formData.street.trim()) return true;
    const q = formData.street.toLowerCase();
    return (
      addr.street.toLowerCase().includes(q) ||
      (addr.city || '').toLowerCase().includes(q) ||
      (addr.state || '').toLowerCase().includes(q)
    );
  });

  const selectAddress = useCallback(
    (addr: CustomerAddress) => {
      setFormData({
        ...formData,
        street: addr.street,
        city: addr.city || '',
        state: addr.state || '',
        zip: addr.zip_code || '',
      });
      setShowAddressDropdown(false);
      setHighlightedIndex(-1);
      setEditingField(null);
    },
    [formData, setFormData]
  );

  const handleAddressKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!showAddressDropdown || filteredAddresses.length === 0) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredAddresses.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && highlightedIndex >= 0) {
        e.preventDefault();
        selectAddress(filteredAddresses[highlightedIndex]);
      } else if (e.key === 'Escape') {
        setShowAddressDropdown(false);
      }
    },
    [showAddressDropdown, filteredAddresses, highlightedIndex, selectAddress]
  );

  // Auto-save form changes to DB with debounce
  const handleAutoSave = useCallback(
    async (fieldName?: string) => {
      try {
        const palletsNum = parseInt(formData.pallets, 10) || 1;
        const unitsNum = parseInt(formData.bikes, 10) + parseInt(formData.parts, 10) || 0;
        const weightNum = formData.weight.trim() ? parseFloat(formData.weight) : null;

        // Save picking_lists fields
        const { error: plError } = await supabase
          .from('picking_lists')
          .update({
            pallets_qty: palletsNum,
            total_units: unitsNum,
            total_weight_lbs: weightNum,
            load_number: formData.loadNumber || null,
            transport_company: formData.transportCompany || null,
          })
          .eq('id', selectedOrder.id);

        if (plError) throw plError;

        // Save customer name if changed
        if (selectedCustomerId && formData.customerName.trim()) {
          const { error: custError } = await supabase
            .from('customers')
            .update({ name: formData.customerName })
            .eq('id', selectedCustomerId);

          if (custError) console.error('Failed to update customer name:', custError);
        }

        // Save address if any address field changed and customer exists
        if (
          selectedCustomerId &&
          (formData.street.trim() ||
            formData.city.trim() ||
            formData.state.trim() ||
            formData.zip.trim())
        ) {
          await saveCustomerAddress({
            customerId: selectedCustomerId,
            street: formData.street,
            city: formData.city,
            state: formData.state,
            zip: formData.zip,
          });
        }

        // Show success feedback
        if (fieldName) {
          setJustSavedField(fieldName);
          if (clearSaveRef.current) clearTimeout(clearSaveRef.current);
          clearSaveRef.current = setTimeout(() => {
            setJustSavedField(null);
          }, 2000);
        }
      } catch (err) {
        console.error('Auto-save failed:', err);
        toast.error('Failed to save changes');
      }
    },
    [formData, selectedOrder.id, selectedCustomerId]
  );

  // Debounced auto-save on blur
  const triggerAutoSave = useCallback(
    (fieldName?: string) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        handleAutoSave(fieldName);
      }, 500); // 500ms delay before saving
    },
    [handleAutoSave]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      if (clearSaveRef.current) clearTimeout(clearSaveRef.current);
    };
  }, []);

  if (!selectedOrder) return null;

  const handleStreetChange = (value: string) => {
    const parsed = parseUSAddress(value);
    if (parsed) {
      setFormData({ ...formData, ...parsed });
      setShowAddressDropdown(false);
      return;
    }
    setFormData({ ...formData, street: value });
  };

  const handleDelete = () => {
    showConfirmation(
      'Delete Order',
      'Mark this order as cancelled? Any picked units will be returned to inventory. Only do this if the order has NOT shipped.',
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

  const handleCarrierChange = async (company: string) => {
    const newCompany = formData.transportCompany === company ? '' : company;
    setFormData({
      ...formData,
      transportCompany: newCompany,
    });
    setEditingField(null);

    // If selecting FEDEX, update order_group to fedex type
    // If deselecting FEDEX or selecting another, clear the order_group
    if (newCompany === 'FEDEX') {
      setIsUpdatingCarrier(true);
      try {
        // Create or update order_group with type 'fedex'
        const { data: group, error: groupError } = await supabase
          .from('order_groups')
          .insert({ group_type: 'fedex' })
          .select()
          .single();

        if (groupError) throw groupError;

        // Link the order to this fedex group
        const { error: updateError } = await supabase
          .from('picking_lists')
          .update({ group_id: group.id })
          .eq('id', selectedOrder.id);

        if (updateError) throw updateError;
        onRefresh();
        toast.success('Order set to FedEx');
      } catch (err) {
        console.error('Failed to update carrier:', err);
        toast.error('Failed to update carrier');
      } finally {
        setIsUpdatingCarrier(false);
      }
    } else if (formData.transportCompany === 'FEDEX' && newCompany !== 'FEDEX') {
      // Deselecting FEDEX or switching to another carrier — remove from fedex group
      setIsUpdatingCarrier(true);
      try {
        const { error } = await supabase
          .from('picking_lists')
          .update({ group_id: null })
          .eq('id', selectedOrder.id);

        if (error) throw error;
        onRefresh();
        toast.success('Order set to Regular');
      } catch (err) {
        console.error('Failed to update carrier:', err);
        toast.error('Failed to update carrier');
      } finally {
        setIsUpdatingCarrier(false);
      }
    }
  };

  const joinedAddress = [
    formData.street,
    [formData.city, formData.state, formData.zip].filter(Boolean).join(', '),
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="w-full bg-card border border-subtle rounded-3xl p-5 md:p-7 flex flex-col gap-5 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent/5 blur-[100px] pointer-events-none" />

      {selectedOrder.user_id !== user?.id &&
        ['active', 'ready_to_double_check', 'double_checking'].includes(selectedOrder.status) && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-3">
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

      {/* Order # + status */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="font-mono text-2xl font-black text-content tracking-tight">
          #{selectedOrder.order_number}
        </span>
        <OrderStatusPill status={selectedOrder.status} />
      </div>

      {/* Customer name — click to edit */}
      <div
        ref={editingField === 'customer' ? editRef : undefined}
        className="flex items-center gap-2"
      >
        {editingField === 'customer' ? (
          <div className="flex-1 min-w-0">
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
                  setSelectedCustomerId(customer.id || null);
                  if (customer.id) {
                    setEditingField(null);
                    triggerAutoSave('customer');
                  }
                } else {
                  setFormData({ ...formData, customerName: '' });
                }
              }}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setEditingField('customer')}
              className="text-left flex-1 min-w-0"
            >
              <span className="text-xl font-black text-content hover:text-accent transition-colors truncate block">
                {formData.customerName || (
                  <span className="text-muted/50 italic font-semibold">Add customer…</span>
                )}
              </span>
            </button>
            <SaveCheckmark show={justSavedField === 'customer'} />
          </div>
        )}
        <CopyButton value={formData.customerName} label="Customer name" />
      </div>

      {/* Address — click to edit, joined when reading */}
      <div
        ref={editingField === 'address' ? editRef : undefined}
        className="flex items-start gap-2 pb-4 border-b border-dashed border-subtle"
      >
        {editingField === 'address' ? (
          <div className="flex-1 flex flex-col gap-3">
            <div className="relative flex items-center">
              <input
                autoFocus
                type="text"
                value={formData.street}
                onChange={(e) => handleStreetChange(e.target.value)}
                onBlur={() => triggerAutoSave('street')}
                onFocus={() => {
                  if (addresses.length > 0) {
                    setShowAddressDropdown(true);
                    setHighlightedIndex(-1);
                  }
                }}
                onKeyDown={handleAddressKeyDown}
                placeholder="Paste full address to auto-fill..."
                className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 pr-11 text-base text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
              />
              <button
                type="button"
                onClick={() => handleStreetChange(formData.street)}
                title="Parse address"
                className="absolute right-2 w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-accent hover:bg-accent/10 transition-all active:scale-90"
              >
                <Wand2 size={14} />
              </button>

              {showAddressDropdown && filteredAddresses.length > 0 && (
                <div className="absolute z-50 w-full top-full mt-1 bg-surface border border-subtle rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="max-h-48 overflow-y-auto">
                    {filteredAddresses.map((addr, idx) => (
                      <button
                        key={addr.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectAddress(addr)}
                        className={`w-full text-left px-4 py-3 transition-colors ${
                          idx === highlightedIndex
                            ? 'bg-accent/10 text-accent'
                            : 'text-content hover:bg-white/5'
                        } ${idx > 0 ? 'border-t border-subtle/50' : ''}`}
                      >
                        <p className="text-sm font-bold truncate">{addr.street}</p>
                        {(addr.city || addr.state || addr.zip_code) && (
                          <p className="text-[10px] text-muted font-bold mt-0.5 truncate">
                            {[addr.city, addr.state, addr.zip_code].filter(Boolean).join(', ')}
                          </p>
                        )}
                        {addr.is_default && (
                          <span className="text-[8px] font-black text-accent/60 uppercase tracking-widest">
                            Default
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <input
              type="text"
              value={formData.city}
              onChange={(e) => setFormData({ ...formData, city: e.target.value })}
              onBlur={() => triggerAutoSave('city')}
              placeholder="City..."
              className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 text-base text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
            />

            <div className="grid grid-cols-2 gap-3">
              <input
                type="text"
                maxLength={2}
                value={formData.state}
                onChange={(e) => setFormData({ ...formData, state: e.target.value.toUpperCase() })}
                onBlur={() => triggerAutoSave('state')}
                placeholder="CA"
                className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 text-base text-content ios-transition font-medium text-center focus:border-accent focus:bg-surface shadow-sm"
              />
              <input
                type="text"
                value={formData.zip}
                onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                onBlur={() => triggerAutoSave('zip')}
                placeholder="00000"
                className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 text-base text-content ios-transition font-medium focus:border-accent focus:bg-surface shadow-sm"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 flex-1 min-w-0">
            <button
              type="button"
              onClick={() => setEditingField('address')}
              className="text-left flex-1 min-w-0 flex items-start gap-2 hover:text-accent transition-colors"
            >
              <MapPin size={15} className="mt-0.5 shrink-0 text-muted" />
              <span className="text-sm text-content font-medium">
                {formData.street || formData.city ? (
                  joinedAddress
                ) : (
                  <span className="text-muted/50 italic">Add shipping address…</span>
                )}
              </span>
            </button>
            {(justSavedField === 'street' ||
              justSavedField === 'city' ||
              justSavedField === 'state' ||
              justSavedField === 'zip') && <SaveCheckmark show={true} />}
          </div>
        )}
        <CopyButton value={joinedAddress} label="Address" />
      </div>

      {/* Load number + Transport — click to edit */}
      <div className="flex flex-wrap items-center gap-3">
        <div ref={editingField === 'load' ? editRef : undefined}>
          {editingField === 'load' ? (
            <input
              autoFocus
              type="text"
              value={formData.loadNumber}
              onChange={(e) =>
                setFormData({ ...formData, loadNumber: e.target.value.toUpperCase() })
              }
              onBlur={() => {
                setEditingField(null);
                triggerAutoSave('load');
              }}
              placeholder="E.G. 127035968"
              className="bg-main border border-subtle rounded-2xl px-4 py-2 text-sm font-bold text-content ios-transition focus:border-accent focus:bg-surface shadow-sm w-48"
            />
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingField('load')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-main border border-subtle text-xs font-black uppercase tracking-widest text-muted hover:text-accent hover:border-accent/40 transition-all"
              >
                <Hash size={11} /> {formData.loadNumber || 'Load #'}
              </button>
              <SaveCheckmark show={justSavedField === 'load'} />
            </div>
          )}
        </div>

        <div ref={editingField === 'transport' ? editRef : undefined}>
          {editingField === 'transport' ? (
            <div className="flex flex-wrap gap-2">
              {TRANSPORT_COMPANIES.map((company) => (
                <button
                  key={company}
                  type="button"
                  disabled={isUpdatingCarrier}
                  onClick={() => handleCarrierChange(company)}
                  className={`px-3 py-1.5 rounded-2xl border text-xs font-black uppercase tracking-widest transition-all ${
                    formData.transportCompany === company
                      ? 'bg-accent text-main border-accent ring-2 ring-accent'
                      : 'bg-main text-muted border-subtle hover:border-accent/50 hover:text-content'
                  } ${isUpdatingCarrier ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {company}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEditingField('transport')}
                className="flex items-center gap-1.5 px-3 py-2 rounded-2xl bg-main border border-subtle text-xs font-black uppercase tracking-widest text-muted hover:text-accent hover:border-accent/40 transition-all"
              >
                <Truck size={11} /> {formData.transportCompany || 'Carrier'}
              </button>
              <SaveCheckmark show={justSavedField === 'transport'} />
            </div>
          )}
        </div>
      </div>

      {/* Stats — click any figure to edit */}
      <div className="flex flex-wrap gap-6 pt-4 border-t border-dashed border-subtle">
        <StatField
          label="Pallets"
          value={formData.pallets}
          editing={editingField === 'pallets'}
          onEdit={() => setEditingField('pallets')}
          onChange={(v) => setFormData({ ...formData, pallets: v })}
          onBlur={() => {
            setEditingField(null);
            triggerAutoSave('pallets');
          }}
          editRef={editingField === 'pallets' ? editRef : undefined}
          colorClass="text-[#22c55e]"
          min="1"
          showSaveCheckmark={justSavedField === 'pallets'}
        />
        <StatField
          label="Bikes"
          value={formData.bikes}
          placeholder={String(autoBikeCount)}
          editing={editingField === 'bikes'}
          onEdit={() => setEditingField('bikes')}
          onChange={(v) => setFormData({ ...formData, bikes: v })}
          onBlur={() => {
            setEditingField(null);
            triggerAutoSave('bikes');
          }}
          editRef={editingField === 'bikes' ? editRef : undefined}
          colorClass="text-blue-400"
          showSaveCheckmark={justSavedField === 'bikes'}
        />
        <StatField
          label="Parts"
          value={formData.parts}
          placeholder={String(autoPartCount)}
          editing={editingField === 'parts'}
          onEdit={() => setEditingField('parts')}
          onChange={(v) => setFormData({ ...formData, parts: v })}
          onBlur={() => {
            setEditingField(null);
            triggerAutoSave('parts');
          }}
          editRef={editingField === 'parts' ? editRef : undefined}
          colorClass="text-orange-400"
          showSaveCheckmark={justSavedField === 'parts'}
        />
        <div className="flex items-end gap-2">
          <StatField
            label="Weight (lbs)"
            value={formData.weight}
            placeholder={autoWeight > 0 ? String(autoWeight) : '0'}
            editing={editingField === 'weight'}
            onEdit={() => setEditingField('weight')}
            onChange={(v) => setFormData({ ...formData, weight: v })}
            onBlur={() => {
              setEditingField(null);
              triggerAutoSave('weight');
            }}
            editRef={editingField === 'weight' ? editRef : undefined}
            colorClass="text-purple-400"
            showSaveCheckmark={justSavedField === 'weight'}
          />
          <CopyButton
            value={String(formData.weight || (autoWeight > 0 ? autoWeight : 0))}
            label="Weight"
          />
        </div>
      </div>

      {/* Combined Order Info */}
      {selectedOrder.combine_meta?.is_combined && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl space-y-2">
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

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
        <button
          onClick={() => {
            // Navigate to Orders board and search for this order
            navigate('/orders', { state: { searchQuery: selectedOrder.order_number } });
          }}
          className="flex-1 min-w-[160px] flex items-center justify-center gap-2 h-12 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-blue-500 transition-all active:scale-95"
        >
          <span>Picking Summary</span>
        </button>

        {onReopenOrder && selectedOrder.status === 'completed' && (
          <button
            onClick={onReopenOrder}
            className="flex-1 min-w-[160px] flex items-center justify-center gap-2 h-12 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-orange-400 transition-all active:scale-95"
          >
            <RotateCcw size={14} />
            <span>Reopen Order</span>
          </button>
        )}

        {onRestoreOrder && selectedOrder.status === 'cancelled' && (
          <button
            onClick={onRestoreOrder}
            className="flex-1 min-w-[160px] flex items-center justify-center gap-2 h-12 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-orange-400 transition-all active:scale-95"
          >
            <RotateCcw size={14} />
            <span>Restore Order</span>
          </button>
        )}

        {onContinueEditing && selectedOrder.status === 'reopened' && (
          <button
            onClick={onContinueEditing}
            className="flex-1 min-w-[160px] flex items-center justify-center gap-2 h-12 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-orange-400 transition-all active:scale-95"
          >
            <RotateCcw size={14} />
            <span>
              {selectedOrder.user_id !== user?.id ? 'Take Over & Edit' : 'Continue Editing'}
            </span>
          </button>
        )}

        <button
          onClick={handleDelete}
          className="flex-1 min-w-[160px] flex items-center justify-center gap-2 h-12 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-red-500 transition-all active:scale-95"
        >
          <Trash2 size={14} />
          <span>Delete Order</span>
        </button>
      </div>
    </div>
  );
};
