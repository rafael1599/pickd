// The Exports card in Settings: one button that produces the FedEx Ship Manager
// Dimensions file, plus the exceptions it held back.
//
// The exceptions are shown rather than filed away because they are the point.
// Ship Manager imports in "Replace current data" mode, so a SKU missing from the
// CSV is a SKU with no dimensions in FedEx at all — the list is the work queue
// for whoever has the tape measure.

import { useState } from 'react';
import Download from 'lucide-react/dist/esm/icons/download';
import Package from 'lucide-react/dist/esm/icons/package';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { useFedexDimensionsExport } from '../hooks/useFedexDimensionsExport';
import {
  EXCEPTION_LABELS,
  toExceptionsCsv,
  type FedexDimensionException,
} from '../utils/fedexDimensions';

function downloadExceptions(exceptions: FedexDimensionException[], stamp: string) {
  const blob = new Blob([toExceptionsCsv(exceptions)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `DIMENSIONS_EXCEPTIONS_${stamp}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function FedexDimensionsExportCard() {
  const exportCsv = useFedexDimensionsExport();
  const [showExceptions, setShowExceptions] = useState(false);
  const result = exportCsv.data;
  const stamp = result?.filename.replace(/^DIMENSIONS_FEDEX_|\.csv$/g, '') ?? '';

  return (
    <div className="bg-card border border-subtle rounded-3xl p-6 mb-8 backdrop-blur-sm">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="p-2.5 bg-surface border border-subtle rounded-2xl text-accent">
            <Package size={20} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-content uppercase tracking-tight">Exports</h2>
            <p className="text-xs text-muted font-medium">
              Refresh the FedEx Ship Manager dimensions database
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            setShowExceptions(false);
            exportCsv.mutate();
          }}
          disabled={exportCsv.isPending}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-accent text-white text-sm font-bold
                     disabled:opacity-50 disabled:cursor-not-allowed transition-opacity
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
        >
          <Download size={16} />
          {exportCsv.isPending ? 'Building…' : 'Export FedEx Dimensions (CSV)'}
        </button>
      </div>

      <p className="text-xs text-muted mt-4 leading-relaxed">
        Import at <span className="font-semibold text-content">Databases → File Maintenance →
        Import</span> with template <span className="font-mono">DIMENTIONS1</span> and{' '}
        <span className="font-semibold text-content">Replace current data</span>. Replace empties
        the table first, so always import the whole file — never a partial one.
      </p>

      {result && (
        <div className="mt-5 pt-5 border-t border-subtle">
          <div className="flex items-baseline gap-6 flex-wrap">
            <div>
              <span className="text-2xl font-black text-content tabular-nums">
                {result.records.length}
              </span>
              <span className="text-xs text-muted font-medium ml-2">
                records in {result.filename}
              </span>
            </div>
            {result.exceptions.length > 0 && (
              <div>
                <span className="text-2xl font-black text-amber-500 tabular-nums">
                  {result.exceptions.length}
                </span>
                <span className="text-xs text-muted font-medium ml-2">SKUs held back</span>
              </div>
            )}
          </div>

          <p className="text-xs text-muted mt-2">
            Ship Manager should report Processed = {result.records.length}, Errors = 0.
          </p>

          {result.exceptions.length > 0 && (
            <div className="mt-4">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => setShowExceptions((v) => !v)}
                  aria-expanded={showExceptions}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-accent
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                >
                  <ChevronDown
                    size={14}
                    className={`transition-transform ${showExceptions ? 'rotate-180' : ''}`}
                  />
                  {showExceptions ? 'Hide' : 'Show'} exceptions
                </button>
                <button
                  onClick={() => downloadExceptions(result.exceptions, stamp)}
                  className="text-xs font-bold uppercase tracking-wide text-muted hover:text-content
                             focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                >
                  Download list
                </button>
              </div>

              {showExceptions && (
                <div className="mt-3 max-h-80 overflow-auto border border-subtle rounded-2xl">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="text-muted uppercase tracking-wide">
                        <th className="text-left font-bold px-3 py-2">SKU</th>
                        <th className="text-left font-bold px-3 py-2">Model</th>
                        <th className="text-left font-bold px-3 py-2">Size</th>
                        <th className="text-left font-bold px-3 py-2">Stored</th>
                        <th className="text-left font-bold px-3 py-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.exceptions.map((e) => (
                        <tr key={e.sku} className="border-t border-subtle">
                          <td className="px-3 py-1.5 font-mono text-content">{e.sku}</td>
                          <td className="px-3 py-1.5 text-muted">{e.model ?? '—'}</td>
                          <td className="px-3 py-1.5 text-muted">{e.size ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-muted tabular-nums">
                            {e.length_in ?? '—'}×{e.width_in ?? '—'}×{e.height_in ?? '—'}
                          </td>
                          <td className="px-3 py-1.5 text-muted">{EXCEPTION_LABELS[e.reason]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
