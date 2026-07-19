import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { SearchInput } from '../../components/ui/SearchInput';
import { useViewMode } from '../../context/ViewModeContext';
import { useDebounce } from '../../hooks/useDebounce';
import { CarrierFilter } from '../picking/components/board/CarrierFilter';
import {
  computeBikesParts,
  isFedexOrder,
  useOrdersOfDay,
  type OrderRow,
} from './hooks/useOrdersOfDay';
import { OrderRowCard } from './components/OrderRowCard';
import { printOrderDetail } from './lib/printOrderDetail';

/** FedEx orders count as the 'FEDEX' carrier; everything else uses its transport_company. */
function getCarrierLabel(order: OrderRow): string | null {
  if (isFedexOrder(order)) return 'FEDEX';
  return order.transport_company?.trim().toUpperCase() || null;
}

const DEFAULT_LIMIT = 7;

/** Local calendar-day key (YYYY-MM-DD) for grouping. */
function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** Human label for a day group: Today / Yesterday / `Jul 6` (+ year if past). */
function dayLabel(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-US', opts);
}

interface DayGroup {
  key: string;
  label: string;
  orders: OrderRow[];
}

/**
 * Read-only Orders board. Lists orders as expandable packing-slip cards with
 * search + a FedEx toggle, grouped under date separators. Default view shows
 * the 7 most-recent (FedEx-filtered) orders; searching lifts the cap and
 * matches order # + customer name across all orders. Each card deep-links into
 * the shipping label editor at /ship.
 */
export const OrdersBoardScreen = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { externalOrderId, setExternalOrderId } = useViewMode();

  const [searchQuery, setSearchQuery] = useState(
    () => (location.state as { searchOrderNumber?: string })?.searchOrderNumber || ''
  );

  const debouncedQuery = useDebounce(searchQuery, 200);

  const { orders, skuIsBike, loading } = useOrdersOfDay(debouncedQuery);

  const [selectedCarriers, setSelectedCarriers] = useState<Set<string>>(new Set());
  const [includeUnassigned, setIncludeUnassigned] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const ignoreNextExternalRef = useRef(false);

  // Update searchQuery and expandedId if navigation happens with location state
  useEffect(() => {
    const passedOrderNumber = (location.state as any)?.searchOrderNumber;
    const passedTargetId = (location.state as any)?.targetId;

    if (passedOrderNumber && passedOrderNumber !== searchQuery) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from router location.state
      setSearchQuery(passedOrderNumber);
    }

    if (passedTargetId) {
      setExpandedId(passedTargetId);
    }
  }, [location.state]);

  const handleCarrierToggle = useCallback((carrier: string) => {
    setSelectedCarriers((prev) => {
      const next = new Set(prev);
      if (next.has(carrier)) {
        next.delete(carrier);
      } else {
        next.add(carrier);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (externalOrderId) {
      if (ignoreNextExternalRef.current) {
        ignoreNextExternalRef.current = false;
        return;
      }
      const targetId = externalOrderId;
      setExternalOrderId(null);

      // Expand the card
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from external view-mode context
      setExpandedId(targetId as string);
    }
  }, [externalOrderId, setExternalOrderId]);

  // 1. Compute filtered orders based on search query (before carrier filter is applied)
  const filteredOrders = useMemo(() => {
    const query = debouncedQuery.toLowerCase().trim();
    const hasQuery = query.length > 0;

    let result = orders;

    if (hasQuery) {
      result = result.filter((o) => {
        const orderNum = String(o.order_number || o.id.toString().slice(-6)).toLowerCase();
        const customer = String(o.customer?.name || '').toLowerCase();
        return orderNum.includes(query) || customer.includes(query);
      });
      result = [...result].sort((a, b) => {
        const aStarts = String(a.order_number || '')
          .toLowerCase()
          .startsWith(query)
          ? 1
          : 0;
        const bStarts = String(b.order_number || '')
          .toLowerCase()
          .startsWith(query)
          ? 1
          : 0;
        return bStarts - aStarts;
      });
    }
    return result;
  }, [orders, debouncedQuery]);

  // Get the base set of orders shown on screen (without carrier filter applied)
  const baseVisibleOrders = useMemo(() => {
    const query = debouncedQuery.toLowerCase().trim();
    const hasQuery = query.length > 0;

    if (!hasQuery) {
      const top7 = filteredOrders.slice(0, DEFAULT_LIMIT);
      // Guarantee that if we have an expanded order, it's visible on the board
      if (expandedId && !top7.some((o) => o.id === expandedId)) {
        const expandedOrder = filteredOrders.find((o) => o.id === expandedId);
        if (expandedOrder) {
          return [expandedOrder, ...top7];
        }
      }
      return top7;
    }

    // Even when searching, guarantee it's visible if we fetched it
    const result = [...filteredOrders];
    if (expandedId && !result.some((o) => o.id === expandedId)) {
      const expandedOrder = orders.find((o) => o.id === expandedId);
      if (expandedOrder) {
        result.unshift(expandedOrder);
      }
    }
    return result;
  }, [filteredOrders, debouncedQuery, expandedId, orders]);

  // 2. Compute carrier options (incl. FedEx) based on only the orders shown on screen
  const { availableCarriers, carrierCounts, hasUnassignedOrders, unassignedCount } = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of baseVisibleOrders) {
      const carrier = getCarrierLabel(o);
      if (carrier) {
        counts.set(carrier, (counts.get(carrier) || 0) + 1);
      } else {
        unassigned++;
      }
    }
    return {
      availableCarriers: Array.from(counts.keys()).sort(),
      carrierCounts: counts,
      hasUnassignedOrders: unassigned > 0,
      unassignedCount: unassigned,
    };
  }, [baseVisibleOrders]);

  // 3. Compute final visible orders (applying the carrier filter to baseVisibleOrders)
  const visibleOrders = useMemo(() => {
    const hasQuery = debouncedQuery.trim().length > 0;
    if (hasQuery) return baseVisibleOrders;
    if (selectedCarriers.size === 0 && !includeUnassigned) return baseVisibleOrders;

    return baseVisibleOrders.filter((o) => {
      const carrier = getCarrierLabel(o);
      if (!carrier) return includeUnassigned;
      return selectedCarriers.has(carrier);
    });
  }, [baseVisibleOrders, selectedCarriers, includeUnassigned, debouncedQuery]);

  // 4. Group visible orders by day
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<string, DayGroup>();
    for (const o of visibleOrders) {
      const d = new Date(o.created_at);
      const key = Number.isNaN(d.getTime()) ? 'unknown' : dayKey(d);
      let group = map.get(key);
      if (!group) {
        group = {
          key,
          label: Number.isNaN(d.getTime()) ? 'Unknown date' : dayLabel(d),
          orders: [],
        };
        map.set(key, group);
      }
      group.orders.push(o);
    }
    return Array.from(map.values());
  }, [visibleOrders]);

  const handleEditLabel = (order: OrderRow) => {
    ignoreNextExternalRef.current = true;
    setExternalOrderId(order.id);
    navigate('/ship');
  };

  // Ctrl/Cmd+P prints the currently-open order (the itemized packing slip)
  // instead of the browser's default page print. With no order open, the
  // native print is left untouched.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'p') return;
      if (!expandedId) return;
      const order = orders.find((o) => o.id === expandedId);
      if (!order) return;
      e.preventDefault();
      printOrderDetail(order, computeBikesParts(order, skuIsBike));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expandedId, orders, skuIsBike]);

  const hasQuery = debouncedQuery.trim().length > 0;
  const isEmpty = groups.length === 0;

  return (
    <div className="flex flex-col h-screen w-full bg-main font-body">
      {/* Sticky header: title + search + carrier filter */}
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <h1 className="text-2xl font-black uppercase tracking-tight text-content">Orders</h1>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search order # or customer…"
            variant="inline"
            preferenceId="orders-board-search"
          />
          {availableCarriers.length > 0 && (
            <CarrierFilter
              selectedCarriers={selectedCarriers}
              includeUnassigned={includeUnassigned}
              hasUnassignedOrders={hasUnassignedOrders}
              availableCarriers={availableCarriers}
              carrierCounts={carrierCounts}
              unassignedCount={unassignedCount}
              onCarrierToggle={handleCarrierToggle}
              onUnassignedToggle={setIncludeUnassigned}
            />
          )}
        </div>
      </div>

      {/* Scrollable list — pb-24 clears the floating BottomNavigation */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-4 pt-4 pb-24">
        <div className="max-w-3xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-accent opacity-40" />
            </div>
          ) : isEmpty ? (
            <div className="text-center text-muted text-sm py-16">
              {hasQuery ? `No matches for "${debouncedQuery.trim()}".` : 'No orders yet.'}
            </div>
          ) : (
            <div className="space-y-6">
              {groups.map((group) => (
                <div key={group.key} className="space-y-3">
                  <div className="sticky top-0 z-[1] -mx-1 px-1 py-1 bg-main/80 backdrop-blur-sm text-[10px] font-black uppercase tracking-widest text-muted/60">
                    {group.label}
                  </div>
                  {group.orders.map((order) => (
                    <OrderRowCard
                      key={order.id}
                      order={order}
                      skuIsBike={skuIsBike}
                      expanded={expandedId === order.id}
                      onToggle={() => setExpandedId((cur) => (cur === order.id ? null : order.id))}
                      onEditLabel={() => handleEditLabel(order)}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
