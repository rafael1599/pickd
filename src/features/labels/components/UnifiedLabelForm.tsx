import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Check from 'lucide-react/dist/esm/icons/check';
import toast from 'react-hot-toast';

import { supabase } from '../../../lib/supabase';
import { useModal } from '../../../context/ModalContext';
import { useInventoryMutations } from '../../inventory/hooks/useInventoryMutations';
import type { InventoryItemWithMetadata } from '../../../schemas/inventory.schema';
import type { LabelField } from '../../inventory/utils/labelLayout';
import { useLabelItems, type LabelInventoryItem } from '../hooks/useLabelItems';
import { useTagCounts } from '../hooks/useTagCounts';
import { useGenerateLabels, type LabelEntry } from '../hooks/useGenerateLabels';
import {
  useLabelLayoutPreference,
  getLabelLayoutPreference,
} from '../hooks/useLabelLayoutPreference';
import { FuzzySearch } from './FuzzySearch';
import { InlineSkuCreate } from './InlineSkuCreate';
import { EntryList } from './EntryList';
import { LayoutToggle } from './LayoutToggle';
import { LabelPreview } from './LabelPreview';
import { LabelDataModal } from './LabelDataModal';

interface UnifiedLabelFormProps {
  initialSku?: string;
  initialName?: string;
  initialLocation?: string;
}

// SKU-level fields live in inventory → edited in Item Detail. The rest are
// per-tag label data → edited in the "＋" popup.
const SKU_LEVEL_FIELDS: ReadonlySet<LabelField> = new Set(['name', 'detail', 'upc']);

function newEntry(item: Partial<LabelInventoryItem> & { sku: string }, qty: number): LabelEntry {
  return {
    sku: item.sku,
    itemName: item.item_name ?? null,
    location: item.location ?? null,
    stock: item.quantity ?? 0,
    tagged: 0,
    qty,
    layout: getLabelLayoutPreference(),
    prefix: null,
    extra: null,
    upc: item.upc ?? null,
    color: item.color ?? null,
    poNumber: null,
    cNumber: null,
    serialNumber: null,
    madeIn: null,
    otherNotes: null,
    withQr: true,
    withBarcode: true,
  };
}

export const UnifiedLabelForm = ({
  initialSku,
  initialName,
  initialLocation,
}: UnifiedLabelFormProps) => {
  const [entries, setEntries] = useState<LabelEntry[]>([]);
  const initialApplied = useRef(false);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createDefaultName, setCreateDefaultName] = useState('');
  const [dataModalOpen, setDataModalOpen] = useState(false);

  const { data: items, isLoading: isLoadingItems } = useLabelItems();
  const { data: tagCounts } = useTagCounts();
  const { generate, isGenerating } = useGenerateLabels();
  const [, setDefaultLayout] = useLabelLayoutPreference();
  const { open: openModal } = useModal();
  const { updateItem } = useInventoryMutations();
  const queryClient = useQueryClient();

  // Auto-add initial SKU from navigation (e.g., "Edit Label" from ItemDetailView)
  useEffect(() => {
    if (initialApplied.current || !initialSku || !items) return;
    initialApplied.current = true;
    const item = items.find((i) => i.sku === initialSku);
    const tagged = tagCounts?.get(initialSku) ?? 0;
    const entry = newEntry(
      {
        sku: initialSku,
        item_name: item?.item_name ?? initialName ?? null,
        location: item?.location ?? initialLocation ?? null,
        quantity: item?.quantity ?? 0,
        upc: item?.upc ?? null,
        color: item?.color ?? null,
      },
      Math.max(1, (item?.quantity ?? 1) - tagged)
    );
    entry.tagged = tagged;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot init from navigation props, guarded by initialApplied ref
    setEntries([entry]);
    setSelectedSku(initialSku);
  }, [initialSku, initialName, initialLocation, items, tagCounts]);

  // Unique locations sorted naturally
  const locations = useMemo(() => {
    if (!items) return [];
    const locs = [...new Set(items.map((i) => i.location).filter(Boolean))] as string[];
    return locs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [items]);

  const excludeSkus = useMemo(() => new Set(entries.map((e) => e.sku)), [entries]);

  const selectedEntry = useMemo(
    () => (selectedSku ? (entries.find((e) => e.sku === selectedSku) ?? null) : null),
    [entries, selectedSku]
  );

  const activeEntries = useMemo(() => entries.filter((e) => e.qty > 0), [entries]);
  const totalLabels = activeEntries.reduce((sum, e) => sum + e.qty * 2, 0);
  const totalUnits = activeEntries.reduce((sum, e) => sum + e.qty, 0);

  // --- Handlers ---

  const handleAddFromSearch = useCallback(
    (item: LabelInventoryItem) => {
      if (entries.some((e) => e.sku === item.sku)) {
        toast('Already added', { icon: '⚠️' });
        return;
      }
      const tagged = tagCounts?.get(item.sku) ?? 0;
      const qty = Math.max(0, item.quantity - tagged);
      if (qty === 0 && item.quantity > 0) {
        toast(`${item.sku} already fully tagged (${tagged}/${item.quantity})`, { icon: '✅' });
      }
      const entry = newEntry(item, qty);
      entry.tagged = tagged;
      setEntries((prev) => [...prev, entry]);
      setSelectedSku(item.sku);
    },
    [entries, tagCounts]
  );

  const handleLoadLocation = useCallback(() => {
    if (!selectedLocation || !items) return;
    const existingSkus = new Set(entries.map((e) => e.sku));
    const newEntries: LabelEntry[] = [];

    for (const item of items.filter((i) => i.location === selectedLocation)) {
      if (existingSkus.has(item.sku)) continue;
      const tagged = tagCounts?.get(item.sku) ?? 0;
      const qty = Math.max(0, item.quantity - tagged);
      if (qty === 0) continue;
      const entry = newEntry(item, qty);
      entry.tagged = tagged;
      newEntries.push(entry);
    }

    if (newEntries.length === 0) {
      toast('All items in this location already have labels', { icon: '✅' });
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

  const handleQtySet = useCallback((sku: string, qty: number) => {
    setEntries((prev) => prev.map((e) => (e.sku === sku ? { ...e, qty: Math.max(0, qty) } : e)));
  }, []);

  const handleRemove = useCallback(
    (sku: string) => {
      setEntries((prev) => prev.filter((e) => e.sku !== sku));
      if (selectedSku === sku) setSelectedSku(null);
    },
    [selectedSku]
  );

  // Edit SKU-level data (name/color/UPC) in Item Detail — persists to inventory,
  // then refresh the entry so the preview reflects the saved values.
  const openItemDetail = useCallback(
    async (sku: string) => {
      const { data } = await supabase
        .from('inventory')
        .select('*, sku_metadata(*)')
        .eq('sku', sku)
        .order('quantity', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) {
        toast.error(`${sku} is not in inventory yet`);
        return;
      }
      const itemData = data as unknown as InventoryItemWithMetadata;
      openModal({
        type: 'item-detail',
        item: itemData,
        mode: 'edit',
        screenType: itemData.warehouse,
        onSave: async (formData) => {
          await updateItem.mutateAsync({ originalItem: itemData, updatedFormData: formData });
          await queryClient.invalidateQueries({ queryKey: ['label-studio-items'] });
          const { data: fresh } = await supabase
            .from('inventory')
            .select('item_name, sku_metadata(color, upc)')
            .eq('sku', sku)
            .order('quantity', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (fresh) {
            const f = fresh as unknown as {
              item_name: string | null;
              sku_metadata: { color: string | null; upc: string | null } | null;
            };
            handleUpdateEntry(sku, {
              itemName: f.item_name,
              color: f.sku_metadata?.color ?? null,
              upc: f.sku_metadata?.upc ?? null,
            });
          }
          toast.success(`Updated ${sku}`);
        },
      });
    },
    [openModal, updateItem, queryClient, handleUpdateEntry]
  );

  const handleEditField = useCallback(
    (field: LabelField) => {
      if (!selectedEntry) return;
      if (SKU_LEVEL_FIELDS.has(field)) openItemDetail(selectedEntry.sku);
      else setDataModalOpen(true);
    },
    [selectedEntry, openItemDetail]
  );

  const handleGenerate = useCallback(async () => {
    if (activeEntries.length === 0) return;
    await generate(activeEntries);
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

        {/* Selected entry: the preview IS the editor */}
        {selectedEntry && (
          <div className="mb-4 p-4 bg-card border border-subtle rounded-xl space-y-4">
            <LabelPreview
              entry={selectedEntry}
              onEditField={handleEditField}
              onAddData={() => setDataModalOpen(true)}
            />

            {/* Options (not printed on the label) */}
            <div className="space-y-3 pt-1">
              <LayoutToggle
                layout={selectedEntry.layout}
                onLayoutChange={(layout: 'standard' | 'vertical') => {
                  handleUpdateEntry(selectedEntry.sku, { layout });
                  setDefaultLayout(layout);
                }}
                sdPrefix={selectedEntry.prefix === 'S/D'}
                onSdChange={(sd: boolean) =>
                  handleUpdateEntry(selectedEntry.sku, { prefix: sd ? 'S/D' : null })
                }
              />

              {/* Per-entry codes */}
              <div className="flex gap-2">
                {(
                  [
                    ['withQr', 'QR code'],
                    ['withBarcode', 'Barcode'],
                  ] as const
                ).map(([key, label]) => {
                  const checked = selectedEntry[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleUpdateEntry(selectedEntry.sku, { [key]: !checked })}
                      aria-pressed={checked}
                      className={`flex-1 h-9 flex items-center justify-center gap-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-[0.98] ${
                        checked
                          ? 'bg-accent text-main'
                          : 'bg-surface border border-subtle text-muted'
                      }`}
                    >
                      <Check size={12} className={checked ? '' : 'opacity-0'} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Location — required for the tag, NOT printed on the label */}
              <div>
                <label className="text-[10px] font-black text-muted uppercase tracking-widest mb-1 block">
                  Location <span className="text-muted/60">· not on label</span>
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
            </div>
          </div>
        )}

        {/* Entry list */}
        <EntryList
          entries={entries}
          selectedSku={selectedSku}
          onSelect={setSelectedSku}
          onQtyChange={handleQtyChange}
          onQtySet={handleQtySet}
          onRemove={handleRemove}
        />
      </div>

      {/* Fixed footer — prints directly (codes/layout are per-entry) */}
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

      {dataModalOpen && selectedEntry && (
        <LabelDataModal
          entry={selectedEntry}
          onUpdate={(partial) => handleUpdateEntry(selectedEntry.sku, partial)}
          onEditSku={() => {
            setDataModalOpen(false);
            openItemDetail(selectedEntry.sku);
          }}
          onClose={() => setDataModalOpen(false)}
        />
      )}
    </div>
  );
};
