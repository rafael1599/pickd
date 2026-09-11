import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import Search from 'lucide-react/dist/esm/icons/search';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Check from 'lucide-react/dist/esm/icons/check';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import X from 'lucide-react/dist/esm/icons/x';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Loader from 'lucide-react/dist/esm/icons/loader';
import { findSimilarSkus, type SimilarSku } from '../utils/findSimilarSkus';
import { pickBestStockRow, pickVariantSiblingRow } from '../utils/stockSubstitute';
import { toPickingOrderMap } from '../utils/pickLocation';
import { getSubstituteSku, variantSiblingBase } from '../../../utils/skuNormalize';
import { inventoryApi } from '../../inventory/api/inventoryApi';
import { supabase } from '../../../lib/supabase';
import type { PickingItem, CorrectionAction } from './DoubleCheckView';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import type { InventoryItem } from '../../../schemas/inventory.schema';
import { useAutoSelect } from '../../../hooks/useAutoSelect';
import { ReasonPicker } from './ReasonPicker';
import { useSkuSuggestion } from '../hooks/useSkuSuggestion';
import { buildOrderTabs, defaultAddTarget, rowOfLine } from '../utils/editOrderTargets';

interface CorrectionModeViewProps {
  problemItems: PickingItem[];
  allItems: PickingItem[];
  inventoryData: InventoryItemWithMetadata[];
  onCorrectItem: (action: CorrectionAction, targetListId?: string) => Promise<void>;
  onClose: () => void;
  orderNumber?: string | null;
  /**
   * When editing a single sub-order inside a combined FedEx group, this is the
   * picking_list_id of that sub-order. The correction is applied to only that
   * row in the DB. For non-combined orders this equals the active list id.
   */
  editingListId?: string | null;
  /**
   * For grouped orders: maps source_order (order_number) → picking_list id.
   * Used to route corrections to the correct DB row per item.
   * Empty map for non-grouped orders.
   */
  sourceOrderMap?: Map<string, string>;
  isReopened?: boolean;
  onCancelReopen?: () => void;
  /**
   * Open straight on one panel — Double Check's inline "Replace" lands the
   * picker on the search for that SKU instead of the list of problems.
   */
  initialPanel?: ActivePanel;
}

// `rowId` names the order the line belongs to. A combined group can hold the
// same SKU in two orders, so the SKU alone does not say which line was tapped.
// Absent, the first line with that SKU is meant (a single order).
export type ActivePanel =
  | { type: 'replace'; sku: string; rowId?: string }
  | { type: 'adjust_qty'; sku: string; availableStock: number; rowId?: string }
  | { type: 'remove'; sku: string; rowId?: string }
  | { type: 'confirm_replace'; sku: string; replacement: InventoryItem; rowId?: string }
  | { type: 'add_item' }
  | { type: 'confirm_add'; item: InventoryItem }
  | null;

function getThumbUrl(imageUrl: string): string {
  if (imageUrl.includes('/catalog/')) {
    return imageUrl.replace('/catalog/', '/catalog/thumbs/').replace('.png', '.webp');
  }
  if (imageUrl.includes('/photos/')) {
    return imageUrl.replace('/photos/', '/photos/thumbs/');
  }
  return imageUrl;
}

/* ── Reusable search result row ── */
const ResultRow: React.FC<{
  item: { sku: string; item_name?: string | null; location?: string | null; quantity?: number };
  onSelect: () => void;
}> = ({ item, onSelect }) => (
  <button
    onClick={onSelect}
    className="flex items-center gap-3 p-3 bg-card border border-subtle rounded-xl hover:border-accent/30 hover:bg-accent/5 transition-all active:scale-[0.98] touch-manipulation"
  >
    <div className="flex flex-col items-start min-w-0 flex-1">
      <span className="font-black text-sm text-content tracking-tight">{item.sku}</span>
      {item.item_name && (
        <span className="text-[10px] text-muted/70 truncate w-full text-left">
          {item.item_name.slice(0, 35)}
        </span>
      )}
    </div>
    <div className="flex flex-col items-end shrink-0 gap-0.5">
      <span className="text-[9px] font-black text-muted/60 uppercase">
        {(item.location || '-').replace(/row/i, '').trim().slice(0, 5)}
      </span>
      <span className="text-[10px] font-black text-green-400">{item.quantity ?? 0} avail</span>
    </div>
  </button>
);

/* ── SKU canonical-form suggestion (idea-092) ──
 * When a SKU is unregistered ("UNREG"), look up sku_metadata for any SKU
 * whose normalized form (lowercase, dashes/spaces stripped) matches. If
 * exactly one canonical exists, surface a one-tap button so the picker
 * doesn't have to manually search for the right SKU. Common case: PDF
 * import dropped a dash ("034666BR" → "03-4666BR"). */
const SkuFormatSuggestion: React.FC<{
  rawSku: string;
  enabled: boolean;
  onUseCanonical: (canonical: string) => void;
}> = ({ rawSku, enabled, onUseCanonical }) => {
  const { canonicalSku } = useSkuSuggestion(rawSku, enabled);
  if (!canonicalSku) return null;
  return (
    <button
      onClick={() => onUseCanonical(canonicalSku)}
      className="self-start mt-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/25 transition-all active:scale-[0.97]"
      title={`This looks like a format mismatch — ${canonicalSku} is the registered SKU.`}
    >
      Use {canonicalSku} instead
    </button>
  );
};

/* ── Search input + results (shared by Replace and Add Item) ── */
const SearchPanel: React.FC<{
  query: string;
  onQueryChange: (q: string) => void;
  results: InventoryItem[];
  isSearching: boolean;
  onSelectResult: (item: InventoryItem) => void;
  suggestions?: SimilarSku[];
  onSelectSuggestion?: (alt: SimilarSku) => void;
}> = ({
  query,
  onQueryChange,
  results,
  isSearching,
  onSelectResult,
  suggestions,
  onSelectSuggestion,
}) => (
  <>
    {suggestions && suggestions.length > 0 && onSelectSuggestion && (
      <div className="mb-4">
        <span className="text-[9px] font-black text-muted/60 uppercase tracking-widest">
          Suggested Alternatives
        </span>
        <div className="flex flex-col gap-1.5 mt-2">
          {suggestions.map((alt) => (
            <ResultRow key={alt.sku} item={alt} onSelect={() => onSelectSuggestion(alt)} />
          ))}
        </div>
      </div>
    )}

    <div className="relative mb-3">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted/60" />
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search SKU or name..."
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck="false"
        autoFocus
        className="w-full pl-9 pr-9 py-3 bg-card border border-subtle rounded-xl text-content text-sm placeholder-muted/50 focus:outline-none focus:border-accent/40 font-mono"
      />
      {query && (
        <button
          onClick={() => onQueryChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted/60 hover:text-muted"
        >
          <X size={14} />
        </button>
      )}
    </div>

    {results.length > 0 && (
      <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto">
        {results.map((r) => (
          <ResultRow key={r.id} item={r} onSelect={() => onSelectResult(r)} />
        ))}
      </div>
    )}

    {query.length >= 2 && isSearching && results.length === 0 && (
      <div className="flex items-center justify-center gap-2 py-3">
        <Loader size={14} className="text-muted/60 animate-spin" />
        <span className="text-[10px] text-muted/60 uppercase tracking-widest font-black">
          Searching...
        </span>
      </div>
    )}

    {query.length >= 2 && !isSearching && results.length === 0 && (
      <p className="text-[10px] text-muted/60 text-center py-3 uppercase tracking-widest font-black">
        No results found
      </p>
    )}
  </>
);

/* ── Qty input with auto-select ── */
const QtyInput: React.FC<{
  value: number;
  onChange: (v: number) => void;
  autoSelect: ReturnType<typeof useAutoSelect>;
}> = ({ value, onChange, autoSelect }) => (
  <div className="flex items-center justify-center mb-3">
    <input
      type="number"
      min="1"
      value={value}
      onChange={(e) => {
        const val = parseInt(e.target.value, 10);
        if (!isNaN(val) && val >= 1) onChange(val);
      }}
      onFocus={autoSelect.onFocus}
      onPointerUp={autoSelect.onPointerUp}
      autoFocus
      className="w-20 text-center text-3xl font-black text-content bg-card border border-subtle rounded-xl py-2 focus:outline-none focus:border-accent/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  </div>
);

/* ── Two-button row (Cancel + Action) ── */
const ActionButtons: React.FC<{
  onCancel: () => void;
  onConfirm: () => void;
  isProcessing: boolean;
  confirmLabel: string;
  confirmClass?: string;
  disabled?: boolean;
}> = ({ onCancel, onConfirm, isProcessing, confirmLabel, confirmClass, disabled }) => (
  <div className="flex items-center gap-2">
    <button
      onClick={onCancel}
      className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-card text-muted border border-subtle transition-all hover:bg-card active:scale-[0.97]"
    >
      Cancel
    </button>
    <button
      onClick={onConfirm}
      disabled={isProcessing || disabled}
      className={`flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] transition-all hover:opacity-80 active:scale-[0.97] disabled:opacity-50 ${
        confirmClass || 'bg-accent text-main border border-accent'
      }`}
    >
      {isProcessing ? 'Processing...' : confirmLabel}
    </button>
  </div>
);

/* ── One order of a combined group: its number, its lines, a dot if it has issues ── */
const OrderTabButton: React.FC<{
  label: string;
  lines: number;
  issues: number;
  selected: boolean;
  onSelect: () => void;
}> = ({ label, lines, issues, selected, onSelect }) => (
  <button
    role="tab"
    aria-selected={selected}
    onClick={onSelect}
    className={`min-h-11 px-3.5 rounded-xl border flex items-center gap-2 transition-all active:scale-[0.97] touch-manipulation ${
      selected
        ? 'bg-accent text-main border-accent'
        : 'bg-card text-content border-subtle hover:border-accent/30'
    }`}
  >
    <span className="text-sm font-black tracking-tight">{label}</span>
    <span className="text-[11px] font-black opacity-70">{lines}</span>
    {issues > 0 && (
      <span
        className="w-2 h-2 rounded-full bg-amber-400"
        aria-label={`${issues} issue${issues !== 1 ? 's' : ''}`}
      />
    )}
  </button>
);

/* ── Main component ── */
export const CorrectionModeView: React.FC<CorrectionModeViewProps> = ({
  problemItems,
  allItems,
  inventoryData,
  onCorrectItem,
  onClose,
  orderNumber,
  editingListId,
  sourceOrderMap = new Map(),
  isReopened = false,
  onCancelReopen,
  initialPanel,
}) => {
  const isGroupEdit = sourceOrderMap.size > 0;
  const targetListId = editingListId ?? undefined;
  // Track original items to detect changes for reopened orders
  const [initialSnapshot] = useState(() =>
    isReopened ? JSON.stringify(allItems.map((i) => ({ sku: i.sku, qty: i.pickingQty }))) : null
  );
  const hasChanges =
    isReopened &&
    initialSnapshot !== null &&
    initialSnapshot !== JSON.stringify(allItems.map((i) => ({ sku: i.sku, qty: i.pickingQty })));

  const [activePanel, setActivePanel] = useState<ActivePanel>(initialPanel ?? null);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQty, setReplaceQty] = useState(1);
  const [adjustQty, setAdjustQty] = useState(1);
  const [addQty, setAddQty] = useState(1);

  /** The order a line belongs to — where every correction on it is written. */
  const rowOf = useCallback(
    (item: PickingItem): string | undefined =>
      isGroupEdit ? rowOfLine(item, sourceOrderMap, editingListId) : targetListId,
    [isGroupEdit, sourceOrderMap, editingListId, targetListId]
  );
  /**
   * The line a panel is about: that SKU in that order. Without an order — or
   * with one no line here belongs to, as when Double Check names the row a
   * single order's leftover tag points at — the first line with the SKU.
   */
  const findLine = useCallback(
    (sku: string, rowId?: string): PickingItem | undefined =>
      (rowId ? allItems.find((i) => i.sku === sku && rowOf(i) === rowId) : undefined) ??
      allItems.find((i) => i.sku === sku),
    [allItems, rowOf]
  );
  /** Replace, adjust and remove go to the line's own order — nothing to ask. */
  const targetOf = useCallback(
    (sku: string, rowId?: string): string | undefined => {
      const line = findLine(sku, rowId);
      return line ? rowOf(line) : (rowId ?? targetListId);
    },
    [findLine, rowOf, targetListId]
  );
  const autoSelect = useAutoSelect();
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [recentlyRemoved, setRecentlyRemoved] = useState<string[]>([]);

  // ── One order at a time (combined groups) ──
  // The group's orders as tabs; null shows all of them. The list, the summary
  // and the Add Item default all follow the tab.
  const [orderFilter, setOrderFilter] = useState<string | null>(null);
  const [addTarget, setAddTarget] = useState<string | null>(null);
  const problemSet = useMemo(() => new Set(problemItems), [problemItems]);
  const orderTabs = useMemo(
    () => (isGroupEdit ? buildOrderTabs(allItems, problemSet, sourceOrderMap, editingListId) : []),
    [isGroupEdit, allItems, problemSet, sourceOrderMap, editingListId]
  );
  const showOrderTabs = orderTabs.length > 1;
  const orderNumberOf = useMemo(
    () => new Map(orderTabs.map((tab) => [tab.rowId, tab.orderNumber])),
    [orderTabs]
  );
  const visibleItems = useMemo(
    () => (orderFilter ? allItems.filter((i) => rowOf(i) === orderFilter) : allItems),
    [allItems, orderFilter, rowOf]
  );
  const visibleProblems = useMemo(
    () => visibleItems.filter((i) => problemSet.has(i)),
    [visibleItems, problemSet]
  );
  // Everything the problem list did not take. The two lists used to be decided
  // by different tests — problems by the LIVE stock (Double Check's
  // isUnresolvedProblem), normals by the STORED flags — so a line whose flag
  // still said LOW STOCK while the stock already covered it was in neither, and
  // Edit Order never showed it: #881514's part, reopened twice with nothing on
  // screen to correct.
  const normalItems = useMemo(
    () => visibleItems.filter((i) => !problemSet.has(i)),
    [visibleItems, problemSet]
  );

  const selectOrder = (rowId: string | null) => {
    setOrderFilter(rowId);
    setActivePanel(null);
    setSearchQuery('');
  };

  const similarSkus = useMemo(() => {
    if (activePanel?.type !== 'replace') return [];
    const item = findLine(activePanel.sku, activePanel.rowId);
    if (!item) return [];
    return findSimilarSkus(item.sku, item.warehouse || 'LUDLOW', inventoryData, 5);
  }, [activePanel, findLine, inventoryData]);

  // ── Tier 1: auto-resolve out-of-stock items that have an equivalent ──
  // On open, any insufficient_stock problem item is swapped automatically —
  // and surfaced with an Undo — when an equivalent carries enough LIVE stock:
  // either its hardcoded substitute (SKU_SUBSTITUTES, a different product) or
  // a variant sibling (the SAME bike under another catalog name, 03-3768BLD ↔
  // 03-3768BL — whichever holds the stock this month). We read live stock
  // because inventoryData is paginated.
  const mountedRef = useRef(true);
  const autoTriedRef = useRef<Set<string>>(new Set());
  const [autoResolved, setAutoResolved] = useState<
    {
      from: string;
      to: string;
      rowId?: string;
      original: { location: string | null; warehouse: string; item_name: string | null };
    }[]
  >([]);
  const [undoingSku, setUndoingSku] = useState<string | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Once per line per mount — a line is its SKU in its order, since two
    // orders of a group can both be short of the same SKU.
    const triedKey = (i: PickingItem) => `${rowOf(i) ?? ''}|${i.sku}`;
    const candidates = problemItems.filter(
      (i) =>
        i.insufficient_stock &&
        !i.sku_not_found &&
        (getSubstituteSku(i.sku) || variantSiblingBase(i.sku)) &&
        !autoTriedRef.current.has(triedKey(i))
    );
    if (candidates.length === 0) return;

    candidates.forEach(async (item) => {
      autoTriedRef.current.add(triedKey(item));
      const subSku = getSubstituteSku(item.sku);
      // Searching by the family base ("03-3768BL") returns every sibling's rows
      // in one query — the search RPC matches on the normalized SKU.
      const searchTerm = subSku ?? variantSiblingBase(item.sku);
      if (!searchTerm) return;
      const warehouse = item.warehouse || 'LUDLOW';
      try {
        const [bikes, parts, locationRows] = await Promise.all([
          inventoryApi.fetchInventoryWithMetadata({
            search: searchTerm,
            showParts: false,
            limit: 20,
          }),
          inventoryApi.fetchInventoryWithMetadata({
            search: searchTerm,
            showParts: true,
            limit: 20,
          }),
          supabase.from('locations').select('warehouse, location, picking_order'),
        ]);
        // The replacement is chosen the same way every other pick is: a buried
        // pallet is not offered while a normal shelf still has the bike. Without
        // this the auto-swap was the one chooser that still ranked on quantity
        // alone, and it silently sent the picker to the pallet.
        const rows = [...bikes.data, ...parts.data];
        const pickingOrder = toPickingOrderMap(locationRows.data);
        const best = subSku
          ? pickBestStockRow(rows, subSku, warehouse, pickingOrder, item.pickingQty)
          : pickVariantSiblingRow(rows, item.sku, warehouse, pickingOrder, item.pickingQty);
        // Only auto-swap when the substitute fully covers the order. Partial
        // stock is a judgment call — leave it flagged for the picker.
        if (!best || best.quantity < item.pickingQty) return;
        const rowId = rowOf(item);
        await onCorrectItem(
          {
            type: 'swap',
            originalSku: item.sku,
            replacement: {
              sku: best.sku,
              location: best.location,
              warehouse: best.warehouse,
              item_name: best.item_name ?? null,
            },
            reason: 'Auto-resolved: out-of-stock equivalent',
          },
          rowId
        );
        if (mountedRef.current) {
          setAutoResolved((prev) =>
            prev.some((e) => e.from === item.sku && e.to === best.sku && e.rowId === rowId)
              ? prev
              : [
                  ...prev,
                  {
                    from: item.sku,
                    to: best.sku,
                    rowId,
                    original: {
                      location: item.location,
                      warehouse,
                      item_name: item.item_name ?? null,
                    },
                  },
                ]
          );
        }
      } catch {
        // Live stock lookup failed — leave the item flagged for manual handling.
      }
    });
  }, [problemItems, onCorrectItem, rowOf]);

  const handleUndoAutoResolve = async (entry: {
    from: string;
    to: string;
    rowId?: string;
    original: { location: string | null; warehouse: string; item_name: string | null };
  }) => {
    if (undoingSku) return;
    setUndoingSku(entry.to);
    try {
      // Swap the substitute back to the original SKU and restore its out-of-stock
      // flag so it reads as the problem it was. The original stays in
      // autoTriedRef, so it is NOT auto-resolved again this session.
      await onCorrectItem(
        {
          type: 'swap',
          originalSku: entry.to,
          replacement: {
            sku: entry.from,
            location: entry.original.location,
            warehouse: entry.original.warehouse,
            item_name: entry.original.item_name,
          },
          flags: { insufficient_stock: true },
          reason: 'Undo auto-resolve',
        },
        targetOf(entry.to, entry.rowId)
      );
      if (mountedRef.current) {
        setAutoResolved((prev) =>
          prev.filter((e) => !(e.to === entry.to && e.rowId === entry.rowId))
        );
      }
    } finally {
      if (mountedRef.current) setUndoingSku(null);
    }
  };

  // ── Tier 2: proactive one-tap suggestion for out-of-stock items WITHOUT a
  // hardcoded substitute — the best same-model sibling that has stock. One tap
  // opens the existing confirm-replace flow (reason picker preserved).
  const cardSuggestions = useMemo(() => {
    const map = new Map<string, SimilarSku>();
    for (const item of problemItems) {
      if (!item.insufficient_stock || item.sku_not_found) continue;
      if (getSubstituteSku(item.sku)) continue; // tier 1 owns these
      const [best] = findSimilarSkus(item.sku, item.warehouse || 'LUDLOW', inventoryData, 1);
      if (best) map.set(item.sku, best);
    }
    return map;
  }, [problemItems, inventoryData]);

  // Server-side search (shared by Replace and Add Item panels)
  const [searchResults, setSearchResults] = useState<InventoryItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isSearchPanel = activePanel?.type === 'replace' || activePanel?.type === 'add_item';
    if (!isSearchPanel || searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setIsSearching(true);

    searchTimerRef.current = setTimeout(async () => {
      try {
        const [bikesRes, partsRes] = await Promise.all([
          inventoryApi.fetchInventoryWithMetadata({
            search: searchQuery,
            showParts: false,
            limit: 15,
          }),
          inventoryApi.fetchInventoryWithMetadata({
            search: searchQuery,
            showParts: true,
            limit: 15,
          }),
        ]);
        // Show every in-stock match — including the SAME SKU in OTHER locations,
        // which is exactly what's needed to re-source a pick when the assigned
        // location is empty. (Previously the item's own SKU was excluded by
        // value, which hid valid stock sitting in a different row/location.)
        setSearchResults([...bikesRes.data, ...partsRes.data].filter((inv) => inv.quantity > 0));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, activePanel]);

  // Reset reason when panel changes
  useEffect(() => {
    setSelectedReason('');
  }, [activePanel]);

  // ── Handlers ──

  // Every panel carries the order of the line it was opened on (see ActivePanel).

  const handleOpenRemove = (item: PickingItem) => {
    setActivePanel({ type: 'remove', sku: item.sku, rowId: rowOf(item) });
  };

  const handleOpenReplace = (item: PickingItem) => {
    setSearchQuery('');
    setActivePanel({ type: 'replace', sku: item.sku, rowId: rowOf(item) });
  };

  // idea-092: open the replace panel with the canonical SKU pre-filled in
  // the search. The picker still confirms (one click on the result row),
  // which preserves the audit trail through the existing swap flow.
  const handleUseCanonicalSku = (item: PickingItem, canonicalSku: string) => {
    setSearchQuery(canonicalSku);
    setActivePanel({ type: 'replace', sku: item.sku, rowId: rowOf(item) });
  };

  const handleOpenAdjustQty = async (item: PickingItem) => {
    const rowId = rowOf(item);
    setAdjustQty(item.pickingQty);
    setActivePanel({ type: 'adjust_qty', sku: item.sku, availableStock: -1, rowId });
    try {
      const [bikesRes, partsRes] = await Promise.all([
        inventoryApi.fetchInventoryWithMetadata({ search: item.sku, showParts: false, limit: 10 }),
        inventoryApi.fetchInventoryWithMetadata({ search: item.sku, showParts: true, limit: 10 }),
      ]);
      const totalStock = [...bikesRes.data, ...partsRes.data]
        .filter((inv) => inv.sku === item.sku && inv.warehouse === (item.warehouse || 'LUDLOW'))
        .reduce((sum, inv) => sum + (inv.quantity || 0), 0);
      setActivePanel({ type: 'adjust_qty', sku: item.sku, availableStock: totalStock, rowId });
    } catch {
      setActivePanel({ type: 'adjust_qty', sku: item.sku, availableStock: 0, rowId });
    }
  };

  const handleSelectReplacement = (
    originalSku: string,
    rowId: string | undefined,
    replacement: InventoryItem
  ) => {
    const originalItem = findLine(originalSku, rowId);
    setReplaceQty(originalItem?.pickingQty ?? 1);
    setActivePanel({ type: 'confirm_replace', sku: originalSku, replacement, rowId });
  };

  const handleSuggestionSelect = (item: PickingItem, alt: SimilarSku) => {
    handleSelectReplacement(item.sku, rowOf(item), {
      sku: alt.sku,
      location: alt.location,
      warehouse: item.warehouse || 'LUDLOW',
      item_name: alt.item_name,
      quantity: alt.quantity,
    } as InventoryItem);
  };

  const handleConfirmReplace = async () => {
    if (activePanel?.type !== 'confirm_replace' || isProcessing) return;
    setIsProcessing(true);
    try {
      const originalItem = findLine(activePanel.sku, activePanel.rowId);
      const qtyChanged = !!originalItem && replaceQty !== originalItem.pickingQty;
      await onCorrectItem(
        {
          type: 'swap',
          originalSku: activePanel.sku,
          replacement: {
            sku: activePanel.replacement.sku,
            location: activePanel.replacement.location,
            warehouse: activePanel.replacement.warehouse,
            item_name: activePanel.replacement.item_name ?? null,
          },
          newQty: qtyChanged ? replaceQty : undefined,
          reason: selectedReason || undefined,
        },
        targetOf(activePanel.sku, activePanel.rowId)
      );
      setActivePanel(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAdjustQty = async () => {
    if (activePanel?.type !== 'adjust_qty' || isProcessing) return;
    setIsProcessing(true);
    try {
      await onCorrectItem(
        {
          type: 'adjust_qty',
          sku: activePanel.sku,
          newQty: adjustQty,
          reason: selectedReason || undefined,
        },
        targetOf(activePanel.sku, activePanel.rowId)
      );
      setActivePanel(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (activePanel?.type !== 'remove' || isProcessing) return;
    setIsProcessing(true);
    try {
      await onCorrectItem(
        {
          type: 'remove',
          sku: activePanel.sku,
          reason: selectedReason || undefined,
        },
        targetOf(activePanel.sku, activePanel.rowId)
      );
      setRecentlyRemoved((prev) => [...prev, activePanel.sku]);
      setActivePanel(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // A new line has no order of its own: it goes where the operator confirms.
  // The tab on screen is the default; with every order on screen they choose.
  const openAddConfirm = (item: InventoryItem) => {
    setAddQty(1);
    setAddTarget(defaultAddTarget(orderFilter, orderTabs));
    setActivePanel({ type: 'confirm_add', item });
  };
  const addNeedsTarget = showOrderTabs && !addTarget;

  const handleConfirmAdd = async () => {
    if (activePanel?.type !== 'confirm_add' || isProcessing || addNeedsTarget) return;
    setIsProcessing(true);
    try {
      const addTargetListId = (isGroupEdit && addTarget) || targetListId;
      await onCorrectItem(
        {
          type: 'add',
          item: {
            sku: activePanel.item.sku,
            location: activePanel.item.location,
            warehouse: activePanel.item.warehouse,
            item_name: activePanel.item.item_name ?? null,
            pickingQty: addQty,
          },
          reason: selectedReason || undefined,
        },
        addTargetListId
      );
      setActivePanel(null);
      setSearchQuery('');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Render a single item card + expandable panels ──

  // The one card an open panel belongs to: that SKU in that order — the first
  // such line, so a line split across shelves does not open two panels.
  const activeLine =
    activePanel && 'sku' in activePanel ? findLine(activePanel.sku, activePanel.rowId) : undefined;

  const renderItemCard = (item: PickingItem) => {
    const isActive = !!activeLine && item === activeLine;
    const isProblem = item.sku_not_found || item.insufficient_stock;
    const lineRowId = rowOf(item);
    // With every order on screen each card says whose it is; with one order
    // picked, the tab already does.
    const lineOrderNumber =
      showOrderTabs && !orderFilter ? orderNumberOf.get(lineRowId ?? '') : undefined;
    const errorType = item.sku_not_found
      ? 'sku_not_found'
      : item.insufficient_stock
        ? 'insufficient_stock'
        : null;

    return (
      <div
        key={`${lineRowId ?? ''}|${item.sku}|${item.location ?? ''}`}
        className="flex flex-col gap-0"
      >
        {/* Card */}
        <div
          className={`bg-card border rounded-2xl p-4 transition-all duration-200 ${
            isActive ? 'border-subtle rounded-b-none' : 'border-subtle'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center justify-center min-w-[3rem] shrink-0 border-r border-subtle pr-3">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted/60 mb-0.5">
                QTY
              </span>
              <span
                className={`text-xl font-black leading-none ${item.pickingQty !== 1 ? 'text-amber-500' : 'text-content'}`}
              >
                {item.pickingQty}
              </span>
            </div>

            {item.sku_metadata?.image_url && (
              <img
                src={getThumbUrl(item.sku_metadata.image_url)}
                alt={item.sku}
                loading="lazy"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
                className="w-9 h-9 object-contain rounded flex-shrink-0 border border-subtle"
              />
            )}

            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className={`font-black text-xl tracking-tight leading-none break-all ${isProblem ? 'text-red-500' : 'text-content'}`}
                >
                  {item.sku}
                </span>
                {item.sku_not_found && (
                  <span className="text-[8px] bg-red-500 text-white px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">
                    UNREG
                  </span>
                )}
                {item.insufficient_stock && !item.sku_not_found && (
                  <span className="text-[8px] bg-amber-500 text-black px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">
                    LOW STOCK
                  </span>
                )}
                {lineOrderNumber && (
                  <span className="text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-2 py-0.5 rounded-md font-black tracking-tight">
                    #{lineOrderNumber}
                  </span>
                )}
              </div>
              {(item.item_name || item.description) && (
                <span className="text-[11px] font-semibold text-muted uppercase tracking-wide leading-none truncate">
                  {(item.item_name || item.description || '').slice(0, 30)}
                </span>
              )}
              <SkuFormatSuggestion
                rawSku={item.sku}
                enabled={!!item.sku_not_found}
                onUseCanonical={(canonical) => handleUseCanonicalSku(item, canonical)}
              />
            </div>

            <div className="flex flex-col items-end shrink-0">
              <span className="text-[8px] font-black uppercase tracking-widest text-muted/60">
                LOC
              </span>
              <span className="text-[11px] font-black text-content/70 uppercase">
                {(item.location || '').replace(/row/i, '').trim().slice(0, 5) || '-'}
              </span>
            </div>
          </div>

          {/* Action buttons — same for all items */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-subtle">
            <button
              onClick={() =>
                isActive && activePanel?.type === 'replace'
                  ? setActivePanel(null)
                  : handleOpenReplace(item)
              }
              className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-accent/15 text-accent border border-accent/20 transition-all hover:bg-accent/25 active:scale-[0.97]"
            >
              <RefreshCw size={12} className="inline mr-1.5 -mt-0.5" /> Replace
            </button>
            {errorType !== 'sku_not_found' && (
              <button
                onClick={() =>
                  isActive && activePanel?.type === 'adjust_qty'
                    ? setActivePanel(null)
                    : handleOpenAdjustQty(item)
                }
                className={`flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] border transition-all active:scale-[0.97] ${
                  errorType === 'insufficient_stock'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25'
                    : 'bg-card text-muted border-subtle hover:bg-card'
                }`}
              >
                Adjust Qty
              </button>
            )}
            <button
              onClick={() =>
                isActive && activePanel?.type === 'remove'
                  ? setActivePanel(null)
                  : handleOpenRemove(item)
              }
              className="min-h-12 px-4 rounded-xl font-black uppercase tracking-widest text-[10px] bg-red-500/15 text-red-400 border border-red-500/20 transition-all hover:bg-red-500/25 active:scale-[0.97]"
            >
              <Trash2 size={12} className="inline mr-1 -mt-0.5" /> Remove
            </button>
          </div>

          {/* Tier 2: proactive one-tap suggestion for out-of-stock items that
              have no hardcoded substitute. Opens the confirm-replace flow so the
              picker still confirms with a reason. */}
          {!isActive && cardSuggestions.get(item.sku) && (
            <button
              onClick={() => handleSuggestionSelect(item, cardSuggestions.get(item.sku)!)}
              className="mt-2 w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/20 active:scale-[0.98] transition-all"
            >
              <span className="flex items-center gap-1.5 min-w-0">
                <RefreshCw size={11} className="text-emerald-400 shrink-0" />
                <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300 truncate">
                  Replace with {cardSuggestions.get(item.sku)!.sku}
                </span>
              </span>
              <span className="text-[10px] font-black text-emerald-400 shrink-0">
                {cardSuggestions.get(item.sku)!.quantity} avail
              </span>
            </button>
          )}
        </div>

        {/* ── Expandable panels ── */}

        {isActive && activePanel?.type === 'replace' && (
          <div className="bg-card border border-subtle border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <SearchPanel
              query={searchQuery}
              onQueryChange={setSearchQuery}
              results={searchResults}
              isSearching={isSearching}
              onSelectResult={(r) => handleSelectReplacement(item.sku, lineRowId, r)}
              suggestions={similarSkus}
              onSelectSuggestion={(alt) => handleSuggestionSelect(item, alt)}
            />
          </div>
        )}

        {isActive && activePanel?.type === 'confirm_replace' && (
          <div className="bg-card border border-subtle border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="text-center mb-4">
              <span className="text-[10px] font-black text-muted/70 uppercase tracking-widest">
                Replace
              </span>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className={`font-black text-sm ${isProblem ? 'text-red-400' : 'text-muted'}`}>
                  {activePanel.sku}
                </span>
                <RefreshCw size={12} className="text-muted/60" />
                <span className="font-black text-green-400 text-sm">
                  {activePanel.replacement.sku}
                </span>
              </div>
              {activePanel.replacement.item_name && (
                <span className="text-[10px] text-muted/70 mt-1 block">
                  {activePanel.replacement.item_name.slice(0, 40)}
                </span>
              )}
            </div>
            <QtyInput value={replaceQty} onChange={setReplaceQty} autoSelect={autoSelect} />
            <p className="text-[9px] text-muted/60 text-center mb-4 font-black uppercase tracking-widest">
              {activePanel.replacement.quantity} available in stock
            </p>
            <ReasonPicker
              actionType="swap"
              preselect={isProblem ? 'Out of stock — replacing' : undefined}
              selectedReason={selectedReason}
              onReasonChange={setSelectedReason}
            />
            <ActionButtons
              onCancel={() =>
                setActivePanel({ type: 'replace', sku: activePanel.sku, rowId: activePanel.rowId })
              }
              onConfirm={handleConfirmReplace}
              isProcessing={isProcessing}
              confirmLabel="Confirm Replace"
              disabled={!selectedReason}
            />
          </div>
        )}

        {isActive && activePanel?.type === 'adjust_qty' && (
          <div className="bg-card border border-subtle border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <QtyInput value={adjustQty} onChange={setAdjustQty} autoSelect={autoSelect} />
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="text-[9px] text-muted/60 font-black uppercase tracking-widest">
                Ordered: {item.pickingQty}
              </span>
              <span className="text-[9px] text-muted/20">|</span>
              <span
                className={`text-[9px] font-black uppercase tracking-widest ${
                  activePanel.availableStock === -1
                    ? 'text-muted/60'
                    : activePanel.availableStock > 0
                      ? 'text-green-400/70'
                      : 'text-red-400/70'
                }`}
              >
                Available: {activePanel.availableStock === -1 ? '...' : activePanel.availableStock}
              </span>
            </div>
            <ReasonPicker
              actionType="adjust_qty"
              preselect={item.insufficient_stock ? 'Partial stock only' : undefined}
              selectedReason={selectedReason}
              onReasonChange={setSelectedReason}
            />
            <ActionButtons
              onCancel={() => setActivePanel(null)}
              onConfirm={handleConfirmAdjustQty}
              isProcessing={isProcessing}
              confirmLabel="Update Qty"
              disabled={adjustQty === item.pickingQty || !selectedReason}
            />
          </div>
        )}

        {isActive && activePanel?.type === 'remove' && (
          <div className="bg-card border border-subtle border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <p className="text-sm text-content/70 text-center mb-4">
              Remove <span className="font-black text-red-400">{item.sku}</span> from{' '}
              {showOrderTabs && orderNumberOf.get(lineRowId ?? '') ? (
                <span className="font-black text-content">
                  #{orderNumberOf.get(lineRowId ?? '')}
                </span>
              ) : (
                'order'
              )}
              ?
            </p>
            <ReasonPicker
              actionType="remove"
              preselect={item.insufficient_stock ? 'Out of stock' : undefined}
              selectedReason={selectedReason}
              onReasonChange={setSelectedReason}
            />
            <ActionButtons
              onCancel={() => setActivePanel(null)}
              onConfirm={handleConfirmRemove}
              isProcessing={isProcessing}
              confirmLabel="Yes, Remove"
              confirmClass="bg-red-500 text-white border border-red-500"
              disabled={!selectedReason}
            />
          </div>
        )}
      </div>
    );
  };

  // ── Layout ──

  return (
    <div className="fixed inset-0 z-30 bg-main flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-subtle bg-main">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="p-2 hover:bg-card rounded-full text-muted transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <h1
            className={`text-lg font-black uppercase tracking-widest ${isReopened ? 'text-orange-400' : 'text-content'}`}
          >
            {isReopened ? 'Reopen Order' : 'Edit Order'}
          </h1>
          {/* The order tabs below name every order; the combined number would repeat them. */}
          {orderNumber && !showOrderTabs && (
            <span
              className={`text-[9px] font-black uppercase tracking-tighter px-2 py-0.5 rounded border ${
                isReopened
                  ? 'text-orange-400/80 bg-orange-500/10 border-orange-500/20'
                  : 'text-muted bg-card border-subtle'
              }`}
            >
              {orderNumber}
            </span>
          )}
        </div>
      </div>

      {/* Order tabs — a combined group, one order at a time */}
      {showOrderTabs && (
        <div
          role="tablist"
          aria-label="Orders in this group"
          className="px-4 pt-3 flex flex-wrap gap-2"
        >
          <OrderTabButton
            label="ALL"
            lines={allItems.length}
            issues={problemItems.length}
            selected={orderFilter === null}
            onSelect={() => selectOrder(null)}
          />
          {orderTabs.map((tab) => (
            <OrderTabButton
              key={tab.rowId}
              label={`#${tab.orderNumber}`}
              lines={tab.lines}
              issues={tab.issues}
              selected={orderFilter === tab.rowId}
              onSelect={() => selectOrder(tab.rowId)}
            />
          ))}
        </div>
      )}

      {/* Summary badge */}
      <div className="px-4 py-3">
        <div
          className={`flex items-center gap-2 rounded-xl px-4 py-2 ${
            visibleProblems.length > 0
              ? 'bg-amber-500/10 border border-amber-500/20'
              : 'bg-card border border-subtle'
          }`}
        >
          {visibleProblems.length > 0 ? (
            <AlertTriangle className="text-amber-500 flex-shrink-0" size={16} />
          ) : (
            <Check className="text-green-400 flex-shrink-0" size={16} />
          )}
          <span
            className={`text-[11px] font-black uppercase tracking-widest ${visibleProblems.length > 0 ? 'text-amber-400' : 'text-muted'}`}
          >
            {visibleProblems.length > 0
              ? `${visibleProblems.length} issue${visibleProblems.length !== 1 ? 's' : ''}`
              : 'No issues'}
            {' · '}
            {visibleItems.length} item{visibleItems.length !== 1 ? 's' : ''} total
          </span>
        </div>
      </div>

      {/* Auto-resolved substitutions (tier 1) — out-of-stock SKU swapped for a
          hardcoded equivalent that has stock. Undo reverts and re-flags it. */}
      {autoResolved.length > 0 && (
        <div className="px-4 pb-1 flex flex-col gap-2">
          {autoResolved.map((entry) => (
            <div
              key={`${entry.rowId ?? ''}|${entry.from}->${entry.to}`}
              className="flex items-center gap-2 rounded-xl px-4 py-2 bg-emerald-500/10 border border-emerald-500/25"
            >
              <Check className="text-emerald-400 flex-shrink-0" size={14} strokeWidth={3} />
              <span className="text-[10px] font-black uppercase tracking-widest text-emerald-300/90 flex-1 min-w-0 truncate">
                Auto-resolved · <span className="text-emerald-400">{entry.from}</span>
                {' → '}
                <span className="text-emerald-400">{entry.to}</span>
                {showOrderTabs && orderNumberOf.get(entry.rowId ?? '') && (
                  <> · #{orderNumberOf.get(entry.rowId ?? '')}</>
                )}
              </span>
              <button
                onClick={() => handleUndoAutoResolve(entry)}
                disabled={undoingSku === entry.to}
                className="px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25 disabled:opacity-50 active:scale-95 transition-all"
              >
                {undoingSku === entry.to ? '…' : 'Undo'}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-4 pb-32 min-h-0">
        <div className="flex flex-col gap-3">
          {/* Problem items first */}
          {visibleProblems.map(renderItemCard)}

          {/* Divider */}
          {visibleProblems.length > 0 && normalItems.length > 0 && (
            <div className="flex items-center gap-3 mt-6 mb-2">
              <div className="h-[1px] flex-1 bg-card" />
              <span className="text-[9px] font-black text-muted/60 uppercase tracking-widest">
                Other Items
              </span>
              <div className="h-[1px] flex-1 bg-card" />
            </div>
          )}

          {/* Normal items */}
          {normalItems.map(renderItemCard)}

          {/* Add Item */}
          <div className="mt-6">
            {activePanel?.type === 'add_item' ? (
              <div className="bg-card border border-accent/20 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {recentlyRemoved.length > 0 && (
                  <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <span className="text-[10px] font-bold text-amber-400">
                      You removed {recentlyRemoved[recentlyRemoved.length - 1]} — consider using{' '}
                      <strong>Replace</strong> on the item instead for a cleaner audit trail.
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black text-accent uppercase tracking-widest">
                    Add Item to Order
                  </span>
                  <button
                    onClick={() => {
                      setActivePanel(null);
                      setSearchQuery('');
                    }}
                    className="p-1 hover:bg-card rounded-full text-muted/60"
                  >
                    <X size={16} />
                  </button>
                </div>
                <SearchPanel
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  results={searchResults}
                  isSearching={isSearching}
                  onSelectResult={openAddConfirm}
                />
              </div>
            ) : activePanel?.type === 'confirm_add' ? (
              <div className="bg-card border border-accent/20 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="text-center mb-4">
                  <span className="text-[10px] font-black text-muted/70 uppercase tracking-widest">
                    Add to Order
                  </span>
                  <div className="font-black text-accent text-lg mt-1">{activePanel.item.sku}</div>
                  {activePanel.item.item_name && (
                    <span className="text-[10px] text-muted/70">
                      {activePanel.item.item_name.slice(0, 40)}
                    </span>
                  )}
                </div>
                {/* Which order gets the new line — first, since it is the one
                    thing a combined group cannot guess when every order is on
                    screen. The tab on screen comes pre-selected. */}
                {showOrderTabs && (
                  <div className="mb-4">
                    <p className="text-[10px] font-black text-muted/70 uppercase tracking-widest mb-2 text-center">
                      Add to
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {orderTabs.map((tab) => (
                        <button
                          key={tab.rowId}
                          onClick={() => setAddTarget(tab.rowId)}
                          aria-pressed={addTarget === tab.rowId}
                          className={`min-h-11 px-4 rounded-xl text-sm font-black tracking-tight border transition-all active:scale-[0.97] touch-manipulation ${
                            addTarget === tab.rowId
                              ? 'bg-accent text-main border-accent'
                              : 'bg-surface text-content border-subtle hover:border-accent/30'
                          }`}
                        >
                          #{tab.orderNumber}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <QtyInput value={addQty} onChange={setAddQty} autoSelect={autoSelect} />
                <p className="text-[9px] text-muted/60 text-center mb-4 font-black uppercase tracking-widest">
                  {activePanel.item.location?.replace(/row/i, 'ROW') || 'No location'} ·{' '}
                  {activePanel.item.quantity} available
                </p>
                <ReasonPicker
                  actionType="add"
                  preselect={
                    recentlyRemoved.length > 0 ? 'Replacement for removed item' : undefined
                  }
                  selectedReason={selectedReason}
                  onReasonChange={setSelectedReason}
                />
                <ActionButtons
                  onCancel={() => {
                    setActivePanel({ type: 'add_item' });
                    setSearchQuery('');
                  }}
                  onConfirm={handleConfirmAdd}
                  isProcessing={isProcessing}
                  confirmLabel={
                    showOrderTabs && addTarget
                      ? `Add to #${orderNumberOf.get(addTarget) ?? ''}`
                      : addNeedsTarget
                        ? 'Pick an order'
                        : 'Add to Order'
                  }
                  disabled={!selectedReason || addNeedsTarget}
                />
              </div>
            ) : (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setActivePanel({ type: 'add_item' });
                }}
                className="w-full min-h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] bg-accent/10 text-accent border border-accent/20 transition-all hover:bg-accent/20 active:scale-[0.97] flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Add Item
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer — Done button */}
      <div className="shrink-0 p-4 pb-28 border-t border-subtle bg-main">
        <button
          onClick={() => {
            if (isReopened && initialSnapshot !== null) {
              const current = JSON.stringify(
                allItems.map((i) => ({ sku: i.sku, qty: i.pickingQty }))
              );
              if (current === initialSnapshot) {
                // No changes — cancel reopen entirely
                onCancelReopen?.();
                return;
              }
            }
            onClose();
          }}
          className={`w-full py-4 font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2 ${
            isReopened
              ? 'bg-orange-500 text-white shadow-orange-500/20'
              : 'bg-accent text-main shadow-accent/20'
          }`}
        >
          <Check size={16} strokeWidth={3} />
          {isReopened ? (hasChanges ? 'Review Changes' : 'Close Without Changes') : 'Done Editing'}
        </button>
      </div>
    </div>
  );
};
