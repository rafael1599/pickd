import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useInventory } from './hooks/InventoryProvider.tsx';
import { useViewMode } from '../../context/ViewModeContext.tsx';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import { useDebounce } from '../../hooks/useDebounce.ts';
import { InventoryCard } from './components/InventoryCard.tsx';
import { InventoryModal } from './components/InventoryModal.tsx';
import { ItemDetailView } from './components/ItemDetailView';
import { naturalSort } from '../../utils/sortUtils.ts';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Warehouse from 'lucide-react/dist/esm/icons/warehouse';
import { MovementModal } from './components/MovementModal.tsx';
import { CapacityBar } from '../../components/ui/CapacityBar.tsx';
import toast from 'react-hot-toast';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

/** jspdf-autotable extends jsPDF instances with lastAutoTable after calling autoTable() */
interface JsPDFWithAutoTable extends jsPDF {
  lastAutoTable?: { finalY: number };
}
import FileDown from 'lucide-react/dist/esm/icons/file-down';

import { usePickingSession } from '../../context/PickingContext.tsx';
import { useAuth } from '../../context/AuthContext.tsx';
import { useLocationManagement } from './hooks/useLocationManagement.ts';
import LocationEditorModal from '../warehouse-management/components/LocationEditorModal.tsx';
import { useError } from '../../context/ErrorContext.tsx';
import { useConfirmation } from '../../context/ConfirmationContext.tsx';
import { SessionInitializationModal } from '../picking/components/SessionInitializationModal.tsx';
import { InventoryItemWithMetadata, InventoryItemInput } from '../../schemas/inventory.schema.ts';
import { Location, LocationInput } from '../../schemas/location.schema.ts';
/** Represents a "ghost" location that exists only as text on inventory items, not in the locations table */
interface NewLocationStub {
  warehouse: string;
  location: string;
  max_capacity: number;
  zone: string;
  picking_order: number;
  isNew: true;
}

const SEARCHING_MESSAGE = (
  <div className="py-20 text-center text-muted font-bold uppercase tracking-widest animate-pulse">
    Searching Inventory...
  </div>
);

const NoInventoryFound = ({ onClear }: { onClear: () => void }) => (
  <div className="text-center text-muted mt-20 py-20 border-2 border-dashed border-subtle rounded-3xl">
    <Warehouse className="mx-auto mb-4 opacity-20" size={48} />
    <p className="text-xl font-black uppercase tracking-widest opacity-30 mb-6">
      No inventory found
    </p>
    <button
      onClick={onClear}
      className="px-6 py-2.5 bg-accent text-white font-black uppercase tracking-widest rounded-xl text-xs active:scale-95 transition-all shadow-lg shadow-accent/20"
    >
      Clear Search
    </button>
  </div>
);

export const InventoryScreen = () => {
  const {
    inventoryData,
    locationCapacities,
    updateQuantity,
    addItem,
    updateItem,
    moveItem,
    deleteItem,
    loading,
    showInactive,
    setShowInactive,
    showPartsBins,
    setShowPartsBins,
    setSearchQuery,
    loadMore: loadMoreItems,
    hasMoreItems,
    isLoadingMore,
    isSearching: isServerSearching,
  } = useInventory();

  const [localSearch, setLocalSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to top when searching to ensure results are visible
  useEffect(() => {
    if (localSearch) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [localSearch]);
  const debouncedSearch = useDebounce(localSearch, 300);

  // Sync search to data hook so it forces parts bins download when searching
  useEffect(() => {
    setSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSearchQuery]);

  // Filtering (search is now server-side, only inactive filter remains client-side)
  const filteredInventory = useMemo(() => {
    return inventoryData.filter((item) => {
      if (!showInactive && item.is_active === false) return false;
      return true;
    });
  }, [inventoryData, showInactive]);

  const isLoading = loading;

  const allGroupedData = useMemo(() => {
    const groups: Record<
      string,
      Record<string, { items: typeof filteredInventory; locationId?: string | null }>
    > = {};

    // First pass: Group by Warehouse + Location
    filteredInventory.forEach((item) => {
      const wh = item.warehouse || 'UNKNOWN';
      const locName = item.location || 'Unknown Location';

      if (!groups[wh]) groups[wh] = {};
      if (!groups[wh][locName]) {
        groups[wh][locName] = {
          items: [],
          locationId: item.location_id,
        };
      }

      groups[wh][locName].items.push(item);
      if (item.location_id && !groups[wh][locName].locationId) {
        groups[wh][locName].locationId = item.location_id;
      }
    });

    // Second pass: Consolidate items within each location by SKU
    Object.keys(groups).forEach((wh) => {
      Object.keys(groups[wh]).forEach((loc) => {
        const consolidated: Record<string, InventoryItemWithMetadata> = {};

        groups[wh][loc].items.forEach((item) => {
          const skuKey = item.sku.toUpperCase().trim();

          if (!consolidated[skuKey]) {
            consolidated[skuKey] = { ...item };
          } else {
            // MERGE Logic
            const existing = consolidated[skuKey];

            // Prefer a 'real' ID over an optimistic one if both exist,
            // but keep the local flag if either is local.
            const existingId = existing.id as string | number;
            const itemId = item.id as string | number;
            const isExistingTemp =
              (typeof existingId === 'string' &&
                (existingId.startsWith('add-') || existingId.startsWith('move-'))) ||
              (typeof existingId === 'number' && existingId < 0);
            const isItemReal = typeof itemId === 'number' && itemId > 0;

            if (isExistingTemp && isItemReal) {
              existing.id = item.id;
            }

            existing.quantity = (existing.quantity || 0) + (item.quantity || 0);

            // Merge notes if they differ
            if (item.item_name && item.item_name !== existing.item_name) {
              existing.item_name = existing.item_name
                ? `${existing.item_name} | ${item.item_name}`
                : item.item_name;
            }

            // Sync metadata if missing
            if (!existing.sku_metadata && item.sku_metadata) {
              existing.sku_metadata = item.sku_metadata;
            }

            // Preservation of flags
            if (item._lastUpdateSource === 'local') {
              existing._lastUpdateSource = 'local';
              existing._lastLocalUpdateAt = Math.max(
                existing._lastLocalUpdateAt || 0,
                item._lastLocalUpdateAt || 0
              );
            }
          }
        });

        let consolidatedItems = Object.values(consolidated);

        // Filter out zero-quantity items unless showing inactive
        if (!showInactive) {
          consolidatedItems = consolidatedItems.filter((item) => item.quantity > 0);
        }

        groups[wh][loc].items = consolidatedItems;
      });
    });

    return groups;
  }, [filteredInventory, showInactive]);

  const allSortedWarehouses = useMemo(() => {
    // Only include warehouses that have entries in allGroupedData and aren't effectively empty
    const warehouses = Object.keys(allGroupedData).filter((wh) => {
      const locs = allGroupedData[wh];
      return Object.values(locs).some((loc) => loc.items.length > 0);
    });

    return warehouses.sort((a, b) => {
      if (a === 'LUDLOW') return -1;
      if (b === 'LUDLOW') return 1;
      return a.localeCompare(b);
    });
  }, [allGroupedData]);

  const allLocationBlocks = useMemo(() => {
    return allSortedWarehouses.flatMap(
      (wh) =>
        Object.keys(allGroupedData[wh])
          .sort(naturalSort)
          .map((location) => ({
            wh,
            location,
            items: allGroupedData[wh][location].items,
            locationId: allGroupedData[wh][location].locationId,
          }))
          .filter((block) => block.items.length > 0) // Remove empty locations from view
    );
  }, [allSortedWarehouses, allGroupedData]);

  // All blocks are rendered — pagination is server-side now
  const locationBlocks = allLocationBlocks;

  // Scroll to top when search changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [debouncedSearch]);

  const { viewMode, isSearching } = useViewMode(); // 'stock' | 'picking'

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItemWithMetadata | null>(null);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedWarehouseForAdd, setSelectedWarehouseForAdd] = useState('LUDLOW');
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [locationBeingEdited, setLocationBeingEdited] = useState<Location | NewLocationStub | null>(
    null
  );

  const { isAdmin, user: authUser, profile } = useAuth();
  const { showError } = useError();
  const { showConfirmation } = useConfirmation();
  const {
    locations: allMappedLocations,
    createLocation,
    updateLocation,
    deactivateLocation,
  } = useLocationManagement();

  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);

  // Calculate stats for the filtered view
  const filteredStats = useMemo(() => {
    const uniqueSkus = new Set<string>();
    let totalQty = 0;

    allLocationBlocks.forEach((block) => {
      block.items.forEach((item) => {
        uniqueSkus.add(item.sku);
        totalQty += item.quantity;
      });
    });

    return { totalSkus: uniqueSkus.size, totalQuantity: totalQty };
  }, [allLocationBlocks]);

  const handleDownloadView = useCallback(async () => {
    if (allLocationBlocks.length === 0) {
      toast.error('No inventory to download');
      return;
    }

    setIsGeneratingPDF(true);
    try {
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const generatorName = profile?.full_name || authUser?.email || 'System';

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(32);
      doc.text('Stock View Report', 5, 15);

      const firstName = generatorName.split(' ')[0];
      const today = new Date().toLocaleDateString('es-ES');

      // Group items by Warehouse -> SKU (Aggregate locations)
      const whAggregates: Record<
        string,
        Record<string, { qty: number; locations: Set<string>; notes: Set<string> }>
      > = {};

      allLocationBlocks.forEach((block) => {
        if (!whAggregates[block.wh]) whAggregates[block.wh] = {};
        const whGroup = whAggregates[block.wh];

        block.items.forEach((item) => {
          if (!whGroup[item.sku]) {
            whGroup[item.sku] = { qty: 0, locations: new Set(), notes: new Set() };
          }
          whGroup[item.sku].qty += item.quantity;
          if (item.location) whGroup[item.sku].locations.add(item.location.trim().toUpperCase());
          if (item.item_name) whGroup[item.sku].notes.add(item.item_name.trim());
        });
      });

      let currentY = 32; // Increased from 22

      Object.entries(whAggregates).forEach(([wh, skuGroups], index) => {
        if (index > 0 && currentY > 150) {
          doc.addPage();
          currentY = 22; // Start lower on new pages
        }

        const totalSkus = Object.keys(skuGroups).length;
        const totalQty = Object.values(skuGroups).reduce((sum, g) => sum + g.qty, 0);
        const metadataLine = `By: ${firstName} | Date: ${today} | SKUs: ${totalSkus} | Qty: ${totalQty} | WH: ${wh}`;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(28);
        doc.text('SKU | Locs | Qty | Notes', 5, currentY);
        currentY += 8; // Increased from 5 for more separation

        // Convert grouped data to table rows
        const tableData = Object.entries(skuGroups)
          .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
          .map(([sku, data]) => [
            sku,
            Array.from(data.locations).sort().join(', ') || 'GEN',
            data.qty.toString(),
            Array.from(data.notes).join(' | '),
          ]);

        autoTable(doc, {
          startY: currentY,
          body: tableData,
          theme: 'plain',
          styles: {
            font: 'helvetica',
            fontSize: 40,
            cellPadding: 6,
            minCellHeight: 20,
            textColor: [0, 0, 0],
            lineColor: [0, 0, 0],
            lineWidth: 1.12,
          },
          columnStyles: {
            0: { cellWidth: 100, fontStyle: 'bold' },
            1: { cellWidth: 45, fontSize: 18 },
            2: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
            3: { cellWidth: 'auto', fontSize: 14 },
          },
          margin: { top: 5, right: 5, bottom: 5, left: 5 },
          didDrawPage: () => {
            // Footer: By: Rafael | Date: ... | SKUs: ... | Qty: ... | WH: ...
            // Positioned at bottom right
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(14);
            doc.text(metadataLine, 292, 205, { align: 'right' });
            currentY = (doc as JsPDFWithAutoTable).lastAutoTable?.finalY || 15;
          },
        });

        currentY = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? 15) + 15;
      });

      const blob = doc.output('bloburl');
      window.open(blob, '_blank');
      toast.success('Report opened in new tab');
    } catch (error) {
      console.error('Failed to generate PDF:', error);
      toast.error('Failed to generate PDF');
    } finally {
      setIsGeneratingPDF(false);
    }
  }, [allLocationBlocks, profile, authUser]);

  // Picking Mode State
  const { cartItems, addToCart, getAvailableStock, onStartSession, sessionMode } =
    usePickingSession();

  // --- Stock Mode Handlers ---
  const handleAddItem = useCallback((warehouse = 'LUDLOW') => {
    setModalMode('add');
    setSelectedWarehouseForAdd(warehouse);
    setEditingItem(null);
    setIsModalOpen(true);
  }, []);

  const handleEditItem = useCallback((item: InventoryItemWithMetadata) => {
    setModalMode('edit');
    setEditingItem(item);
    setIsModalOpen(true);
  }, []);

  const handleDelete = useCallback(() => {
    if (editingItem) {
      deleteItem(editingItem.warehouse, editingItem.sku, editingItem.location);
    }
  }, [editingItem, deleteItem]);

  const saveItem = useCallback(
    async (
      formData: InventoryItemInput & { length_in?: number; width_in?: number; height_in?: number }
    ) => {
      const targetWarehouse = formData.warehouse;
      if (modalMode === 'add') {
        return await addItem(targetWarehouse, formData);
      } else if (editingItem) {
        return await updateItem(editingItem, formData);
      }
    },
    [modalMode, addItem, updateItem, editingItem]
  );

  const handleMoveStock = useCallback(
    async (moveData: {
      sourceItem: InventoryItemWithMetadata;
      targetWarehouse: string;
      targetLocation: string;
      quantity: number;
      internalNote?: string | null;
    }) => {
      try {
        await moveItem(
          moveData.sourceItem,
          moveData.targetWarehouse,
          moveData.targetLocation,
          moveData.quantity,
          undefined,
          moveData.internalNote
        );
        toast.success('Stock successfully moved!');
      } catch (err: unknown) {
        console.error('Error moving stock:', err);
        showError('Move failed', err instanceof Error ? err.message : String(err));
      }
    },
    [moveItem, showError]
  );

  const handleQuickMove = useCallback((item: InventoryItemWithMetadata) => {
    setEditingItem(item);
    setIsMovementModalOpen(true);
  }, []);

  const handleOpenLocationEditor = useCallback(
    (warehouse: string, locationName: string, locationId?: string | null) => {
      if (!isAdmin || viewMode !== 'stock') return;
      let loc = null;
      if (locationId) {
        loc = allMappedLocations.find((l) => l.id === locationId);
      }
      if (!loc) {
        loc = allMappedLocations.find(
          (l) =>
            l.warehouse === warehouse && l.location.toLowerCase() === locationName.toLowerCase()
        );
      }
      if (loc) {
        setLocationBeingEdited(loc);
      } else {
        setLocationBeingEdited({
          warehouse,
          location: locationName,
          max_capacity: 550,
          zone: 'UNASSIGNED',
          picking_order: 999,
          isNew: true,
        });
      }
    },
    [isAdmin, viewMode, allMappedLocations]
  );

  const handleSaveLocation = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (formData: any) => {
      let result;
      if (
        locationBeingEdited &&
        'isNew' in locationBeingEdited &&
        (locationBeingEdited as NewLocationStub).isNew
      ) {
        const { isNew: _IsNew, ...dataToCreate } = formData;
        result = await createLocation(dataToCreate as LocationInput);
      } else if (locationBeingEdited && 'id' in locationBeingEdited) {
        result = await updateLocation(locationBeingEdited.id, formData);
      } else {
        return;
      }

      if (result.success) {
        setLocationBeingEdited(null);
        window.location.reload();
      } else {
        showError('Error saving location', result.error);
      }
    },
    [locationBeingEdited, createLocation, updateLocation, showError]
  );

  const handleDeleteLocation = useCallback(
    async (id: string) => {
      if (
        locationBeingEdited &&
        'isNew' in locationBeingEdited &&
        (locationBeingEdited as NewLocationStub).isNew
      ) {
        const totalUnits = inventoryData
          .filter(
            (i) =>
              i.warehouse === locationBeingEdited.warehouse &&
              i.location === locationBeingEdited.location
          )
          .reduce((sum, i) => sum + (i.quantity || 0), 0);

        const confirmMsg = `This is a "ghost" location (it only exists as text on ${totalUnits} inventory units). 
Do you want to PERMANENTLY DELETE all these products so the location disappears?`;

        showConfirmation(
          'Delete Ghost Location',
          confirmMsg,
          async () => {
            const itemsToDelete = inventoryData.filter(
              (i) =>
                i.warehouse === locationBeingEdited.warehouse &&
                i.location === locationBeingEdited.location
            );
            for (const item of itemsToDelete) {
              await deleteItem(item.warehouse, item.sku);
            }
            setLocationBeingEdited(null);
            window.location.reload();
          },
          undefined,
          'Permanently Delete',
          'Cancel'
        );
        return;
      }

      const result = await deactivateLocation(id);
      if (result.success) {
        setLocationBeingEdited(null);
        window.location.reload();
      }
    },
    [locationBeingEdited, inventoryData, deleteItem, deactivateLocation, showConfirmation]
  );

  // --- Picking Mode Handlers ---
  const handleCardClick = useCallback(
    (item: InventoryItemWithMetadata) => {
      if (viewMode === 'stock') {
        handleEditItem(item);
      } else {
        onStartSession();
        addToCart(item);
      }
    },
    [viewMode, handleEditItem, addToCart, onStartSession]
  );

  // REMOVED EARLY LOADING RETURN TO PREVENT KEYBOARD DISMISSAL
  // Layout must remain stable while charging

  // Removed isError check as we are using local data now

  return (
    <div className="pb-4 relative">
      <SessionInitializationModal />

      {/* Manual Snapshot Button (Admin Stock Mode Only) */}
      {isAdmin && viewMode === 'stock' && (
        <div className="fixed bottom-40 right-4 z-40 flex flex-col gap-3">
          <button
            onClick={handleDownloadView}
            disabled={isGeneratingPDF}
            className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-all ${
              isGeneratingPDF
                ? 'bg-subtle text-muted cursor-wait'
                : 'bg-surface text-accent border border-accent/20 hover:bg-blue-500 hover:text-white hover:border-blue-500 hover:shadow-blue-500/20'
            }`}
            title="Download Filtered Stock PDF"
          >
            {isGeneratingPDF ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
            ) : (
              <FileDown size={20} />
            )}
          </button>
        </div>
      )}

      <SearchInput
        ref={searchInputRef}
        value={localSearch}
        onChange={setLocalSearch}
        placeholder="Search SKU, Loc, Warehouse..."
        preferenceId="inventory"
        autoFocus={viewMode === 'picking'}
      />

      {viewMode === 'stock' && (
        <div className="px-4 pt-2 flex justify-between items-center text-xs font-black uppercase tracking-widest text-muted">
          <span>{filteredStats.totalSkus} SKUs</span>
          <span>{filteredStats.totalQuantity} Units Total</span>
        </div>
      )}

      {(!isSearching || (allLocationBlocks.length === 0 && localSearch.trim() !== '')) && (
        <div
          className={`px-4 pt-2 flex flex-wrap items-center gap-x-4 gap-y-1 transition-all duration-300 ${allLocationBlocks.length === 0 && localSearch.trim() !== '' ? 'bg-blue-500/10 p-3 rounded-xl border border-blue-500/20 animate-in fade-in zoom-in-95 duration-500' : ''}`}
        >
          <label
            htmlFor="show-inactive"
            className={`flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none transition-colors ${
              allLocationBlocks.length === 0 && localSearch.trim() !== ''
                ? 'text-blue-500 font-black uppercase tracking-wider'
                : 'text-muted'
            }`}
          >
            <input
              type="checkbox"
              id="show-inactive"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className={`rounded transition-colors h-3.5 w-3.5 ${
                allLocationBlocks.length === 0 && localSearch.trim() !== ''
                  ? 'border-blue-500 text-blue-500 focus:ring-blue-500'
                  : 'border-neutral-600 bg-surface text-accent focus:ring-accent focus:ring-offset-0'
              }`}
            />
            Deleted & Qty 0
          </label>
          <label
            htmlFor="show-bike-bins"
            className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none text-muted"
          >
            <input
              type="checkbox"
              id="show-bike-bins"
              checked={showPartsBins}
              onChange={(e) => setShowPartsBins(e.target.checked)}
              className="rounded transition-colors h-3.5 w-3.5 border-neutral-600 bg-surface text-accent focus:ring-accent focus:ring-offset-0"
            />
            Parts Bins
          </label>
        </div>
      )}

      <div className="p-4 space-y-6 min-h-[50vh]">
        {(isLoading || isServerSearching) && !locationBlocks.length
          ? SEARCHING_MESSAGE
          : locationBlocks.map(({ wh, location, items, locationId }, index) => {
              const isFirstInWarehouse = index === 0 || locationBlocks[index - 1].wh !== wh;

              return (
                <div key={`${wh}-${location}`} className="space-y-2 max-w-2xl mx-auto">
                  {isFirstInWarehouse && !isSearching && wh !== 'LUDLOW' && (
                    <div className="flex items-center gap-4 pt-8 pb-2">
                      <div className="h-px flex-1 bg-subtle" />
                      <h2
                        className="text-2xl font-black uppercase tracking-tighter text-content bg-surface px-6 py-2 rounded-full border border-subtle shadow-sm flex items-center gap-3"
                        style={{ fontFamily: 'var(--font-heading)' }}
                      >
                        <Warehouse className="text-accent" size={24} />
                        {wh === 'DELETED ITEMS' ? 'Deleted Items' : wh}
                      </h2>
                      <div className="h-px flex-1 bg-subtle" />
                    </div>
                  )}

                  <div className="sticky top-[84px] bg-main/95 backdrop-blur-sm z-30 py-3 border-b border-subtle group">
                    <div className="flex items-center gap-4 px-1">
                      <div className="flex-[3]">
                        <CapacityBar
                          current={
                            locationCapacities[`${wh}-${(location || '').trim().toUpperCase()}`]
                              ?.current || 0
                          }
                          max={
                            locationCapacities[`${wh}-${(location || '').trim().toUpperCase()}`]
                              ?.max || 550
                          }
                        />
                      </div>

                      <div className="flex-1 min-w-0">
                        <h3
                          className={`text-content text-xl font-black uppercase tracking-tighter truncate ${isAdmin && viewMode === 'stock' ? 'cursor-pointer hover:text-accent transition-colors' : ''}`}
                          style={{ fontFamily: 'var(--font-heading)' }}
                          title={
                            isAdmin && viewMode === 'stock' ? 'Click to edit location' : location
                          }
                          onClick={() => handleOpenLocationEditor(wh, location, locationId)}
                        >
                          {location}
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1">
                    {items.map((item) => {
                      const isInCart = cartItems.some(
                        (c) =>
                          c.sku === item.sku &&
                          c.warehouse === item.warehouse &&
                          c.location === item.location
                      );

                      // Calculate availability for picking mode
                      const stockInfo = viewMode === 'picking' ? getAvailableStock(item) : null;

                      return (
                        <div
                          key={`inv-row-${item.id}-${item.sku}`}
                          className={`animate-staggered-fade-in ${
                            isInCart && viewMode === 'picking'
                              ? 'ring-1 ring-accent rounded-lg'
                              : ''
                          }`}
                          style={{ animationDelay: `${(index % 10) * 0.05}s` }}
                        >
                          <InventoryCard
                            sku={item.sku}
                            quantity={item.quantity}
                            detail={item.item_name}
                            warehouse={item.warehouse}
                            onIncrement={() =>
                              updateQuantity(item.sku, 1, item.warehouse, item.location)
                            }
                            onDecrement={() =>
                              updateQuantity(item.sku, -1, item.warehouse, item.location)
                            }
                            onMove={() => handleQuickMove(item)}
                            onClick={() => handleCardClick(item)}
                            mode={viewMode === 'picking' ? sessionMode : 'stock'}
                            reservedByOthers={stockInfo?.reservedByOthers || 0}
                            available={stockInfo?.available}
                            sku_metadata={item.sku_metadata}
                            internal_note={item.internal_note}
                            distribution={item.distribution}
                            lastUpdateSource={item._lastUpdateSource}
                            is_active={item.is_active}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

        {hasMoreItems && !debouncedSearch ? (
          <div className="flex flex-col items-center gap-4 py-8">
            <button
              onClick={loadMoreItems}
              disabled={isLoadingMore}
              className={`px-8 py-4 font-black uppercase tracking-widest rounded-2xl transition-all active:scale-95 shadow-lg ${
                isLoadingMore
                  ? 'bg-subtle text-muted cursor-wait'
                  : 'bg-subtle text-accent hover:bg-accent hover:text-white'
              }`}
            >
              {isLoadingMore ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                  Loading...
                </span>
              ) : (
                'Load More'
              )}
            </button>
          </div>
        ) : null}

        {allLocationBlocks.length === 0 ? (
          <NoInventoryFound
            onClear={() => {
              setLocalSearch('');
              searchInputRef.current?.focus();
            }}
          />
        ) : null}
      </div>

      {viewMode === 'stock' ? (
        <div className="fixed bottom-24 right-4 flex flex-col gap-3 z-40">
          <button
            onClick={() => handleAddItem('LUDLOW')}
            className="w-16 h-16 ios-btn-primary shadow-2xl shadow-accent/40 active:scale-90 transition-transform"
            title="Add New SKU"
          >
            <Plus size={32} strokeWidth={3} />
          </button>
        </div>
      ) : null}

      <ItemDetailView
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={saveItem}
        onDelete={handleDelete}
        initialData={editingItem}
        mode={modalMode}
        screenType={selectedWarehouseForAdd || editingItem?.warehouse}
      />

      <MovementModal
        isOpen={isMovementModalOpen}
        onClose={() => setIsMovementModalOpen(false)}
        onMove={handleMoveStock}
        initialSourceItem={editingItem}
      />

      {locationBeingEdited ? (
        <LocationEditorModal
          location={locationBeingEdited as Location}
          onSave={handleSaveLocation}
          onDelete={handleDeleteLocation}
          onCancel={() => setLocationBeingEdited(null)}
        />
      ) : null}
    </div>
  );
};
