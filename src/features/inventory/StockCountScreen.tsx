import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Play from 'lucide-react/dist/esm/icons/play';
import Search from 'lucide-react/dist/esm/icons/search';
import History from 'lucide-react/dist/esm/icons/history';
import Layers from 'lucide-react/dist/esm/icons/layers';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useInventory } from './hooks/InventoryProvider.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLocationManagement } from './hooks/useLocationManagement.ts';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import { ItemDetailView } from './components/ItemDetailView';
import { InventoryItemWithMetadata, InventoryItemInput } from '../../schemas/inventory.schema.ts';
import { supabase } from '../../lib/supabase';

interface AuditRow {
  row_label: string;
  sku_count: number;
  skus_touched_90d: number;
  last_touched_at: string | null;
  has_waiting_skus: boolean;
  missing_sublocation_count: number;
}

type RowFilter = 'all' | 'stale' | 'waiting' | 'subloc';

function describeLastTouched(iso: string | null): {
  label: string;
  tone: 'red' | 'amber' | 'green';
} {
  if (!iso) return { label: 'Never', tone: 'red' };
  const ageDays = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (ageDays > 90) return { label: `${ageDays}d ago`, tone: 'red' };
  if (ageDays > 30) return { label: `${ageDays}d ago`, tone: 'amber' };
  if (ageDays <= 1) return { label: 'Today', tone: 'green' };
  return { label: `${ageDays}d ago`, tone: 'green' };
}

function rowAccuracyPct(r: AuditRow): number {
  if (r.sku_count === 0) return 0;
  return Math.round((r.skus_touched_90d / r.sku_count) * 100);
}

function isRowStale(r: AuditRow): boolean {
  if (!r.last_touched_at) return true;
  const ageDays = Math.floor((Date.now() - new Date(r.last_touched_at).getTime()) / 86_400_000);
  return ageDays > 30;
}

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
  const queryClient = useQueryClient();
  const {
    inventoryData,
    updateItem,
    deleteItem,
    setSearchQuery: setGlobalSearchQuery,
  } = useInventory();
  const { locations: allMappedLocations } = useLocationManagement();
  const { user, profile } = useAuth();

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
    supabase
      .from('cycle_count_sessions')
      .select('id, label, status')
      .eq('status', 'in_progress')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setDbSessionId(data.id);
          setDbSessionLabel(data.label);
          // Load items from this session
          supabase
            .from('cycle_count_items')
            .select('sku, expected_qty, counted_qty, status')
            .eq('session_id', data.id)
            .order('created_at')
            .then(async ({ data: items }) => {
              if (items && items.length > 0) {
                const skus = items.map((i) => i.sku);
                const verified = items
                  .filter((i) => i.status === 'counted' || i.status === 'verified')
                  .map((i) => i.sku);

                // Fetch real inventory for these SKUs directly from DB
                const { data: invData } = await supabase
                  .from('inventory')
                  .select(
                    '*, sku_metadata(sku, image_url, length_in, width_in, height_in, weight_lbs, is_bike)'
                  )
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
  const [inputMode, setInputMode] = useState<'sku' | 'row'>('sku');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');

  const { data: auditRows = [], isLoading: rowsLoading } = useQuery<AuditRow[]>({
    queryKey: ['audit-rows', 'LUDLOW'],
    queryFn: async () => {
      // RPC not yet in generated Supabase types. Cast through unknown.
      const { data, error } = await (
        supabase.rpc as unknown as (
          fn: string,
          args: Record<string, unknown>
        ) => Promise<{ data: AuditRow[] | null; error: unknown }>
      )('get_audit_rows', { p_warehouse: 'LUDLOW' });
      if (error) throw error;
      return data ?? [];
    },
    enabled: (session.status === 'input' && inputMode === 'row') || session.status === 'completed',
    staleTime: 60_000,
  });

  // Warehouse total SKUs — used to show per-session accuracy-boost projection.
  const { data: warehouseTotalSkus = 0 } = useQuery<number>({
    queryKey: ['inventory-stats', 'total_skus'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inventory_stats', { p_include_parts: true });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return Number((row as { total_skus?: number } | null)?.total_skus ?? 0);
    },
    staleTime: 5 * 60_000,
  });

  // Forward local searchQuery to useInventory's global searchQuery (debounced)
  // so that inventoryData contains server-side search results, not just the
  // first paginated page. Without this, SKUs beyond INITIAL_PAGE_SIZE are
  // invisible to the cycle count search box.
  useEffect(() => {
    if (session.status !== 'input') return;
    const timer = setTimeout(() => {
      setGlobalSearchQuery(searchQuery);
    }, 200);
    return () => clearTimeout(timer);
  }, [searchQuery, session.status, setGlobalSearchQuery]);

  // Clear global search when leaving input phase so InventoryProvider returns
  // to its normal paginated state for any other consumers.
  useEffect(() => {
    if (session.status !== 'input') {
      setGlobalSearchQuery('');
    }
  }, [session.status, setGlobalSearchQuery]);

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

  // Ensure a cycle_count_sessions row exists, creating one (plus items) if not.
  // Ref guards against concurrent calls racing to create duplicate sessions.
  const ensureDbSessionPromiseRef = useRef<Promise<string | null> | null>(null);
  const ensureDbSession = useCallback(async (): Promise<string | null> => {
    if (dbSessionId) return dbSessionId;
    if (ensureDbSessionPromiseRef.current) return ensureDbSessionPromiseRef.current;
    if (!user?.id) {
      toast.error('Not authenticated');
      return null;
    }

    const promise = (async () => {
      const nowIso = new Date().toISOString();
      const dateLabel = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      const { data: newSession, error } = await supabase
        .from('cycle_count_sessions')
        .insert({
          created_by: user.id,
          warehouse: 'LUDLOW',
          source: 'manual',
          label: `Manual Count ${dateLabel}`,
          status: 'in_progress',
          started_at: nowIso,
        })
        .select('id, label')
        .single();

      if (error || !newSession) {
        toast.error('Could not start cycle count session');
        return null;
      }

      const itemsToInsert = session.skus.map((sku) => {
        const group = inventoryBySku.get(sku);
        const activeItems = (group?.items ?? []).filter((i) => (i.quantity || 0) > 0);
        const expectedQty = activeItems.reduce((sum, i) => sum + (i.quantity || 0), 0);
        return {
          session_id: newSession.id,
          sku,
          warehouse: 'LUDLOW',
          location: null,
          expected_qty: expectedQty,
          status: 'pending',
        };
      });

      if (itemsToInsert.length > 0) {
        const { error: itemsError } = await supabase
          .from('cycle_count_items')
          .insert(itemsToInsert);
        if (itemsError) {
          toast.error('Could not create count items');
          await supabase.from('cycle_count_sessions').delete().eq('id', newSession.id);
          return null;
        }
      }

      setDbSessionId(newSession.id);
      setDbSessionLabel(newSession.label);
      return newSession.id as string;
    })();

    ensureDbSessionPromiseRef.current = promise;
    const result = await promise;
    if (!result) ensureDbSessionPromiseRef.current = null;
    return result;
  }, [dbSessionId, user, session.skus, inventoryBySku]);

  // Insert cycle_count_items rows for SKUs added AFTER the session was created.
  // Needed so syncVerifiedToDb (which does UPDATE) finds a row to update.
  const insertMissingItems = useCallback(
    async (sessionId: string, items: Array<{ sku: string; expected_qty: number }>) => {
      if (items.length === 0) return;
      const skus = items.map((i) => i.sku);
      const { data: existing } = await supabase
        .from('cycle_count_items')
        .select('sku')
        .eq('session_id', sessionId)
        .in('sku', skus);
      const existingSet = new Set((existing ?? []).map((r) => r.sku));
      const toInsert = items
        .filter((i) => !existingSet.has(i.sku))
        .map((i) => ({
          session_id: sessionId,
          sku: i.sku,
          warehouse: 'LUDLOW',
          location: null,
          expected_qty: i.expected_qty,
          status: 'pending',
        }));
      if (toInsert.length > 0) {
        await supabase.from('cycle_count_items').insert(toInsert);
      }
    },
    []
  );

  // Sync verified status back to DB. If no DB session yet (user is in counting
  // phase but session was never persisted, e.g. legacy localStorage session),
  // create one on-demand so the verification actually sticks.
  const syncVerifiedToDb = useCallback(
    async (sku: string, verified: boolean) => {
      const sessionId = await ensureDbSession();
      if (!sessionId) return;
      await supabase
        .from('cycle_count_items')
        .update({
          status: verified ? 'counted' : 'pending',
          counted_qty: verified ? (inventoryBySku.get(sku)?.totalQty ?? 0) : null,
          counted_at: verified ? new Date().toISOString() : null,
          counted_by: verified ? (user?.id ?? null) : null,
        })
        .eq('session_id', sessionId)
        .eq('sku', sku);
    },
    [ensureDbSession, inventoryBySku, user]
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

    // Persist this SKU's inventory rows into directInventory so they survive
    // future searches that change inventoryData. Without this, the SKU would
    // disappear from inventoryBySku as soon as the user searches for the
    // next one, and counting phase would mark it as missing.
    const group = inventoryBySku.get(upperSku);
    if (group) {
      setDirectInventory((prev) => {
        const existingIds = new Set(prev.map((i) => i.id as number));
        const newItems = group.items.filter((i) => !existingIds.has(i.id as number));
        return newItems.length > 0 ? [...prev, ...newItems] : prev;
      });
    }

    setSession((prev) => ({ ...prev, skus: [...prev.skus, upperSku] }));
    setSearchQuery('');

    // If a DB session is already in progress, persist this new SKU so it's
    // countable from Phase 2 without needing to recreate the session.
    if (dbSessionId) {
      const expectedQty = (group?.items ?? [])
        .filter((i) => (i.quantity || 0) > 0)
        .reduce((sum, i) => sum + (i.quantity || 0), 0);
      void insertMissingItems(dbSessionId, [{ sku: upperSku, expected_qty: expectedQty }]);
    }
  };

  const handleRemoveSku = (sku: string) => {
    setSession((prev) => ({ ...prev, skus: prev.skus.filter((s) => s !== sku) }));
  };

  const handleAddRow = async (rowLabel: string, skuCount: number) => {
    const { data: invData, error } = await supabase
      .from('inventory')
      .select(
        '*, sku_metadata(sku, image_url, length_in, width_in, height_in, weight_lbs, is_bike)'
      )
      .eq('warehouse', 'LUDLOW')
      .eq('location', rowLabel)
      .eq('is_active', true);

    if (error || !invData || invData.length === 0) {
      toast.error(`No active SKUs in ${rowLabel}`);
      return;
    }

    const items = invData as unknown as InventoryItemWithMetadata[];
    setDirectInventory((prev) => {
      const existingIds = new Set(prev.map((i) => i.id as number));
      const added = items.filter((i) => !existingIds.has(i.id as number));
      return added.length > 0 ? [...prev, ...added] : prev;
    });

    const skusInRow = Array.from(new Set(items.map((i) => i.sku.toUpperCase())));
    const existingSet = new Set(session.skus);
    const newSkus = skusInRow.filter((s) => !existingSet.has(s));
    if (newSkus.length === 0) {
      toast(`${rowLabel} already in count (${skuCount} SKUs)`);
      return;
    }
    setSession((prev) => ({ ...prev, skus: [...prev.skus, ...newSkus] }));
    toast.success(`Added ${newSkus.length} SKUs from ${rowLabel}`);
    setInputMode('sku');

    // If a DB session is already in progress, persist the new SKUs so they're
    // countable from Phase 2. expected_qty is computed from the just-fetched
    // inventory rows (inventoryBySku may not yet reflect the setDirectInventory).
    if (dbSessionId) {
      const qtyBySku = new Map<string, number>();
      for (const i of items) {
        const k = i.sku.toUpperCase();
        if ((i.quantity || 0) > 0) qtyBySku.set(k, (qtyBySku.get(k) ?? 0) + (i.quantity || 0));
      }
      const payload = newSkus.map((sku) => ({
        sku,
        expected_qty: qtyBySku.get(sku) ?? 0,
      }));
      void insertMissingItems(dbSessionId, payload);
    }
  };

  // One-tap "next audit": pick the stalest row (sorted by RPC priority), then
  // build session + DB row + items in one shot and drop the user straight into
  // Phase 2. Avoids the state-update timing issue of chaining stateful helpers.
  const startRowAuditDirect = useCallback(
    async (rowLabel: string) => {
      if (!user?.id) {
        toast.error('Not authenticated');
        return;
      }

      const { data: invData, error: invErr } = await supabase
        .from('inventory')
        .select(
          '*, sku_metadata(sku, image_url, length_in, width_in, height_in, weight_lbs, is_bike)'
        )
        .eq('warehouse', 'LUDLOW')
        .eq('location', rowLabel)
        .eq('is_active', true);

      if (invErr || !invData || invData.length === 0) {
        toast.error(`No active SKUs in ${rowLabel}`);
        return;
      }
      const items = invData as unknown as InventoryItemWithMetadata[];
      const qtyBySku = new Map<string, number>();
      for (const i of items) {
        const k = i.sku.toUpperCase();
        if ((i.quantity || 0) > 0) qtyBySku.set(k, (qtyBySku.get(k) ?? 0) + (i.quantity || 0));
      }
      const skus = Array.from(qtyBySku.keys());
      if (skus.length === 0) {
        toast.error(`No SKUs with stock in ${rowLabel}`);
        return;
      }

      const nowIso = new Date().toISOString();
      const dateLabel = new Date().toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      const { data: newSession, error: sErr } = await supabase
        .from('cycle_count_sessions')
        .insert({
          created_by: user.id,
          warehouse: 'LUDLOW',
          source: 'manual',
          label: `${rowLabel} · ${dateLabel}`,
          status: 'in_progress',
          started_at: nowIso,
        })
        .select('id, label')
        .single();
      if (sErr || !newSession) {
        toast.error('Could not start next audit');
        return;
      }

      const { error: iErr } = await supabase.from('cycle_count_items').insert(
        skus.map((sku) => ({
          session_id: newSession.id,
          sku,
          warehouse: 'LUDLOW',
          location: null,
          expected_qty: qtyBySku.get(sku) ?? 0,
          status: 'pending',
        }))
      );
      if (iErr) {
        await supabase.from('cycle_count_sessions').delete().eq('id', newSession.id);
        toast.error('Could not seed items for next audit');
        return;
      }

      setDirectInventory(items);
      setSession({
        status: 'counting',
        skus,
        verifiedSkus: [],
        adjustments: [],
      });
      setDbSessionId(newSession.id);
      setDbSessionLabel(newSession.label);
      ensureDbSessionPromiseRef.current = null;
      toast.success(`Starting ${rowLabel} (${skus.length} SKUs)`);
    },
    [user]
  );

  const clearSession = async () => {
    if (!window.confirm('Are you sure you want to clear the current counting session?')) {
      return;
    }
    if (dbSessionId) {
      await supabase
        .from('cycle_count_sessions')
        .update({ status: 'cancelled' })
        .eq('id', dbSessionId);
    }
    setSession(defaultSession);
    setDbSessionId(null);
    setDbSessionLabel(null);
    ensureDbSessionPromiseRef.current = null;
  };

  const startCounting = async () => {
    if (session.skus.length === 0) return;
    const sessionId = await ensureDbSession();
    if (!sessionId) return;
    setSession((prev) => ({ ...prev, status: 'counting' }));
  };

  const finishCounting = async () => {
    setSession((prev) => ({ ...prev, status: 'completed' }));
    if (dbSessionId) {
      await supabase
        .from('cycle_count_sessions')
        .update({ status: 'completed', completed_at: new Date().toISOString() })
        .eq('id', dbSessionId);
    }
    // Release the id so a subsequent count starts a fresh session.
    setDbSessionId(null);
    setDbSessionLabel(null);
    ensureDbSessionPromiseRef.current = null;
    // Refresh row-level stats so Phase 3 ("Next Row") shows accurate priorities.
    queryClient.invalidateQueries({ queryKey: ['audit-rows'] });
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
          // Phase 2 (counting) → back to Phase 1 with session intact.
          // Phase 3 (completed) → reset to a fresh Phase 1 (By SKU / By Row picker).
          // Phase 1 (input) → exit to previous page; session persists in DB.
          if (session.status === 'counting') {
            setSession((prev) => ({ ...prev, status: 'input' }));
            return;
          }
          if (session.status === 'completed') {
            setSession(defaultSession);
            return;
          }
          navigate(-1);
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
      {session.status === 'input' && (
        <button
          onClick={() => navigate('/cycle-count-history')}
          className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all"
          title="History"
        >
          <History size={18} />
        </button>
      )}
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
          {/* Mode toggle: SKU search vs Row browser */}
          <div className="px-4 pt-2 pb-3 flex gap-2">
            <button
              onClick={() => setInputMode('sku')}
              className={`flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                inputMode === 'sku'
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-surface border border-subtle text-muted active:scale-[0.98]'
              }`}
            >
              <Search size={14} />
              By SKU
            </button>
            <button
              onClick={() => setInputMode('row')}
              className={`flex-1 h-10 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all ${
                inputMode === 'row'
                  ? 'bg-accent text-white shadow-sm'
                  : 'bg-surface border border-subtle text-muted active:scale-[0.98]'
              }`}
            >
              <Layers size={14} />
              By Row
            </button>
          </div>

          {inputMode === 'sku' && (
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Scan or type SKU to add..."
            />
          )}

          {/* Row browser — rows sorted by natural order, stale rows highlighted */}
          {inputMode === 'row' && (
            <div className="px-4 mb-4">
              {/* Filter pills — priority signals */}
              <div className="flex gap-1.5 mb-3 overflow-x-auto">
                {(
                  [
                    { k: 'all', l: 'All', count: auditRows.length },
                    {
                      k: 'stale',
                      l: '🔴 Stale',
                      count: auditRows.filter(isRowStale).length,
                    },
                    {
                      k: 'waiting',
                      l: '⏱ Waiting',
                      count: auditRows.filter((r) => r.has_waiting_skus).length,
                    },
                    {
                      k: 'subloc',
                      l: '📦 No Subloc',
                      count: auditRows.filter((r) => r.missing_sublocation_count > 0).length,
                    },
                  ] as Array<{ k: RowFilter; l: string; count: number }>
                ).map((f) => (
                  <button
                    key={f.k}
                    onClick={() => setRowFilter(f.k)}
                    className={`shrink-0 h-8 px-3 rounded-lg text-[10px] font-black uppercase tracking-widest flex items-center gap-1.5 transition-all ${
                      rowFilter === f.k
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-surface border border-subtle text-muted active:scale-[0.98]'
                    }`}
                  >
                    <span>{f.l}</span>
                    <span className="opacity-70">{f.count}</span>
                  </button>
                ))}
              </div>

              <p className="text-[10px] font-black uppercase tracking-widest text-muted mb-3">
                {rowsLoading ? 'Loading rows…' : 'Tap a row to add its SKUs to the count'}
              </p>

              <div className="space-y-2">
                {auditRows
                  .filter((r) => {
                    if (rowFilter === 'stale') return isRowStale(r);
                    if (rowFilter === 'waiting') return r.has_waiting_skus;
                    if (rowFilter === 'subloc') return r.missing_sublocation_count > 0;
                    return true;
                  })
                  .map((r) => {
                    const { label, tone } = describeLastTouched(r.last_touched_at);
                    const toneClass =
                      tone === 'red'
                        ? 'bg-red-500/10 border-red-500/30 text-red-400'
                        : tone === 'amber'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                          : 'bg-green-500/10 border-green-500/30 text-green-400';
                    const pct = rowAccuracyPct(r);
                    const pctTone =
                      pct === 100
                        ? 'text-green-400'
                        : pct >= 50
                          ? 'text-amber-400'
                          : 'text-red-400';
                    return (
                      <button
                        key={r.row_label}
                        onClick={() => handleAddRow(r.row_label, r.sku_count)}
                        className="w-full bg-card border border-subtle rounded-2xl p-4 flex items-center justify-between hover:border-accent active:scale-[0.98] transition-all"
                      >
                        <div className="flex flex-col items-start gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-black text-lg tracking-tight uppercase">
                              {r.row_label}
                            </span>
                            {r.has_waiting_skus && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                ⏱ Waiting
                              </span>
                            )}
                            {r.missing_sublocation_count > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest bg-blue-500/15 text-blue-400 border border-blue-500/30">
                                📦 {r.missing_sublocation_count}
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-muted font-bold uppercase tracking-widest">
                            {r.sku_count} SKU{r.sku_count === 1 ? '' : 's'}
                            <span className="mx-1.5 opacity-40">·</span>
                            <span className={pctTone}>{pct}% audited</span>
                          </span>
                        </div>
                        <span
                          className={`px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-widest border ${toneClass}`}
                        >
                          {label}
                        </span>
                      </button>
                    );
                  })}
                {!rowsLoading && auditRows.length === 0 && (
                  <p className="text-xs text-muted text-center py-8 font-bold uppercase">
                    No rows found
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Search Results Dropdown-like */}
          {inputMode === 'sku' && searchQuery && (
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
                  className="w-full h-14 bg-accent hover:opacity-90 active:scale-[0.98] text-white font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-accent/20 flex items-center justify-center gap-2"
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

        {/* Finalize CTA with session contribution */}
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-main via-main to-transparent pointer-events-none z-20 pb-safe">
          <div className="max-w-2xl mx-auto pointer-events-auto space-y-2">
            {verified > 0 && (
              <div className="bg-accent/10 border border-accent/30 rounded-xl px-4 py-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                <span className="text-accent">+{verified} verified this session</span>
                {warehouseTotalSkus > 0 && (
                  <span className="text-accent/80">
                    +{((verified / warehouseTotalSkus) * 100).toFixed(2)}% accuracy
                  </span>
                )}
              </div>
            )}
            <button
              onClick={finishCounting}
              className={`w-full h-14 font-black uppercase tracking-widest rounded-2xl transition-all shadow-lg shadow-black flex items-center justify-center gap-2 ${
                verified === total - missing
                  ? 'bg-accent hover:opacity-90 text-white shadow-accent/20'
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
  // Next stalest row that isn't the one we just finished — powers the chain-audit CTA.
  const justCountedLocations = new Set(
    session.skus.map(
      (sku) => inventoryBySku.get(sku)?.items?.[0]?.location?.toUpperCase().trim() ?? ''
    )
  );
  const nextStaleRow = auditRows
    .filter((r) => !justCountedLocations.has(r.row_label))
    .slice()
    .sort((a, b) => {
      // Never touched first, then oldest.
      const aTs = a.last_touched_at ? new Date(a.last_touched_at).getTime() : 0;
      const bTs = b.last_touched_at ? new Date(b.last_touched_at).getTime() : 0;
      return aTs - bTs;
    })[0];
  const discrepancyCount = session.adjustments.length;
  const verifiedCount = session.verifiedSkus.length;

  return (
    <div className="min-h-screen bg-main text-content">
      {renderHeader()}
      <div className="max-w-xl mx-auto px-4 py-8 space-y-6 pb-32">
        <div className="text-center space-y-2 mb-8">
          <div className="w-20 h-20 bg-green-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-green-500/20">
            <CheckCircle2 size={40} className="text-green-500" />
          </div>
          <h2 className="text-3xl font-black uppercase tracking-tighter">Audit Complete</h2>
          <p className="text-xs font-bold uppercase tracking-widest text-muted">
            Session generated by {profile?.full_name || 'Staff'}
          </p>
        </div>

        {/* Summary tiles — verified count + estimated accuracy contribution */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card border border-subtle rounded-2xl p-4 text-center">
            <p className="text-3xl font-black text-accent">{verifiedCount}</p>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mt-1">
              Verified
            </p>
          </div>
          <div className="bg-card border border-subtle rounded-2xl p-4 text-center">
            <p className="text-3xl font-black text-accent">
              {warehouseTotalSkus > 0
                ? `+${((verifiedCount / warehouseTotalSkus) * 100).toFixed(2)}%`
                : '—'}
            </p>
            <p className="text-[10px] font-black uppercase tracking-widest text-muted mt-1">
              Accuracy boost
            </p>
          </div>
        </div>

        {/* Discrepancies Report — only the SKUs where counted qty differed */}
        <div className="bg-card border border-subtle rounded-3xl overflow-hidden shadow-lg">
          <div className="p-4 border-b border-subtle bg-surface flex items-center justify-between">
            <h3 className="font-black uppercase tracking-widest text-sm flex items-center gap-2 text-accent">
              <AlertCircle size={16} />
              Discrepancies
            </h3>
            <span className="text-[10px] font-black uppercase tracking-widest text-muted">
              {discrepancyCount} {discrepancyCount === 1 ? 'item' : 'items'}
            </span>
          </div>
          <div className="p-4 bg-main/50 space-y-3">
            {discrepancyCount === 0 ? (
              <p className="text-xs font-bold text-muted uppercase tracking-widest text-center py-4">
                No discrepancies — all counts matched
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

        {/* Next Row CTA — chain audits without returning to menu */}
        {nextStaleRow && (
          <button
            onClick={() => startRowAuditDirect(nextStaleRow.row_label)}
            className="w-full bg-accent hover:opacity-90 active:scale-[0.98] text-white rounded-3xl p-5 flex items-center justify-between transition-all shadow-lg shadow-accent/20"
          >
            <div className="flex flex-col items-start gap-1">
              <span className="text-[10px] font-black uppercase tracking-widest opacity-80">
                Audit next stale row
              </span>
              <span className="text-xl font-black tracking-tight">{nextStaleRow.row_label}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">
                {nextStaleRow.sku_count} SKUs ·{' '}
                {describeLastTouched(nextStaleRow.last_touched_at).label}
              </span>
            </div>
            <Play size={22} fill="currentColor" />
          </button>
        )}

        <button
          onClick={() => {
            setSession(defaultSession);
            navigate('/inventory');
          }}
          className="w-full h-12 bg-surface border border-subtle hover:border-accent text-content font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 text-xs"
        >
          Back to Inventory
        </button>
      </div>
    </div>
  );
};

export default StockCountScreen;
