import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { SearchInput } from '../../components/ui/SearchInput';
import { useViewMode } from '../../context/ViewModeContext';
import { useDebounce } from '../../hooks/useDebounce';
import { TransportLogo } from '../../components/orders/TransportLogo';
import {
  computeBikesParts,
  isFedexOrder,
  useOrdersOfDay,
  type OrderRow,
} from './hooks/useOrdersOfDay';
import { OrderRowCard } from './components/OrderRowCard';
import { printOrderDetail } from './lib/printOrderDetail';

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
  const { setExternalOrderId } = useViewMode();
  const { orders, skuIsBike, loading } = useOrdersOfDay();

  const [searchQuery, setSearchQuery] = useState('');
  const [showFedex, setShowFedex] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debouncedQuery = useDebounce(searchQuery, 200);

  // Compute daily order counts per carrier (excluding REGULAR, focusing on actual shipping carriers)
  const carrierSummaries = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of orders) {
      const isFedex = isFedexOrder(o);
      const carrier = isFedex ? 'FEDEX' : o.transport_company?.trim().toUpperCase();
      if (carrier) {
        counts.set(carrier, (counts.get(carrier) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count);
  }, [orders]);

  const groups = useMemo<DayGroup[]>(() => {
    const query = debouncedQuery.toLowerCase().trim();
    const hasQuery = query.length > 0;

    // FedEx filter: OFF hides FedEx orders; ON shows everything. `orders`
    // already arrives sorted by created_at DESC from the hook.
    let result = orders.filter((o) => (showFedex || !isFedexOrder(o) ? true : false));

    if (hasQuery) {
      // Search across ALL fedex-filtered orders (no cap). Match order # +
      // customer name; float "starts-with" order-number matches to the top.
      result = result.filter((o) => {
        const orderNum = String(o.order_number || '').toLowerCase();
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
    } else {
      // Default: the 7 most-recent orders.
      result = result.slice(0, DEFAULT_LIMIT);
    }

    // Group by calendar day, preserving the incoming (DESC) order both across
    // and within groups.
    const map = new Map<string, DayGroup>();
    for (const o of result) {
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
  }, [orders, debouncedQuery, showFedex]);

  const handleEditLabel = (order: OrderRow) => {
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
      {/* Sticky header: title + search + FedEx toggle */}
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <h1 className="text-2xl font-black uppercase tracking-tight text-content">Orders</h1>
            <div className="flex items-center gap-3">
              {/* Carrier summaries (active volumes of the day) */}
              {carrierSummaries.length > 0 && (
                <div className="flex items-center gap-1.5 select-none">
                  {carrierSummaries.map(({ company, count }) => (
                    <div
                      key={company}
                      className="flex flex-col items-center gap-0.5 px-2 py-1 bg-content/[0.02] border border-subtle/50 rounded-md min-w-[44px] shrink-0"
                      title={`${company}: ${count} orders today`}
                    >
                      <TransportLogo company={company} height={12} plain />
                      <span className="text-[9px] font-black leading-none text-muted/80 mt-0.5">
                        {count}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {carrierSummaries.length > 0 && <div className="h-6 w-px bg-subtle shrink-0" />}

              <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                <input
                  type="checkbox"
                  checked={showFedex}
                  onChange={(e) => setShowFedex(e.target.checked)}
                  className="w-4 h-4 accent-purple-500"
                />
                <span className="text-xs font-black uppercase tracking-widest text-muted">
                  FedEx
                </span>
              </label>
            </div>
          </div>
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search order # or customer…"
            variant="inline"
            preferenceId="orders-board-search"
          />
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
