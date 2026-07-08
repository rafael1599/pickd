import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { SearchInput } from '../../components/ui/SearchInput';
import { useViewMode } from '../../context/ViewModeContext';
import { useDebounce } from '../../hooks/useDebounce';
import { isFedexOrder, useOrdersOfDay, type OrderRow } from './hooks/useOrdersOfDay';
import { OrderRowCard } from './components/OrderRowCard';

/**
 * Read-only Orders board. Lists the day's orders as expandable packing-slip
 * cards with search + a FedEx toggle. Each card deep-links into the shipping
 * label editor at /ship.
 */
export const OrdersBoardScreen = () => {
  const navigate = useNavigate();
  const { setExternalOrderId } = useViewMode();
  const { orders, loading } = useOrdersOfDay();

  const [searchQuery, setSearchQuery] = useState('');
  const [showFedex, setShowFedex] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const debouncedQuery = useDebounce(searchQuery, 200);

  const filtered = useMemo(() => {
    const query = debouncedQuery.toLowerCase().trim();
    const hasQuery = query.length > 0;

    // Start-of-today (local calendar day).
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    let result = orders.filter((o) => {
      // FedEx filter: OFF hides FedEx orders; ON shows everything.
      if (!showFedex && isFedexOrder(o)) return false;

      // Date filter: only applied when there is NO active search query.
      if (!hasQuery && new Date(o.created_at) < startOfToday) return false;

      // Search filter (order number + customer name).
      if (hasQuery) {
        const orderNum = String(o.order_number || '').toLowerCase();
        const customer = String(o.customer?.name || '').toLowerCase();
        if (!orderNum.includes(query) && !customer.includes(query)) return false;
      }

      return true;
    });

    // When searching, float "starts-with" order-number matches to the top.
    if (hasQuery) {
      result = [...result].sort((a, b) => {
        const aNum = String(a.order_number || '').toLowerCase();
        const bNum = String(b.order_number || '').toLowerCase();
        const aStarts = aNum.startsWith(query) ? 1 : 0;
        const bStarts = bNum.startsWith(query) ? 1 : 0;
        return bStarts - aStarts;
      });
    }

    return result;
  }, [orders, debouncedQuery, showFedex]);

  const handleEditLabel = (order: OrderRow) => {
    setExternalOrderId(order.id);
    navigate('/ship');
  };

  const hasQuery = debouncedQuery.trim().length > 0;

  return (
    <div className="flex flex-col h-screen w-full bg-main font-body">
      {/* Sticky header: title + search + FedEx toggle */}
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-black uppercase tracking-tight text-content">Orders</h1>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showFedex}
                onChange={(e) => setShowFedex(e.target.checked)}
                className="w-4 h-4 accent-purple-500"
              />
              <span className="text-xs font-black uppercase tracking-widest text-muted">FedEx</span>
            </label>
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
          ) : filtered.length === 0 ? (
            <div className="text-center text-muted text-sm py-16">
              {hasQuery ? `No matches for "${debouncedQuery.trim()}".` : 'No orders today.'}
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((order) => (
                <OrderRowCard
                  key={order.id}
                  order={order}
                  expanded={expandedId === order.id}
                  onToggle={() => setExpandedId((cur) => (cur === order.id ? null : order.id))}
                  onEditLabel={() => handleEditLabel(order)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
