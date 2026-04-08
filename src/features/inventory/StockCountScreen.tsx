import { useState, useMemo, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Play from 'lucide-react/dist/esm/icons/play';
import Search from 'lucide-react/dist/esm/icons/search';
import toast from 'react-hot-toast';

import { useInventory } from './hooks/InventoryProvider.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLocationManagement } from './hooks/useLocationManagement.ts';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import { ItemDetailView } from './components/ItemDetailView';
import { InventoryItemWithMetadata, InventoryItemInput } from '../../schemas/inventory.schema.ts';
import { supabase } from '../../lib/supabase';

// ─── Types and Constants ───

const STORAGE_KEY = 'roman_cycle_count_session';

interface SessionAdjustment {
  sku: string;
  location: string;
  oldQty: number;
  newQty: number;
  timestamp: number;
}

interface CycleCountSession {
  status: 'input' | 'counting' | 'completed';
  skus: string[];
  verifiedSkus: string[];
  adjustments: SessionAdjustment[];
}

const defaultSession: CycleCountSession = {
  status: 'input',
  skus: [],
  verifiedSkus: [],
  adjustments: [],
};

// ─── Main Screen Component ───
export const StockCountScreen = () => {
  const navigate = useNavigate();
  const { inventoryData, updateItem, deleteItem } = useInventory();
  const { locations: allMappedLocations } = useLocationManagement();
  const { profile } = useAuth();

  // ─── Session State Management ───
  const [session, setSession] = useState<CycleCountSession>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : defaultSession;
    } catch {
      return defaultSession;
    }
  });

  // Save session continuously
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  // ─── DB Session: Load active cycle_count_sessions ───
  const [dbSessionId, setDbSessionId] = useState<string | null>(null);
  const [dbSessionLabel, setDbSessionLabel] = useState<string | null>(null);
  const [_dbSessionLoaded, setDbSessionLoaded] = useState(false);
  // Direct inventory fetch for cycle count SKUs (bypasses paginated cache)
  const [directInventory, setDirectInventory] = useState<InventoryItemWithMetadata[]>([]);

  useEffect(() => {
    (supabase as any)
      .from('cycle_count_sessions')
      .select('id, label, status')
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data: rawData }: { data: any }) => {
        const data = rawData as { id: string; label: string; status: string } | null;
        if (data) {
          setDbSessionId(data.id);
          setDbSessionLabel(data.label);
          // Load items from this session
          (supabase as any)
            .from('cycle_count_items')
            .select('sku, expected_qty, counted_qty, status')
            .eq('session_id', data.id)
            .order('created_at')
            .then(async ({ data: rawItems }: { data: any[] | null }) => {
              const items = rawItems as unknown as { sku: string; expected_qty: number; counted_qty: number; status: string }[] | null;
              if (items && items.length > 0) {
                const skus = items.map((i) => i.sku);
                const verified = items
                  .filter((i) => i.status === 'counted' || i.status === 'verified')
                  .map((i) => i.sku);

                // Fetch real inventory for these SKUs directly from DB
                const { data: invData } = await supabase
                  .from('inventory')
                  .select('*, sku_metadata(sku, image_url, length_in, width_in, height_in, weight_lbs, is_bike)')
                  .in('sku', skus)
                  .eq('warehouse', 'LUDLOW');
                if (invData) setDirectInventory(invData as unknown as InventoryItemWithMetadata[]);

                setSession((prev) => {
                  if (prev.skus.length === 0) {
                    return { ...prev, skus, verifiedSkus: verified, status: 'counting' };
                  }
                  return prev;
                });
              }
              setDbSessionLoaded(true);
            });
        } else {
          setDbSessionLoaded(true);
        }
      });
  }, []);

  // ─── Input Phase State ───
  const [searchQuery, setSearchQuery] = useState('');

  // ─── Counting Phase State ───
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItemWithMetadata | null>(null);

  // ─── Derived Data: Unique SKUs in Inventory ───
  // Merges paginated cache + direct DB fetch for cycle count SKUs
  const inventoryBySku = useMemo(() => {
    const map = new Map<string, { totalQty: number; items: InventoryItemWithMetadata[] }>();
    const seenIds = new Set<number>();

    const addItem = (item: InventoryItemWithMetadata) => {
      const id = item.id as number;
      if (seenIds.has(id)) return;
      seenIds.add(id);
      const sku = item.sku.toUpperCase();
      if (!map.has(sku)) {
        map.set(sku, { totalQty: 0, items: [] });
      }
      const group = map.get(sku)!;
      group.items.push(item);
      group.totalQty += item.quantity || 0;
    };

    inventoryData.forEach(addItem);
    directInventory.forEach(addItem);
    return map;
  }, [inventoryData, directInventory]);

  // Sync verified status back to DB
  const syncVerifiedToDb = useCallback(
    async (sku: string, verified: boolean) => {
      if (!dbSessionId) return;
      await (supabase as any)
        .from('cycle_count_items')
        .update({
          status: verified ? 'counted' : 'pending',
          counted_qty: verified ? (inventoryBySku.get(sku)?.totalQty ?? 0) : null,
          counted_at: verified ? new Date().toISOString() : null,
        })
        .eq('session_id', dbSessionId)
        .eq('sku', sku);
    },
    [dbSessionId, inventoryBySku]
  );

  // ─── Input Phase: Search Results ───
  const searchResults = useMemo(() => {
    if (!searchQuery || session.status !== 'input') return [];
    const query = searchQuery.toUpperCase().trim();
    const matches = Array.from(inventoryBySku.entries())
      .filter(([sku]) => sku.includes(query) && !session.skus.includes(sku))
      .slice(0, 5); // Limit to top 5 hits
    return matches;
  }, [searchQuery, inventoryBySku, session.skus, session.status]);

  // ─── Input Phase Actions ───
  const handleAddSku = (sku: string) => {
    const upperSku = sku.toUpperCase().trim();
    if (!upperSku || session.skus.includes(upperSku)) return;
    setSession((prev) => ({ ...prev, skus: [...prev.skus, upperSku] }));
    setSearchQuery('');
  };

  const handleRemoveSku = (sku: string) => {
    setSession((prev) => ({ ...prev, skus: prev.skus.filter((s) => s !== sku) }));
  };

  const clearSession = () => {
    if (window.confirm('Are you sure you want to clear the current counting session?')) {
      setSession(defaultSession);
    }
  };

  const startCounting = () => {
    if (session.skus.length === 0) return;
    setSession((prev) => ({ ...prev, status: 'counting' }));
  };

  const finishCounting = async () => {
    setSession((prev) => ({ ...prev, status: 'completed' }));
    if (dbSessionId) {
      await (supabase as any)
        .from('cycle_count_sessions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', dbSessionId);
    }
  };

  // ─── Counting Phase: Sorted list by Picking Order ───
  const sortedCountingList = useMemo(() => {
    if (session.status === 'input') return [];

    // 1. Map locations for quick picking order lookup
    const locationSortMap = new Map<string, number>();
    allMappedLocations.forEach((loc) => {
      const compositeKey = `${loc.warehouse.toUpperCase()}_${loc.location.toUpperCase().trim()}`;
      locationSortMap.set(compositeKey, loc.picking_order ?? 9999);
    });

    // 2. Decorate each chosen SKU with its best picking order and items
    const decorated = session.skus.map((sku) => {
      const group = inventoryBySku.get(sku);
      let bestPickingOrder = Infinity;

      // Filter: only show locations with qty > 0 (no point verifying empty spots)
      const activeItems = group?.items.filter((item) => (item.quantity || 0) > 0) ?? [];
      const activeQty = activeItems.reduce((sum, item) => sum + (item.quantity || 0), 0);

      if (activeItems.length > 0) {
        activeItems.forEach((item) => {
          const lKey = `${item.warehouse.toUpperCase()}_${(item.location || '').toUpperCase().trim()}`;
          const pOrder = locationSortMap.get(lKey) ?? 9999;
          if (pOrder < bestPickingOrder) {
            bestPickingOrder = pOrder;
          }
        });
      }

      return {
        sku,
        totalQty: activeQty,
        items: activeItems,
        isVerified: session.verifiedSkus.includes(sku),
        isMissing: !group || activeItems.length === 0,
        pickingOrder: bestPickingOrder,
      };
    });

    // 3. Sort by Picking Order, then verified items go to bottom (optional, user asked them to be editable/visible but at the bottom?)
    // Wait, user said: "se correrian al final cuando ocurre el ordenamiento de verificacion".
    // Also: "los sku rojos son intocables y se correrian al final".
    return decorated.sort((a, b) => {
      // Missing/Red SKUs goes to the absolute bottom
      if (a.isMissing && !b.isMissing) return 1;
      if (!a.isMissing && b.isMissing) return -1;

      // Verified SKUs push to bottom (below unverified, above missing)
      if (a.isVerified && !b.isVerified) return 1;
      if (!a.isVerified && b.isVerified) return -1;

      // Sort by picking order
      if (a.pickingOrder !== b.pickingOrder) {
        return a.pickingOrder - b.pickingOrder;
      }

      // Fallback alphabet
      return a.sku.localeCompare(b.sku);
    });
  }, [session.skus, session.status, session.verifiedSkus, inventoryBySku, allMappedLocations]);

  // ─── Counting Phase Actions ───
  const toggleVerify = (sku: string) => {
    setSession((prev) => {
      const isVerified = prev.verifiedSkus.includes(sku);
      const newVerified = isVerified
        ? prev.verifiedSkus.filter((s) => s !== sku)
        : [...prev.verifiedSkus, sku];
      // Sync to DB in background
      syncVerifiedToDb(sku, !isVerified);
      return { ...prev, verifiedSkus: newVerified };
    });
  };

  const handleEditItem = (item: InventoryItemWithMetadata) => {
    setEditingItem(item);
    setIsModalOpen(true);
  };

  const handleSaveAdjustment = async (
    formData: InventoryItemInput & { length_in?: number; width_in?: number; height_in?: number }
  ) => {
    if (!editingItem) return;
    const oldQty = editingItem.quantity || 0;
    const newQty = formData.quantity || 0;

    // Save using real API
    await updateItem(editingItem, formData);

    // Log adjustment locally if changed
    if (oldQty !== newQty) {
      setSession((prev) => ({
        ...prev,
        adjustments: [
          ...prev.adjustments,
          {
            sku: editingItem.sku,
            location: formData.location,
            oldQty,
            newQty,
            timestamp: Date.now(),
          },
        ],
      }));
      toast.success(`Adjustment recorded for ${editingItem.sku}`);
    }
  };

  const handleDeleteItem = async () => {
    if (!editingItem) return;

    // Record as 0
    setSession((prev) => ({
      ...prev,
      adjustments: [
        ...prev.adjustments,
        {
          sku: editingItem.sku,
          location: editingItem.location || '',
          oldQty: editingItem.quantity || 0,
          newQty: 0,
          timestamp: Date.now(),
        },
      ],
    }));

    await deleteItem(editingItem.warehouse, editingItem.sku, editingItem.location);
    toast.success(`Deleted ${editingItem.sku} from ${editingItem.location}`);
  };

  // ─── Render: Header ───
  const renderHeader = () => (
    <header className="sticky top-0 z-30 bg-main/95 backdrop-blur-md border-b border-subtle px-4 py-4 flex items-center gap-3">
      <button
        onClick={() => {
          if (session.status === 'input') navigate(-1);
          else if (session.status === 'completed') setSession(defaultSession);
          else clearSession();
        }}
        className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all"
      >
        <ArrowLeft size={20} />
      </button>
      <div className="flex-1">
        <h1 className="text-2xl font-black uppercase tracking-tighter leading-none">Cycle Count</h1>
        <p className="text-[10px] text-muted font-black uppercase tracking-widest">
          {dbSessionLabel && <span className="text-accent">{dbSessionLabel} · </span>}
          {session.status === 'input' && 'Phase 1: Build List'}
          {session.status === 'counting' && 'Phase 2: Verification Tour'}
          {session.status === 'completed' && 'Phase 3: Summary'}
        </p>
      </div>
      {session.status === 'input' && session.skus.length > 0 && (
        <button
          onClick={clearSession}
          className="text-[10px] font-black uppercase tracking-widest text-red-500 border border-red-500/20 bg-red-500/5 px-3 py-2 rounded-xl active:scale-90 transition-all"
        >
          Clear All
        </button>
      )}
    </header>
  );

  // ─── Render: Input Phase ───
  if (session.status === 'input') {
    return (
      <div className="min-h-screen bg-main text-content">
        {renderHeader()}
        <div className="max-w-2xl mx-auto py-2">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Scan or type SKU to add..."
          />

          {/* Search Results Dropdown-like */}
          {searchQuery && (
            <div className="px-4 mb-4">
              <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-lg shadow-black/20">
                {searchResults.length > 0 ? (
                  searchResults.map(([sku, data]) => (
                    <button
                      key={`search-${sku}`}
                      onClick={() => handleAddSku(sku)}
                      className="w-full px-4 py-3 flex items-center justify-between border-b border-subtle last:border-0 hover:bg-surface active:bg-surface/50 text-left transition-colors"
                    >
                      <span className="font-black text-lg tracking-tight uppercase">{sku}</span>
                      <span className="text-xs font-bold text-muted bg-main px-2 py-1 rounded-md">
                        {data.totalQty} in stock
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-center">
                    <p className="text-sm font-bold text-muted mb-2">
                      No SKUs match "{searchQuery}"
                    </p>
                  </div>
                )}

                {/* Always allow adding literal search string for NotFound logic */}
                {searchQuery.length > 2 &&
                  !searchResults.some(([s]) => s === searchQuery.toUpperCase()) && (
                    <button
                      onClick={() => handleAddSku(searchQuery)}
                      className="w-full px-4 py-3 flex items-center justify-between bg-blue-500/10 hover:bg-blue-500/20 text-left transition-colors border-t border-subtle"
                    >
                      <div className="flex items-center gap-2 text-blue-400">
                        <Plus size={16} />
                        <span className="font-black text-sm uppercase tracking-tight">
                          Add "{searchQuery}"
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-blue-400/60 uppercase tracking-widest">
                        Force Add
                      </span>
                    </button>
                  )}
              </div>
            </div>
          )}

          {/* Selected List */}
          <div className="px-4 pb-32 space-y-2 mt-4">
            <h2 className="text-[10px] font-black uppercase tracking-widest text-muted mb-3">
              Added to Count ({session.skus.length} / {allMappedLocations.length > 0 ? '?' : '?'})
            </h2>

            {session.skus.length === 0 ? (
              <div className="text-center py-12 border-2 border-dashed border-subtle rounded-3xl">
                <Search className="mx-auto mb-3 opacity-20 text-muted" size={40} />
                <p className="text-xs font-black uppercase tracking-widest text-muted">
                  No SKUs added yet.
                </p>
                <p className="text-[10px] text-muted/60 mt-1 uppercase font-bold">
                  Use search above to add items to the audit.
                </p>
              </div>
            ) : (
              // Render chosen SKUs
              session.skus.map((sku, index) => {
                const group = inventoryBySku.get(sku);
                const isFound = !!group;
                return (
                  <div
                    key={`input-${sku}-${index}`}
                    className={`flex items-center gap-3 p-3 rounded-2xl border ${isFound ? 'bg-card border-subtle' : 'bg-red-500/5 border-red-500/20'}`}
                  >
                    <div className="shrink-0 pl-1">
                      {isFound ? (
                        <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center text-accent">
                          <CheckCircle2 size={16} />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-red-500/10 flex items-center justify-center text-red-500">
                          <AlertCircle size={16} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className={`font-black uppercase tracking-tight text-lg truncate ${isFound ? 'text-content' : 'text-red-400'}`}
                      >
                        {sku}
                      </p>
                      {isFound ? (
                        <p className="text-[10px] font-bold text-muted uppercase tracking-widest">
                          {group.items.length} locations · Qty {group.totalQty}
                        </p>
                      ) : (
                        <p className="text-[10px] font-bold text-red-500/70 uppercase tracking-widest">
                          NOT FOUND IN SYSTEM
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() => handleRemoveSku(sku)}
                      className="p-2 text-muted hover:text-red-500 bg-surface rounded-xl active:scale-90 transition-all border border-subtle hover:border-red-500/30 shrink-0"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* Fixed Bottom CTA */}
          {session.skus.length > 0 && (
            <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-main via-main to-transparent pointer-events-none z-20 pb-safe">
              <div className="max-w-2xl mx-auto pointer-events-auto shadow-2xl shadow-black">
                <button
                  onClick={startCounting}
                  className="w-full h-14 bg-accent hover:bg-blue-600 active:scale-[0.98] text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2"
                >
                  <Play size={18} fill="currentColor" />
                  Sort & Start Audit
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── Render: Counting Phase ───
  if (session.status === 'counting') {
    const total = sortedCountingList.length;
    const verified = session.verifiedSkus.length;
    const missing = sortedCountingList.filter((s) => s.isMissing).length;

    return (
      <div className="min-h-screen bg-main text-content pb-32">
        {renderHeader()}

        {/* Stats Header */}
        <div className="max-w-2xl mx-auto px-4 py-4 sticky top-[72px] z-20 bg-main/95 backdrop-blur-md border-b border-subtle">
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-card border border-subtle rounded-2xl p-3 text-center">
              <p className="text-xl font-black text-content">{total}</p>
              <p className="text-[9px] text-muted font-black uppercase tracking-widest">
                Total SKUs
              </p>
            </div>
            <div className="bg-green-500/10 border border-green-500/20 rounded-2xl p-3 text-center">
              <p className="text-xl font-black text-green-500">{verified}</p>
              <p className="text-[9px] text-green-500/70 font-black uppercase tracking-widest">
                Verified
              </p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-3 text-center">
              <p className="text-xl font-black text-red-500">{missing}</p>
              <p className="text-[9px] text-red-500/70 font-black uppercase tracking-widest">
                Missing
              </p>
            </div>
          </div>
          {/* Progress Bar */}
          <div className="mt-4 bg-surface rounded-full h-1.5 overflow-hidden">
            <div
              className="bg-accent h-full transition-all duration-500 rounded-full"
              style={{ width: `${(verified / total) * 100}%` }}
            />
          </div>
        </div>

        {/* Audit List */}
        <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
          {sortedCountingList.map((row, idx) => {
            const verifiedBg = row.isVerified
              ? 'bg-green-500/5 border-green-500/30'
              : 'bg-card border-subtle';
            const missingBg = row.isMissing ? 'bg-red-500/5 border-red-500/20 opacity-80' : '';

            return (
              <div
                key={`count-${row.sku}-${idx}`}
                className={`rounded-2xl border transition-all duration-300 ${row.isMissing ? missingBg : verifiedBg} ${row.isVerified ? 'opacity-50 hover:opacity-100' : ''}`}
              >
                {/* Main SKU Header */}
                <div className="flex items-center gap-3 p-4">
                  <div className="flex-[3] min-w-0">
                    <p
                      className={`font-black text-2xl uppercase tracking-tighter truncate ${row.isMissing ? 'text-red-400' : 'text-content'}`}
                    >
                      {row.sku}
                    </p>
                    <p className="text-[10px] uppercase font-bold tracking-widest text-muted mt-1">
                      {row.isMissing ? 'NOT IN SYSTEM' : `Total Expected: ${row.totalQty}`}
                    </p>
                  </div>

                  <div className="shrink-0 flex items-center gap-2">
                    {!row.isMissing && (
                      <button
                        onClick={() => toggleVerify(row.sku)}
                        className={`h-14 px-6 rounded-xl font-black uppercase tracking-widest transition-all active:scale-90 flex items-center gap-2 ${
                          row.isVerified
                            ? 'bg-subtle text-content border border-subtle/50'
                            : 'bg-green-500 text-white shadow-lg shadow-green-500/20'
                        }`}
                      >
                        <CheckCircle2 size={18} />
                        {row.isVerified ? 'Undo' : 'Verify'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Location Details (If Found) */}
                {!row.isMissing && (
                  <div className="border-t border-subtle/40 bg-surface/30 px-3 py-2 divide-y divide-subtle/20 rounded-b-2xl">
                    {row.items.map((item) => (
                      <div key={`${item.id}`} className="py-2.5 flex items-center justify-between">
                        <div className="flex-1">
                          <p className="text-sm font-black uppercase tracking-tight text-accent">
                            {item.location || 'UNASSIGNED'}
                          </p>
                          <p className="text-[9px] font-bold text-muted uppercase tracking-widest flex items-center gap-2">
                            <span>
                              {item.warehouse} {item.item_name ? `· Note: ${item.item_name}` : ''}
                            </span>
                            {item.sku_metadata &&
                              (item.sku_metadata.length_in ||
                                item.sku_metadata.width_in ||
                                item.sku_metadata.height_in) && (
                                <span className="hidden md:inline-block bg-accent/5 text-accent/70 px-1 rounded border border-accent/10">
                                  {item.sku_metadata.length_in || 0} x{' '}
                                  {item.sku_metadata.width_in || 0} x{' '}
                                  {item.sku_metadata.height_in || 0} in
                                </span>
                              )}
                          </p>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-lg font-black font-mono">{item.quantity}</span>
                          <button
                            onClick={() => handleEditItem(item)}
                            className="w-10 h-10 rounded-lg bg-main border border-subtle flex items-center justify-center text-muted hover:text-accent hover:border-accent/40 active:scale-90 transition-all"
                          >
                            <Edit3 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Finalize CTA */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-main via-main to-transparent pointer-events-none z-20 pb-safe">
          <div className="max-w-2xl mx-auto pointer-events-auto shadow-2xl shadow-black">
            <button
              onClick={finishCounting}
              className={`w-full h-14 font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg flex items-center justify-center gap-2 ${
                verified === total - missing
                  ? 'bg-accent hover:bg-blue-600 text-white shadow-accent/20'
                  : 'bg-surface border border-subtle text-content'
              }`}
            >
              Complete Audit
            </button>
          </div>
        </div>

        {/* Edit Item (full-screen ItemDetailView) */}
        <ItemDetailView
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSave={handleSaveAdjustment}
          onDelete={handleDeleteItem}
          initialData={editingItem}
          mode="edit"
        />
      </div>
    );
  }

  // ─── Render: Complete Phase ───
  return (
    <div className="min-h-screen bg-main text-content">
      {renderHeader()}
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6">
        <div className="text-center space-y-2 mb-10">
          <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
            <CheckCircle2 size={40} className="text-green-500" />
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tighter">Audit Complete</h2>
          <p className="text-xs font-bold uppercase tracking-widest text-muted">
            Session generated by {profile?.full_name || 'Staff'}
          </p>
        </div>

        {/* Adjustments Report */}
        <div className="bg-card border border-subtle rounded-3xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-subtle bg-surface">
            <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-accent">
              <AlertCircle size={16} />
              Adjustments Record
            </h3>
          </div>
          <div className="p-4 bg-main/50 space-y-3">
            {session.adjustments.length === 0 ? (
              <p className="text-xs font-bold text-muted uppercase tracking-widest text-center py-4">
                No adjustments made
              </p>
            ) : (
              session.adjustments.map((adj, i) => (
                <div
                  key={`adj-${i}`}
                  className="flex items-center justify-between p-3 bg-surface rounded-xl border border-subtle"
                >
                  <div>
                    <p className="font-black text-sm uppercase">{adj.sku}</p>
                    <p className="text-[10px] font-bold text-muted uppercase tracking-widest">
                      {adj.location}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm font-mono font-black">
                    <span className="text-muted">{adj.oldQty}</span>
                    <ArrowLeft size={12} className="text-accent rotate-180" />
                    <span className={adj.newQty > adj.oldQty ? 'text-green-500' : 'text-red-500'}>
                      {adj.newQty}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <button
          onClick={() => {
            setSession(defaultSession);
            navigate('/inventory'); // or whatever home is
          }}
          className="w-full h-14 bg-surface border border-subtle hover:border-accent text-content font-black uppercase tracking-widest rounded-2xl transition-all shadow-sm active:scale-95 mt-8"
        >
          Wrap UP & Exit
        </button>
      </div>
    </div>
  );
};

export default StockCountScreen;
