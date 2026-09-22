import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Download from 'lucide-react/dist/esm/icons/download';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Search from 'lucide-react/dist/esm/icons/search';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

import { useStrappedPallets } from './hooks/useStrappedPallets';
import { BIKES_PER_STRAPPED_PALLET, compareLocations } from './utils/strappedPalletDistribution';

type SortField = 'sku' | 'size' | 'color' | 'year' | 'c6436' | 'ludlow' | 'dist' | 'loc';

type SortOrder = 'asc' | 'desc';

export const StrappedPalletsScreen = () => {
  const navigate = useNavigate();

  // Search query
  const [searchQuery, setSearchQuery] = useState('');

  // Sorting State - default by 6436N quantity descending
  const [sortField, setSortField] = useState<SortField>('c6436');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  // Data hook
  const {
    data: allItems,
    isLoading,
    isFetching,
    refetch,
    error,
  } = useStrappedPallets({
    includeZeroStock: true,
  });

  // Filter specifically to container 6436N SKUs
  const filteredItems = useMemo(() => {
    if (!allItems) return [];

    return allItems
      .filter((item) => item.isFrom6436N)
      .filter((item) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase().trim();
        return (
          item.sku.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.warehouseLocationsLabel.toLowerCase().includes(q)
        );
      });
  }, [allItems, searchQuery]);

  // Sorting
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case 'sku':
          comparison = a.sku.localeCompare(b.sku);
          break;
        case 'c6436':
          comparison = a.container6436Qty - b.container6436Qty;
          break;
        case 'ludlow':
          comparison = a.ludlowQty - b.ludlowQty;
          break;
        case 'dist':
          comparison = a.dist6436Pallets - b.dist6436Pallets;
          break;
        case 'loc':
          comparison = compareLocations(
            a.warehouseLocations[0] || 'ZZZ',
            b.warehouseLocations[0] || 'ZZZ'
          );
          break;
        // Las tres columnas de catálogo: la cabecera ya era pulsable, pero el
        // comparador no las conocía, así que caían en `default` y ordenar por
        // ellas no hacía nada. Vacío al final en las tres.
        case 'size':
          comparison = (a.size || 'ZZZ').localeCompare(b.size || 'ZZZ');
          break;
        case 'color':
          comparison = (a.color || 'ZZZ').localeCompare(b.color || 'ZZZ');
          break;
        case 'year':
          comparison = (a.year || 'ZZZ').localeCompare(b.year || 'ZZZ');
          break;
        default:
          comparison = 0;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [filteredItems, sortField, sortOrder]);

  // Summary Metrics
  const summary = useMemo(() => {
    const totalSkus = sortedItems.length;
    const total6436NUnits = sortedItems.reduce((acc, it) => acc + it.container6436Qty, 0);
    const totalLudlowUnits = sortedItems.reduce((acc, it) => acc + it.ludlowQty, 0);
    const totalDistPallets = sortedItems.reduce((acc, it) => acc + it.dist6436Pallets, 0);

    return {
      totalSkus,
      total6436NUnits,
      totalLudlowUnits,
      totalDistPallets,
    };
  }, [sortedItems]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'c6436' || field === 'ludlow' || field === 'dist' ? 'desc' : 'asc');
    }
  };

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleExportExcel = useCallback(() => {
    if (!sortedItems || sortedItems.length === 0) {
      toast.error('No data to export');
      return;
    }

    const exportRows = sortedItems.map((item) => ({
      SKU: item.sku,
      SIZE: item.size || '—',
      COLOR: item.color || '—',
      YEAR: item.year || '—',
      '6436N': item.container6436Qty,
      LUDLOW: item.ludlowQty,
      DIST: item.dist6436Pallets,
      LOC: item.warehouseLocationsLabel,
    }));

    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '6436N vs Ludlow');

    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `6436N-vs-ludlow-${dateStr}.xlsx`);
    toast.success('Excel file exported successfully');
  }, [sortedItems]);

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return (
        <ArrowUpDown size={12} className="opacity-30 group-hover:opacity-100 transition-opacity" />
      );
    }
    return sortOrder === 'asc' ? (
      <ChevronUp size={13} className="text-accent" />
    ) : (
      <ChevronDown size={13} className="text-accent" />
    );
  };

  return (
    <div className="min-h-screen bg-main text-content pb-20 print:bg-white print:text-black print:pb-0 print:min-h-0">
      {/* ─── Printable Header (Visible only when printed) ─── */}
      <div className="hidden print:block mb-4 border-b-2 border-black pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-black tracking-tight text-black uppercase">
              PICKD — CONTAINER 6436N VS LUDLOW (STRAPPED PALLETS)
            </h1>
            <p className="text-xs text-gray-700 font-medium">
              33 SKUs · 285 Bikes in 6436N · {BIKES_PER_STRAPPED_PALLET} bikes / strapped pallet
            </p>
          </div>
          <div className="text-right text-[10px] text-gray-600 font-mono">
            <div>
              Date:{' '}
              {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
            <div>Jamis Bikes NJ Warehouse</div>
          </div>
        </div>

        {/* Print Summary Bar */}
        <div className="flex gap-6 mt-2 pt-2 border-t border-gray-300 text-xs">
          <div>
            <span className="font-bold text-black">SKUs:</span> {summary.totalSkus}
          </div>
          <div>
            <span className="font-bold text-black">Total in 6436N:</span> {summary.total6436NUnits}{' '}
            bikes
          </div>
          <div>
            <span className="font-bold text-black">Total in Ludlow:</span>{' '}
            {summary.totalLudlowUnits} bikes
          </div>
          <div>
            <span className="font-bold text-black">Total Strapped Pallets:</span>{' '}
            {summary.totalDistPallets} pallets (@12u)
          </div>
        </div>
      </div>

      {/* ─── Screen Header (Hidden during print) ─── */}
      <header className="sticky top-0 z-30 bg-surface border-b border-subtle px-4 py-3 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              aria-label="Go back"
              className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft size={18} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-black uppercase tracking-tight text-content">
                  Container 6436N vs Ludlow
                </h1>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-accent/10 text-accent uppercase tracking-wider border border-accent/20">
                  12 bikes / pallet
                </span>
              </div>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wider">
                Strapped pallets distribution · Ready to print
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              title="Refresh data"
              aria-label="Refresh data"
              className="p-2 border border-subtle rounded-xl bg-card hover:bg-hover text-muted hover:text-content active:scale-95 transition-all"
            >
              <RefreshCw size={17} className={isFetching ? 'animate-spin text-accent' : ''} />
            </button>

            <button
              onClick={handleExportExcel}
              disabled={isLoading || sortedItems.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 border border-subtle rounded-xl bg-card hover:bg-hover text-content text-xs font-bold active:scale-95 transition-all shadow-xs"
              title="Export to Excel"
            >
              <Download size={15} className="text-emerald-500" />
              <span>Excel</span>
            </button>

            <button
              onClick={handlePrint}
              disabled={isLoading || sortedItems.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-white hover:bg-accent/90 text-xs font-bold active:scale-95 transition-all shadow-md"
              title="Print table"
            >
              <Printer size={15} />
              <span>Print</span>
            </button>
          </div>
        </div>
      </header>

      {/* ─── Main Content Container ─── */}
      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 print:p-0 print:max-w-none">
        {/* ─── Metric Cards (Screen only) ─── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 print:hidden">
          <div className="bg-card border border-subtle rounded-2xl p-3 shadow-xs">
            <span className="text-[10px] text-muted font-black uppercase tracking-wider block">
              6436N SKUs
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-content">{summary.totalSkus}</span>
              <span className="text-[10px] text-muted font-bold">lines</span>
            </div>
          </div>

          <div className="bg-card border border-subtle rounded-2xl p-3 shadow-xs">
            <span className="text-[10px] text-muted font-black uppercase tracking-wider block">
              6436N Bikes
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-blue-600 dark:text-blue-400">
                {summary.total6436NUnits}
              </span>
              <span className="text-[10px] text-muted font-bold">units</span>
            </div>
          </div>

          <div className="bg-card border border-subtle rounded-2xl p-3 shadow-xs">
            <span className="text-[10px] text-muted font-black uppercase tracking-wider block">
              Ludlow Stock
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-content">{summary.totalLudlowUnits}</span>
              <span className="text-[10px] text-muted font-bold">units</span>
            </div>
          </div>

          <div className="bg-card border border-subtle rounded-2xl p-3 shadow-xs border-accent/30 bg-accent/[0.02]">
            <span className="text-[10px] text-accent font-black uppercase tracking-wider block">
              Strapped Pallets
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-accent">{summary.totalDistPallets}</span>
              <span className="text-[10px] text-muted font-bold">pallets (@12u)</span>
            </div>
          </div>
        </div>

        {/* ─── Search Bar (Screen only) ─── */}
        <div className="bg-card border border-subtle rounded-2xl p-3 mb-4 shadow-xs print:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <input
              type="text"
              placeholder="Search SKU, description, color, size, location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface border border-subtle rounded-xl text-xs text-content placeholder:text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-content"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* ─── Data State: Loading / Error ─── */}
        {isLoading && (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted">
            <Loader2 className="animate-spin text-accent" size={32} />
            <p className="text-xs font-bold uppercase tracking-wider">Loading 6436N vs Ludlow...</p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-bold">
            Failed to load data: {(error as Error).message}
          </div>
        )}

        {/* ─── Table ─── */}
        {!isLoading && !error && (
          <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-xs print:bg-white print:border-none print:shadow-none print:rounded-none">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs print:text-[9pt]">
                <thead className="bg-surface/80 border-b border-subtle text-muted text-[10px] font-black uppercase tracking-wider sticky top-0 z-10 print:bg-gray-100 print:text-black print:border-b-2 print:border-black">
                  <tr>
                    <th
                      onClick={() => handleSort('sku')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content print:border print:border-gray-400 print:px-2 print:py-1"
                    >
                      <div className="flex items-center gap-1">
                        <span>SKU</span>
                        <span className="print:hidden">{renderSortIcon('sku')}</span>
                      </div>
                    </th>

                    <th
                      onClick={() => handleSort('size')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content print:border print:border-gray-400 print:px-2 print:py-1 text-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Size</span>
                        <span className="print:hidden">{renderSortIcon('size')}</span>
                      </div>
                    </th>

                    <th
                      onClick={() => handleSort('color')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content print:border print:border-gray-400 print:px-2 print:py-1"
                    >
                      <div className="flex items-center gap-1">
                        <span>Color</span>
                        <span className="print:hidden">{renderSortIcon('color')}</span>
                      </div>
                    </th>

                    <th
                      onClick={() => handleSort('year')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content print:border print:border-gray-400 print:px-2 print:py-1 text-center"
                    >
                      <div className="flex items-center justify-center gap-1">
                        <span>Year</span>
                        <span className="print:hidden">{renderSortIcon('year')}</span>
                      </div>
                    </th>

                    {/* 6436N Quantity */}
                    <th
                      onClick={() => handleSort('c6436')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content text-right bg-blue-500/10 print:bg-gray-100 print:border print:border-gray-400 print:px-2 print:py-1"
                    >
                      <div className="flex items-center justify-end gap-1 text-blue-700 dark:text-blue-300 print:text-black font-black">
                        <span>6436N</span>
                        <span className="print:hidden">{renderSortIcon('c6436')}</span>
                      </div>
                    </th>

                    {/* LUDLOW Warehouse Quantity */}
                    <th
                      onClick={() => handleSort('ludlow')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content text-right bg-surface print:bg-gray-100 print:border print:border-gray-400 print:px-2 print:py-1"
                    >
                      <div className="flex items-center justify-end gap-1 text-content font-black print:text-black">
                        <span>LUDLOW</span>
                        <span className="print:hidden">{renderSortIcon('ludlow')}</span>
                      </div>
                    </th>

                    {/* DIST (Pallets) */}
                    <th
                      onClick={() => handleSort('dist')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content text-right bg-accent/10 print:bg-gray-200 print:border print:border-gray-400 print:px-2 print:py-1"
                    >
                      <div className="flex items-center justify-end gap-1 text-accent print:text-black font-black">
                        <span>DIST</span>
                        <span className="print:hidden">{renderSortIcon('dist')}</span>
                      </div>
                    </th>

                    {/* LOC (Locations in Ludlow) */}
                    <th
                      onClick={() => handleSort('loc')}
                      className="py-2.5 px-3 cursor-pointer select-none group hover:text-content min-w-[160px] print:border print:border-gray-400 print:px-2 print:py-1"
                    >
                      <div className="flex items-center gap-1">
                        <span>LOC</span>
                        <span className="print:hidden">{renderSortIcon('loc')}</span>
                      </div>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-subtle print:divide-y print:divide-gray-400">
                  {sortedItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="py-12 text-center text-muted text-xs print:text-black font-bold"
                      >
                        No SKUs found.
                      </td>
                    </tr>
                  ) : (
                    sortedItems.map((item, index) => {
                      const isEven = index % 2 === 0;
                      return (
                        <tr
                          key={item.sku}
                          className={`hover:bg-hover/60 transition-colors print:break-inside-avoid ${
                            isEven
                              ? 'bg-transparent print:bg-white'
                              : 'bg-surface/30 print:bg-gray-50'
                          }`}
                        >
                          {/* 1. SKU */}
                          <td className="py-2 px-3 font-mono font-bold text-content tracking-tight print:border print:border-gray-300 print:px-2 print:py-1 print:text-black">
                            {item.sku}
                          </td>

                          {/* 2. SIZE */}
                          <td className="py-2 px-3 text-center font-bold text-muted print:text-black print:border print:border-gray-300 print:px-2 print:py-1">
                            {item.size || '—'}
                          </td>

                          {/* 4. COLOR */}
                          <td className="py-2 px-3 text-muted print:text-black print:border print:border-gray-300 print:px-2 print:py-1">
                            {item.color || '—'}
                          </td>

                          {/* 5. YEAR */}
                          <td className="py-2 px-3 text-center text-muted print:text-black print:border print:border-gray-300 print:px-2 print:py-1">
                            {item.year || '—'}
                          </td>

                          {/* 6. 6436N (Container qty) */}
                          <td className="py-2 px-3 text-right font-mono font-black text-blue-600 dark:text-blue-400 print:text-black print:border print:border-gray-300 print:px-2 print:py-1 bg-blue-500/[0.04] print:bg-transparent">
                            <span className="text-sm print:text-xs">{item.container6436Qty}</span>
                          </td>

                          {/* 7. LUDLOW (Warehouse qty excl containers) */}
                          <td className="py-2 px-3 text-right font-mono font-bold text-content print:text-black print:border print:border-gray-300 print:px-2 print:py-1">
                            <span className="text-sm print:text-xs">{item.ludlowQty}</span>
                          </td>

                          {/* 8. DIST (Strapped Pallets needed @ 12/pallet) */}
                          <td className="py-2 px-3 text-right font-mono font-black text-accent print:text-black print:border print:border-gray-300 print:px-2 print:py-1 bg-accent/[0.04] print:bg-gray-100">
                            <span className="text-sm print:text-xs">{item.dist6436Pallets}</span>
                            {item.container6436Qty > 0 && (
                              <span className="text-[10px] text-muted print:hidden font-normal block">
                                {Math.floor(item.container6436Qty / BIKES_PER_STRAPPED_PALLET) > 0
                                  ? `${Math.floor(
                                      item.container6436Qty / BIKES_PER_STRAPPED_PALLET
                                    )}×12${
                                      item.container6436Qty % BIKES_PER_STRAPPED_PALLET > 0
                                        ? ` + ${item.container6436Qty % BIKES_PER_STRAPPED_PALLET}`
                                        : ''
                                    }`
                                  : `${item.container6436Qty}u`}
                              </span>
                            )}
                          </td>

                          {/* 9. LOC (Locations in Ludlow) */}
                          <td className="py-2 px-3 print:border print:border-gray-300 print:px-2 print:py-1">
                            <div className="flex flex-wrap items-center gap-1 text-content font-medium print:text-black">
                              {item.warehouseLocationsLabel}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>

                {/* Table Footer with Totals */}
                {sortedItems.length > 0 && (
                  <tfoot className="bg-surface font-bold text-content border-t-2 border-subtle print:bg-gray-200 print:border-black print:text-black">
                    <tr>
                      <td
                        colSpan={4}
                        className="py-2.5 px-3 text-right uppercase text-[10px] tracking-wider print:border print:border-gray-400 print:px-2 print:py-1"
                      >
                        Totals ({summary.totalSkus} SKUs):
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sm text-blue-600 dark:text-blue-400 print:text-black print:border print:border-gray-400 print:px-2 print:py-1">
                        {summary.total6436NUnits}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sm text-content print:text-black print:border print:border-gray-400 print:px-2 print:py-1">
                        {summary.totalLudlowUnits}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-sm text-accent print:text-black print:border print:border-gray-400 print:px-2 print:py-1">
                        {summary.totalDistPallets}
                      </td>
                      <td className="py-2.5 px-3 print:border print:border-gray-400 print:px-2 print:py-1">
                        <span className="text-[10px] text-muted print:text-gray-600 font-normal">
                          Strapped pallets for 6436N (@12u)
                        </span>
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
