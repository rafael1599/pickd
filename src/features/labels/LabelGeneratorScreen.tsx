import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Search from 'lucide-react/dist/esm/icons/search';
import Check from 'lucide-react/dist/esm/icons/check';
import Tag from 'lucide-react/dist/esm/icons/tag';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import PenLine from 'lucide-react/dist/esm/icons/pen-line';
import { parseBikeName } from '../inventory/utils/parseBikeName';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { generateBikeLabels, type LabelItem } from '../inventory/utils/generateBikeLabel';
import toast from 'react-hot-toast';

interface BikeRow {
  sku: string;
  item_name: string | null;
  location: string | null;
  quantity: number;
}

interface LabelEntry {
  sku: string;
  item_name: string | null;
  location: string | null;
  stock: number;
  tagged: number;
  qty: number; // units to generate (default = stock - tagged)
}

export const LabelGeneratorScreen = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedLocation, setSelectedLocation] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [entries, setEntries] = useState<LabelEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [viewMode, setViewMode] = useState<'create' | 'history' | 'custom'>('create');
  const [customLabelType, setCustomLabelType] = useState<'regular' | 'sd' | 'vertical'>('regular');
  const [historyFilter, setHistoryFilter] = useState('');
  const [isReprinting, setIsReprinting] = useState(false);
  const [customSku, setCustomSku] = useState('');
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState(1);
  const [customExtra, setCustomExtra] = useState('');
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [customUpc, setCustomUpc] = useState('');
  const [customPo, setCustomPo] = useState('');
  const [customCNo, setCustomCNo] = useState('');
  const [customSerial, setCustomSerial] = useState('');
  const [customMadeIn, setCustomMadeIn] = useState('');
  const [customOtherNotes, setCustomOtherNotes] = useState('');
  const [isCustomGenerating, setIsCustomGenerating] = useState(false);

  // Fetch all bike inventory
  const { data: bikes, isLoading } = useQuery({
    queryKey: ['label-bikes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('sku, item_name, location, quantity, sku_metadata!inner(is_bike)')
        .eq('is_active', true)
        .gt('quantity', 0)
        .eq('sku_metadata.is_bike', true)
        .order('location')
        .order('sku');
      if (error) throw error;
      return data as unknown as BikeRow[];
    },
    staleTime: 5 * 60_000,
  });

  // Fetch existing asset_tag counts per SKU
  const { data: tagCounts } = useQuery({
    queryKey: ['asset-tag-counts'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('asset_tags')
        .select('sku')
        .in('status', ['printed', 'in_stock', 'allocated', 'picked']);
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of (data ?? []) as { sku: string }[]) {
        counts.set(row.sku, (counts.get(row.sku) ?? 0) + 1);
      }
      return counts;
    },
    staleTime: 2 * 60_000,
  });

  const getTaggedCount = useCallback(
    (sku: string) => tagCounts?.get(sku) ?? 0,
    [tagCounts],
  );

  // Fetch created asset_tags for history view
  interface AssetTagRow {
    id: string;
    short_code: string;
    public_token: string;
    sku: string;
    location: string | null;
    status: string;
    printed_at: string | null;
    created_at: string;
  }
  const { data: createdTags, isLoading: isLoadingTags } = useQuery({
    queryKey: ['asset-tags-history'],
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('asset_tags')
        .select('id, short_code, public_token, sku, location, status, printed_at, created_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as AssetTagRow[];
    },
    enabled: viewMode === 'history',
    staleTime: 30_000,
  });

  // Group created tags by SKU for history view, with filter
  const tagsBySku = useMemo(() => {
    if (!createdTags) return new Map<string, AssetTagRow[]>();
    const q = historyFilter.toUpperCase();
    const filtered = q
      ? createdTags.filter((t) => t.sku.includes(q) || t.short_code.toUpperCase().includes(q) || (t.location ?? '').toUpperCase().includes(q))
      : createdTags;
    const map = new Map<string, AssetTagRow[]>();
    for (const tag of filtered) {
      const arr = map.get(tag.sku) ?? [];
      arr.push(tag);
      map.set(tag.sku, arr);
    }
    return map;
  }, [createdTags, historyFilter]);

  // Get item_name for a sku from bikes data
  const getItemName = useCallback(
    (sku: string) => bikes?.find((b) => b.sku === sku)?.item_name ?? null,
    [bikes],
  );

  const handleReprint = useCallback(async (sku: string, tags: AssetTagRow[]) => {
    setIsReprinting(true);
    try {
      const labelItems: LabelItem[] = tags.map((t) => ({
        sku: t.sku,
        item_name: getItemName(t.sku),
        short_code: t.short_code,
        public_token: t.public_token,
      }));
      const blobUrl = await generateBikeLabels(labelItems);
      window.open(blobUrl, '_blank');
      toast.success(`Reprinting ${tags.length * 2} labels for ${sku}`);
    } catch {
      toast.error('Failed to reprint labels');
    } finally {
      setIsReprinting(false);
    }
  }, [getItemName]);

  // Unique locations
  const locations = useMemo(() => {
    if (!bikes) return [];
    const locs = [...new Set(bikes.map((b) => b.location).filter(Boolean))] as string[];
    return locs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [bikes]);

  // Filtered bikes for search
  const searchResults = useMemo(() => {
    if (!bikes || searchQuery.length < 2) return [];
    const q = searchQuery.toUpperCase();
    return bikes
      .filter((b) => b.sku.includes(q) || (b.item_name ?? '').toUpperCase().includes(q))
      .filter((b) => !entries.some((e) => e.sku === b.sku))
      .slice(0, 10);
  }, [bikes, searchQuery, entries]);

  const buildEntry = useCallback(
    (b: BikeRow): LabelEntry => {
      const tagged = getTaggedCount(b.sku);
      const untagged = Math.max(0, b.quantity - tagged);
      return {
        sku: b.sku,
        item_name: b.item_name,
        location: b.location,
        stock: b.quantity,
        tagged,
        qty: untagged,
      };
    },
    [getTaggedCount],
  );

  const handleLoadLocation = useCallback(() => {
    if (!selectedLocation || !bikes) return;
    const locationBikes = bikes.filter((b) => b.location === selectedLocation);
    const newEntries = locationBikes
      .filter((b) => !entries.some((e) => e.sku === b.sku))
      .map(buildEntry)
      .filter((e) => e.qty > 0); // skip fully tagged
    if (newEntries.length === 0) {
      toast('All bikes in this location already have labels', { icon: '\u2705' });
      return;
    }
    setEntries((prev) => [...prev, ...newEntries]);
  }, [selectedLocation, bikes, entries, buildEntry]);

  const handleAddFromSearch = useCallback(
    (bike: BikeRow) => {
      if (entries.some((e) => e.sku === bike.sku)) return;
      const entry = buildEntry(bike);
      if (entry.qty === 0) {
        toast(`${bike.sku} already fully tagged (${entry.tagged}/${entry.stock})`, { icon: '\u2705' });
        return;
      }
      setEntries((prev) => [...prev, entry]);
      setSearchQuery('');
    },
    [entries, buildEntry],
  );

  const handleQtyChange = useCallback((sku: string, delta: number) => {
    setEntries((prev) =>
      prev.map((e) =>
        e.sku === sku ? { ...e, qty: Math.max(0, e.qty + delta) } : e,
      ),
    );
  }, []);

  const handleRemove = useCallback((sku: string) => {
    setEntries((prev) => prev.filter((e) => e.sku !== sku));
  }, []);

  const activeEntries = entries.filter((e) => e.qty > 0);
  const totalLabels = activeEntries.reduce((sum, e) => sum + e.qty * 2, 0);
  const totalUnits = activeEntries.reduce((sum, e) => sum + e.qty, 0);

  const handleGenerate = useCallback(async () => {
    if (activeEntries.length === 0 || !user) return;
    setIsGenerating(true);
    try {
      // Build insert rows with location from inventory
      const inserts = activeEntries.flatMap((e) =>
        Array.from({ length: e.qty }, () => ({
          sku: e.sku,
          warehouse: 'LUDLOW',
          location: e.location,
          created_by: user.id,
          printed_at: new Date().toISOString(),
        })),
      );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tags, error } = await (supabase as any)
        .from('asset_tags')
        .insert(inserts)
        .select('short_code, sku, public_token') as { data: { short_code: string; sku: string; public_token: string }[] | null; error: unknown };

      if (error || !tags) throw error || new Error('No tags returned');

      const nameMap = new Map(activeEntries.map((e) => [e.sku, e.item_name]));
      const labelItems: LabelItem[] = tags.map((t) => ({
        sku: t.sku,
        item_name: nameMap.get(t.sku) ?? null,
        short_code: t.short_code,
        public_token: t.public_token,
      }));

      const blobUrl = await generateBikeLabels(labelItems);
      window.open(blobUrl, '_blank');
      toast.success(`${tags.length} asset tags created, ${tags.length * 2} labels generated`);

      // Update tagged counts in entries
      setEntries((prev) =>
        prev.map((e) => {
          const generated = tags.filter((t) => t.sku === e.sku).length;
          return { ...e, tagged: e.tagged + generated, qty: 0 };
        }),
      );
    } catch (err) {
      console.error('Label generation failed:', err);
      toast.error('Failed to generate labels');
    } finally {
      setIsGenerating(false);
    }
  }, [activeEntries, user]);

  return (
    <div className="flex flex-col min-h-screen bg-bg-main">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => viewMode === 'create' ? navigate(-1) : setViewMode('create')}
              className="p-2 hover:bg-card rounded-full text-muted transition-colors"
            >
              {viewMode === 'create' ? <ChevronLeft size={24} /> : <ArrowLeft size={24} />}
            </button>
            <div>
              <h1 className="text-lg font-black uppercase tracking-widest text-content">
                {viewMode === 'create' ? 'Bike Labels' : viewMode === 'custom' ? (customLabelType === 'sd' ? 'S/D Label' : customLabelType === 'vertical' ? 'Vertical Label' : 'Custom Label') : 'Created Tags'}
              </h1>
              <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
                {viewMode === 'create' ? 'QR asset tags for physical tracking' : viewMode === 'custom' ? 'Create your own label' : `${createdTags?.length ?? 0} tags across ${tagsBySku.size} SKUs`}
              </p>
            </div>
          </div>
          {viewMode === 'create' && (
            <div className="flex items-center gap-1">
              <div className="relative">
                <select
                  onChange={(e) => { if (e.target.value) { setCustomLabelType(e.target.value as 'regular' | 'sd' | 'vertical'); setViewMode('custom'); } e.target.value = ''; }}
                  defaultValue=""
                  className="appearance-none bg-transparent text-accent p-2 pr-1 cursor-pointer focus:outline-none"
                  title="Custom label"
                >
                  <option value="" disabled hidden>+</option>
                  <option value="regular">Regular Label</option>
                  <option value="sd">S/D Label</option>
                  <option value="vertical">Vertical Label</option>
                </select>
                <PenLine size={16} className="absolute right-2 top-1/2 -translate-y-1/2 text-accent pointer-events-none" />
              </div>
              <button
                onClick={() => setViewMode('history')}
                className="p-2 hover:bg-card rounded-full text-accent transition-colors"
                title="View created tags"
              >
                <Tag size={20} />
              </button>
            </div>
          )}
        </div>

        {/* Create mode controls */}
        {viewMode === 'create' && (<>
        {/* Location selector */}
        <div className="flex gap-2 mb-3">
          <select
            value={selectedLocation}
            onChange={(e) => setSelectedLocation(e.target.value)}
            className="flex-1 h-10 px-3 bg-surface border border-subtle rounded-xl text-xs text-content focus:outline-none focus:border-accent/40"
          >
            <option value="">Select location...</option>
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
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

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search SKU or model..."
            className="w-full h-10 pl-9 pr-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 font-mono"
          />
        </div>

        {/* Search results */}
        {searchResults.length > 0 && (
          <div className="mb-3 max-h-40 overflow-y-auto bg-card border border-subtle rounded-xl">
            {searchResults.map((b) => {
              const tagged = getTaggedCount(b.sku);
              const untagged = b.quantity - tagged;
              return (
                <button
                  key={b.sku}
                  onClick={() => handleAddFromSearch(b)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface transition-colors text-left border-b border-subtle last:border-0"
                >
                  <div>
                    <span className="text-xs font-bold text-content">{b.sku}</span>
                    <span className="text-[10px] text-muted ml-2">{(b.item_name ?? '').slice(0, 25)}</span>
                  </div>
                  <div className="text-[10px] text-right">
                    {tagged > 0 ? (
                      <span className="text-muted">{tagged} tagged · <span className={untagged > 0 ? 'text-amber-500' : 'text-green-500'}>{untagged} need</span></span>
                    ) : (
                      <span className="text-muted">{b.quantity} in stock</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        </>)}
      </div>

      {/* Entries list — create mode */}
      {viewMode === 'create' && (
      <>
      {/* Entries list */}
      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
          </div>
        )}

        {entries.length === 0 && !isLoading && (
          <div className="text-center py-20 text-muted text-sm">
            Select a location or search for SKUs to start.
          </div>
        )}

        {entries.map((e) => (
          <div
            key={e.sku}
            className={`flex items-center gap-3 p-3 border rounded-xl mb-2 ${
              e.qty === 0
                ? 'bg-green-500/5 border-green-500/20'
                : 'bg-card border-subtle'
            }`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-content tracking-tight">{e.sku}</p>
              <p className="text-[10px] text-muted truncate">{(e.item_name ?? '').slice(0, 35)}</p>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[9px] text-muted font-bold uppercase">
                  {e.stock} in stock
                </span>
                {e.tagged > 0 && (
                  <>
                    <span className="text-[9px] text-muted">·</span>
                    <span className="text-[9px] text-green-500 font-bold uppercase flex items-center gap-0.5">
                      <Check size={8} /> {e.tagged} tagged
                    </span>
                  </>
                )}
                {e.qty === 0 && e.tagged >= e.stock && (
                  <>
                    <span className="text-[9px] text-muted">·</span>
                    <span className="text-[9px] text-green-500 font-bold uppercase">COMPLETE</span>
                  </>
                )}
              </div>
            </div>

            {/* Qty controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleQtyChange(e.sku, -1)}
                disabled={e.qty === 0}
                className="w-8 h-8 flex items-center justify-center bg-surface border border-subtle rounded-lg text-muted active:scale-90 disabled:opacity-30"
              >
                <Minus size={14} />
              </button>
              <span className={`w-8 text-center text-sm font-bold ${e.qty === 0 ? 'text-green-500' : 'text-content'}`}>
                {e.qty}
              </span>
              <button
                onClick={() => handleQtyChange(e.sku, 1)}
                className="w-8 h-8 flex items-center justify-center bg-surface border border-subtle rounded-lg text-muted active:scale-90"
              >
                <Plus size={14} />
              </button>
            </div>

            <button
              onClick={() => handleRemove(e.sku)}
              className="p-2 text-muted hover:text-red-500 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {/* Footer */}
      {activeEntries.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 pb-28 bg-gradient-to-t from-main via-main/90 to-transparent">
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="w-full h-14 bg-accent text-main font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-lg shadow-accent/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isGenerating ? (
              <Loader2 className="animate-spin" size={16} />
            ) : (
              <Printer size={16} />
            )}
            Generate {totalLabels} Labels ({totalUnits} units)
          </button>
        </div>
      )}
      </>
      )}

      {/* History view */}
      {viewMode === 'history' && (
        <>
        {/* History search */}
        <div className="px-4 pb-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
              placeholder="Filter by SKU, tag code, or location..."
              className="w-full h-10 pl-9 pr-3 bg-surface border border-subtle rounded-xl text-xs text-content placeholder-muted focus:outline-none focus:border-accent/40 font-mono"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-8">
          {isLoadingTags && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="animate-spin text-accent w-8 h-8 opacity-30" />
            </div>
          )}

          {!isLoadingTags && tagsBySku.size === 0 && (
            <div className="text-center py-20 text-muted text-sm">
              {historyFilter ? 'No tags match your filter.' : 'No asset tags created yet.'}
            </div>
          )}

          {[...tagsBySku.entries()].map(([sku, tags]) => (
            <div key={sku} className="mb-4 p-3 bg-card border border-subtle rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-bold text-content tracking-tight">{sku}</p>
                  <p className="text-[10px] text-muted">{tags[0]?.location ?? 'No location'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-accent bg-accent/10 border border-accent/20 px-2 py-1 rounded-lg">
                    {tags.length} tag{tags.length !== 1 ? 's' : ''}
                  </span>
                  <button
                    onClick={() => handleReprint(sku, tags)}
                    disabled={isReprinting}
                    className="p-1.5 bg-surface border border-subtle rounded-lg text-muted hover:text-accent hover:border-accent/30 transition-colors active:scale-90 disabled:opacity-30"
                    title="Reprint labels"
                  >
                    <Printer size={14} />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span
                    key={tag.id}
                    className={`text-[9px] font-mono font-bold px-2 py-1 rounded-lg border ${
                      tag.status === 'printed'
                        ? 'bg-card border-subtle text-muted'
                        : tag.status === 'in_stock'
                          ? 'bg-green-500/10 border-green-500/20 text-green-500'
                          : tag.status === 'allocated' || tag.status === 'picked'
                            ? 'bg-blue-500/10 border-blue-500/20 text-blue-500'
                            : tag.status === 'shipped'
                              ? 'bg-accent/10 border-accent/20 text-accent'
                              : 'bg-red-500/10 border-red-500/20 text-red-500'
                    }`}
                    title={`Status: ${tag.status}`}
                  >
                    {tag.short_code}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* Custom label view */}
      {viewMode === 'custom' && (() => {
        const parsed = parseBikeName(customName || null);
        const hasContent = customSku.trim().length > 0 || customName.trim().length > 0 || customExtra.trim().length > 0;

        const handleCustomGenerate = async () => {
          if (!customSku.trim() || !user) return;
          setIsCustomGenerating(true);
          try {
            const skuVal = customSku.trim() || 'CUSTOM';
            const inserts = Array.from({ length: customQty }, () => ({
              sku: skuVal,
              warehouse: 'LUDLOW',
              created_by: user.id,
              printed_at: new Date().toISOString(),
              ...(customUpc && { upc: customUpc.trim() }),
              ...(customPo && { po_number: customPo.trim() }),
              ...(customCNo && { c_number: customCNo.trim() }),
              ...(customSerial && { serial_number: customSerial.trim() }),
              ...(customMadeIn && { made_in: customMadeIn.trim() }),
              ...(customOtherNotes && { other_notes: customOtherNotes.trim() }),
            }));
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { data: tags, error } = await (supabase as any)
              .from('asset_tags')
              .insert(inserts)
              .select('short_code, sku, public_token') as { data: { short_code: string; sku: string; public_token: string }[] | null; error: unknown };
            if (error || !tags) throw error || new Error('No tags returned');
            const labelItems: LabelItem[] = tags.map((t) => ({
              sku: t.sku,
              item_name: customName.trim() || null,
              short_code: t.short_code,
              public_token: t.public_token,
              extra: customExtra.trim() || null,
              prefix: customLabelType === 'sd' ? 'S/D' : null,
              layout: customLabelType === 'vertical' ? 'vertical' : 'standard',
            }));
            const blobUrl = await generateBikeLabels(labelItems);
            window.open(blobUrl, '_blank');
            toast.success(`${tags.length} custom label${tags.length !== 1 ? 's' : ''} created`);
          } catch (err) {
            console.error('Custom label failed:', err);
            toast.error('Failed to generate custom label');
          } finally {
            setIsCustomGenerating(false);
          }
        };

        return (
          <div className="flex-1 overflow-y-auto px-4 pb-32">
            {/* Inputs */}
            <div className="space-y-3 mb-6">
              <div>
                <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">SKU *</label>
                <input
                  type="text"
                  value={customSku}
                  onChange={(e) => setCustomSku(e.target.value.toUpperCase())}
                  placeholder="03-4614BK"
                  className="w-full h-12 px-4 bg-surface border border-subtle rounded-xl text-sm text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">Item Name (optional)</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value.toUpperCase())}
                  placeholder="FAULTLINE A1 V2 15 2026 GLOSS BLACK"
                  className="w-full h-12 px-4 bg-surface border border-subtle rounded-xl text-sm text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">Extra Info (below SKU)</label>
                <input
                  type="text"
                  value={customExtra}
                  onChange={(e) => setCustomExtra(e.target.value.toUpperCase())}
                  placeholder="e.g. SPECIAL ORDER, DEMO UNIT..."
                  className="w-full h-12 px-4 bg-surface border border-subtle rounded-xl text-sm text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
                />
              </div>
              {/* Expandable additional fields */}
              <button
                onClick={() => setShowExtraFields(!showExtraFields)}
                className="w-full text-left text-[10px] font-black uppercase tracking-widest text-accent py-2"
              >
                {showExtraFields ? '▼ Hide Additional Info' : '▶ Additional Info (UPC, Serial, P/O...)'}
              </button>
              {showExtraFields && (
                <div className="space-y-3 pb-2">
                  {([
                    ['UPC', customUpc, setCustomUpc, '012345678901'],
                    ['P/O No', customPo, setCustomPo, 'Purchase order number'],
                    ['C/No', customCNo, setCustomCNo, 'Container number'],
                    ['Serial No', customSerial, setCustomSerial, 'Serial number'],
                    ['Made In', customMadeIn, setCustomMadeIn, 'Country of origin'],
                    ['Other Notes', customOtherNotes, setCustomOtherNotes, 'Additional notes'],
                  ] as [string, string, (v: string) => void, string][]).map(([label, val, setter, ph]) => (
                    <div key={label}>
                      <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">{label}</label>
                      <input
                        type="text"
                        value={val}
                        onChange={(e) => setter(e.target.value.toUpperCase())}
                        placeholder={ph}
                        className="w-full h-10 px-4 bg-surface border border-subtle rounded-xl text-xs text-content font-mono placeholder-muted focus:outline-none focus:border-accent/40"
                      />
                    </div>
                  ))}
                </div>
              )}

              <div>
                <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-1 block">Quantity</label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCustomQty((q) => Math.max(1, q - 1))}
                    className="w-10 h-10 flex items-center justify-center bg-surface border border-subtle rounded-xl text-muted active:scale-90"
                  >
                    <Minus size={16} />
                  </button>
                  <span className="w-10 text-center text-lg font-bold text-content">{customQty}</span>
                  <button
                    onClick={() => setCustomQty((q) => q + 1)}
                    className="w-10 h-10 flex items-center justify-center bg-surface border border-subtle rounded-xl text-muted active:scale-90"
                  >
                    <Plus size={16} />
                  </button>
                </div>
              </div>
            </div>

            {/* Live Preview */}
            <div className="mb-4">
              <label className="text-[10px] text-muted font-black uppercase tracking-widest mb-2 block">Preview</label>

              {customLabelType === 'vertical' ? (
              /* Vertical preview (portrait 4×6) */
              <div className="bg-white border border-subtle rounded-xl p-4 aspect-[4/6] flex flex-col max-w-[200px] mx-auto">
                {/* Name top */}
                {(parsed.model || customName) && (
                  <p className="text-[11px] font-black text-black leading-tight mb-0.5">
                    {parsed.model || customName}
                  </p>
                )}
                <p className="text-[7px] text-black mb-1">
                  {[parsed.size && `SIZE ${parsed.size}`, parsed.color && `COLOR ${parsed.color}`, parsed.year && `YEAR ${parsed.year}`].filter(Boolean).join(' · ')}
                </p>
                <div className="border-t border-black/20 my-1" />
                {/* QR centered */}
                <div className="flex-1 flex items-center justify-center">
                  <div className="w-20 h-20 bg-black/10 border border-black/20 rounded flex items-center justify-center">
                    <span className="text-[7px] text-black/40 font-bold">QR</span>
                  </div>
                </div>
                {/* SKU bottom */}
                <div className="mt-1">
                  {customSku ? (
                    <span className="bg-black text-white font-black text-sm px-2 py-0.5 leading-none inline-block">{customSku}</span>
                  ) : (
                    <span className="text-sm font-black text-black/20">SKU</span>
                  )}
                  {customExtra && <p className="text-[7px] font-bold text-black mt-0.5">{customExtra}</p>}
                </div>
              </div>
              ) : (
              /* Standard / S/D preview */
              <div className="bg-white border border-subtle rounded-xl p-4 aspect-[6/4] flex flex-col">
                {/* Preview header */}
                <div className="flex gap-3 items-start mb-1">
                  {customLabelType === 'sd' && (
                    <span className="text-xl font-black italic text-black leading-none shrink-0">S/D</span>
                  )}
                  {(parsed.model || customName) && (
                    <p className="text-[11px] font-black text-black leading-tight">
                      {parsed.model || customName}
                    </p>
                  )}
                </div>
                {/* Preview detail */}
                <p className="text-[8px] text-black mb-1">
                  {[
                    parsed.size && `SIZE ${parsed.size}`,
                    parsed.color && `COLOR ${parsed.color}`,
                    parsed.year && `YEAR ${parsed.year}`,
                  ].filter(Boolean).join('  ·  ')}
                </p>
                <div className="border-t border-black/20 my-1" />
                {/* Preview main */}
                <div className="flex-1 flex items-center justify-between gap-2">
                  <div>
                    {customSku ? (
                      <span className="bg-black text-white font-black text-lg px-2 py-1 leading-none inline-block">
                        {customSku}
                      </span>
                    ) : (
                      <span className="text-lg font-black text-black/20">SKU</span>
                    )}
                    {customExtra && (
                      <p className="text-[8px] font-bold text-black mt-1 ml-0.5">{customExtra}</p>
                    )}
                  </div>
                  <div className="w-16 h-16 bg-black/10 border border-black/20 rounded flex items-center justify-center shrink-0">
                    <span className="text-[7px] text-black/40 font-bold">QR</span>
                  </div>
                </div>
              </div>
              )}
            </div>

            {/* Generate button */}
            <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 pb-28 bg-gradient-to-t from-main via-main/90 to-transparent">
              <button
                onClick={handleCustomGenerate}
                disabled={!hasContent || isCustomGenerating}
                className="w-full h-14 bg-accent text-main font-black uppercase tracking-widest text-[10px] rounded-2xl shadow-lg shadow-accent/20 active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isCustomGenerating ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <Printer size={16} />
                )}
                Generate {customQty * 2} Labels ({customQty} unit{customQty !== 1 ? 's' : ''})
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
