import { useState, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import type { LabelInventoryItem } from '../hooks/useLabelItems';

interface InlineSkuCreateProps {
  defaultName: string;
  locations: string[];
  onCreated: (item: LabelInventoryItem) => void;
  onCancel: () => void;
}

export function InlineSkuCreate({
  defaultName,
  locations,
  onCreated,
  onCancel,
}: InlineSkuCreateProps) {
  const queryClient = useQueryClient();
  const [sku, setSku] = useState('');
  const [itemName, setItemName] = useState(defaultName);
  const [location, setLocation] = useState('INCOMING');
  const [locationSearch, setLocationSearch] = useState('');
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const filteredLocations = locationSearch
    ? locations
        .filter((loc) => loc.toLowerCase().includes(locationSearch.toLowerCase()))
        .slice(0, 6)
    : locations.slice(0, 6);

  const canCreate = sku.trim() !== '' && itemName.trim() !== '' && location.trim() !== '';

  const handleCreate = useCallback(async () => {
    if (!canCreate || isCreating) return;
    setIsCreating(true);

    const { data, error } = await (supabase.rpc as CallableFunction)('register_new_sku', {
      p_sku: sku.trim(),
      p_item_name: itemName.trim(),
      p_warehouse: 'LUDLOW',
      p_location: location.trim(),
    });

    if (error) {
      toast.error(error.message);
      setIsCreating(false);
      return;
    }

    const result = data as {
      sku: string;
      item_name: string;
      location: string;
      location_id: string;
    };

    const item: LabelInventoryItem = {
      sku: result.sku,
      item_name: result.item_name,
      location: result.location,
      quantity: 0,
      image_url: null,
      is_bike: false,
      upc: null,
      weight_lbs: null,
      length_in: null,
      width_in: null,
      height_in: null,
    };

    onCreated(item);
    queryClient.invalidateQueries({ queryKey: ['label-studio-items'] });
    toast.success('SKU created');
    setIsCreating(false);
  }, [canCreate, isCreating, sku, itemName, location, onCreated, queryClient]);

  const handleLocationFocus = useCallback(() => {
    if (blurTimeout.current) {
      clearTimeout(blurTimeout.current);
      blurTimeout.current = null;
    }
    setShowLocationDropdown(true);
  }, []);

  const handleLocationBlur = useCallback(() => {
    blurTimeout.current = setTimeout(() => setShowLocationDropdown(false), 200);
  }, []);

  const selectLocation = useCallback((loc: string) => {
    setLocation(loc);
    setLocationSearch('');
    setShowLocationDropdown(false);
  }, []);

  return (
    <div className="bg-card border border-subtle rounded-xl p-4 space-y-3">
      <p className="text-[10px] font-black text-accent uppercase tracking-widest">New SKU</p>
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">
          SKU Code
        </label>
        <input
          type="text"
          value={sku}
          onChange={(e) => setSku(e.target.value.toUpperCase())}
          placeholder="e.g. 03-4099BK"
          className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-sm text-content placeholder:text-muted focus:outline-none focus:border-accent/40"
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">Name</label>
        <input
          type="text"
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          placeholder="Product name"
          className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-sm text-content placeholder:text-muted focus:outline-none focus:border-accent/40"
        />
      </div>
      <div className="relative space-y-1">
        <label className="text-[10px] font-bold text-muted uppercase tracking-wider">
          Location
        </label>
        <input
          type="text"
          value={showLocationDropdown ? locationSearch || location : location}
          onChange={(e) => {
            setLocationSearch(e.target.value);
            setLocation(e.target.value.toUpperCase());
          }}
          onFocus={(e) => {
            handleLocationFocus();
            setLocationSearch(e.target.value);
          }}
          onBlur={handleLocationBlur}
          placeholder="e.g. INCOMING"
          className="w-full h-10 px-3 bg-surface border border-subtle rounded-xl text-sm text-content uppercase placeholder:text-muted focus:outline-none focus:border-accent/40"
        />
        {showLocationDropdown && filteredLocations.length > 0 && (
          <div className="absolute z-50 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-card border border-subtle rounded-xl shadow-lg">
            {filteredLocations.map((loc) => (
              <button
                key={loc}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectLocation(loc)}
                className="w-full px-3 py-2 text-left text-sm text-content hover:bg-accent/10 transition-colors border-b border-subtle last:border-b-0"
              >
                {loc}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 h-10 bg-surface text-muted border border-subtle rounded-xl text-sm font-semibold hover:bg-surface/80 transition-colors active:scale-[0.98]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleCreate}
          disabled={!canCreate || isCreating}
          className="flex-1 h-10 bg-accent text-white rounded-xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none"
        >
          {isCreating ? 'Creating...' : 'Create & Add'}
        </button>
      </div>
    </div>
  );
}
