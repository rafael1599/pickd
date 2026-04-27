import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x';
import Search from 'lucide-react/dist/esm/icons/search';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import PackagePlus from 'lucide-react/dist/esm/icons/package-plus';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { supabase } from '../../../lib/supabase';
import { useDebounce } from '../../../hooks/useDebounce';
import { useAddReturnItem } from '../hooks/useFedExReturns';
import { useLocationManagement } from '../../inventory/hooks/useLocationManagement';
import AutocompleteInput from '../../../components/ui/AutocompleteInput';
import type { ItemCondition } from '../types';

const TARGET_WAREHOUSE = 'LUDLOW';

interface ReturnToStockSheetProps {
  returnId: string;
  open: boolean;
  onClose: () => void;
}

interface InventorySearchRow {
  sku: string;
  item_name: string | null;
  quantity: number;
  location: string | null;
}

const CONDITIONS: Array<{ key: ItemCondition; label: string; color: string }> = [
  { key: 'good', label: 'Good', color: 'emerald' },
  { key: 'damaged', label: 'Damaged', color: 'yellow' },
  { key: 'defective', label: 'Defective', color: 'red' },
  { key: 'unknown', label: 'Unknown', color: 'muted' },
];

const CONDITION_STYLES: Record<string, { active: string; inactive: string }> = {
  emerald: {
    active: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40',
    inactive: 'bg-surface text-muted border-subtle hover:text-content',
  },
  yellow: {
    active: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    inactive: 'bg-surface text-muted border-subtle hover:text-content',
  },
  red: {
    active: 'bg-red-500/20 text-red-400 border-red-500/40',
    inactive: 'bg-surface text-muted border-subtle hover:text-content',
  },
  muted: {
    active: 'bg-muted/20 text-content border-muted/40',
    inactive: 'bg-surface text-muted border-subtle hover:text-content',
  },
};

export const ReturnToStockSheet: React.FC<ReturnToStockSheetProps> = ({
  returnId,
  open,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<InventorySearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<InventorySearchRow | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<ItemCondition>('good');
  const [targetLocation, setTargetLocation] = useState('');
  const [creatingNew, setCreatingNew] = useState(false);
  const [newSku, setNewSku] = useState('');
  const [newName, setNewName] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);

  const debouncedQuery = useDebounce(query, 250);
  const addItem = useAddReturnItem();
  const { locations } = useLocationManagement();

  const locationSuggestions = useMemo(
    () =>
      Array.from(
        new Set(
          (locations ?? [])
            .filter((l) => l.warehouse === TARGET_WAREHOUSE)
            .map((l) => (l.location || '').toUpperCase())
            .filter(Boolean)
        )
      ).map((value) => ({ value })),
    [locations]
  );

  const reset = () => {
    setQuery('');
    setResults([]);
    setSelected(null);
    setQuantity(1);
    setCondition('good');
    setTargetLocation('');
    setCreatingNew(false);
    setNewSku('');
    setNewName('');
  };

  useEffect(() => {
    if (!open) reset();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = debouncedQuery.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);

    const run = async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('sku, item_name, quantity, location')
        .eq('is_active', true)
        .or(`sku.ilike.%${q}%,item_name.ilike.%${q}%`)
        .limit(20);
      if (cancelled) return;
      if (error) {
        console.error(error);
        setResults([]);
      } else {
        setResults((data ?? []) as InventorySearchRow[]);
      }
      setSearching(false);
    };
    run();

    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, open]);

  const canShowCreate = useMemo(() => {
    return debouncedQuery.trim().length >= 2 && results.length === 0 && !searching;
  }, [debouncedQuery, results, searching]);

  const handleRegister = async () => {
    const sku = newSku.trim().toUpperCase();
    const name = newName.trim() || sku;
    if (!sku) {
      toast.error('SKU is required');
      return;
    }
    setIsRegistering(true);
    try {
      const { data, error } = await (supabase.rpc as CallableFunction)('register_new_sku', {
        p_sku: sku,
        p_item_name: name,
        p_warehouse: 'LUDLOW',
        p_location: 'FDX',
      });
      if (error) throw error;
      setSelected({ sku, item_name: name, quantity: 0, location: 'FDX' });
      setCreatingNew(false);
      toast.success(data ? 'SKU registered' : 'SKU already existed, using it');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register SKU';
      toast.error(message);
    } finally {
      setIsRegistering(false);
    }
  };

  const trimmedLocation = targetLocation.trim();
  const canSubmit = !!selected && trimmedLocation.length > 0 && !addItem.isPending;

  const handleAdd = async () => {
    if (!selected) return;
    if (!trimmedLocation) {
      toast.error('Set a destination location');
      return;
    }
    try {
      await addItem.mutateAsync({
        return_id: returnId,
        sku: selected.sku,
        item_name: selected.item_name ?? undefined,
        quantity,
        condition,
        target_location: trimmedLocation,
        target_warehouse: TARGET_WAREHOUSE,
      });
      toast.success('Item returned to stock');
      reset();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to return item';
      toast.error(message);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center focus-within:items-start justify-center p-4 transition-all duration-300">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-subtle rounded-2xl w-full max-w-lg max-h-[70vh] overflow-y-auto p-4 shadow-2xl transition-all duration-300">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-bold text-content">Return to Stock</h2>
          <button
            onClick={onClose}
            className="p-1.5 text-muted hover:text-content"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {!selected && !creatingNew && (
          <>
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search SKU or item name"
                autoFocus
                className="w-full bg-surface border border-subtle rounded-xl pl-9 pr-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            {searching && (
              <div className="flex justify-center py-4">
                <Loader2 size={20} className="animate-spin text-muted" />
              </div>
            )}

            {!searching && results.length > 0 && (
              <div className="space-y-2 mb-3">
                {results.map((row) => (
                  <button
                    key={row.sku}
                    onClick={() => setSelected(row)}
                    className="w-full bg-surface border border-subtle rounded-xl p-3 flex items-center justify-between text-left hover:border-accent/40 transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-content text-sm">{row.sku}</div>
                      {row.item_name && (
                        <div className="text-xs text-muted truncate">{row.item_name}</div>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0 ml-2">
                      <div className="text-xs text-content">{row.quantity}</div>
                      <div className="text-[10px] text-muted">{row.location ?? '—'}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {canShowCreate && (
              <button
                onClick={() => {
                  setNewSku(query.trim().toUpperCase());
                  setCreatingNew(true);
                }}
                className="w-full bg-accent/10 border border-accent/30 text-accent rounded-xl py-3 flex items-center justify-center gap-2 text-sm font-bold hover:bg-accent/20 transition-colors"
              >
                <PackagePlus size={16} />
                Create New SKU
              </button>
            )}
          </>
        )}

        {creatingNew && (
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted uppercase tracking-widest">SKU</label>
              <input
                type="text"
                value={newSku}
                onChange={(e) => setNewSku(e.target.value)}
                className="w-full mt-1 bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="text-xs text-muted uppercase tracking-widest">
                Name (optional)
              </label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={newSku.trim() || 'Item name'}
                className="w-full mt-1 bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCreatingNew(false)}
                className="flex-1 bg-surface border border-subtle text-muted rounded-xl py-2 text-sm font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleRegister}
                disabled={isRegistering || !newSku.trim()}
                className="flex-1 bg-accent text-white rounded-xl py-2 text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {isRegistering && <Loader2 size={14} className="animate-spin" />}
                Register
              </button>
            </div>
          </div>
        )}

        {selected && (
          <div className="space-y-4">
            <div className="bg-surface border border-subtle rounded-xl p-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="font-mono font-bold text-content text-sm">{selected.sku}</div>
                {selected.item_name && (
                  <div className="text-xs text-muted truncate">{selected.item_name}</div>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-xs text-muted hover:text-content"
              >
                Change
              </button>
            </div>

            <div>
              <label className="text-xs text-muted uppercase tracking-widest">Quantity</label>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                  className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content"
                  aria-label="Decrease"
                >
                  <Minus size={14} />
                </button>
                <input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 bg-surface border border-subtle rounded-xl px-3 py-2 text-center text-sm text-content focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <button
                  onClick={() => setQuantity(quantity + 1)}
                  className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content"
                  aria-label="Increase"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div>
              <label className="text-xs text-muted uppercase tracking-widest">Condition</label>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {CONDITIONS.map(({ key, label, color }) => {
                  const styles = CONDITION_STYLES[color];
                  const active = condition === key;
                  return (
                    <button
                      key={key}
                      onClick={() => setCondition(key)}
                      className={`rounded-xl py-2 text-xs font-bold uppercase tracking-widest border transition-colors ${
                        active ? styles.active : styles.inactive
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="text-xs text-muted uppercase tracking-widest">
                Destination location
              </label>
              <div className="mt-1">
                <AutocompleteInput
                  id="return_to_stock_location"
                  value={targetLocation}
                  onChange={(v: string) => setTargetLocation(v.toUpperCase())}
                  suggestions={locationSuggestions}
                  placeholder="Row/Bin..."
                  minChars={1}
                  initialKeyboardMode="numeric"
                  className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <button
              type="button"
              onMouseDown={(e) => {
                // Commit any pending input value (location/qty) before click
                // fires so handleAdd reads the latest state. Avoids the iOS
                // first-tap-eaten quirk on numeric keyboards too.
                const el = document.activeElement;
                if (el instanceof HTMLElement && el !== e.currentTarget) el.blur();
              }}
              onClick={handleAdd}
              disabled={!canSubmit}
              className="w-full bg-accent text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
            >
              {addItem.isPending ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              Return Item
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
