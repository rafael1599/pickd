import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useInventory } from './hooks/InventoryProvider.tsx';
import { useViewMode } from '../../context/ViewModeContext.tsx';
import { useModal } from '../../context/ModalContext';
import { SearchInput } from '../../components/ui/SearchInput.tsx';
import { useDebounce } from '../../hooks/useDebounce.ts';
import { InventoryCard } from './components/InventoryCard.tsx';
import { useVerifiedSkus } from '../../hooks/useVerifiedSkus';
import { useLastActivity, formatLastActivity } from './hooks/useLastActivity';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
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
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';

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
    showParts,
    setShowParts,
    showScratchDent,
    setShowScratchDent,
    setSearchQuery,
    loadMore: loadMoreItems,
    hasMoreItems,
    isLoadingMore,
    isSearching: isServerSearching,
    globalStats,
  } = useInventory();

  const [localSearch, setLocalSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  // Auto-load more when sentinel enters viewport (with cooldown to prevent tight loop)
  const loadCooldownRef = useRef(false);
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMoreItems || isLoadingMore || loadCooldownRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadCooldownRef.current = true;
          loadMoreItems();
          setTimeout(() => {
            loadCooldownRef.current = false;
          }, 500);
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreItems, isLoadingMore, loadMoreItems]);

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

  // Split search results: active items render as cards, ghost items as compact trail
  const isActiveSearch = debouncedSearch.length > 0;
  const filteredInventory = useMemo(() => {
    if (!isActiveSearch) return inventoryData;
    if (showInactive) return inventoryData;
    return inventoryData.filter((item) => item.is_active && item.quantity > 0);
  }, [inventoryData, isActiveSearch, showInactive]);

  const ghostItems = useMemo(() => {
    if (!isActiveSearch || showInactive) return [];
    return inventoryData.filter((item) => !item.is_active || item.quantity <= 0);
  }, [inventoryData, isActiveSearch, showInactive]);

  // Split ghost items into two buckets: SKUs that still have stock somewhere
  // else ("moved" — not really gone, just relocated) vs SKUs with zero stock
  // anywhere ("out of stock" — actually empty). Helps the user not panic when
  // an item appears as 0 but lives in another location.
  const { movedGhostItems, oosGhostItems } = useMemo(() => {
    if (ghostItems.length === 0) {
      return { movedGhostItems: [], oosGhostItems: [] };
    }
    const skusWithStockElsewhere = new Set<string>();
    for (const item of inventoryData) {
      if ((item.quantity || 0) > 0 && item.is_active && item.sku) {
        skusWithStockElsewhere.add(item.sku.trim());
      }
    }
    const moved: typeof ghostItems = [];
    const oos: typeof ghostItems = [];
    for (const item of ghostItems) {
      if (skusWithStockElsewhere.has((item.sku || '').trim())) moved.push(item);
      else oos.push(item);
    }
    return { movedGhostItems: moved, oosGhostItems: oos };
  }, [ghostItems, inventoryData]);

  const ghostSkus = useMemo(() => ghostItems.map((i) => i.sku), [ghostItems]);
  const { data: lastActivityMap } = useLastActivity(ghostSkus);
  const [movedTrailOpen, setMovedTrailOpen] = useState(false);
  const [oosTrailOpen, setOosTrailOpen] = useState(false);

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

        const consolidatedItems = Object.values(consolidated);

        groups[wh][loc].items = consolidatedItems;
      });
    });

    return groups;
  }, [filteredInventory]);

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

  const { viewMode, isSearching, externalDoubleCheckId } = useViewMode(); // 'stock' | 'picking'
  const { open: openModal } = useModal();
  const verifiedSkus = useVerifiedSkus();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItemWithMetadata | null>(null);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [selectedWarehouseForAdd, setSelectedWarehouseForAdd] = useState('LUDLOW');
  const [isMovementModalOpen, setIsMovementModalOpen] = useState(false);
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [locationBeingEdited, setLocationBeingEdited] = useState<Location | NewLocationStub | null>(
    null
  );

  const { isAdmin } = useAuth();
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
      const today = new Date().toLocaleDateString('es-ES');

      // Group items by Warehouse → SKU, keeping per-location qty so the
      // PDF can render each location with its individual quantity:
      //   ROW 1 (40), ROW 28 (27)
      const whAggregates: Record<
        string,
        Record<string, { qty: number; locations: Map<string, number> }>
      > = {};

      allLocationBlocks.forEach((block) => {
        if (!whAggregates[block.wh]) whAggregates[block.wh] = {};
        const whGroup = whAggregates[block.wh];

        block.items.forEach((item) => {
          if (!whGroup[item.sku]) {
            whGroup[item.sku] = { qty: 0, locations: new Map() };
          }
          whGroup[item.sku].qty += item.quantity;
          const loc = item.location?.trim().toUpperCase();
          if (loc) {
            whGroup[item.sku].locations.set(
              loc,
              (whGroup[item.sku].locations.get(loc) ?? 0) + item.quantity
            );
          }
        });
      });

      let currentY = 15;

      Object.entries(whAggregates).forEach(([wh, skuGroups], index) => {
        if (index > 0 && currentY > 150) {
          doc.addPage();
          currentY = 15;
        }

        const totalSkus = Object.keys(skuGroups).length;
        const totalQty = Object.values(skuGroups).reduce((sum, g) => sum + g.qty, 0);

        // Header per warehouse: "LUDLOW · 156 SKUs · 4,287 units · 2026-04-29"
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(20);
        doc.text(
          `${wh} · ${totalSkus} SKUs · ${totalQty.toLocaleString()} units · ${today}`,
          5,
          currentY
        );
        currentY += 8;

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(14);
        doc.text('SKU', 5, currentY);
        doc.text('LOCATIONS', 105, currentY);
        doc.text('TOTAL', 285, currentY, { align: 'right' });
        currentY += 4;

        // Convert grouped data to table rows: SKU | LOCATIONS | TOTAL
        // Drop "(qty)" when the SKU lives in a single location — the TOTAL
        // column already shows the same number, so it'd be redundant.
        // Multi-location keeps "(qty)" per loc since they sum to TOTAL.
        const tableData = Object.entries(skuGroups)
          .sort(([skuA], [skuB]) => skuA.localeCompare(skuB))
          .map(([sku, data]) => {
            const stockedLocs = Array.from(data.locations.entries())
              .filter(([, qty]) => qty > 0)
              .sort(([a], [b]) => a.localeCompare(b));
            let locsStr: string;
            if (stockedLocs.length === 0) {
              locsStr = 'GEN';
            } else if (stockedLocs.length === 1) {
              locsStr = stockedLocs[0][0];
            } else {
              locsStr = stockedLocs
                .map(([loc, qty]) => `${loc} (${qty.toLocaleString()})`)
                .join(', ');
            }
            return [sku, locsStr, data.qty.toLocaleString()];
          });

        autoTable(doc, {
          startY: currentY,
          body: tableData,
          theme: 'plain',
          styles: {
            font: 'helvetica',
            fontSize: 32,
            cellPadding: 5,
            minCellHeight: 16,
            textColor: [0, 0, 0],
            lineColor: [0, 0, 0],
            lineWidth: 0.6,
          },
          columnStyles: {
            0: { cellWidth: 100, fontStyle: 'bold' },
            1: { cellWidth: 'auto', fontSize: 18 },
            2: { cellWidth: 35, halign: 'right', fontStyle: 'bold' },
          },
          margin: { top: 5, right: 5, bottom: 5, left: 5 },
        });

        currentY = ((doc as JsPDFWithAutoTable).lastAutoTable?.finalY ?? 15) + 12;
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
  }, [allLocationBlocks]);

  // Picking Mode State
  const {
    cartItems,
    addToCart,
    updateCartQty,
    removeFromCart,
    getAvailableStock,
    onStartSession,
    sessionMode,
  } = usePickingSession();

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
      targetSublocation?: string[] | null;
    }) => {
      try {
        await moveItem(
          moveData.sourceItem,
          moveData.targetWarehouse,
          moveData.targetLocation,
          moveData.quantity,
          undefined,
          moveData.internalNote,
          moveData.targetSublocation
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
      if (!isAdmin || viewMode !== 'stock' || isSearching) return;
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
    [isAdmin, viewMode, isSearching, allMappedLocations]
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

      {/* Intentionally removed — PDF download moved to FAB menu below */}

      <SearchInput
        ref={searchInputRef}
        value={localSearch}
        onChange={setLocalSearch}
        placeholder="Search SKU, Serial, UPC, Loc, Name..."
        preferenceId="inventory"
        autoFocus={viewMode === 'picking' && !externalDoubleCheckId}
      />

      {viewMode === 'stock' &&
        !isSearching &&
        (() => {
          const totalUnits = debouncedSearch
            ? filteredStats.totalQuantity
            : (globalStats?.totalQuantity ?? filteredStats.totalQuantity);
          const totalCapacity = globalStats?.totalCapacity ?? 0;
          const available = totalCapacity > 0 ? totalCapacity - totalUnits : 0;
          const fillPct = totalCapacity > 0 ? Math.min((totalUnits / totalCapacity) * 100, 100) : 0;
          const fillRatio = totalCapacity > 0 ? totalUnits / totalCapacity : 0;
          return (
            <>
              {!showParts && totalCapacity > 0 ? (
                <div className="px-4 pt-2 flex justify-between items-center text-xs font-black uppercase tracking-widest text-muted">
                  <span>{totalUnits.toLocaleString()} Filled</span>
                  <span className="text-emerald-400">{available.toLocaleString()} Available</span>
                </div>
              ) : (
                <div className="px-4 pt-2 flex justify-between items-center text-xs font-black uppercase tracking-widest text-muted">
                  <span>
                    {(debouncedSearch
                      ? filteredStats.totalSkus
                      : (globalStats?.totalSkus ?? filteredStats.totalSkus)
                    ).toLocaleString()}{' '}
                    SKUs
                  </span>
                  <span>{totalUnits.toLocaleString()} Units</span>
                </div>
              )}
              {!debouncedSearch && !showParts && totalCapacity > 0 && (
                <div className="px-4 pt-1.5 pb-1 flex items-center gap-2">
                  <div className="h-3 flex-1 bg-surface rounded-full overflow-hidden border border-subtle">
                    <div
                      className="h-full transition-all duration-500 ease-out rounded-full"
                      style={{
                        width: `${fillPct}%`,
                        background: 'linear-gradient(to right, #3b82f6, #06b6d4, #10b981)',
                        backgroundSize: `${100 / Math.max(fillRatio, 0.01)}% 100%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] font-black text-muted tabular-nums whitespace-nowrap">
                    {totalCapacity.toLocaleString()}
                  </span>
                </div>
              )}
            </>
          );
        })()}

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
            htmlFor="show-parts"
            className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none text-muted"
          >
            <input
              type="checkbox"
              id="show-parts"
              checked={showParts}
              onChange={(e) => {
                setShowParts(e.target.checked);
                if (e.target.checked) setShowScratchDent(false);
              }}
              className="rounded transition-colors h-3.5 w-3.5 border-neutral-600 bg-surface text-accent focus:ring-accent focus:ring-offset-0"
            />
            Parts
          </label>
          <label
            htmlFor="show-sd"
            className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none text-muted"
          >
            <input
              type="checkbox"
              id="show-sd"
              checked={showScratchDent}
              onChange={(e) => {
                setShowScratchDent(e.target.checked);
                if (e.target.checked) setShowParts(false);
              }}
              className="rounded transition-colors h-3.5 w-3.5 border-neutral-600 bg-surface text-accent focus:ring-accent focus:ring-offset-0"
            />
            S/D
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

                  <div
                    className={`sticky top-[84px] bg-main/95 backdrop-blur-sm z-30 py-3 border-b border-subtle group ${isAdmin && viewMode === 'stock' && !isSearching ? 'cursor-pointer' : ''}`}
                    onClick={() => handleOpenLocationEditor(wh, location, locationId)}
                  >
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
                          className={`text-content text-xl font-black uppercase tracking-tighter truncate ${isAdmin && viewMode === 'stock' ? 'hover:text-accent transition-colors' : ''}`}
                          style={{ fontFamily: 'var(--font-heading)' }}
                          title={
                            isAdmin && viewMode === 'stock' ? 'Tap to edit location' : location
                          }
                        >
                          {location}
                        </h3>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-1">
                    {items.map((item) => {
                      const cartItem = cartItems.find(
                        (c) =>
                          c.sku === item.sku &&
                          c.warehouse === item.warehouse &&
                          c.location === item.location
                      );
                      const cartQty = cartItem?.pickingQty ?? 0;

                      // Calculate availability for picking mode
                      const stockInfo = viewMode === 'picking' ? getAvailableStock(item) : null;

                      return (
                        <div
                          key={`inv-row-${item.id}-${item.sku}`}
                          className={`animate-staggered-fade-in ${
                            cartQty > 0 && viewMode === 'picking'
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
                            sublocation={item.sublocation}
                            distribution={item.distribution}
                            lastUpdateSource={item._lastUpdateSource}
                            is_active={item.is_active}
                            cartQty={cartQty}
                            onCartIncrement={() => updateCartQty(item, 1)}
                            onCartDecrement={() => updateCartQty(item, -1)}
                            onCartRemove={() => removeFromCart(item)}
                            lastCounted={verifiedSkus.get(item.sku) ?? null}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

        {/* Ghost trails — qty=0 items split into two buckets:
              · "Moved" — same SKU has stock in another location
              · "Out of stock" — no stock anywhere */}
        {isActiveSearch &&
          (movedGhostItems.length > 0 || oosGhostItems.length > 0) &&
          (() => {
            const renderRow = (item: (typeof ghostItems)[number]) => {
              const activity = lastActivityMap?.get(item.sku);
              return (
                <div
                  key={`ghost-${item.id}-${item.sku}`}
                  onClick={() => handleCardClick(item)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleCardClick(item);
                    }
                  }}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface/50 border border-subtle/50 cursor-pointer hover:bg-surface/80 active:scale-[0.99] transition-all"
                >
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-content/70 tracking-tight">
                      {item.sku}
                    </span>
                    {item.item_name && (
                      <span className="text-[10px] text-muted/60 ml-2 truncate">
                        {item.item_name}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted shrink-0 text-right">
                    {activity ? (
                      activity.list_id ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (activity.list_id) {
                              openModal({ type: 'picking-summary', listId: activity.list_id });
                            }
                          }}
                          className="hover:underline hover:brightness-125 active:scale-95 transition-all cursor-pointer"
                        >
                          {activity.action_type === 'MOVE' && '↗ '}
                          {activity.action_type === 'DEDUCT' && '📦 '}
                          {activity.action_type === 'ADD' && '+ '}
                          {formatLastActivity(activity)}
                        </button>
                      ) : (
                        <span>
                          {activity.action_type === 'MOVE' && '↗ '}
                          {activity.action_type === 'DEDUCT' && '📦 '}
                          {activity.action_type === 'ADD' && '+ '}
                          {formatLastActivity(activity)}
                        </span>
                      )
                    ) : !item.is_active ? (
                      <span className="text-muted/50">Inactive</span>
                    ) : (
                      <span>No recent activity</span>
                    )}
                  </div>
                </div>
              );
            };

            return (
              <div className="max-w-2xl mx-auto space-y-1">
                {movedGhostItems.length > 0 && (
                  <div>
                    <button
                      onClick={() => setMovedTrailOpen((v) => !v)}
                      className="flex items-center gap-2 w-full py-3 px-1 text-emerald-500/80 hover:text-emerald-400 transition-colors"
                    >
                      <div className="h-px flex-1 bg-emerald-500/20" />
                      <span className="text-[10px] font-black uppercase tracking-widest shrink-0">
                        Moved ({movedGhostItems.length})
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 transition-transform ${movedTrailOpen ? 'rotate-180' : ''}`}
                      />
                      <div className="h-px flex-1 bg-emerald-500/20" />
                    </button>
                    {movedTrailOpen && (
                      <div className="space-y-1 pb-4">{movedGhostItems.map(renderRow)}</div>
                    )}
                  </div>
                )}

                {oosGhostItems.length > 0 && (
                  <div>
                    <button
                      onClick={() => setOosTrailOpen((v) => !v)}
                      className="flex items-center gap-2 w-full py-3 px-1 text-muted hover:text-content transition-colors"
                    >
                      <div className="h-px flex-1 bg-subtle" />
                      <span className="text-[10px] font-black uppercase tracking-widest shrink-0">
                        Out of stock ({oosGhostItems.length})
                      </span>
                      <ChevronDown
                        size={14}
                        className={`shrink-0 transition-transform ${oosTrailOpen ? 'rotate-180' : ''}`}
                      />
                      <div className="h-px flex-1 bg-subtle" />
                    </button>
                    {oosTrailOpen && (
                      <div className="space-y-1 pb-4">{oosGhostItems.map(renderRow)}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

        {hasMoreItems && !isServerSearching ? (
          <div ref={loadMoreSentinelRef} className="py-8 flex justify-center">
            {isLoadingMore && (
              <div className="w-6 h-6 border-2 border-white/20 border-t-white/60 rounded-full animate-spin" />
            )}
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
        <>
          {/* Backdrop to close menu */}
          {fabMenuOpen && (
            <div className="fixed inset-0 z-40" onClick={() => setFabMenuOpen(false)} />
          )}
          <div className="fixed bottom-24 right-4 flex flex-col items-end gap-2 z-40">
            {/* Expandable actions */}
            {fabMenuOpen && (
              <div className="flex flex-col items-end gap-2 animate-staggered-fade-in">
                <button
                  onClick={() => {
                    handleAddItem('LUDLOW');
                    setFabMenuOpen(false);
                  }}
                  className="flex items-center gap-2 h-11 pl-4 pr-3 bg-surface border border-subtle rounded-full shadow-lg active:scale-95 transition-all"
                >
                  <span className="text-[11px] font-bold text-content uppercase tracking-wider">
                    Add SKU
                  </span>
                  <Plus size={18} className="text-accent" />
                </button>
                <button
                  onClick={() => {
                    handleDownloadView();
                    setFabMenuOpen(false);
                  }}
                  disabled={isGeneratingPDF}
                  className="flex items-center gap-2 h-11 pl-4 pr-3 bg-surface border border-subtle rounded-full shadow-lg active:scale-95 transition-all disabled:opacity-50"
                >
                  <span className="text-[11px] font-bold text-content uppercase tracking-wider">
                    {isGeneratingPDF ? 'Generating...' : 'Download PDF'}
                  </span>
                  {isGeneratingPDF ? (
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-current border-t-transparent" />
                  ) : (
                    <FileDown size={18} className="text-accent" />
                  )}
                </button>
              </div>
            )}
            {/* Main FAB — 3 dots */}
            <button
              onClick={() => setFabMenuOpen((v) => !v)}
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-all active:scale-90 ${
                fabMenuOpen
                  ? 'bg-accent text-white shadow-xl shadow-accent/30 rotate-90'
                  : 'text-accent hover:bg-accent hover:text-white hover:shadow-xl hover:shadow-accent/30'
              }`}
            >
              <MoreHorizontal size={24} strokeWidth={3} />
            </button>
          </div>
        </>
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
