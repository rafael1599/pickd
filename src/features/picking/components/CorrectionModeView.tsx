import React, { useState, useMemo, useEffect, useRef } from 'react';
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
import { inventoryApi } from '../../inventory/api/inventoryApi';
import type { PickingItem, CorrectionAction } from './DoubleCheckView';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import type { InventoryItem } from '../../../schemas/inventory.schema';
import { useAutoSelect } from '../../../hooks/useAutoSelect';
import { ReasonPicker } from './ReasonPicker';

interface CorrectionModeViewProps {
  problemItems: PickingItem[];
  allItems: PickingItem[];
  inventoryData: InventoryItemWithMetadata[];
  onCorrectItem: (action: CorrectionAction) => Promise<void>;
  onClose: () => void;
  orderNumber?: string | null;
  isReopened?: boolean;
  onCancelReopen?: () => void;
}

type ActivePanel =
  | { type: 'replace'; sku: string }
  | { type: 'adjust_qty'; sku: string; availableStock: number }
  | { type: 'remove'; sku: string }
  | { type: 'confirm_replace'; sku: string; replacement: InventoryItem }
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
    className="flex items-center gap-3 p-3 bg-white/5 border border-white/5 rounded-xl hover:border-accent/30 hover:bg-accent/5 transition-all active:scale-[0.98] touch-manipulation"
  >
    <div className="flex flex-col items-start min-w-0 flex-1">
      <span className="font-black text-sm text-white tracking-tight">{item.sku}</span>
      {item.item_name && (
        <span className="text-[10px] text-white/40 truncate w-full text-left">
          {item.item_name.slice(0, 35)}
        </span>
      )}
    </div>
    <div className="flex flex-col items-end shrink-0 gap-0.5">
      <span className="text-[9px] font-black text-white/30 uppercase">
        {(item.location || '-').replace(/row/i, '').trim().slice(0, 5)}
      </span>
      <span className="text-[10px] font-black text-green-400">{item.quantity ?? 0} avail</span>
    </div>
  </button>
);

/* ── Search input + results (shared by Replace and Add Item) ── */
const SearchPanel: React.FC<{
  query: string;
  onQueryChange: (q: string) => void;
  results: InventoryItem[];
  isSearching: boolean;
  onSelectResult: (item: InventoryItem) => void;
  suggestions?: SimilarSku[];
  onSelectSuggestion?: (alt: SimilarSku) => void;
}> = ({ query, onQueryChange, results, isSearching, onSelectResult, suggestions, onSelectSuggestion }) => (
  <>
    {suggestions && suggestions.length > 0 && onSelectSuggestion && (
      <div className="mb-4">
        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">
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
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
      <input
        type="text"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Search SKU or name..."
        autoCapitalize="characters"
        autoCorrect="off"
        spellCheck="false"
        autoFocus
        className="w-full pl-9 pr-9 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-white/25 focus:outline-none focus:border-accent/40 font-mono"
      />
      {query && (
        <button
          onClick={() => onQueryChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
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
        <Loader size={14} className="text-white/30 animate-spin" />
        <span className="text-[10px] text-white/30 uppercase tracking-widest font-black">
          Searching...
        </span>
      </div>
    )}

    {query.length >= 2 && !isSearching && results.length === 0 && (
      <p className="text-[10px] text-white/30 text-center py-3 uppercase tracking-widest font-black">
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
      className="w-20 text-center text-3xl font-black text-white bg-white/5 border border-white/20 rounded-xl py-2 focus:outline-none focus:border-accent/50 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
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
      className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-white/5 text-white/50 border border-white/10 transition-all hover:bg-white/10 active:scale-[0.97]"
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

/* ── Main component ── */
export const CorrectionModeView: React.FC<CorrectionModeViewProps> = ({
  problemItems,
  allItems,
  inventoryData,
  onCorrectItem,
  onClose,
  orderNumber,
  isReopened = false,
  onCancelReopen,
}) => {
  // Track original items to detect changes for reopened orders
  const [initialSnapshot] = useState(() =>
    isReopened ? JSON.stringify(allItems.map(i => ({ sku: i.sku, qty: i.pickingQty }))) : null
  );
  const hasChanges = isReopened && initialSnapshot !== null &&
    initialSnapshot !== JSON.stringify(allItems.map(i => ({ sku: i.sku, qty: i.pickingQty })));

  const [activePanel, setActivePanel] = useState<ActivePanel>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [replaceQty, setReplaceQty] = useState(1);
  const [adjustQty, setAdjustQty] = useState(1);
  const [addQty, setAddQty] = useState(1);
  const autoSelect = useAutoSelect();
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedReason, setSelectedReason] = useState('');
  const [recentlyRemoved, setRecentlyRemoved] = useState<string[]>([]);

  const normalItems = useMemo(
    () => allItems.filter((i) => !i.sku_not_found && !i.insufficient_stock),
    [allItems],
  );

  const similarSkus = useMemo(() => {
    if (activePanel?.type !== 'replace') return [];
    const item = allItems.find((i) => i.sku === activePanel.sku);
    if (!item) return [];
    return findSimilarSkus(item.sku, item.warehouse || 'LUDLOW', inventoryData, 5);
  }, [activePanel, allItems, inventoryData]);

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
    const excludeSku =
      activePanel?.type === 'replace'
        ? allItems.find((i) => i.sku === activePanel.sku)?.sku
        : undefined;

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    setIsSearching(true);

    searchTimerRef.current = setTimeout(async () => {
      try {
        const [bikesRes, partsRes] = await Promise.all([
          inventoryApi.fetchInventoryWithMetadata({ search: searchQuery, showParts: false, limit: 15 }),
          inventoryApi.fetchInventoryWithMetadata({ search: searchQuery, showParts: true, limit: 15 }),
        ]);
        setSearchResults(
          [...bikesRes.data, ...partsRes.data].filter(
            (inv) => (!excludeSku || inv.sku !== excludeSku) && inv.quantity > 0,
          ),
        );
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery, activePanel, allItems]);

  // Reset reason when panel changes
  useEffect(() => {
    setSelectedReason('');
  }, [activePanel]);

  // ── Handlers ──

  const handleOpenRemove = (sku: string) => {
    setActivePanel({ type: 'remove', sku });
  };

  const handleOpenReplace = (sku: string) => {
    setSearchQuery('');
    setActivePanel({ type: 'replace', sku });
  };

  const handleOpenAdjustQty = async (item: PickingItem) => {
    setAdjustQty(item.pickingQty);
    setActivePanel({ type: 'adjust_qty', sku: item.sku, availableStock: -1 });
    try {
      const [bikesRes, partsRes] = await Promise.all([
        inventoryApi.fetchInventoryWithMetadata({ search: item.sku, showParts: false, limit: 10 }),
        inventoryApi.fetchInventoryWithMetadata({ search: item.sku, showParts: true, limit: 10 }),
      ]);
      const totalStock = [...bikesRes.data, ...partsRes.data]
        .filter((inv) => inv.sku === item.sku && inv.warehouse === (item.warehouse || 'LUDLOW'))
        .reduce((sum, inv) => sum + (inv.quantity || 0), 0);
      setActivePanel({ type: 'adjust_qty', sku: item.sku, availableStock: totalStock });
    } catch {
      setActivePanel({ type: 'adjust_qty', sku: item.sku, availableStock: 0 });
    }
  };

  const handleSelectReplacement = (originalSku: string, replacement: InventoryItem) => {
    const originalItem = allItems.find((i) => i.sku === originalSku);
    setReplaceQty(originalItem?.pickingQty ?? 1);
    setActivePanel({ type: 'confirm_replace', sku: originalSku, replacement });
  };

  const handleSuggestionSelect = (itemSku: string, alt: SimilarSku, warehouse: string) => {
    handleSelectReplacement(itemSku, {
      sku: alt.sku,
      location: alt.location,
      warehouse,
      item_name: alt.item_name,
      quantity: alt.quantity,
    } as InventoryItem);
  };

  const handleConfirmReplace = async () => {
    if (activePanel?.type !== 'confirm_replace' || isProcessing) return;
    setIsProcessing(true);
    try {
      await onCorrectItem({
        type: 'swap',
        originalSku: activePanel.sku,
        replacement: {
          sku: activePanel.replacement.sku,
          location: activePanel.replacement.location,
          warehouse: activePanel.replacement.warehouse,
          item_name: activePanel.replacement.item_name ?? null,
        },
        reason: selectedReason || undefined,
      });
      const originalItem = allItems.find((i) => i.sku === activePanel.sku);
      if (originalItem && replaceQty !== originalItem.pickingQty) {
        await onCorrectItem({ type: 'adjust_qty', sku: activePanel.replacement.sku, newQty: replaceQty });
      }
      setActivePanel(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAdjustQty = async () => {
    if (activePanel?.type !== 'adjust_qty' || isProcessing) return;
    setIsProcessing(true);
    try {
      await onCorrectItem({ type: 'adjust_qty', sku: activePanel.sku, newQty: adjustQty, reason: selectedReason || undefined });
      setActivePanel(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmRemove = async () => {
    if (activePanel?.type !== 'remove' || isProcessing) return;
    setIsProcessing(true);
    try {
      await onCorrectItem({ type: 'remove', sku: activePanel.sku, reason: selectedReason || undefined });
      setRecentlyRemoved((prev) => [...prev, activePanel.sku]);
      setActivePanel(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirmAdd = async () => {
    if (activePanel?.type !== 'confirm_add' || isProcessing) return;
    setIsProcessing(true);
    try {
      await onCorrectItem({
        type: 'add',
        item: {
          sku: activePanel.item.sku,
          location: activePanel.item.location,
          warehouse: activePanel.item.warehouse,
          item_name: activePanel.item.item_name ?? null,
          pickingQty: addQty,
        },
        reason: selectedReason || undefined,
      });
      setActivePanel(null);
      setSearchQuery('');
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Render a single item card + expandable panels ──

  const renderItemCard = (item: PickingItem) => {
    const isActive = activePanel !== null && 'sku' in activePanel && activePanel.sku === item.sku;
    const isProblem = item.sku_not_found || item.insufficient_stock;
    const errorType = item.sku_not_found ? 'sku_not_found' : item.insufficient_stock ? 'insufficient_stock' : null;

    return (
      <div key={item.sku} className="flex flex-col gap-0">
        {/* Card */}
        <div
          className={`bg-white/5 border rounded-2xl p-4 transition-all duration-200 ${
            isActive ? 'border-white/20 rounded-b-none' : 'border-white/10'
          }`}
        >
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-center justify-center min-w-[3rem] shrink-0 border-r border-white/10 pr-3">
              <span className="text-[8px] font-black uppercase tracking-widest text-white/30 mb-0.5">QTY</span>
              <span className={`text-xl font-black leading-none ${item.pickingQty !== 1 ? 'text-amber-500' : 'text-white'}`}>
                {item.pickingQty}
              </span>
            </div>

            {item.sku_metadata?.image_url && (
              <img
                src={getThumbUrl(item.sku_metadata.image_url)}
                alt={item.sku}
                loading="lazy"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                className="w-9 h-9 object-contain rounded flex-shrink-0 border border-white/20"
              />
            )}

            <div className="flex flex-col gap-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`font-black text-xl tracking-tight leading-none break-all ${isProblem ? 'text-red-500' : 'text-white'}`}>
                  {item.sku}
                </span>
                {item.sku_not_found && (
                  <span className="text-[8px] bg-red-500 text-white px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">UNREG</span>
                )}
                {item.insufficient_stock && !item.sku_not_found && (
                  <span className="text-[8px] bg-amber-500 text-black px-1 py-0.5 rounded font-black uppercase tracking-tighter animate-pulse">LOW STOCK</span>
                )}
              </div>
              {(item.item_name || item.description) && (
                <span className="text-[11px] font-semibold text-white/45 uppercase tracking-wide leading-none truncate">
                  {(item.item_name || item.description || '').slice(0, 30)}
                </span>
              )}
            </div>

            <div className="flex flex-col items-end shrink-0">
              <span className="text-[8px] font-black uppercase tracking-widest text-white/30">LOC</span>
              <span className="text-[11px] font-black text-white/70 uppercase">
                {(item.location || '').replace(/row/i, '').trim().slice(0, 5) || '-'}
              </span>
            </div>
          </div>

          {/* Action buttons — same for all items */}
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-white/5">
            <button
              onClick={() => (isActive && activePanel?.type === 'replace' ? setActivePanel(null) : handleOpenReplace(item.sku))}
              className="flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] bg-accent/15 text-accent border border-accent/20 transition-all hover:bg-accent/25 active:scale-[0.97]"
            >
              <RefreshCw size={12} className="inline mr-1.5 -mt-0.5" /> Replace
            </button>
            {errorType !== 'sku_not_found' && (
              <button
                onClick={() => (isActive && activePanel?.type === 'adjust_qty' ? setActivePanel(null) : handleOpenAdjustQty(item))}
                className={`flex-1 min-h-12 rounded-xl font-black uppercase tracking-widest text-[10px] border transition-all active:scale-[0.97] ${
                  errorType === 'insufficient_stock'
                    ? 'bg-amber-500/15 text-amber-400 border-amber-500/20 hover:bg-amber-500/25'
                    : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'
                }`}
              >
                Adjust Qty
              </button>
            )}
            <button
              onClick={() => (isActive && activePanel?.type === 'remove' ? setActivePanel(null) : handleOpenRemove(item.sku))}
              className="min-h-12 px-4 rounded-xl font-black uppercase tracking-widest text-[10px] bg-red-500/15 text-red-400 border border-red-500/20 transition-all hover:bg-red-500/25 active:scale-[0.97]"
            >
              <Trash2 size={12} className="inline mr-1 -mt-0.5" /> Remove
            </button>
          </div>
        </div>

        {/* ── Expandable panels ── */}

        {isActive && activePanel?.type === 'replace' && (
          <div className="bg-white/[0.03] border border-white/10 border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <SearchPanel
              query={searchQuery}
              onQueryChange={setSearchQuery}
              results={searchResults}
              isSearching={isSearching}
              onSelectResult={(r) => handleSelectReplacement(item.sku, r)}
              suggestions={similarSkus}
              onSelectSuggestion={(alt) => handleSuggestionSelect(item.sku, alt, item.warehouse || 'LUDLOW')}
            />
          </div>
        )}

        {isActive && activePanel?.type === 'confirm_replace' && (
          <div className="bg-white/[0.03] border border-white/10 border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="text-center mb-4">
              <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Replace</span>
              <div className="flex items-center justify-center gap-2 mt-1">
                <span className={`font-black text-sm ${isProblem ? 'text-red-400' : 'text-white/60'}`}>{activePanel.sku}</span>
                <RefreshCw size={12} className="text-white/30" />
                <span className="font-black text-green-400 text-sm">{activePanel.replacement.sku}</span>
              </div>
              {activePanel.replacement.item_name && (
                <span className="text-[10px] text-white/40 mt-1 block">{activePanel.replacement.item_name.slice(0, 40)}</span>
              )}
            </div>
            <QtyInput value={replaceQty} onChange={setReplaceQty} autoSelect={autoSelect} />
            <p className="text-[9px] text-white/30 text-center mb-4 font-black uppercase tracking-widest">
              {activePanel.replacement.quantity} available in stock
            </p>
            <ReasonPicker
              actionType="swap"
              preselect={isProblem ? 'Out of stock — replacing' : undefined}
              selectedReason={selectedReason}
              onReasonChange={setSelectedReason}
            />
            <ActionButtons
              onCancel={() => setActivePanel({ type: 'replace', sku: activePanel.sku })}
              onConfirm={handleConfirmReplace}
              isProcessing={isProcessing}
              confirmLabel="Confirm Replace"
              disabled={!selectedReason}
            />
          </div>
        )}

        {isActive && activePanel?.type === 'adjust_qty' && (
          <div className="bg-white/[0.03] border border-white/10 border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <QtyInput value={adjustQty} onChange={setAdjustQty} autoSelect={autoSelect} />
            <div className="flex items-center justify-center gap-3 mb-4">
              <span className="text-[9px] text-white/30 font-black uppercase tracking-widest">Ordered: {item.pickingQty}</span>
              <span className="text-[9px] text-white/10">|</span>
              <span
                className={`text-[9px] font-black uppercase tracking-widest ${
                  activePanel.availableStock === -1 ? 'text-white/30' : activePanel.availableStock > 0 ? 'text-green-400/70' : 'text-red-400/70'
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
          <div className="bg-white/[0.03] border border-white/10 border-t-0 rounded-b-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <p className="text-sm text-white/70 text-center mb-4">
              Remove <span className="font-black text-red-400">{item.sku}</span> from order?
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
    <div className="fixed inset-0 z-30 bg-black flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-white/10 bg-black">
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-white/50 transition-colors">
            <ChevronLeft size={24} />
          </button>
          <h1 className={`text-lg font-black uppercase tracking-widest ${isReopened ? 'text-orange-400' : 'text-white'}`}>
            {isReopened ? 'Reopen Order' : 'Edit Order'}
          </h1>
          {orderNumber && (
            <span className={`text-[9px] font-black uppercase tracking-tighter px-2 py-0.5 rounded border ${
              isReopened
                ? 'text-orange-400/80 bg-orange-500/10 border-orange-500/20'
                : 'text-white/60 bg-white/5 border-white/5'
            }`}>
              {orderNumber}
            </span>
          )}
        </div>
      </div>

      {/* Summary badge */}
      <div className="px-4 py-3">
        <div
          className={`flex items-center gap-2 rounded-xl px-4 py-2 ${
            problemItems.length > 0 ? 'bg-amber-500/10 border border-amber-500/20' : 'bg-white/5 border border-white/10'
          }`}
        >
          {problemItems.length > 0 ? (
            <AlertTriangle className="text-amber-500 flex-shrink-0" size={16} />
          ) : (
            <Check className="text-green-400 flex-shrink-0" size={16} />
          )}
          <span className={`text-[11px] font-black uppercase tracking-widest ${problemItems.length > 0 ? 'text-amber-400' : 'text-white/50'}`}>
            {problemItems.length > 0 ? `${problemItems.length} issue${problemItems.length !== 1 ? 's' : ''}` : 'No issues'}
            {' · '}
            {allItems.length} item{allItems.length !== 1 ? 's' : ''} total
          </span>
        </div>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-4 pb-32 min-h-0">
        <div className="flex flex-col gap-3">
          {/* Problem items first */}
          {problemItems.map(renderItemCard)}

          {/* Divider */}
          {problemItems.length > 0 && normalItems.length > 0 && (
            <div className="flex items-center gap-3 mt-6 mb-2">
              <div className="h-[1px] flex-1 bg-white/10" />
              <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">Other Items</span>
              <div className="h-[1px] flex-1 bg-white/10" />
            </div>
          )}

          {/* Normal items */}
          {normalItems.map(renderItemCard)}

          {/* Add Item */}
          <div className="mt-6">
            {activePanel?.type === 'add_item' ? (
              <div className="bg-white/[0.03] border border-accent/20 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                {recentlyRemoved.length > 0 && (
                  <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <span className="text-[10px] font-bold text-amber-400">
                      You removed {recentlyRemoved[recentlyRemoved.length - 1]} — consider using <strong>Replace</strong> on the item instead for a cleaner audit trail.
                    </span>
                  </div>
                )}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black text-accent uppercase tracking-widest">Add Item to Order</span>
                  <button
                    onClick={() => { setActivePanel(null); setSearchQuery(''); }}
                    className="p-1 hover:bg-white/10 rounded-full text-white/30"
                  >
                    <X size={16} />
                  </button>
                </div>
                <SearchPanel
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  results={searchResults}
                  isSearching={isSearching}
                  onSelectResult={(item) => { setAddQty(1); setActivePanel({ type: 'confirm_add', item }); }}
                />
              </div>
            ) : activePanel?.type === 'confirm_add' ? (
              <div className="bg-white/[0.03] border border-accent/20 rounded-2xl p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="text-center mb-4">
                  <span className="text-[10px] font-black text-white/40 uppercase tracking-widest">Add to Order</span>
                  <div className="font-black text-accent text-lg mt-1">{activePanel.item.sku}</div>
                  {activePanel.item.item_name && (
                    <span className="text-[10px] text-white/40">{activePanel.item.item_name.slice(0, 40)}</span>
                  )}
                </div>
                <QtyInput value={addQty} onChange={setAddQty} autoSelect={autoSelect} />
                <p className="text-[9px] text-white/30 text-center mb-4 font-black uppercase tracking-widest">
                  {activePanel.item.location?.replace(/row/i, 'ROW') || 'No location'} · {activePanel.item.quantity} available
                </p>
                <ReasonPicker
                  actionType="add"
                  preselect={recentlyRemoved.length > 0 ? 'Replacement for removed item' : undefined}
                  selectedReason={selectedReason}
                  onReasonChange={setSelectedReason}
                />
                <ActionButtons
                  onCancel={() => { setActivePanel({ type: 'add_item' }); setSearchQuery(''); }}
                  onConfirm={handleConfirmAdd}
                  isProcessing={isProcessing}
                  confirmLabel="Add to Order"
                  disabled={!selectedReason}
                />
              </div>
            ) : (
              <button
                onClick={() => { setSearchQuery(''); setActivePanel({ type: 'add_item' }); }}
                className="w-full min-h-12 rounded-2xl font-black uppercase tracking-widest text-[10px] bg-accent/10 text-accent border border-accent/20 transition-all hover:bg-accent/20 active:scale-[0.97] flex items-center justify-center gap-2"
              >
                <Plus size={16} /> Add Item
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Footer — Done button */}
      <div className="shrink-0 p-4 border-t border-white/10 bg-black">
        <button
          onClick={() => {
            if (isReopened && initialSnapshot !== null) {
              const current = JSON.stringify(allItems.map(i => ({ sku: i.sku, qty: i.pickingQty })));
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
