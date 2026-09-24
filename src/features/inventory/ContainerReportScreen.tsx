import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Printer from 'lucide-react/dist/esm/icons/printer';
import Download from 'lucide-react/dist/esm/icons/download';
import Search from 'lucide-react/dist/esm/icons/search';
import ChevronUp from 'lucide-react/dist/esm/icons/chevron-up';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import ArrowUpDown from 'lucide-react/dist/esm/icons/arrow-up-down';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

import { useContainerReport } from './hooks/useContainers';
import { summarizeContainerReport, type ContainerReportRow } from './utils/containerReport';
import { BIKES_PER_STRAPPED_PALLET, compareLocations } from './utils/strappedPalletDistribution';

type SortField = 'arrived' | 'sku' | 'loc' | 'dist' | 'total';
type SortOrder = 'asc' | 'desc';

const NUMERIC_FIELDS: SortField[] = ['arrived', 'dist', 'total'];

function formatDay(iso: string | null): string {
  if (!iso) return '—';
  // snapshot_date es una fecha sin hora: se pinta tal cual, sin pasar por la zona del navegador.
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatMoment(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * El reporte de un container contra Ludlow (`get_container_report`). Si ya
 * llegó, LOC y Ludlow salen del último daily snapshot tomado antes de la
 * llegada, así que la hoja dice lo mismo aunque se imprima con el container ya
 * repartido; si todavía viene, del stock de ahora.
 */
export const ContainerReportScreen = () => {
  const navigate = useNavigate();
  const { container: rawContainer } = useParams<{ container: string }>();
  const container = (rawContainer ?? '').trim().toUpperCase();

  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('arrived');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  const { data: report, isLoading, error } = useContainerReport(container);

  const sortedRows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const rows = (report?.rows ?? []).filter(
      (r) => !q || r.sku.toLowerCase().includes(q) || r.locLabel.toLowerCase().includes(q)
    );
    const cmp = (a: ContainerReportRow, b: ContainerReportRow) => {
      switch (sortField) {
        case 'sku':
          return a.sku.localeCompare(b.sku);
        case 'arrived':
          return a.arrived - b.arrived;
        case 'dist':
          return a.dist - b.dist;
        case 'total':
          return a.total - b.total;
        case 'loc':
          return compareLocations(a.firstLocation || 'ZZZ', b.firstLocation || 'ZZZ');
      }
    };
    return [...rows].sort((a, b) => (sortOrder === 'asc' ? cmp(a, b) : -cmp(a, b)));
  }, [report, searchQuery, sortField, sortOrder]);

  const summary = useMemo(() => summarizeContainerReport(sortedRows), [sortedRows]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(NUMERIC_FIELDS.includes(field) ? 'desc' : 'asc');
    }
  };

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleExportExcel = useCallback(() => {
    if (sortedRows.length === 0) {
      toast.error('No data to export');
      return;
    }
    const exportRows = sortedRows.map((r) => ({
      [container]: r.arrived,
      SKU: r.sku,
      LOC: r.locLabel,
      DIST: r.dist,
      TOTAL: r.total,
    }));
    const ws = XLSX.utils.json_to_sheet(exportRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `${container} vs Ludlow`);
    XLSX.writeFile(wb, `${container}-vs-ludlow.xlsx`);
    toast.success('Excel file exported successfully');
  }, [sortedRows, container]);

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

  const headerCell = (field: SortField, label: string, align: 'left' | 'right') => (
    <th
      onClick={() => handleSort(field)}
      className={`py-2.5 px-3 cursor-pointer select-none group hover:text-content print:border print:border-black print:px-2 print:py-1 ${
        align === 'right' ? 'text-right' : ''
      }`}
    >
      <div
        className={`flex items-center gap-1 font-black print:text-black ${
          align === 'right' ? 'justify-end' : ''
        }`}
      >
        <span>{label}</span>
        <span className="print:hidden">{renderSortIcon(field)}</span>
      </div>
    </th>
  );

  const cell = 'py-2 px-3 print:border print:border-black print:px-2 print:py-1 print:text-black';
  const snapshotLine = !report
    ? ''
    : report.ludlowSource === 'live'
      ? 'Coming · Ludlow = stock right now'
      : report.snapshotDate
        ? `Arrived ${formatMoment(report.arrivedAt)} · Ludlow = snapshot ${formatDay(report.snapshotDate)}, before arrival`
        : `Arrived ${formatMoment(report.arrivedAt)} · no snapshot before arrival`;

  return (
    <div className="min-h-screen bg-main text-content pb-20 print:bg-white print:text-black print:pb-0 print:min-h-0">
      {/* ─── Printable Header ─── */}
      <div className="hidden print:block mb-4 border-b-2 border-black pb-3">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-black uppercase">
              CONTAINER {container} VS LUDLOW
            </h1>
            <p className="text-sm text-black font-medium">{snapshotLine}</p>
          </div>
          <div className="text-right text-xs text-black font-mono">
            <div>Registered: {formatMoment(report?.firstRegisteredAt ?? null)}</div>
            <div>Printed: {formatMoment(new Date().toISOString())}</div>
            <div>Jamis Bikes NJ Warehouse</div>
          </div>
        </div>
      </div>

      {/* ─── Screen Header ─── */}
      <header className="sticky top-0 z-30 bg-surface border-b border-subtle px-4 py-3 print:hidden">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() =>
                navigate(`/containers?tab=${report?.ludlowSource === 'live' ? 'coming' : 'past'}`)
              }
              aria-label="Back to containers"
              className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <h1 className="text-lg font-black uppercase tracking-tight text-content">
                Container {container} vs Ludlow
              </h1>
              <p className="text-[10px] text-muted font-bold uppercase tracking-wider truncate">
                {snapshotLine}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportExcel}
              disabled={isLoading || sortedRows.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 border border-subtle rounded-xl bg-card hover:bg-hover text-content text-xs font-bold active:scale-95 transition-all shadow-xs"
              title="Export to Excel"
            >
              <Download size={15} className="text-emerald-500" />
              <span>Excel</span>
            </button>
            <button
              onClick={handlePrint}
              disabled={isLoading || sortedRows.length === 0}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-accent text-white hover:bg-accent/90 text-xs font-bold active:scale-95 transition-all shadow-md"
              title="Print table"
            >
              <Printer size={15} />
              <span>Print</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-6 pt-4 print:p-0 print:max-w-none">
        <div className="bg-card border border-subtle rounded-2xl p-3 mb-4 shadow-xs print:hidden">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" size={16} />
            <input
              type="text"
              placeholder="Search SKU, location..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface border border-subtle rounded-xl text-xs text-content placeholder:text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-all"
            />
          </div>
        </div>

        {isLoading && (
          <div className="py-20 flex flex-col items-center justify-center gap-3 text-muted">
            <Loader2 className="animate-spin text-accent" size={32} />
            <p className="text-xs font-bold uppercase tracking-wider">Loading {container}...</p>
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-2xl text-xs font-bold">
            Failed to load data: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && (
          <div className="bg-card border border-subtle rounded-2xl overflow-hidden shadow-xs print:bg-white print:border-none print:shadow-none print:rounded-none">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs print:text-[11pt]">
                <thead className="bg-surface/80 border-b border-subtle text-muted text-[10px] font-black uppercase tracking-wider print:bg-white print:text-black print:text-[10pt] print:border-b-2 print:border-black">
                  <tr>
                    {headerCell('arrived', container, 'right')}
                    {headerCell('sku', 'SKU', 'left')}
                    {headerCell('loc', 'LOC', 'left')}
                    {headerCell('dist', 'DIST', 'right')}
                    {headerCell('total', 'TOTAL', 'right')}
                  </tr>
                </thead>
                <tbody className="divide-y divide-subtle print:divide-black">
                  {sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-muted text-xs font-bold">
                        No SKUs found.
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((r, index) => (
                      <tr
                        key={r.sku}
                        className={`hover:bg-hover/60 transition-colors print:break-inside-avoid ${
                          index % 2 === 0 ? 'print:bg-white' : 'bg-surface/30 print:bg-white'
                        }`}
                      >
                        <td
                          className={`${cell} text-right font-mono font-black text-blue-600 dark:text-blue-400`}
                        >
                          {r.arrived}
                        </td>
                        <td className={`${cell} font-mono font-bold tracking-tight`}>
                          {r.sku}
                          {!r.isBike && (
                            <span className="ml-1.5 text-[9px] font-bold text-muted uppercase print:text-black print:text-[8pt]">
                              part
                            </span>
                          )}
                        </td>
                        <td className={`${cell} font-medium`}>{r.locLabel}</td>
                        <td className={`${cell} text-right font-mono font-black text-accent`}>
                          {r.dist}
                        </td>
                        <td className={`${cell} text-right font-mono font-black`}>{r.total}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Totales al final */}
            <div className="flex gap-6 px-3 py-2.5 border-t-2 border-subtle text-xs print:text-[11pt] print:mt-3 print:px-0 print:pt-2 print:border-black print:text-black">
              <div>
                <span className="font-bold">SKUs:</span> {summary.skus}
              </div>
              <div>
                <span className="font-bold">Total Strapped Pallets:</span> {summary.pallets} pallets
                (@{BIKES_PER_STRAPPED_PALLET}u)
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
