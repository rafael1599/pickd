/* eslint-disable react-refresh/only-export-components */
import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Clock from 'lucide-react/dist/esm/icons/clock';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Unlink from 'lucide-react/dist/esm/icons/unlink';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import type { PickingList } from '../../hooks/useDoubleCheckList';

import { TransportLogo } from '../../../../components/orders/TransportLogo';
import {
  calculatePalletsWithBikeAwareness,
  type PickingItem,
} from '../../../../utils/pickingLogic';
import { SINGLE_ORDER_COLOR } from '../../../../utils/orderColors';
import { CombinedOrderNumbers } from '../../../../components/orders/CombinedOrderNumbers';
import { OrderNotesInline } from '../OrderNotesInline';
import { getCarrierTextColor } from '../../../../components/orders/transportLogos';
import { useAuth } from '../../../../context/AuthContext';
import { supabase } from '../../../../lib/supabase';
import toast from 'react-hot-toast';
import { useParkedLocations } from '../../hooks/useParkedLocations';

type ShippingType = 'fedex' | 'regular' | 'pickup';

export interface CardProps {
  order: PickingList;
  shippingType: ShippingType;
  showShippingBadge?: boolean;
  onSelect: (order: PickingList) => void;
  onDelete?: (order: PickingList) => void;
  onUngroup?: (order: PickingList) => void;
  onMerge?: (order: PickingList) => void;
  showDate?: boolean;
}

/** Sum of pickingQty across the order's items, falling back to total_units. */
export function getOrderUnits(order: PickingList): number {
  const items = order.items;
  if (Array.isArray(items) && items.length > 0) {
    const sum = items.reduce(
      (acc, i) => acc + (((i as Record<string, unknown>).pickingQty as number) || 0),
      0
    );
    if (sum > 0) return sum;
  }
  return order.total_units ?? 0;
}

const SHIPPING_COLORS: Record<ShippingType, { stripe: string; badge: string; badgeText: string }> =
  {
    fedex: { stripe: 'bg-purple-500/70', badge: 'bg-purple-500', badgeText: 'FDX' },
    regular: { stripe: 'bg-emerald-500/70', badge: 'bg-emerald-500', badgeText: 'TRK' },
    pickup: { stripe: 'bg-red-500/70', badge: 'bg-red-500', badgeText: 'PU' },
  };

function getStatusStyles(status: string) {
  switch (status) {
    case 'needs_correction':
      return {
        border: 'border-amber-500/30',
        icon: 'text-amber-500',
        hoverBg: 'hover:bg-amber-500/5',
        Icon: AlertCircle,
      };
    case 'double_checking':
      return {
        border: 'border-orange-500/30',
        icon: 'text-orange-500',
        hoverBg: 'hover:bg-orange-500/5',
        Icon: Clock,
      };
    default:
      return {
        border: 'border-subtle',
        icon: 'text-accent',
        hoverBg: 'hover:bg-accent/5',
        Icon: CheckCircle2,
      };
  }
}

/** A parked order keeps status double_checking but has no checker — treat it
 *  like a plain ready order everywhere (no orange "Checking" state), so the
 *  mental model stays simple: closed with X → normal card → tap to re-take. */
export function isActivelyChecking(order: PickingList): boolean {
  return order.status === 'double_checking' && !!order.checked_by;
}

/** First name of whoever is on the order right now: the checker while the
 *  order is being double-checked, otherwise the picker who pulled it. */
export function getWorkerLabel(order: PickingList): string | null {
  const checking = isActivelyChecking(order);
  const name = checking ? order.checker_profile?.full_name : order.profiles?.full_name;
  if (name === 'Warehouse Team') {
    return 'Ready to Pull';
  }
  const first = name?.trim().split(' ')[0];
  if (!first) return null;
  return checking ? `✓ ${first}` : first;
}

function completedAtLabel(iso: string | undefined, showDate: boolean): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!showDate) return time;

  const now = new Date();
  const dDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneDayMs = 24 * 60 * 60 * 1000;
  const diffMs = today.getTime() - dDay.getTime();

  let dateStr = '';
  if (diffMs === 0) {
    dateStr = 'Today';
  } else if (diffMs === oneDayMs) {
    dateStr = 'Yesterday';
  } else {
    dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  return `${dateStr} · ${time}`;
}

// ─── Shared visual content (no DnD hooks) ────────────────────────────────────

const OrderCardShell: React.FC<CardProps> = ({
  order,
  shippingType,
  showShippingBadge = true,
  onSelect,
  onDelete,
  onUngroup,
  onMerge,
  showDate = false,
}) => {
  const { user } = useAuth();
  const [isCarrierOpen, setIsCarrierOpen] = useState(false);
  const [selectedCarrier, setSelectedCarrier] = useState('');
  const [isSavingCarrier, setIsSavingCarrier] = useState(false);
  const [isPickupLocationOpen, setIsPickupLocationOpen] = useState(false);
  const [pickupLocation, setPickupLocation] = useState('');
  const { locations: suggestedLocations } = useParkedLocations();

  const handleSaveCarrier = async () => {
    if (!selectedCarrier.trim() || !user) return;

    // If PICK UP is selected, ask for location instead
    if (selectedCarrier === 'PICK UP') {
      setIsCarrierOpen(false);
      setIsPickupLocationOpen(true);
      return;
    }

    // Regular carrier save
    setIsSavingCarrier(true);
    try {
      const { error } = await supabase
        .from('picking_lists')
        .update({ transport_company: selectedCarrier.trim() })
        .eq('id', order.id);

      if (error) throw error;
      toast.success(`Carrier set to ${selectedCarrier}`);
      setIsCarrierOpen(false);
      setSelectedCarrier('');
    } catch (err) {
      console.error('Failed to update carrier:', err);
      toast.error('Failed to save carrier');
    } finally {
      setIsSavingCarrier(false);
    }
  };

  const handleSavePickup = async () => {
    if (!pickupLocation.trim() || !user) return;
    setIsSavingCarrier(true);
    try {
      // Update carrier to PICK UP
      const { error: updateError } = await supabase
        .from('picking_lists')
        .update({ transport_company: 'PICK UP' })
        .eq('id', order.id);

      if (updateError) throw updateError;

      // Add parked location note via RPC (safer with RLS)
      const { error: rpcError } = await supabase.rpc('add_parked_location_note', {
        p_list_id: order.id,
        p_location: pickupLocation.trim(),
      });

      if (rpcError) throw rpcError;

      toast.success(`Assigned as PICK UP at ${pickupLocation}`);
      setIsPickupLocationOpen(false);
      setPickupLocation('');
      setSelectedCarrier('');
    } catch (err) {
      console.error('Failed to assign pickup:', err);
      toast.error('Failed to assign pickup');
    } finally {
      setIsSavingCarrier(false);
    }
  };

  // Parked orders (double_checking without a checker) render as plain cards.
  const effectiveStatus =
    order.status === 'double_checking' && !order.checked_by
      ? 'ready_to_double_check'
      : order.status;
  const statusStyles = getStatusStyles(effectiveStatus);
  const { Icon } = statusStyles;
  const colors = SHIPPING_COLORS[shippingType];
  const worker = getWorkerLabel(order);
  const showStatusIcon =
    effectiveStatus === 'needs_correction' || effectiveStatus === 'double_checking';
  const when = order.status === 'completed' ? completedAtLabel(order.updated_at, showDate) : null;

  // Calculate bikes and parts counts from order items using the 03- prefix heuristic
  const { bikesCount, partsCount } = React.useMemo(() => {
    let bikes = 0;
    let parts = 0;
    if (Array.isArray(order.items)) {
      for (const item of order.items) {
        const qty = (item.pickingQty as number) || (item.qty as number) || 0;
        if (item.sku && item.sku.startsWith('03-')) {
          bikes += qty;
        } else {
          parts += qty;
        }
      }
    }
    return { bikesCount: bikes, partsCount: parts };
  }, [order.items]);

  // Split order number. Single orders render muted prefix + yellow 3D last-3.
  // Combined numbers ("880696 / 880669") render ONLY the last 3 of each order,
  // each segment 3D-tinted with its per-order color (see orderColors.ts) so
  // the board matches the DoubleCheck header and item stripes.
  const numberParts = React.useMemo(() => {
    const fullNum = String(order.order_number || order.id.toString().slice(-6).toUpperCase());
    if (fullNum.includes(' / ')) {
      return {
        segments: fullNum
          .split(' / ')
          .map((s) => s.trim())
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })),
      };
    }
    if (fullNum.length <= 3) {
      return { firstPart: '', lastThree: fullNum };
    }
    return {
      firstPart: fullNum.slice(0, -3),
      lastThree: fullNum.slice(-3),
    };
  }, [order.order_number, order.id]);

  const progressPercent = React.useMemo(() => {
    // Orders sent to DS (ready_to_double_check, double_checking, completed) have completed picking 100%
    if (
      ['ready_to_double_check', 'double_checking', 'completed'].includes(order.status) ||
      order.is_shipped
    ) {
      return 100;
    }
    if (!Array.isArray(order.items) || order.items.length === 0) return 0;

    const verifiedKeys = new Set(order.verified_item_keys ?? []);
    if (verifiedKeys.size === 0) return 0;

    const bikeSkuSet = new Set<string>();
    for (const item of order.items) {
      if (item.sku && item.sku.startsWith('03-')) {
        bikeSkuSet.add(item.sku);
      }
    }
    const allItems = (order.items ?? []) as unknown as PickingItem[];
    const pallets = calculatePalletsWithBikeAwareness(allItems, bikeSkuSet);

    let totalUnits = 0;
    let verifiedUnits = 0;

    for (const pallet of pallets) {
      for (const item of pallet.items) {
        const qty = item.pickingQty || 0;
        totalUnits += qty;
        const key = `${pallet.id}-${item.sku}-${item.location}`;
        if (verifiedKeys.has(key)) {
          verifiedUnits += qty;
        }
      }
    }

    if (totalUnits === 0) return 0;
    return Math.min(100, Math.round((verifiedUnits / totalUnits) * 100));
  }, [order.status, order.is_shipped, order.items, order.verified_item_keys]);

  return (
    <div
      className={`relative flex flex-col rounded-2xl overflow-hidden bg-card transition-all duration-200 group border w-full ${statusStyles.border} ${statusStyles.hoverBg}`}
    >
      {showShippingBadge && <div className={`h-1.5 shrink-0 w-full ${colors.stripe}`} />}

      <div className="flex-1 flex items-stretch min-w-0 w-full">
        {/* Left Panel: Quantities */}
        <div className="flex flex-col items-center justify-center border-r border-subtle bg-content/[0.02] py-2 px-2.5 shrink-0 self-stretch min-w-[76px] md:min-w-[84px] gap-2 select-none">
          <div className="flex flex-col gap-1.5 w-full text-center">
            {/* Pallets Row */}
            {typeof order.pallets_qty === 'number' && order.pallets_qty > 0 && (
              <div className="flex flex-col leading-none">
                <span className="text-base md:text-lg font-black text-sky-400">
                  {order.pallets_qty}
                </span>
                <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                  {order.pallets_qty === 1 ? 'Pallet' : 'Pallets'}
                </span>
              </div>
            )}

            {/* Bikes Row */}
            {bikesCount > 0 && (
              <div className="flex flex-col leading-none">
                <span className="text-base md:text-lg font-black text-amber-500">{bikesCount}</span>
                <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                  {bikesCount === 1 ? 'Bike' : 'Bikes'}
                </span>
              </div>
            )}

            {/* Parts Row */}
            {partsCount > 0 && (
              <div className="flex flex-col leading-none">
                <span className="text-base md:text-lg font-black text-emerald-500">
                  {partsCount}
                </span>
                <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                  {partsCount === 1 ? 'Part' : 'Parts'}
                </span>
              </div>
            )}

            {/* Placeholder if empty */}
            {!(order.pallets_qty && order.pallets_qty > 0) &&
              bikesCount === 0 &&
              partsCount === 0 && (
                <div className="flex flex-col leading-none">
                  <span className="text-base md:text-lg font-black text-muted/40">—</span>
                  <span className="text-[8px] md:text-[9px] font-bold text-muted uppercase tracking-wider mt-0.5">
                    Items
                  </span>
                </div>
              )}
          </div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex flex-col justify-center min-w-0 w-full">
          <button
            onClick={() => onSelect(order)}
            className={`text-left px-3 py-2.5 md:px-4 md:py-3 pb-0 md:pb-0 flex flex-col gap-1 min-w-0 w-full ${
              effectiveStatus === 'double_checking' ? 'opacity-70' : ''
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {showStatusIcon && (
                <Icon
                  size={22}
                  className={`shrink-0 ${statusStyles.icon} md:w-7 md:h-7`}
                  aria-label={order.status}
                />
              )}
              <span className="text-[clamp(1.2rem,2.5vw,3.5rem)] leading-none font-black uppercase tracking-tight text-content whitespace-nowrap">
                {numberParts.segments ? (
                  // A number click here just opens the order (same as the
                  // rest of the card) — filtering to one sub-order happens
                  // once it's open in DoubleCheckView, via the same
                  // CombinedOrderNumbers there.
                  <CombinedOrderNumbers
                    numbers={numberParts.segments}
                    activeOrderFilter={null}
                    onToggle={() => onSelect(order)}
                    variant="inline"
                  />
                ) : (
                  <>
                    <span className="text-content/35 mr-1 select-none">
                      #{numberParts.firstPart}
                    </span>
                    <span
                      style={{ textShadow: SINGLE_ORDER_COLOR.shadow }}
                      className={`${SINGLE_ORDER_COLOR.face} text-[1.27em] font-black tracking-tight leading-none inline-block align-baseline relative z-10`}
                    >
                      {numberParts.lastThree}
                    </span>
                  </>
                )}
              </span>
              {order.is_addon && (
                <span className="shrink-0 text-[clamp(0.6rem,1vw,1rem)] bg-amber-500 text-white px-1.5 py-0.5 rounded font-black animate-pulse">
                  ADD-ON
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-3 min-w-0">
              {when ? (
                <span className="text-[clamp(0.85rem,1.2vw,1.4rem)] text-muted font-bold uppercase tracking-wide truncate">
                  {when}
                </span>
              ) : worker ? (
                <span className="text-[clamp(1.05rem,1.8vw,2.25rem)] leading-tight font-bold uppercase tracking-wide text-muted truncate">
                  {worker}
                </span>
              ) : null}
            </div>
            {progressPercent > 0 && order.status !== 'completed' && (
              <div className="mt-2 h-2 w-full bg-surface rounded-full overflow-hidden border border-subtle">
                <div
                  className="h-full transition-all duration-500 ease-out"
                  style={{
                    width: `${progressPercent}%`,
                    background:
                      'linear-gradient(to right, rgb(59, 130, 246), rgb(6, 182, 212), rgb(16, 185, 129)) 0% 0% / 162.242% 100%',
                  }}
                />
              </div>
            )}
          </button>

          {/* Notes preview lives outside the select button — it opens its
              own modal on click, and nested <button>s aren't valid HTML. */}
          <OrderNotesInline
            listId={order.id}
            watcherNote={order.notes}
            className="px-3 md:px-4 pb-2 pt-1 text-left"
          />
        </div>

        {/* Right Panel: Carrier Logo Panel (Full Height) - Only shown on completed orders */}
        {order.status === 'completed' && (
          <div className="relative flex items-center justify-center shrink-0 self-stretch min-w-[76px] md:min-w-[84px] overflow-hidden">
            {order.transport_company === 'PICK UP' ? (
              // Checked first, unconditionally — a PICK UP order's own
              // auto-classified shippingType (fedex/regular, used for the
              // stripe/lane) previously leaked into this panel, showing the
              // FedEx logo or "Set Carrier" (as if no carrier was assigned)
              // for an order that DOES have a carrier: PICK UP.
              <TransportLogo
                company="PICK UP"
                className="absolute inset-0 h-full w-full object-contain select-none"
                plain
                textColor="text-red-500"
              />
            ) : shippingType === 'fedex' || order.transport_company ? (
              <TransportLogo
                company={shippingType === 'fedex' ? 'FEDEX' : order.transport_company}
                className="absolute inset-0 h-full w-full object-contain select-none"
                plain
                textColor={getCarrierTextColor(order.transport_company)}
              />
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCarrierOpen(true);
                }}
                className="flex items-center justify-center gap-1 px-2 py-1.5 text-[9px] font-black uppercase tracking-widest text-accent hover:bg-accent/10 rounded-lg transition-colors"
                title="Select Carrier (Regular)"
              >
                <span>Set Carrier</span>
              </button>
            )}
          </div>
        )}

        {/* Action Buttons (Stacked Vertically on Top-Right) - Only for completed orders */}
        {!order.is_shipped && (onMerge || (order.group_id && onUngroup) || onDelete) && (
          <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity z-10">
            {onMerge && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMerge(order);
                }}
                className="p-1.5 text-muted hover:text-sky-400 transition-colors rounded-lg hover:bg-card hover:bg-content/[0.05]"
                title="Combine"
              >
                <MoreVertical className="w-4 h-4" />
              </button>
            )}
            {order.group_id && onUngroup && shippingType !== 'fedex' && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUngroup(order);
                }}
                className="p-1.5 text-muted hover:text-amber-500 transition-colors rounded-lg hover:bg-card hover:bg-content/[0.05]"
                title="Ungroup"
              >
                <Unlink className="w-4 h-4" />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(order);
                }}
                className="p-1.5 text-muted hover:text-red-500 transition-colors rounded-lg hover:bg-card hover:bg-content/[0.05]"
                title="Delete Order"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Carrier Selector Modal */}
      {isCarrierOpen &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-main/70 backdrop-blur-md"
              onClick={() => setIsCarrierOpen(false)}
            />
            <div className="relative w-full max-w-md bg-surface border border-accent/20 rounded-[2rem] shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-black uppercase tracking-widest text-content">
                    Select Carrier
                  </h3>
                </div>
                <button
                  onClick={() => setIsCarrierOpen(false)}
                  className="p-2 hover:bg-card rounded-full text-muted transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-2 max-h-96 overflow-y-auto mb-5">
                {[
                  'PICK UP',
                  'FEDEX',
                  'R+L',
                  '2-DAY',
                  'RIST',
                  'TFORCE',
                  'DAYLIGHT',
                  'PAV EXPRESS',
                  'ESTES',
                ].map((carrier) => (
                  <button
                    key={carrier}
                    onClick={() => setSelectedCarrier(carrier)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                      selectedCarrier === carrier
                        ? 'border-accent bg-accent/10'
                        : 'border-subtle bg-card hover:border-accent/50'
                    }`}
                  >
                    <div className="flex-1 text-left">
                      <TransportLogo
                        company={carrier}
                        height={24}
                        plain
                        textColor={getCarrierTextColor(carrier)}
                      />
                    </div>
                    <span className="text-xs font-bold text-muted">{carrier}</span>
                  </button>
                ))}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setIsCarrierOpen(false)}
                  className="flex-1 py-3 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-sm rounded-2xl active:scale-95 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveCarrier}
                  disabled={!selectedCarrier.trim() || isSavingCarrier}
                  className="flex-1 py-3 bg-accent text-main font-black uppercase tracking-widest text-sm rounded-2xl shadow-lg shadow-accent/10 active:scale-95 transition-all disabled:opacity-30"
                >
                  {isSavingCarrier ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Pickup Location Modal */}
      {isPickupLocationOpen &&
        createPortal(
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <div
              className="absolute inset-0 bg-main/70 backdrop-blur-md"
              onClick={() => setIsPickupLocationOpen(false)}
            />
            <div className="relative w-full max-w-md bg-surface border border-red-500/20 rounded-[2rem] shadow-2xl p-6 animate-in fade-in zoom-in duration-200">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <h3 className="text-xl font-black uppercase tracking-widest text-content">
                    Where is it parked?
                  </h3>
                </div>
                <button
                  onClick={() => setIsPickupLocationOpen(false)}
                  className="p-2 hover:bg-card rounded-full text-muted transition-colors"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="mb-5">
                <input
                  type="text"
                  value={pickupLocation}
                  onChange={(e) => setPickupLocation(e.target.value.toUpperCase())}
                  placeholder="E.g., BAY 1, ROW 42..."
                  className="w-full bg-card border border-subtle rounded-2xl p-4 text-lg text-content focus:outline-none focus:border-accent/30 placeholder:text-muted/50"
                  autoFocus
                />
              </div>

              <div className="mb-5">
                <p className="text-xs font-bold text-muted uppercase tracking-widest mb-2">
                  Most Used ({suggestedLocations.length})
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {suggestedLocations.map((loc) => (
                    <button
                      key={loc}
                      onClick={() => setPickupLocation(loc)}
                      className={`py-2 px-3 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${
                        pickupLocation === loc
                          ? 'bg-red-600 text-white'
                          : 'bg-card border border-subtle text-muted hover:bg-surface'
                      }`}
                    >
                      {loc}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setIsPickupLocationOpen(false)}
                  className="flex-1 py-3 bg-card border border-subtle text-content/70 font-black uppercase tracking-widest text-sm rounded-2xl active:scale-95 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSavePickup}
                  disabled={!pickupLocation.trim() || isSavingCarrier}
                  className="flex-1 py-3 bg-red-600 text-white font-black uppercase tracking-widest text-sm rounded-2xl shadow-lg shadow-red-600/20 active:scale-95 transition-all disabled:opacity-30"
                >
                  {isSavingCarrier ? 'Saving...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export const SortableOrderCard = React.memo<CardProps>(OrderCardShell);
export const DraggableOrderCard = React.memo<CardProps>(OrderCardShell);
export const StaticOrderCard = React.memo<CardProps>(OrderCardShell);
