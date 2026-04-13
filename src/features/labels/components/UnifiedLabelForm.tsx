import { useState, useCallback, useMemo } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import toast from 'react-hot-toast';

import { useLabelItems, type LabelInventoryItem } from '../hooks/useLabelItems';
import { useTagCounts } from '../hooks/useTagCounts';
import { useGenerateLabels, type LabelEntry } from '../hooks/useGenerateLabels';
import { FuzzySearch } from './FuzzySearch';
import { InlineSkuCreate } from './InlineSkuCreate';
import { EntryList } from './EntryList';
import { LayoutToggle } from './LayoutToggle';
import { LabelPreview } from './LabelPreview';

export const UnifiedLabelForm = () => {
  const [entries, setEntries] = useState<LabelEntry[]>([]);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDefaultName, setCreateDefaultName] = useState('');

  const { data: items, isLoading: isLoadingItems } = useLabelItems();
  const { data: tagCounts } = useTagCounts();
  const { generate, isGenerating } = useGenerateLabels();

  // Unique locations sorted naturally
  const locations = useMemo(() => {
    if (!items) return [];
    const locs = [...new Set(items.map((i) => i.location).filter(Boolean))] as string[];
    return locs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [items]);

  // Set of SKUs already in entries (for FuzzySearch excludeSkus)
  const excludeSkus = useMemo(() => new Set(entries.map((e) => e.sku)), [entries]);

  // Currently selected entry
  const selectedEntry = useMemo(
    () => (selectedSku ? (entries.find((e) => e.sku === selectedSku) ?? null) : null),
    [entries, selectedSku]
  );

  // Active entries (qty > 0) for footer
  const activeEntries = useMemo(() => entries.filter((e) => e.qty > 0), [entries]);
  const totalLabels = activeEntries.reduce((sum, e) => sum + e.qty * 2, 0);
  const totalUnits = activeEntries.reduce((sum, e) => sum + e.qty, 0);

  // --- Handlers ---

  const handleAddFromSearch = useCallback(
    (item: LabelInventoryItem) => {
      if (entries.some((e) => e.sku === item.sku)) {
        toast('Already added', { icon: '\u26A0\uFE0F' });
        return;
      }
      const tagged = tagCounts?.get(item.sku) ?? 0;
      const qty = Math.max(0, item.quantity - tagged);
      if (qty === 0 && item.quantity > 0) {
        toast(`${item.sku} already fully tagged (${tagged}/${item.quantity})`, {
          icon: '\u2705',
        });
      }
      const entry: LabelEntry = {
        sku: item.sku,
        itemName: item.item_name,
        location: item.location,
        stock: item.quantity,
        tagged,
        qty,
        layout: 'standard',
        prefix: null,
        extra: null,
        upc: item.upc,
        poNumber: null,
        cNumber: null,
        serialNumber: null,
        madeIn: null,
        otherNotes: null,
      };
      setEntries((prev) => [...prev, entry]);
    },
    [entries, tagCounts]
  );

  const handleLoadLocation = useCallback(() => {
    if (!selectedLocation || !items) return;
    const locationItems = items.filter((i) => i.location === selectedLocation);
    const existingSkus = new Set(entries.map((e) => e.sku));
    const newEntries: LabelEntry[] = [];

    for (const item of locationItems) {
      if (existingSkus.has(item.sku)) continue;
      const tagged = tagCounts?.get(item.sku) ?? 0;
      const qty = Math.max(0, item.quantity - tagged);
      if (qty === 0) continue;
      newEntries.push({
        sku: item.sku,
        itemName: item.item_name,
        location: item.location,
        stock: item.quantity,
        tagged,
        qty,
        layout: 'standard',
        prefix: null,
        extra: null,
        upc: item.upc,
        poNumber: null,
        cNumber: null,
        serialNumber: null,
        madeIn: null,
        otherNotes: null,
      });
    }

    if (newEntries.length === 0) {
      toast('All items in this location already have labels', { icon: '\u2705' });
      return;
    }
    setEntries((prev) => [...prev, ...newEntries]);
    toast.success(`Loaded ${newEntries.length} items from ${selectedLocation}`);
  }, [selectedLocation, items, entries, tagCounts]);

  const handleUpdateEntry = useCallback((sku: string, partial: Partial<LabelEntry>) => {
    setEntries((prev) => prev.map((e) => (e.sku === sku ? { ...e, ...partial } : e)));
  }, []);

  const handleQtyChange = useCallback((sku: string, delta: number) => {
    setEntries((prev) =>
      prev.map((e) => (e.sku === sku ? { ...e, qty: Math.max(0, e.qty + delta) } : e))
    );
  }, []);

  const handleRemove = useCallback(
    (sku: string) => {
      setEntries((prev) => prev.filter((e) => e.sku !== sku));
      if (selectedSku === sku) setSelectedSku(null);
    },
    [selectedSku]
  );

  const handleGenerate = useCallback(async () => {
    if (activeEntries.length === 0) return;
    await generate(activeEntries);
    // Reset qty to 0 after generation
    setEntries((prev) => prev.map((e) => ({ ...e, qty: 0 })));
  }, [activeEntries, generate]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Location loader */}
      <div className="px-4 pb-3">
        <div className="flex gap-2">
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="flex-1 h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content focus:outline-none focus:border-accent/40"
          >
            <option value="">Select location...</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
          <button
            onClick={handleLoadLocation}
            disabled={!selectedLocation}
            className="h-10 px-4 bg-accent text-main font-black uppercase tracking-widest text-[10px] rounded-xl active:scale-95 transition-all disabled:opacity-30"
          >
            Load
          </button>
        </div>
      </div>

      {/* FuzzySearch + New SKU button */}
      <div className="px-4 pb-3 flex gap-2">
        <div className="flex-1">
          <FuzzySearch
            tagCounts={tagCounts ?? new Map()}
            excludeSkus={excludeSkus}
            onSelect={handleAddFromSearch}
            onCreateNew={(name: string) => {
              setCreateDefaultName(name);
              setShowCreateForm(true);
            }}
          />
        </div>
        {!showCreateForm && (
          <button
            onClick={() => {
              setCreateDefaultName('');
              setShowCreateForm(true);
            }}
            className="shrink-0 h-10 px-3 bg-accent/10 border border-accent/30 rounded-xl text-[10px] font-black text-accent uppercase tracking-widest hover:bg-accent/20 transition-all active:scale-95"
          >
            + New
          </button>
        )}
      </div>

      {/* Inline SKU creation form */}
      {showCreateForm && (
        <div className="px-4 pb-3">
          <InlineSkuCreate
            defaultName={createDefaultName}
            locations={locations}
            onCreated={(item) => {
              handleAddFromSearch(item);
              setShowCreateForm(false);
            }}
            onCancel={() => setShowCreateForm(false)}
          />
        </div>
      )}

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {isLoadingItems && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
          </div>
        )}

        {entries.length === 0 && !isLoadingItems && !showCreateForm && (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <p className="text-muted text-sm">Search for a SKU or create a new one</p>
            <button
              onClick={() => {
                setCreateDefaultName('');
                setShowCreateForm(true);
              }}
              className="px-5 py-2.5 bg-accent/10 border border-accent/30 rounded-xl text-sm font-bold text-accent hover:bg-accent/20 transition-all active:scale-95"
            >
              + Create New SKU Label
            </button>
          </div>
        )}

        {/* Entry list */}
        <EntryList
          entries={entries}
          selectedSku={selectedSku}
          onSelect={setSelectedSku}
          onQtyChange={handleQtyChange}
          onRemove={handleRemove}
        />

        {/* Detail panel */}
        {selectedEntry && (
          <div className="mt-4 p-4 bg-card border border-subtle rounded-xl">
            <h3 className="text-[10px] text-muted font-black uppercase tracking-widest mb-3">
              Detail — {selectedEntry.sku}
            </h3>

            {/* Item Name */}
            <div className="mb-3">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">
                Item Name
              </label>
              <input
                type="text"
                value={selectedEntry.itemName ?? ''}
                onChange={(e) =>
                  handleUpdateEntry(selectedEntry.sku, {
                    itemName: e.target.value.toUpperCase() || null,
                  })
                }
                placeholder="FAULTLINE A1 V2 15 2026 GLOSS BLACK"
                className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
              />
            </div>

            {/* Extra */}
            <div className="mb-3">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">
                Extra Info (below SKU)
              </label>
              <input
                type="text"
                value={selectedEntry.extra ?? ''}
                onChange={(e) =>
                  handleUpdateEntry(selectedEntry.sku, {
                    extra: e.target.value.toUpperCase() || null,
                  })
                }
                placeholder="e.g. SPECIAL ORDER, DEMO UNIT..."
                className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
              />
            </div>

            {/* Location */}
            <div className="mb-3">
              <label className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">
                Location
              </label>
              <input
                type="text"
                value={selectedEntry.location ?? ''}
                onChange={(e) =>
                  handleUpdateEntry(selectedEntry.sku, {
                    location: e.target.value.toUpperCase() || null,
                  })
                }
                placeholder="ROW 15, INCOMING, etc."
                className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-sm text-content uppercase placeholder-muted/50 focus:outline-none focus:border-accent/40"
              />
            </div>

            {/* Layout toggle */}
            <div className="mb-3">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">
                Layout
              </label>
              <LayoutToggle
                layout={selectedEntry.layout}
                onLayoutChange={(layout: 'standard' | 'vertical') =>
                  handleUpdateEntry(selectedEntry.sku, { layout })
                }
                sdPrefix={selectedEntry.prefix === 'S/D'}
                onSdChange={(sd: boolean) =>
                  handleUpdateEntry(selectedEntry.sku, { prefix: sd ? 'S/D' : null })
                }
              />
            </div>

            {/* Collapsible extra fields */}
            <button
              onClick={() => setShowExtraFields((v) => !v)}
              className="flex items-center gap-1 w-full text-left text-[10px] font-black uppercase tracking-widest text-accent py-2"
            >
              {showExtraFields ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Additional Info (UPC, Serial, P/O...)
            </button>

            {showExtraFields && (
              <div className="space-y-3 pb-3">
                {(
                  [
                    ['upc', 'UPC', selectedEntry.upc, '012345678901'],
                    ['poNumber', 'P/O No', selectedEntry.poNumber, 'Purchase order number'],
                    ['cNumber', 'C/No', selectedEntry.cNumber, 'Container number'],
                    ['serialNumber', 'Serial No', selectedEntry.serialNumber, 'Serial number'],
                    ['madeIn', 'Made In', selectedEntry.madeIn, 'Country of origin'],
                    ['otherNotes', 'Other Notes', selectedEntry.otherNotes, 'Additional notes'],
                  ] as [string, string, string | null, string][]
                ).map(([key, label, val, placeholder]) => (
                  <div key={key}>
                    <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">
                      {label}
                    </label>
                    <input
                      type="text"
                      value={val ?? ''}
                      onChange={(e) =>
                        handleUpdateEntry(selectedEntry.sku, {
                          [key]: e.target.value.toUpperCase() || null,
                        })
                      }
                      placeholder={placeholder}
                      className="w-full h-9 px-3 bg-surface border border-subtle rounded-lg text-xs text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Label preview */}
            <div className="mt-3">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-2 block">
                Preview
              </label>
              <LabelPreview entry={selectedEntry} />
            </div>
          </div>
        )}
      </div>

      {/* Fixed footer */}
      {activeEntries.length > 0 && (
        <div className="print:hidden fixed bottom-0 left-0 right-0 px-4 pt-4 pb-28 bg-gradient-to-t from-main via-main/90 to-transparent">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full h-14 bg-accent text-main font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-lg shadow-accent/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isGenerating ? <Loader2 className="animate-spin" size={16} /> : <Printer size={16} />}
            Generate {totalLabels} Labels ({totalUnits} units)
          </button>
        </div>
      )}
    </div>
  );
};
