import React, { useState, useRef, useCallback, useEffect } from 'react';
import { orderColorFor } from '../../utils/orderColors';
import { CombinedOrderNumbers } from './CombinedOrderNumbers';
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
import MessageSquareWarning from 'lucide-react/dist/esm/icons/message-square-warning';
import Send from 'lucide-react/dist/esm/icons/send';
import Eye from 'lucide-react/dist/esm/icons/eye';
import X from 'lucide-react/dist/esm/icons/x';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { CustomerAutocomplete } from '../../features/picking/components/CustomerAutocomplete';
import { usePickingSession } from '../../context/PickingContext';
import { useConfirmation } from '../../context/ConfirmationContext';
import { parseUSAddress } from '../../utils/parseUSAddress';
import { useCustomerAddresses } from '../../hooks/useCustomerAddresses';
import { getPavExpressZone } from '../../utils/pavExpressZones';
import { OrderStatusPill } from './OrderStatusPill';
import { TransportLogo } from './TransportLogo';
import { getCarrierBrandColors, normalizeCompany } from './transportLogos';
import { detectSmsPlatform } from '../../utils/shipOutSms';
import {
  DAYLIGHT_CONTACT_NAME,
  DAYLIGHT_CONTACT_PHONE_DISPLAY,
  buildDaylightPickupSmsBody,
  buildDaylightPickupSmsUrl,
} from '../../utils/daylightPickupSms';
import { OrderProgressBar } from '../../features/picking/components/OrderProgressBar';
import type { CustomerAddress } from '../../lib/customerAddresses';
import type { CombineMeta, PickingList, PickingListItem } from '../../schemas/picking.schema';
import { PalletPhotosBlock } from './PalletPhotosBlock';
import type { Customer } from '../../types/schema';
import type { User } from '@supabase/supabase-js';
import { isDeliberateCombineGroupType } from '../../utils/shippingClassification';

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
  'PICK UP',
] as const;

interface SelectedOrder extends PickingList {
  user?: { full_name?: string } | null;
  combine_meta?: CombineMeta;
  is_waiting_inventory?: boolean | null;
  is_shipped?: boolean | null;
  order_group?: { group_type: string | null } | null;
}

interface ShipOrderCardProps {
  formData: OrderFormData;
  setFormData: (data: OrderFormData) => void;
  selectedOrder: SelectedOrder;
  selectedCustomerId: string | null;
  user: User | null;
  onRefresh: () => void;
  onDelete: () => void;
  /** Persist the current form to the DB. Owned by ShipScreen so the auto-save
   *  writes to the exact same places as the print flow. `overrides` patches
   *  the form for values that were just set in the same tick (React state
   *  hasn't flushed yet); `pickedCustomerId` links an existing customer
   *  chosen from the autocomplete. Resolves true when the save succeeded. */
  onAutoSave: (
    overrides?: Partial<OrderFormData>,
    pickedCustomerId?: string | null
  ) => Promise<boolean>;
  onSplitOrder?: () => void;
  onUncombineGroup?: (groupId: string) => void;
  onViewOrder?: () => void;
  onShowPickingSummary?: () => void;
  onReopenOrder?: () => void;
  onRestoreOrder?: () => void;
  onContinueEditing?: () => void;
  onAddPhoto?: () => void;
  isAddingPhoto?: boolean;
  autoBikeCount?: number;
  autoPartCount?: number;
  /** Auto-calculated weight (sum of sku_metadata.weight_lbs × qty + pallets).
   *  Shown as placeholder when the user hasn't entered a manual override. */
  autoWeight?: number;
  /** Click-to-filter state for a combined order, shared with the rest of
   *  this screen (ShipScreen owns one useCombinedOrderFilter instance). */
  activeOrderFilter?: string | null;
  onToggleOrderFilter?: (orderNumber: string) => void;
  /** Current FedEx classification (same isFedexOrder signal used for the
   *  purple/green board treatment) — gates the "you sure?" prompt when
   *  switching away from FedEx below. */
  isFedexOrder?: boolean;
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
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-accent transition-colors duration-150 active:scale-90"
    >
      <Copy size={13} />
    </button>
  );
};

// Fixed-size wrapper always in the layout (opacity toggle, not mount/unmount)
// so appearing after a save never shifts the neighboring copy button or text.
const SaveCheckmark: React.FC<{ show: boolean }> = ({ show }) => (
  <div
    className={`shrink-0 w-4 h-4 flex items-center justify-center transition-opacity duration-200 ${
      show ? 'opacity-100' : 'opacity-0'
    }`}
    aria-hidden={!show}
  >
    <Check size={16} className="text-green-500" />
  </div>
);

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
        className={`w-32 bg-main border border-subtle rounded-2xl py-2 text-center font-heading text-7xl font-bold ${colorClass} transition-colors duration-150 focus:border-current shadow-sm focus:bg-surface [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      />
    ) : (
      <div className="flex items-center gap-2">
        <button type="button" onClick={onEdit} className="group text-left">
          {/* Hover recolors the text only (like the address field) — no
              opacity/filter hovers anywhere on these read views, they
              promote the element to its own GPU layer and glitched as a
              black box over the field on some devices. */}
          <span
            className={`font-heading text-7xl font-bold ${colorClass} group-hover:text-accent transition-colors duration-150`}
          >
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
  onRefresh,
  onDelete,
  onAutoSave,
  onSplitOrder,
  onUncombineGroup,
  onViewOrder,
  onShowPickingSummary,
  onReopenOrder,
  onRestoreOrder,
  onContinueEditing,
  onAddPhoto,
  isAddingPhoto = false,
  autoBikeCount = 0,
  autoPartCount = 0,
  autoWeight = 0,
  activeOrderFilter = null,
  onToggleOrderFilter,
  isFedexOrder = false,
}) => {
  const [editingField, setEditingField] = useState<EditableField>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isUpdatingCarrier, setIsUpdatingCarrier] = useState(false);
  const [justSavedField, setJustSavedField] = useState<string | null>(null);
  const [isPavBannerDismissed, setIsPavBannerDismissed] = useState(false);
  // Pallet count the operator confirmed they texted to Luis, or null while
  // the Daylight reminder is still outstanding. We keep the NUMBER rather
  // than a boolean so editing the pallet count after confirming re-arms the
  // reminder — otherwise Luis shows up for a truckload that changed size.
  const [daylightTextedPallets, setDaylightTextedPallets] = useState<number | null>(null);
  const editRef = useRef<HTMLDivElement>(null);
  const clearSaveRef = useRef<NodeJS.Timeout | null>(null);
  const { deleteList } = usePickingSession();
  const { showConfirmation } = useConfirmation();

  const { addresses } = useCustomerAddresses(selectedCustomerId);

  // Persist via the parent (same code path as the print flow), then flash a
  // green check next to the saved field for a couple of seconds.
  const saveField = useCallback(
    async (field: string, overrides?: Partial<OrderFormData>, pickedCustomerId?: string | null) => {
      const ok = await onAutoSave(overrides, pickedCustomerId);
      if (ok) {
        setJustSavedField(field);
        if (clearSaveRef.current) clearTimeout(clearSaveRef.current);
        clearSaveRef.current = setTimeout(() => setJustSavedField(null), 2000);
      }
    },
    [onAutoSave]
  );

  useEffect(() => {
    return () => {
      if (clearSaveRef.current) clearTimeout(clearSaveRef.current);
    };
  }, []);

  // Close whichever field is being edited and reset PAV banner state when selected order changes
  useEffect(() => {
    setEditingField(null);
    setIsPavBannerDismissed(false);
    setDaylightTextedPallets(null);
  }, [selectedOrder?.id]);

  const isPavOutOfZone = React.useMemo(() => {
    if (!formData.zip || formData.zip.trim().length < 3) return false;
    return getPavExpressZone(formData.zip) === null;
  }, [formData.zip]);

  const showPavWarningBanner =
    !isPavBannerDismissed && !formData.transportCompany && !isFedexOrder && isPavOutOfZone;

  // Daylight only rolls a truck once someone texts the dispatcher how many
  // pallets to come get, so the carrier picker nags until the operator says
  // they sent it. Same shape as the PAV banner above: pure front-end state,
  // no persistence — picking DAYLIGHT is what arms it. Already-shipped orders
  // are skipped: the truck has been and gone.
  const daylightPallets = parseInt(formData.pallets, 10) || 1;
  const showDaylightSmsReminder =
    normalizeCompany(formData.transportCompany) === 'DAYLIGHT' &&
    !selectedOrder?.is_shipped &&
    daylightTextedPallets !== daylightPallets;
  const daylightSmsBody = buildDaylightPickupSmsBody(daylightPallets);

  // Opening Messages is NOT the same as having sent the text, so this
  // deliberately leaves the reminder up — only "I sent it" clears it.
  const handleSendDaylightSms = useCallback(() => {
    const platform = detectSmsPlatform(navigator.userAgent || '');
    window.location.href = buildDaylightPickupSmsUrl(daylightSmsBody, platform);
  }, [daylightSmsBody]);

  // Close the active field on outside click — same pattern already used
  // elsewhere in this app for dropdowns (mousedown so it fires before the
  // click that opens a different field). The save MUST be triggered here,
  // not only on the inputs' onBlur: closing the editor unmounts the input
  // before the browser dispatches blur, so onBlur alone silently misses the
  // most common gesture (click elsewhere after typing).
  useEffect(() => {
    if (!editingField) return;
    const field = editingField;
    const handler = (e: MouseEvent) => {
      if (editRef.current && !editRef.current.contains(e.target as Node)) {
        setEditingField(null);
        // 'customer' is the exception: a half-typed name must not rename or
        // spawn a customer record — it only saves via autocomplete selection.
        if (field !== 'customer') void saveField(field);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [editingField, saveField]);

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
      const patch = {
        street: addr.street,
        city: addr.city || '',
        state: addr.state || '',
        zip: addr.zip_code || '',
      };
      setFormData({ ...formData, ...patch });
      setShowAddressDropdown(false);
      setHighlightedIndex(-1);
      setEditingField(null);
      void saveField('address', patch);
    },
    [formData, setFormData, saveField]
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

  const applyCarrierChange = (company: string) => {
    const newCompany = formData.transportCompany === company ? '' : company;
    setFormData({
      ...formData,
      transportCompany: newCompany,
    });
    setEditingField(null);
    // Persist immediately with the new value as an override — formData in
    // this closure still holds the previous carrier.
    void saveField('transport', { transportCompany: newCompany });

    // If selecting FEDEX, update order_group to fedex type
    // If deselecting FEDEX or selecting another, clear the order_group
    if (newCompany === 'FEDEX') {
      setIsUpdatingCarrier(true);
      (async () => {
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
      })();
    } else if (isFedexOrder && newCompany !== 'FEDEX') {
      // Was FedEx (by any signal — explicit carrier, fedex group, or
      // item-based auto-classify), now switching to a non-FedEx carrier.
      // Confirmed via handleCarrierChange below before we ever get here.
      setIsUpdatingCarrier(true);
      (async () => {
        try {
          const groupId = selectedOrder.group_id;
          const isDeliberateGroup = isDeliberateCombineGroupType(
            selectedOrder.order_group?.group_type
          );

          if (groupId && isDeliberateGroup) {
            // A real combined order (Quick Group / combine-suggestion) —
            // both members become regular; the group stays linked, this
            // isn't a split.
            const { error } = await supabase
              .from('picking_lists')
              .update({ shipping_type: 'regular' })
              .eq('group_id', groupId);
            if (error) throw error;
          } else {
            // Solo order, or sitting in the operational FedEx-lane bucket
            // (which may hold other customers' unrelated orders — leave
            // those alone, only detach this one and mark it regular).
            const { error } = await supabase
              .from('picking_lists')
              .update({ shipping_type: 'regular', group_id: null })
              .eq('id', selectedOrder.id);
            if (error) throw error;
          }

          onRefresh();
          toast.success('Order set to Regular');
        } catch (err) {
          console.error('Failed to update carrier:', err);
          toast.error('Failed to update carrier');
        } finally {
          setIsUpdatingCarrier(false);
        }
      })();
    }
  };

  const handleCarrierChange = (company: string) => {
    const newCompany = formData.transportCompany === company ? '' : company;

    if (isFedexOrder && newCompany !== 'FEDEX') {
      showConfirmation(
        `Ship via ${newCompany || 'no carrier'} instead of FedEx?`,
        `This order has only ${autoBikeCount} bike${autoBikeCount === 1 ? '' : 's'}. Are you sure you want to send it with ${newCompany || 'no carrier'} instead of FedEx?`,
        () => applyCarrierChange(company),
        () => {},
        'Yes, switch carrier',
        'Cancel',
        'warning'
      );
      return;
    }

    applyCarrierChange(company);
  };

  return (
    <div className="w-full bg-card border border-subtle rounded-3xl p-5 md:p-7 flex flex-col gap-5 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent/5 blur-[100px] pointer-events-none" />

      {selectedOrder.user_id !== user?.id &&
        ['active', 'ready_to_double_check', 'double_checking'].includes(selectedOrder.status) && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-4">
            <div className="flex items-center gap-2 text-amber-600">
              <HandMetal size={16} />
              <p className="text-xs font-black uppercase tracking-tight">
                By {selectedOrder.user?.full_name || 'Another User'}
              </p>
            </div>

            <OrderProgressBar
              status={selectedOrder.status}
              isShipped={selectedOrder.is_shipped ?? false}
              items={selectedOrder.items}
              verifiedKeys={selectedOrder.verified_item_keys ?? null}
              totalUnits={selectedOrder.total_units || 0}
              className="w-full"
            />

            <button
              type="button"
              onClick={onViewOrder}
              className="w-full py-3 bg-amber-500/15 text-amber-600 border border-amber-500/30 text-[10px] font-black uppercase tracking-widest rounded-lg shadow-sm hover:bg-amber-500 hover:text-white active:scale-95 transition-all flex items-center justify-center gap-2"
            >
              <Eye size={14} />
              View Order
            </button>
          </div>
        )}

      {/* Top Header Section: Status, Customer, Address on left + Pallet Photos on right */}
      <div className="flex flex-col sm:flex-row gap-5 lg:gap-6 items-start justify-between w-full">
        <div className="w-full lg:flex-1 min-w-0 flex flex-col gap-4">
          {/* Status — order number now lives in the LivePrintPreview block above.
              When shipped, the shipped logo shows in the header row above (right
              side), so we skip it here to avoid duplicating it. */}
          {!selectedOrder.is_shipped && (
            <div className="flex items-start gap-4">
              <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
                <OrderStatusPill
                  status={selectedOrder.status}
                  is_waiting_inventory={selectedOrder.is_waiting_inventory}
                  is_shipped={selectedOrder.is_shipped}
                />
              </div>
            </div>
          )}

          {/* Customer name — click to edit */}
          <div
            ref={editingField === 'customer' ? editRef : undefined}
            className="flex items-center gap-2"
          >
            <CopyButton value={formData.customerName} label="Customer name" />
            {editingField === 'customer' ? (
              <div className="flex-1 min-w-0">
                <CustomerAutocomplete
                  value={
                    formData.customerName ? ({ name: formData.customerName } as Customer) : null
                  }
                  onChange={(customer) => {
                    if (customer) {
                      const patch = {
                        customerName: customer.name,
                        street: customer.street || formData.street,
                        city: customer.city || formData.city,
                        state: customer.state || formData.state,
                        zip: customer.zip_code || formData.zip,
                      };
                      setFormData({ ...formData, ...patch });
                      if (customer.id) {
                        setEditingField(null);
                        // Pass the patch + picked id explicitly: React state
                        // hasn't flushed yet, and the id links the existing
                        // customer instead of cloning it as a new one.
                        void saveField('customer', patch, customer.id);
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
                    onBlur={() => void saveField('street')}
                    onFocus={() => {
                      if (addresses.length > 0) {
                        setShowAddressDropdown(true);
                        setHighlightedIndex(-1);
                      }
                    }}
                    onKeyDown={handleAddressKeyDown}
                    placeholder="Paste full address to auto-fill..."
                    className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 pr-11 text-base text-content transition-colors duration-150 font-medium focus:border-accent focus:bg-surface shadow-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleStreetChange(formData.street)}
                    title="Parse address"
                    className="absolute right-2 w-7 h-7 flex items-center justify-center rounded-full text-muted hover:text-accent transition-colors duration-150 active:scale-90"
                  >
                    <Wand2 size={14} />
                  </button>
                </div>

                {/* In normal flow (not absolutely positioned) so it pushes
                city/state/zip down instead of floating over them and
                hiding the fields the user is trying to edit. */}
                {showAddressDropdown && filteredAddresses.length > 0 && (
                  <div className="bg-surface border border-subtle rounded-2xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
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

                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  onBlur={() => void saveField('city')}
                  placeholder="City..."
                  className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 text-base text-content transition-colors duration-150 font-medium focus:border-accent focus:bg-surface shadow-sm"
                />

                <div className="grid grid-cols-2 gap-3">
                  <input
                    type="text"
                    maxLength={2}
                    value={formData.state}
                    onChange={(e) =>
                      setFormData({ ...formData, state: e.target.value.toUpperCase() })
                    }
                    onBlur={() => void saveField('state')}
                    placeholder="CA"
                    className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 text-base text-content transition-colors duration-150 font-medium text-center focus:border-accent focus:bg-surface shadow-sm"
                  />
                  <input
                    type="text"
                    value={formData.zip}
                    onChange={(e) => setFormData({ ...formData, zip: e.target.value })}
                    onBlur={() => void saveField('zip')}
                    placeholder="00000"
                    className="w-full bg-main border border-subtle rounded-2xl px-4 py-3 text-base text-content transition-colors duration-150 font-medium focus:border-accent focus:bg-surface shadow-sm"
                  />
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-1 flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <CopyButton value={formData.street} label="Street" />
                  <button
                    type="button"
                    onClick={() => setEditingField('address')}
                    className="text-left flex-1 min-w-0 flex items-start gap-2 hover:text-accent transition-colors"
                  >
                    <MapPin size={15} className="mt-0.5 shrink-0 text-muted" />
                    <span className="text-sm text-content font-medium">
                      {formData.street || formData.city ? (
                        [
                          formData.street,
                          [formData.city, formData.state].filter(Boolean).join(', '),
                        ]
                          .filter(Boolean)
                          .join(', ')
                      ) : (
                        <span className="text-muted/50 italic">Add shipping address…</span>
                      )}
                    </span>
                  </button>
                  <SaveCheckmark
                    show={
                      justSavedField === 'address' ||
                      justSavedField === 'street' ||
                      justSavedField === 'city' ||
                      justSavedField === 'state' ||
                      justSavedField === 'zip'
                    }
                  />
                </div>
                {formData.zip && (
                  <div className="flex items-center gap-2 pl-1">
                    <CopyButton value={formData.zip} label="Zip Code" />
                    <button
                      type="button"
                      onClick={() => setEditingField('address')}
                      className="text-xs text-muted/70 font-mono hover:text-accent transition-colors"
                    >
                      ZIP {formData.zip}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Pallet Photos Block — sits next to Customer/Address only */}
        {((selectedOrder.pallet_photos ?? []).length > 0 || onAddPhoto) && (
          <div className="w-full sm:w-auto shrink-0 flex items-start justify-end ml-auto">
            <PalletPhotosBlock
              photos={selectedOrder.pallet_photos ?? []}
              orderNumber={selectedOrder.order_number ?? undefined}
              compact
              className="w-auto"
              onAddPhoto={onAddPhoto}
              isAddingPhoto={isAddingPhoto}
            />
          </div>
        )}
      </div>

      {/* Main Body Section (Load #, Carrier Selector, Stats) — FULL CARD WIDTH (100%) */}
      <div className="flex flex-col gap-5 w-full">
        {/* Load number + Transport — click to edit */}
        <div className="flex flex-col gap-3.5 w-full">
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
                  void saveField('load');
                }}
                placeholder="E.G. 127035968"
                className="bg-main border border-subtle rounded-2xl px-4 py-2 text-sm font-bold text-content transition-colors duration-150 focus:border-accent focus:bg-surface shadow-sm w-48"
              />
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setEditingField('load')}
                  className="flex items-center gap-1.5 text-sm font-bold text-content hover:text-accent transition-colors duration-150"
                >
                  <Hash size={13} className="shrink-0 text-muted" />
                  {formData.loadNumber || (
                    <span className="text-muted/50 italic font-semibold">Add load #…</span>
                  )}
                </button>
                <SaveCheckmark show={justSavedField === 'load'} />
              </div>
            )}
          </div>

          <div className="w-full">
            {/* Carrier selector — always visible, expands 100% full width */}
            <div className="flex flex-col gap-2 w-full">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted flex items-center gap-1.5">
                <Truck size={11} className="text-muted" />
                Carrier
                {isUpdatingCarrier && (
                  <span className="text-[9px] text-muted/50 font-semibold normal-case tracking-normal">
                    saving…
                  </span>
                )}
                <SaveCheckmark show={justSavedField === 'transport'} />
              </span>

              {showPavWarningBanner && (
                <div className="relative flex items-center justify-between gap-3 px-3 py-2 bg-red-500/10 border border-red-500/30 rounded-2xl w-full">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {/* PAV Express Logo crossed out with a thick red line */}
                    <div className="relative shrink-0 w-12 h-6 bg-white rounded flex items-center justify-center p-0.5 overflow-hidden shadow-sm border border-subtle">
                      <img
                        src="/logos/transport/pav.png"
                        alt="PAV Express"
                        className="max-h-full max-w-full object-contain"
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-[140%] h-1 bg-red-600 rotate-[-25deg] shadow-sm rounded-full" />
                      </div>
                    </div>

                    <span className="text-xs font-bold text-red-500 truncate">
                      Outside PAV delivery zones
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsPavBannerDismissed(true)}
                    title="Close warning"
                    aria-label="Close warning"
                    className="shrink-0 p-1 rounded-lg text-muted hover:text-content hover:bg-subtle transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}

              {showDaylightSmsReminder && (
                <div
                  role="alert"
                  className="flex flex-col gap-3 px-3 py-2.5 bg-red-500/10 border border-red-500/40 rounded-2xl w-full sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="relative flex shrink-0 h-2.5 w-2.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
                    </span>
                    <MessageSquareWarning size={18} className="shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase tracking-tight text-red-500">
                        Text {DAYLIGHT_CONTACT_NAME} the pallet count
                      </p>
                      <p className="text-[11px] font-semibold text-red-500/70 truncate">
                        {DAYLIGHT_CONTACT_PHONE_DISPLAY} &middot; &ldquo;{daylightSmsBody}&rdquo;
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={handleSendDaylightSms}
                      className="px-3 h-9 inline-flex items-center gap-1.5 rounded-xl bg-red-600 text-white text-[10px] font-black uppercase tracking-widest shadow-sm hover:bg-red-500 active:scale-95 transition-all"
                    >
                      <Send size={12} />
                      Send text
                    </button>
                    <button
                      type="button"
                      onClick={() => setDaylightTextedPallets(daylightPallets)}
                      className="px-3 h-9 inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 text-red-500 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 active:scale-95 transition-all"
                    >
                      <Check size={12} />I sent it
                    </button>
                  </div>
                </div>
              )}

              <div className="w-full flex flex-wrap items-center gap-2">
                {TRANSPORT_COMPANIES.map((company) => {
                  const isSelected = formData.transportCompany === company;
                  const hasSelection = Boolean(formData.transportCompany);
                  const brand = getCarrierBrandColors(company);

                  let styleClasses = '';
                  if (isSelected) {
                    styleClasses = `bg-white ${brand.border} ring-2 ${brand.ring} ${brand.shadow} opacity-100 scale-105 z-10`;
                  } else if (hasSelection) {
                    styleClasses =
                      'bg-main/60 border-subtle opacity-40 grayscale contrast-75 hover:opacity-100 hover:grayscale-0 hover:contrast-100 hover:border-content/30';
                  } else {
                    styleClasses =
                      'bg-main border-subtle opacity-100 hover:border-content/30 hover:bg-surface';
                  }

                  return (
                    <button
                      key={company}
                      type="button"
                      disabled={isUpdatingCarrier}
                      onClick={() => handleCarrierChange(company)}
                      title={company}
                      aria-label={`Select carrier ${company}`}
                      className={`shrink-0 px-4 h-11 rounded-2xl border inline-flex items-center justify-center transition-all duration-200 active:scale-95 ${styleClasses} ${
                        isUpdatingCarrier ? 'cursor-not-allowed' : ''
                      }`}
                    >
                      <TransportLogo
                        company={company}
                        height={26}
                        plain
                        textColor={
                          company === 'PICK UP'
                            ? 'text-red-500 font-black tracking-wider'
                            : isSelected
                              ? 'text-content font-black'
                              : 'text-muted font-bold'
                        }
                      />
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Stats — click any figure to edit */}
        <div className="flex flex-wrap gap-6 pt-4 border-t border-dashed border-subtle w-full">
          <StatField
            label="Pallets"
            value={formData.pallets}
            editing={editingField === 'pallets'}
            onEdit={() => setEditingField('pallets')}
            onChange={(v) => setFormData({ ...formData, pallets: v })}
            onBlur={() => {
              setEditingField(null);
              void saveField('pallets');
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
              void saveField('bikes');
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
              void saveField('parts');
            }}
            editRef={editingField === 'parts' ? editRef : undefined}
            colorClass="text-orange-400"
            showSaveCheckmark={justSavedField === 'parts'}
          />
          <div className="flex items-end gap-2">
            <CopyButton
              value={String(formData.weight || (autoWeight > 0 ? autoWeight : 0))}
              label="Weight"
            />
            <StatField
              label="Weight (lbs)"
              value={formData.weight}
              placeholder={autoWeight > 0 ? String(autoWeight) : '0'}
              editing={editingField === 'weight'}
              onEdit={() => setEditingField('weight')}
              onChange={(v) => setFormData({ ...formData, weight: v })}
              onBlur={() => {
                setEditingField(null);
                void saveField('weight');
              }}
              editRef={editingField === 'weight' ? editRef : undefined}
              colorClass="text-purple-400"
              showSaveCheckmark={justSavedField === 'weight'}
            />
          </div>
        </div>
      </div>

      {/* Combined Order Info */}
      {selectedOrder.combine_meta?.is_combined && (
        <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl space-y-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400 flex items-center gap-1.5">
            🔗 Combined Order
          </p>
          {onToggleOrderFilter && (
            <CombinedOrderNumbers
              numbers={selectedOrder.combine_meta?.source_orders?.map((s) => s.order_number) ?? []}
              activeOrderFilter={activeOrderFilter}
              onToggle={onToggleOrderFilter}
              variant="inline"
            />
          )}
          <div className="flex flex-col gap-1">
            {selectedOrder.combine_meta?.source_orders?.map((src, i) => {
              const allNumbers =
                selectedOrder.combine_meta?.source_orders?.map((s) => s.order_number) ?? [];
              const unitCount = (selectedOrder.items || [])
                .filter(
                  (item) =>
                    (item as PickingListItem & { source_order?: string }).source_order ===
                    src.order_number
                )
                .reduce((sum, item) => sum + (item.pickingQty || 0), 0);
              return (
                <span key={i} className="text-xs font-mono">
                  <span style={{ color: orderColorFor(src.order_number, allNumbers).hex }}>
                    #{src.order_number}
                  </span>
                  <span className="text-blue-300/70">
                    {' '}
                    — {unitCount || src.item_count || '?'} units
                  </span>
                </span>
              );
            })}
          </div>
          {/* Split Orders rebuilds each source into its own fresh row from
              combine_meta.source_orders — only correct for a real single-row
              DB-merge. A group_id merge's "order" here is a client-built
              pseudo-order (its siblings are already separate rows); running
              Split on it would insert duplicate rows AND leave the
              non-anchor siblings active/uncancelled. Now that step 3 also
              populates source_orders for group_id merges (for the info
              panel above), this guard is what keeps that combination from
              becoming reachable. */}
          {onSplitOrder && selectedOrder.status !== 'completed' && !selectedOrder.group_id && (
            <button
              onClick={onSplitOrder}
              className="w-full mt-2 flex items-center justify-center gap-2 h-10 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-blue-400 transition-all active:scale-95"
            >
              <Scissors size={12} />
              <span>Split Orders</span>
            </button>
          )}

          {onUncombineGroup && selectedOrder.status !== 'completed' && selectedOrder.group_id && (
            <button
              onClick={() => onUncombineGroup(selectedOrder.group_id!)}
              className="w-full mt-2 flex items-center justify-center gap-2 h-10 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-xl text-[10px] font-black uppercase tracking-widest text-amber-400 hover:text-amber-300 transition-all active:scale-95"
              title="Uncombine group into separate orders"
            >
              <Scissors size={12} />
              <span>Uncombine Group (Separar Órdenes)</span>
            </button>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row flex-wrap gap-3 pt-2">
        <button
          onClick={() => {
            if (onShowPickingSummary) {
              onShowPickingSummary();
            }
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
