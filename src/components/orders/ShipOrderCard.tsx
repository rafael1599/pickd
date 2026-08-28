import React, { useState, useRef, useCallback, useEffect, useLayoutEffect, useMemo } from 'react';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Hash from 'lucide-react/dist/esm/icons/hash';
import HandMetal from 'lucide-react/dist/esm/icons/hand-metal';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';
import { carrierCandidates, fitCarriers } from './carrierPicker';
import Truck from 'lucide-react/dist/esm/icons/truck';
import Wand2 from 'lucide-react/dist/esm/icons/wand-2';
import Check from 'lucide-react/dist/esm/icons/check';
import MessageSquareWarning from 'lucide-react/dist/esm/icons/message-square-warning';
import Send from 'lucide-react/dist/esm/icons/send';
import Eye from 'lucide-react/dist/esm/icons/eye';
import X from 'lucide-react/dist/esm/icons/x';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { CustomerAutocomplete } from '../../features/picking/components/CustomerAutocomplete';
import { useConfirmation } from '../../context/ConfirmationContext';
import { parseUSAddress } from '../../utils/parseUSAddress';
import { useCustomerAddresses } from '../../hooks/useCustomerAddresses';
import { getPavExpressZone } from '../../utils/pavExpressZones';
import type { ElectricBikeLine } from '../../utils/electricBikes';
import { ElectricCartonDeclaration } from './ElectricCartonDeclaration';
import { useFitFontSize } from './useFitFontSize';
import type { ElectricCarton } from './electricCartons';
import { OrderStatusPill } from './OrderStatusPill';
import { CopyButton } from '../ui/CopyButton';
import { FedexRecipientChip } from '../../features/picking/components/FedexRecipientChip';
import { TransportLogo } from './TransportLogo';
import { getCarrierBrandColors, logoNeedsLightBackdrop } from './transportLogos';
import { detectSmsPlatform } from '../../utils/shipOutSms';
import {
  DAYLIGHT_CONTACT_NAME,
  DAYLIGHT_CONTACT_PHONE_DISPLAY,
  buildDaylightPickupSmsBody,
  buildDaylightPickupSmsUrl,
  buildDaylightSentNote,
  daylightNotePallets,
  shouldRemindDaylightPickup,
} from '../../utils/daylightPickupSms';
import { usePickingNotes } from '../../features/picking/hooks/usePickingNotes';
import { OrderProgressBar } from '../../features/picking/components/OrderProgressBar';
import type { CustomerAddress } from '../../lib/customerAddresses';
import type { CombineMeta, PickingList } from '../../schemas/picking.schema';
import { ElectricBikeWarning } from './ElectricBikeWarning';
import { PalletPhotoRail } from './PalletPhotoRail';
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
  /** Present only on the pseudo-order ShipScreen builds for a combined
   *  group — notes are read across every member, written on the anchor. */
  combined_member_ids?: string[];
}

interface ShipOrderCardProps {
  formData: OrderFormData;
  setFormData: (data: OrderFormData) => void;
  selectedOrder: SelectedOrder;
  selectedCustomerId: string | null;
  user: User | null;
  onRefresh: () => void;
  /** Persist the current form to the DB. Owned by ShipScreen so the auto-save
   *  writes to the exact same places as the print flow. `overrides` patches
   *  the form for values that were just set in the same tick (React state
   *  hasn't flushed yet); `pickedCustomerId` links an existing customer
   *  chosen from the autocomplete. Resolves true when the save succeeded. */
  onAutoSave: (
    overrides?: Partial<OrderFormData>,
    pickedCustomerId?: string | null
  ) => Promise<boolean>;
  onViewOrder?: () => void;
  autoBikeCount?: number;
  autoPartCount?: number;
  /** Auto-calculated weight (sum of sku_metadata.weight_lbs × qty + pallets).
   *  Shown as placeholder when the user hasn't entered a manual override. */
  autoWeight?: number;
  /** Current FedEx classification (same isFedexOrder signal used for the
   *  purple/green board treatment) — gates the "you sure?" prompt when
   *  switching away from FedEx below. */
  isFedexOrder?: boolean;
  /** Electric bikes on this order, already deduped and filtered to the active
   *  sub-order by ShipScreen. Non-empty means the cartons need a lithium-ion
   *  mark before the carrier takes them. */
  electricBikeLines?: ElectricBikeLine[];
  /** The e-bikes as Audit Source wants them declared — own carton, outside the pallet (idea-167). */
  electricCartons?: ElectricCarton[];
  /** Every line is an e-bike: nothing rides on a pallet, so Pallets / Bikes /
   *  Parts / Weight say nothing — only the carton rows show (Rafael, 27 Aug). */
  hidePalletTotals?: boolean;
}

/** Stable default so the prop's identity doesn't change on every render. */
const EMPTY_ELECTRIC_LINES: ElectricBikeLine[] = [];
const EMPTY_ELECTRIC_CARTONS: ElectricCarton[] = [];

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
        data-fit-figure
        style={{ fontSize: 'var(--stat-size, 4.5rem)' }}
        className={`w-32 bg-main border border-subtle rounded-2xl py-2 text-center font-heading font-bold ${colorClass} transition-colors duration-150 focus:border-current shadow-sm focus:bg-surface [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
      />
    ) : (
      <div className="flex items-center gap-2">
        <button type="button" onClick={onEdit} className="group text-left">
          {/* Hover recolors the text only (like the address field) — no
              opacity/filter hovers anywhere on these read views, they
              promote the element to its own GPU layer and glitched as a
              black box over the field on some devices. */}
          <span
            data-fit-figure
            style={{ fontSize: 'var(--stat-size, 4.5rem)' }}
            className={`font-heading font-bold leading-none whitespace-nowrap ${colorClass} group-hover:text-accent transition-colors duration-150`}
          >
            {value || placeholder || 0}
          </span>
        </button>
        <SaveCheckmark show={showSaveCheckmark} />
      </div>
    )}
    <span className="text-[10px] font-black uppercase tracking-widest text-muted whitespace-nowrap">
      {label}
    </span>
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
  onAutoSave,
  onViewOrder,
  autoBikeCount = 0,
  autoPartCount = 0,
  autoWeight = 0,
  isFedexOrder = false,
  electricBikeLines = EMPTY_ELECTRIC_LINES,
  electricCartons = EMPTY_ELECTRIC_CARTONS,
  hidePalletTotals = false,
}) => {
  const [editingField, setEditingField] = useState<EditableField>(null);
  const [showAddressDropdown, setShowAddressDropdown] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [isUpdatingCarrier, setIsUpdatingCarrier] = useState(false);
  const [showAllCarriers, setShowAllCarriers] = useState(false);
  // The four numbers scale to the card's width and never wrap (useFitFontSize).
  const statsRowRef = useRef<HTMLDivElement>(null);
  const statSize = useFitFontSize(statsRowRef, 72, 26, [
    formData.pallets,
    formData.bikes,
    formData.parts,
    formData.weight,
    autoBikeCount,
    autoPartCount,
    autoWeight,
    editingField,
  ]);
  // The carrier row shows what fits on one line (carrierPicker.ts): every
  // candidate chip is rendered once, hidden, and measured; the visible row is
  // cut to the measured width and re-cut whenever the card resizes.
  const carrierRowRef = useRef<HTMLDivElement>(null);
  const carrierMeasureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moreMeasureRef = useRef<HTMLButtonElement>(null);
  const [fittedCarriers, setFittedCarriers] = useState<string[] | null>(null);
  const carrierCandidateList = useMemo(
    () => carrierCandidates(TRANSPORT_COMPANIES, isFedexOrder, formData.transportCompany),
    [isFedexOrder, formData.transportCompany]
  );
  useLayoutEffect(() => {
    const row = carrierRowRef.current;
    if (!row) return;
    const CHIP_GAP = 8; // gap-2
    const measure = () => {
      const moreWidth = moreMeasureRef.current?.offsetWidth ?? 44;
      const available = row.clientWidth - moreWidth - CHIP_GAP;
      const next = fitCarriers(
        carrierCandidateList,
        (company) => carrierMeasureRefs.current[company]?.offsetWidth ?? 0,
        available,
        CHIP_GAP,
        formData.transportCompany
      );
      setFittedCarriers((prev) => (prev && prev.join('|') === next.join('|') ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [carrierCandidateList, formData.transportCompany]);
  const visibleCarriers: readonly string[] = showAllCarriers
    ? TRANSPORT_COMPANIES
    : (fittedCarriers ?? carrierCandidateList.slice(0, 3));
  const [justSavedField, setJustSavedField] = useState<string | null>(null);
  const [isPavBannerDismissed, setIsPavBannerDismissed] = useState(false);
  const [isEbikeBannerDismissed, setIsEbikeBannerDismissed] = useState(false);
  const [isConfirmingDaylight, setIsConfirmingDaylight] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);
  const clearSaveRef = useRef<NodeJS.Timeout | null>(null);
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
    setIsEbikeBannerDismissed(false);
  }, [selectedOrder?.id]);

  const isPavOutOfZone = React.useMemo(() => {
    if (!formData.zip || formData.zip.trim().length < 3) return false;
    return getPavExpressZone(formData.zip) === null;
  }, [formData.zip]);

  const showPavWarningBanner =
    !isPavBannerDismissed && !formData.transportCompany && !isFedexOrder && isPavOutOfZone;

  // A battery only needs marking while the order is still in the building.
  // Dismissal is deliberately session-only — it resets on the next order and on
  // reload, because the cost of showing it twice is a glance and the cost of
  // hiding it once is a carton refused at the dock.
  // FedEx only (Rafael, 2026-08-28): the label is FedEx's hazmat rule; on a
  // truck order the e-bike row under the numbers is the declaration.
  const showElectricBikeWarning =
    isFedexOrder &&
    !isEbikeBannerDismissed &&
    electricBikeLines.length > 0 &&
    !selectedOrder?.is_shipped;

  // Daylight only rolls a truck once someone texts the dispatcher how many
  // pallets to come get, so the carrier picker nags until that's done. The
  // record of "done" is a `[Daylight]` note on the order, not local state:
  // it survives switching orders, a reload, a different device and a
  // different operator, and it doubles as the audit trail of who sent what.
  const notesListId = selectedOrder?.combined_member_ids ?? selectedOrder?.id ?? null;
  const { notes: orderNotes, isFetched: areNotesFetched, addNote } = usePickingNotes(notesListId);

  const daylightPallets = parseInt(formData.pallets, 10) || 1;
  const daylightSmsBody = buildDaylightPickupSmsBody(daylightPallets);

  // Last count anyone confirmed texting for this order. A note saying 4 stops
  // covering an order that now ships 6, so editing pallets re-arms the
  // reminder and the next confirmation appends a fresh note.
  const daylightConfirmedPallets = useMemo(() => {
    let latest: number | null = null;
    for (const note of orderNotes) {
      const pallets = daylightNotePallets(note);
      if (pallets !== null) latest = pallets;
    }
    return latest;
  }, [orderNotes]);

  const showDaylightSmsReminder = shouldRemindDaylightPickup({
    transportCompany: formData.transportCompany,
    isShipped: selectedOrder?.is_shipped,
    notesSettled: areNotesFetched,
    pallets: daylightPallets,
    confirmedPallets: daylightConfirmedPallets,
  });

  // Opening Messages is NOT the same as having sent the text, so this
  // deliberately leaves the reminder up — only "I sent it" clears it.
  const handleSendDaylightSms = useCallback(() => {
    const platform = detectSmsPlatform(navigator.userAgent || '');
    window.location.href = buildDaylightPickupSmsUrl(daylightSmsBody, platform);
  }, [daylightSmsBody]);

  const handleConfirmDaylightSms = useCallback(async () => {
    if (!user?.id || isConfirmingDaylight) return;
    setIsConfirmingDaylight(true);
    try {
      await addNote(user.id, buildDaylightSentNote(daylightPallets));
    } catch (err) {
      console.error('Failed to record the Daylight text:', err);
      // The note is the only record — if it didn't land, the reminder has to
      // stay up rather than pretend the dispatcher was told.
      toast.error('Could not save the confirmation — the reminder stays up');
    } finally {
      setIsConfirmingDaylight(false);
    }
  }, [user?.id, isConfirmingDaylight, addNote, daylightPallets]);

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
    <div className="w-full bg-card border border-subtle rounded-3xl p-5 md:p-7 flex flex-row gap-3 relative overflow-hidden">
      <div className="absolute -top-24 -right-24 w-48 h-48 bg-accent/5 blur-[100px] pointer-events-none" />
      {/* Rafael's layout (2026-08-28): one column of content, and the pallet
          photos as a strip down the right edge that grows with the photos —
          the header's photo tile sits right above it. */}
      <div className="flex-1 min-w-0 flex flex-col gap-5">
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

        {/* Status, customer, address · ZIP */}
        <div className="w-full flex flex-col gap-4">
          {/* Status — order number now lives in the LivePrintPreview block above.
              When shipped, the shipped logo shows in the header row above (right
              side), so we skip it here to avoid duplicating it. */}
          {/* No "Verified" pill here (idea-160): every order in Ship is completed,
              so the label distinguished nothing. Waiting / Editing still show. */}
          {!selectedOrder.is_shipped &&
            !(selectedOrder.status === 'completed' && !selectedOrder.is_waiting_inventory) && (
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

          {/* FedEx Recipient ID — what to paste in Ship Manager (idea-153). Only on
              FedEx orders: a freight carrier or PICK UP has no recipient book. */}
          {isFedexOrder && <FedexRecipientChip listId={selectedOrder?.id ?? null} />}

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
            className="flex items-start gap-2"
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
              /* Address and ZIP on one line (Rafael, 2026-08-28) — the photos
                 left this block so the address has the width; on a phone the
                 ZIP wraps under it. */
              <div className="flex flex-wrap items-center gap-x-6 gap-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0 max-w-full">
                  <CopyButton value={formData.street} label="Street" />
                  <button
                    type="button"
                    onClick={() => setEditingField('address')}
                    className="text-left flex-1 min-w-0 flex items-center gap-2 hover:text-accent transition-colors"
                    title={[formData.street, formData.city, formData.state]
                      .filter(Boolean)
                      .join(', ')}
                  >
                    <MapPin size={15} className="shrink-0 text-muted" />
                    <span className="text-sm text-content font-medium md:whitespace-nowrap md:truncate">
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
                  <div className="flex items-center gap-2 shrink-0">
                    <CopyButton value={formData.zip} label="Zip Code" />
                    <button
                      type="button"
                      onClick={() => setEditingField('address')}
                      className="text-sm text-content font-mono font-bold hover:text-accent transition-colors"
                    >
                      ZIP {formData.zip}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Main Body Section (Load #, Carrier Selector, Stats) — FULL CARD WIDTH (100%) */}
        <div className="flex flex-col gap-5 w-full">
          {/* Carrier row, then load # — click to edit */}
          <div className="flex flex-col gap-3.5 w-full">
            <div className="w-full">
              {/* Carrier selector — always visible, expands 100% full width */}
              <div className="flex flex-col gap-2 w-full">
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

                {showElectricBikeWarning && (
                  <ElectricBikeWarning
                    lines={electricBikeLines}
                    onDismiss={() => setIsEbikeBannerDismissed(true)}
                  />
                )}

                {/* One row: the label, the chips that fit, and — only while
                  Daylight is the carrier and the dispatcher has not been
                  texted — the reminder, on the same line (Rafael, 2026-08-28). */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 w-full">
                  <span className="text-[10px] font-black uppercase tracking-widest text-muted flex items-center gap-1.5 shrink-0">
                    <Truck size={11} className="text-muted" />
                    Carrier
                    {isUpdatingCarrier && (
                      <span className="text-[9px] text-muted/50 font-semibold normal-case tracking-normal">
                        saving…
                      </span>
                    )}
                    <SaveCheckmark show={justSavedField === 'transport'} />
                  </span>
                  <div className="relative flex-1 min-w-[12rem]">
                    {/* Hidden twin of every candidate chip, measured to decide what fits on one line. */}
                    <div
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-0 overflow-hidden invisible pointer-events-none flex items-center gap-2 whitespace-nowrap"
                    >
                      {carrierCandidateList.map((company) => (
                        <button
                          key={`measure-${company}`}
                          ref={(el) => {
                            carrierMeasureRefs.current[company] = el;
                          }}
                          type="button"
                          tabIndex={-1}
                          className="shrink-0 px-4 h-11 rounded-2xl border inline-flex items-center justify-center"
                        >
                          <TransportLogo
                            company={company}
                            height={26}
                            plain={!logoNeedsLightBackdrop(company)}
                            textColor="font-black"
                          />
                        </button>
                      ))}
                      <button
                        ref={moreMeasureRef}
                        type="button"
                        tabIndex={-1}
                        className="shrink-0 px-3 h-11 rounded-2xl border inline-flex items-center justify-center"
                      >
                        <MoreHorizontal size={18} />
                      </button>
                    </div>
                    <div
                      ref={carrierRowRef}
                      className={`w-full flex items-center gap-2 ${showAllCarriers ? 'flex-wrap' : 'flex-nowrap'}`}
                    >
                      {visibleCarriers.map((company) => {
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
                              plain={!logoNeedsLightBackdrop(company)}
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
                      <button
                        type="button"
                        onClick={() => setShowAllCarriers((v) => !v)}
                        title={showAllCarriers ? 'Fewer carriers' : 'More carriers'}
                        aria-label={showAllCarriers ? 'Show fewer carriers' : 'Show all carriers'}
                        aria-expanded={showAllCarriers}
                        className="shrink-0 px-3 h-11 rounded-2xl border border-subtle bg-main text-muted hover:text-content hover:border-content/30 inline-flex items-center justify-center transition-all active:scale-95"
                      >
                        <MoreHorizontal size={18} />
                        {showAllCarriers && (
                          <span className="ml-1 text-[10px] font-black uppercase tracking-widest">
                            Less
                          </span>
                        )}
                      </button>
                    </div>
                  </div>
                  {/* Load # in the carrier row, chip-high (Rafael, 2026-08-28) */}
                  <div
                    ref={editingField === 'load' ? editRef : undefined}
                    className="shrink-0 h-11 flex items-center"
                  >
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
                  {showDaylightSmsReminder && (
                    <div
                      role="alert"
                      className="flex flex-col gap-3 px-3 py-2.5 bg-red-500/10 border border-red-500/40 rounded-2xl flex-1 min-w-[17rem] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="relative flex shrink-0 h-2.5 w-2.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75 animate-ping" />
                          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
                        </span>
                        <MessageSquareWarning size={18} className="shrink-0 text-red-500" />
                        <div className="min-w-0">
                          {/* The pallet count IS the message, so it goes in the headline.
                          Quoting the full sentence here truncated to "2 pallets to
                          pick u…" in the Ship panel's width — the Send button fills
                          the wording in anyway. */}
                          <p className="text-xs font-black uppercase tracking-tight text-red-500">
                            Text {DAYLIGHT_CONTACT_NAME} &mdash; {daylightPallets}{' '}
                            {daylightPallets === 1 ? 'pallet' : 'pallets'}
                          </p>
                          <p className="text-[11px] font-semibold text-red-500/70">
                            {DAYLIGHT_CONTACT_PHONE_DISPLAY}
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
                          onClick={handleConfirmDaylightSms}
                          disabled={isConfirmingDaylight}
                          className="px-3 h-9 inline-flex items-center gap-1.5 rounded-xl border border-red-500/40 text-red-500 text-[10px] font-black uppercase tracking-widest hover:bg-red-500/10 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Check size={12} />
                          {isConfirmingDaylight ? 'Saving…' : 'I sent it'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Stats — click any figure to edit */}
          {/* One line, always: the figures shrink to the width they have
            (useFitFontSize) instead of wrapping — at gap-6 "1 · 8 · 0 · 400"
            once measured 458 px in a 456 px card and Weight fell to a second
            line. When every line is an e-bike there is no pallet to describe. */}
          {!hidePalletTotals && (
            <div
              ref={statsRowRef}
              style={{ ['--stat-size' as string]: `${statSize}px` }}
              className="flex flex-nowrap items-end gap-x-4 pt-4 border-t border-dashed border-subtle w-full"
            >
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
          )}
        </div>

        {/* The e-bike as its own carton, in the language of the four numbers above it.
          Audit Source (regular) wants carton + bike + weight; FedEx wants the size too. */}
        <ElectricCartonDeclaration
          cartons={electricCartons}
          pulse={!selectedOrder.is_shipped}
          showDims={isFedexOrder}
        />
      </div>

      <PalletPhotoRail
        photos={selectedOrder.pallet_photos ?? []}
        orderNumber={selectedOrder.order_number ?? undefined}
        className="shrink-0"
      />
    </div>
  );
};
