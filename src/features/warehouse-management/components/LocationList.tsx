import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import { useState, useMemo, useEffect } from 'react';
import Package from 'lucide-react/dist/esm/icons/package';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { useLocationManagement } from '../../inventory/hooks/useLocationManagement';
import { useInventory } from '../../inventory/hooks/useInventoryData';
import LocationEditorModal from './LocationEditorModal';
import { type Location } from '../../../schemas/location.schema';
import { SearchInput } from '../../../components/ui/SearchInput';

/**
 * LocationList - Grid/List of locations with edit capability
 * Displays all locations from the new locations table
 */
export const LocationList = () => {
  const { locations, loading, updateLocation, refresh, deactivateLocation } = useLocationManagement();
  const { ludlowData, atsData } = useInventory();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<"LUDLOW" | "ATS">('LUDLOW');
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Combine inventory data
  const allInventory = useMemo(() => [...ludlowData, ...atsData], [ludlowData, atsData]);

  // Get unique warehouses from locations (only shows warehouses that have locations)
  const warehouses = useMemo(() => {
    const unique = new Set(locations.map((l) => l.warehouse));
    return Array.from(unique).filter(wh => wh !== 'ATS').sort();
  }, [locations]);

  // Update selected warehouse if it no longer exists in the list or on initial load
  useEffect(() => {
    if (warehouses.length > 0) {
      if (!(warehouses as string[]).includes(selectedWarehouse)) {
        // If current selection doesn't exist, default to LUDLOW or first available
        setSelectedWarehouse((warehouses as string[]).includes('LUDLOW') ? 'LUDLOW' : warehouses[0] as "LUDLOW" | "ATS");
      }
    }
  }, [warehouses, selectedWarehouse]);

  const filteredLocations = useMemo(() => {
    return locations
      .filter((loc) => {
        const matchesSearch =
          loc.location.toLowerCase().includes(searchTerm.toLowerCase()) ||
          loc.warehouse.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesWarehouse = loc.warehouse === selectedWarehouse;
        return matchesSearch && matchesWarehouse;
      })
      .sort((a, b) => {
        // Treat null or 999 as "no order" — push to the end
        const aOrder = (a.picking_order === null || a.picking_order === 999) ? -Infinity : a.picking_order;
        const bOrder = (b.picking_order === null || b.picking_order === 999) ? -Infinity : b.picking_order;
        return bOrder - aOrder; // Descending: highest row number first
      });
  }, [locations, searchTerm, selectedWarehouse]);

  // Get inventory count for a location
  const getInventoryInfo = (loc: Location) => {
    const items = allInventory.filter((item) => {
      if (item.location_id && loc.id) {
        return item.location_id === loc.id;
      }
      return item.warehouse === loc.warehouse && item.location === loc.location;
    });
    const totalQty = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    return { skuCount: items.length, totalQty };
  };

  const handleSaveLocation = async (formData: any) => {
    if (!selectedLocation) return;
    const result = await updateLocation(selectedLocation.id, formData);
    if (result.success) {
      setSaveSuccess(`${selectedLocation.location} updated successfully`);
      setTimeout(() => setSaveSuccess(null), 3000);
      setSelectedLocation(null);
      refresh();
    }
  };

  const handleDeleteLocation = async (id: string) => {
    const result = await deactivateLocation(id);
    if (result.success) {
      setSelectedLocation(null);
      refresh();
    }
  };



  if (loading) {
    return <div className="p-12 text-center text-muted animate-pulse">Loading Locations...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Success Message */}
      {saveSuccess && (
        <div className="p-3 bg-green-500/20 border border-green-500/30 rounded-lg text-green-400 text-sm font-medium animate-in fade-in duration-300">
          ✅ {saveSuccess}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-3 bg-card border border-subtle p-4 rounded-xl">
        {/* Search and Filter */}
        <SearchInput
          variant="inline"
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search location..."
          preferenceId="locations"
          rightSlot={
            <div className="flex gap-2">
              {warehouses.map((wh) => (
                <button
                  key={wh}
                  onClick={() => setSelectedWarehouse(wh)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${selectedWarehouse === wh
                    ? 'bg-accent text-main shadow-lg shadow-accent/20'
                    : 'bg-surface text-muted border border-subtle hover:bg-main'
                    }`}
                >
                  {wh}
                </button>
              ))}
            </div>
          }
        />
      </div>

      {/* Stats */}
      <div className="text-xs text-muted">
        Showing {filteredLocations.length} of {locations.length} locations
      </div>

      {/* Locations Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredLocations.map((loc) => {
          const invInfo = getInventoryInfo(loc);

          return (
            <button
              key={loc.id}
              onClick={() => setSelectedLocation(loc)}
              className="bg-card border border-subtle rounded-xl p-4 text-left hover:border-accent/50 hover:bg-surface/50 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="text-accent" size={16} />
                    <span className="font-bold text-content">{loc.location}</span>
                  </div>
                  <div className="text-xs text-muted mt-0.5">{loc.warehouse}</div>
                </div>
                <ChevronRight
                  className="text-muted group-hover:text-accent transition-colors"
                  size={18}
                />
              </div>

              <div className="flex items-center gap-2 mb-3">
                {/* Capacity Badge */}
                {loc.max_capacity && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface text-muted border border-subtle">
                    Cap: {loc.max_capacity}
                  </span>
                )}
                {loc.picking_order !== null && loc.picking_order < 999 && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-accent/10 text-accent border border-accent/20">
                    #{loc.picking_order}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1 text-muted">
                  <Package size={12} />
                  <span>{invInfo.skuCount} SKUs</span>
                </div>
                <span className="text-muted">{invInfo.totalQty} units</span>
              </div>


            </button>
          );
        })}
      </div>

      {/* Empty State */}
      {filteredLocations.length === 0 && (
        <div className="text-center py-12 text-muted">
          No locations found with current filters.
        </div>
      )}

      {/* Edit Modal */}
      {selectedLocation && (
        <LocationEditorModal
          location={selectedLocation}
          onSave={handleSaveLocation}
          onCancel={() => setSelectedLocation(null)}
          onDelete={handleDeleteLocation}
        />
      )}
    </div>
  );
};

export default LocationList;
