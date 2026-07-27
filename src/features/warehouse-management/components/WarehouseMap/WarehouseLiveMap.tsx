import React, { useState, useMemo } from 'react';
import { RotateCw, Loader2, Printer, Layers } from 'lucide-react';
import { WarehouseGrid } from './WarehouseGrid';
import { SkuDetailPanel, type SelectedSku, type SkuDetailInfo } from './SkuDetailPanel';
import {
  useRealInventoryMap,
  useAvailableWarehouseRows,
  extractRowNumber,
} from '../../hooks/useRealInventoryMap';

const DEFAULT_ROW = 'ROW 2';

export const WarehouseLiveMap: React.FC = () => {
  const [rotation, setRotation] = useState(0);
  const [selectedSku, setSelectedSku] = useState<SelectedSku | null>(null);
  const [selectedRow, setSelectedRow] = useState<string>(DEFAULT_ROW);

  const { data: availableRows } = useAvailableWarehouseRows();
  const { data: realMapData, isLoading, isError } = useRealInventoryMap(selectedRow);

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

  // Build skuInfo map for SkuDetailPanel
  const skuInfo = useMemo(() => {
    const map = new Map<string, SkuDetailInfo>();
    if (!realMapData?.slots) return map;

    for (const slot of realMapData.slots) {
      const subloc = (slot as unknown as { sublocation: string }).sublocation ?? slot.letter;
      if (slot.usage.kind === 'tower') {
        map.set(slot.usage.sku, {
          itemName: slot.usage.sku,
          pullFrom: `${selectedRow} (${subloc})`,
          ordersCompleted: 0,
          totalQty: slot.usage.units,
        });
      } else if (slot.usage.kind === 'lines') {
        for (const entry of slot.usage.entries) {
          const existing = map.get(entry.sku);
          map.set(entry.sku, {
            itemName: entry.sku,
            pullFrom: `${selectedRow} (${subloc})`,
            ordersCompleted: 0,
            totalQty: (existing?.totalQty ?? 0) + entry.units,
          });
        }
      }
    }

    for (const item of realMapData.unassigned ?? []) {
      map.set(item.sku, {
        itemName: item.itemName ?? item.sku,
        pullFrom: item.location ?? selectedRow,
        ordersCompleted: 0,
        totalQty: item.quantity,
      });
    }

    return map;
  }, [realMapData, selectedRow]);

  const rowNum = extractRowNumber(selectedRow);

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
            Real-time physical stock by sublocation for {selectedRow}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Single-Select Row Dropdown */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
            <Layers className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide">Row:</span>
            <select
              value={selectedRow}
              onChange={(e) => setSelectedRow(e.target.value)}
              className="bg-transparent text-slate-800 font-extrabold text-sm focus:outline-none cursor-pointer pr-2"
            >
              {(availableRows ?? [DEFAULT_ROW, 'ROW 33', 'ROW 32', 'ROW 31']).map((row) => (
                <option key={row} value={row} className="font-semibold text-slate-800">
                  {row}
                </option>
              ))}
            </select>
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
              ⚠️ {realMapData.unassigned.length} items in {selectedRow} lack sublocation letters
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              These items are registered in {selectedRow} but haven't been assigned sublocation
              letters yet.
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

      {/* Map Container — Reuses WarehouseGrid Natively with Dynamic Rows & Sublocations! */}
      <div className="relative flex-1 rounded-2xl print:rounded-none bg-[#F8FAFC] print:bg-white border-2 print:border-0 border-dashed border-slate-200 p-8 print:p-0 overflow-auto print:overflow-visible">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading live stock for {selectedRow}…
          </div>
        ) : isError ? (
          <div className="flex items-center justify-center h-full text-red-500 text-sm font-medium">
            Failed to load live physical stock for {selectedRow}.
          </div>
        ) : (
          <div className="flex justify-center items-center min-w-max print:min-w-0 print:w-full print:h-full mx-auto h-full print:h-auto">
            <WarehouseGrid
              slots={realMapData?.slots ?? []}
              rotation={rotation}
              onSelectSku={setSelectedSku}
              customRows={[rowNum]}
              customLetters={realMapData?.letters}
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
