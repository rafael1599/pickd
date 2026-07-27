import React, { useState, useMemo } from 'react';
import { RotateCw, Loader2, Printer, CheckCircle2, ChevronDown, Filter } from 'lucide-react';
import { WarehouseGrid } from './WarehouseGrid';
import { SkuDetailPanel, type SelectedSku, type SkuDetailInfo } from './SkuDetailPanel';
import { useRealInventoryMap, useAvailableWarehouseRows } from '../../hooks/useRealInventoryMap';

const DEFAULT_SELECTED_ROWS = ['ROW 33', 'ROW 32', 'ROW 31'];

export const WarehouseLiveMap: React.FC = () => {
  const [rotation, setRotation] = useState(0);
  const [selectedSku, setSelectedSku] = useState<SelectedSku | null>(null);
  const [selectedRows, setSelectedRows] = useState<string[]>(DEFAULT_SELECTED_ROWS);
  const [isRowSelectorOpen, setIsRowSelectorOpen] = useState(false);

  const { data: availableRows } = useAvailableWarehouseRows();
  const { data: realMapData, isLoading, isError } = useRealInventoryMap(selectedRows);

  const handlePrintLandscape = () => {
    const style = document.createElement('style');
    style.id = 'print-landscape-override';
    style.innerHTML = '@page { size: A4 landscape !important; margin: 4mm !important; }';
    document.head.appendChild(style);

    const cleanup = () => {
      document.getElementById('print-landscape-override')?.remove();
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 2000);
  };

  const handleToggleRow = (row: string) => {
    setSelectedRows((prev) =>
      prev.includes(row) ? prev.filter((r) => r !== row) : [...prev, row]
    );
  };

  // Build skuInfo map for SkuDetailPanel
  const skuInfo = useMemo(() => {
    const map = new Map<string, SkuDetailInfo>();
    if (!realMapData?.slots) return map;

    for (const slot of realMapData.slots) {
      if (slot.usage.kind === 'tower') {
        map.set(slot.usage.sku, {
          itemName: slot.usage.sku,
          pullFrom: `ROW ${slot.row} (${slot.sublocation})`,
          ordersCompleted: 0,
          totalQty: slot.usage.units,
        });
      } else if (slot.usage.kind === 'lines') {
        for (const entry of slot.usage.entries) {
          const existing = map.get(entry.sku);
          map.set(entry.sku, {
            itemName: entry.sku,
            pullFrom: `ROW ${slot.row} (${slot.sublocation})`,
            ordersCompleted: 0,
            totalQty: (existing?.totalQty ?? 0) + entry.units,
          });
        }
      }
    }

    for (const item of realMapData.unassigned ?? []) {
      map.set(item.sku, {
        itemName: item.itemName ?? item.sku,
        pullFrom: item.location ?? 'Unknown',
        ordersCompleted: 0,
        totalQty: item.quantity,
      });
    }

    return map;
  }, [realMapData]);

  const selectedRowsLabel = useMemo(() => {
    if (!selectedRows.length) return 'Select Rows';
    const nums = selectedRows.map((r) => r.replace(/\D+/g, '')).filter(Boolean);
    return `Rows: ${nums.join(', ')}`;
  }, [selectedRows]);

  return (
    <div className="w-full h-full flex flex-col p-6 print:p-0 overflow-auto print:overflow-visible bg-white">
      {/* Header */}
      <div className="print:hidden flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold text-slate-800">Warehouse Live View</h2>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              LIVE
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Real-time physical stock directly from database
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap relative">
          {/* Row Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsRowSelectorOpen((prev) => !prev)}
              className="flex items-center gap-2 px-3.5 h-10 rounded-lg border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 active:scale-95 transition-all font-semibold text-xs tracking-wide"
            >
              <Filter className="w-3.5 h-3.5 text-slate-500" />
              <span>{selectedRowsLabel}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
            </button>

            {isRowSelectorOpen && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 space-y-2 animate-in fade-in zoom-in duration-150">
                <div className="flex items-center justify-between border-b pb-2">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Select Rows
                  </span>
                  <button
                    onClick={() => setSelectedRows(DEFAULT_SELECTED_ROWS)}
                    className="text-[10px] text-blue-600 font-bold hover:underline"
                  >
                    Reset (33, 32, 31)
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1">
                  {(availableRows ?? DEFAULT_SELECTED_ROWS).map((row) => {
                    const isSelected = selectedRows.includes(row);
                    return (
                      <label
                        key={row}
                        className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-xs font-semibold text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleRow(row)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                        />
                        <span>{row}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handlePrintLandscape}
            className="flex items-center gap-1.5 px-3.5 h-10 rounded-lg border border-gray-200 bg-white text-slate-700 shadow-sm hover:bg-gray-50 active:scale-95 transition-all font-semibold text-xs tracking-wide"
            title="Print / Save PDF (Landscape A4)"
          >
            <Printer className="w-4 h-4 text-slate-500" />
            <span>Print Landscape</span>
          </button>

          <button
            onClick={() => setRotation((prev) => prev + 90)}
            className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white text-slate-600 shadow-sm hover:bg-gray-50 hover:text-slate-800 transition-colors"
            title="Rotate 90°"
          >
            <RotateCw className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Unassigned Sublocation Warning Banner */}
      {realMapData?.unassigned && realMapData.unassigned.length > 0 && (
        <div className="print:hidden mb-6 p-4 rounded-xl bg-amber-50 border border-amber-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold text-amber-900">
              ⚠️ {realMapData.unassigned.length} items in selected rows lack sublocations
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              These items are in the row but haven't been assigned sublocation letters (A–J) yet.
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {realMapData.unassigned.slice(0, 5).map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center px-2 py-1 rounded bg-amber-100 text-amber-800 text-[10px] font-mono font-bold"
              >
                {u.sku} ({u.quantity}u)
              </span>
            ))}
            {realMapData.unassigned.length > 5 && (
              <span className="text-[10px] font-bold text-amber-700 self-center">
                +{realMapData.unassigned.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* Map Container — Reuses WarehouseGrid Natively! */}
      <div className="relative flex-1 rounded-2xl print:rounded-none bg-[#F8FAFC] print:bg-white border-2 print:border-0 border-dashed border-slate-200 p-8 print:p-0 overflow-auto print:overflow-visible">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading live physical stock…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center h-full text-red-500 text-sm font-medium">
            Failed to load live physical stock.
          </div>
        ) : (
          <div className="flex justify-center items-center min-w-max print:min-w-0 print:w-full print:h-full mx-auto h-full print:h-auto">
            <WarehouseGrid
              slots={realMapData?.slots ?? []}
              rotation={rotation}
              onSelectSku={setSelectedSku}
            />
          </div>
        )}

        {selectedSku && (
          <div className="print:hidden">
            <SkuDetailPanel
              selected={selectedSku}
              info={skuInfo.get(selectedSku.sku)}
              onClose={() => setSelectedSku(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
};
