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
  qty: number;
}

export const LabelGeneratorScreen = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedLocation, setSelectedLocation] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [entries, setEntries] = useState<LabelEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);

  // Fetch all bike inventory grouped by location
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

  // Load bikes from a location into entries
  const handleLoadLocation = useCallback(() => {
    if (!selectedLocation || !bikes) return;
    const locationBikes = bikes.filter((b) => b.location === selectedLocation);
    const newEntries: LabelEntry[] = locationBikes
      .filter((b) => !entries.some((e) => e.sku === b.sku))
      .map((b) => ({ sku: b.sku, item_name: b.item_name, qty: b.quantity }));
    setEntries((prev) => [...prev, ...newEntries]);
  }, [selectedLocation, bikes, entries]);

  const handleAddFromSearch = useCallback(
    (bike: BikeRow) => {
      if (entries.some((e) => e.sku === bike.sku)) return;
      setEntries((prev) => [...prev, { sku: bike.sku, item_name: bike.item_name, qty: bike.quantity }]);
      setSearchQuery('');
    },
    [entries],
  );

  const handleQtyChange = useCallback((sku: string, delta: number) => {
    setEntries((prev) =>
      prev.map((e) => (e.sku === sku ? { ...e, qty: Math.max(1, e.qty + delta) } : e)),
    );
  }, []);

  const handleRemove = useCallback((sku: string) => {
    setEntries((prev) => prev.filter((e) => e.sku !== sku));
  }, []);

  const totalLabels = entries.reduce((sum, e) => sum + e.qty * 2, 0);
  const totalUnits = entries.reduce((sum, e) => sum + e.qty, 0);

  const handleGenerate = useCallback(async () => {
    if (entries.length === 0 || !user) return;
    setIsGenerating(true);
    try {
      // Batch insert asset_tags — DB generates short_codes via sequence
      const inserts = entries.flatMap((e) =>
        Array.from({ length: e.qty }, () => ({
          sku: e.sku,
          warehouse: 'LUDLOW',
          created_by: user.id,
          printed_at: new Date().toISOString(),
        })),
      );

      const { data: tags, error } = await supabase
        .from('asset_tags' as never)
        .insert(inserts as never)
        .select('short_code, sku') as { data: { short_code: string; sku: string }[] | null; error: unknown };

      if (error || !tags) throw error || new Error('No tags returned');

      // Build label items: match each tag with its item_name
      const nameMap = new Map(entries.map((e) => [e.sku, e.item_name]));
      const labelItems: LabelItem[] = tags.map((t) => ({
        sku: t.sku,
        item_name: nameMap.get(t.sku) ?? null,
        short_code: t.short_code,
      }));

      const blobUrl = await generateBikeLabels(labelItems);
      window.open(blobUrl, '_blank');
      toast.success(`${tags.length} asset tags created, ${tags.length * 2} labels generated`);
    } catch (err) {
      console.error('Label generation failed:', err);
      toast.error('Failed to generate labels');
    } finally {
      setIsGenerating(false);
    }
  }, [entries, user]);

  return (
    <div className="flex flex-col min-h-screen bg-bg-main">
      {/* Header */}
      <div className="shrink-0 px-4 pt-4 pb-2">
        <div className="flex items-center gap-3 mb-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 hover:bg-card rounded-full text-muted transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <div>
            <h1 className="text-lg font-black uppercase tracking-widest text-content">
              Bike Labels
            </h1>
            <p className="text-[10px] text-muted font-bold uppercase tracking-widest">
              QR asset tags for physical tracking
            </p>
          </div>
        </div>

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
            {searchResults.map((b) => (
              <button
                key={b.sku}
                onClick={() => handleAddFromSearch(b)}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface transition-colors text-left border-b border-subtle last:border-0"
              >
                <div>
                  <span className="text-xs font-bold text-content">{b.sku}</span>
                  <span className="text-[10px] text-muted ml-2">{(b.item_name ?? '').slice(0, 30)}</span>
                </div>
                <span className="text-[10px] text-muted">{b.quantity} in stock</span>
              </button>
            ))}
          </div>
        )}
      </div>

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
            className="flex items-center gap-3 p-3 bg-card border border-subtle rounded-xl mb-2"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-content tracking-tight">{e.sku}</p>
              <p className="text-[10px] text-muted truncate">{(e.item_name ?? '').slice(0, 40)}</p>
            </div>

            {/* Qty controls */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => handleQtyChange(e.sku, -1)}
                className="w-8 h-8 flex items-center justify-center bg-surface border border-subtle rounded-lg text-muted active:scale-90"
              >
                <Minus size={14} />
              </button>
              <span className="w-8 text-center text-sm font-bold text-content">{e.qty}</span>
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
      {entries.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-main border-t border-subtle">
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
    </div>
  );
};
