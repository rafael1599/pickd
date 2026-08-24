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
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import { useFedexDimensionsExport } from '../hooks/useFedexDimensionsExport';
import {
  EXCEPTION_LABELS,
  toExceptionsCsv,
  type FedexDimensionException,
} from '../utils/fedexDimensions';
import { useUpdateCartonDimensions } from '../../picking/hooks/useUpdateCartonDimensions';
import {
  draftProblem,
  draftSides,
  DRAFT_SIDES,
  EMPTY_CARTON_DRAFT,
  type CartonDraft,
} from '../../picking/utils/cartonDraft';

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

function ExceptionRow({ e, onUpdated }: { e: FedexDimensionException; onUpdated: () => void }) {
  const [draft, setDraft] = useState<CartonDraft>(EMPTY_CARTON_DRAFT);
  const [isEditing, setIsEditing] = useState(false);
  const update = useUpdateCartonDimensions();
  
  const problem = draftProblem(draft);
  const busy = update.isPending;

  const save = async () => {
    const sides = draftSides(draft);
    if (!sides || problem) return;
    try {
      await update.mutateAsync({ sku: e.sku, sides });
      toast.success(`${e.sku} measured`);
      setIsEditing(false);
      setDraft(EMPTY_CARTON_DRAFT);
      onUpdated();
    } catch {
      // toast already handled by hook
    }
  };

  return (
    <>
      <tr className="border-t border-subtle group">
        <td className="px-3 py-2">
          <div className="font-mono text-content font-bold">{e.sku}</div>
          {e.location && (
            <div className="text-[10px] text-muted flex items-center gap-1 mt-0.5">
              <MapPin size={10} />
              {e.location}
            </div>
          )}
        </td>
        <td className="px-3 py-2 text-muted">{e.model ?? '—'}</td>
        <td className="px-3 py-2 text-muted">{e.size ?? '—'}</td>
        <td className="px-3 py-2 font-mono text-muted tabular-nums">
          {e.length_in ?? '—'}×{e.width_in ?? '—'}×{e.height_in ?? '—'}
        </td>
        <td className="px-3 py-2 text-muted">
          <div className="flex items-center justify-between gap-2">
            <span>{EXCEPTION_LABELS[e.reason]}</span>
            {!isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="text-[10px] font-bold uppercase tracking-wide text-accent hover:text-accent-hover opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100"
              >
                Fix
              </button>
            )}
          </div>
        </td>
      </tr>
      {isEditing && (
        <tr className="bg-surface/50 border-b border-subtle">
          <td colSpan={5} className="px-4 py-3">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-medium text-muted uppercase tracking-widest">
                New Dimensions
              </span>
              <div className="flex items-center gap-2">
                {DRAFT_SIDES.map((key, i) => (
                  <div key={key} className="flex items-center gap-2">
                    {i > 0 && <span className="text-muted text-xs">×</span>}
                    <input
                      type="number"
                      step="0.25"
                      min="0"
                      inputMode="decimal"
                      value={draft[key]}
                      onChange={(evt) => setDraft((d) => ({ ...d, [key]: evt.target.value }))}
                      disabled={busy}
                      aria-label={`Side ${i + 1} of ${e.sku}, in inches`}
                      className="w-16 py-1 rounded bg-card border border-subtle text-center text-sm font-mono font-semibold text-content focus:outline-none focus:border-accent disabled:opacity-50"
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={save}
                  disabled={problem !== null || busy}
                  className="ml-2 h-[28px] px-3 rounded bg-accent text-white text-[10px] font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  {busy && <Loader2 size={12} className="animate-spin" />}
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsEditing(false);
                    setDraft(EMPTY_CARTON_DRAFT);
                  }}
                  disabled={busy}
                  className="h-[28px] px-2 text-[10px] font-bold uppercase tracking-wide text-muted hover:text-content disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
              {problem && problem !== 'incomplete' && (
                <span className="text-[10px] font-bold text-rose-400">
                  {EXCEPTION_LABELS[problem] ?? problem}
                </span>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
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
                        <ExceptionRow 
                          key={e.sku} 
                          e={e} 
                          onUpdated={() => {
                            // Automatically rebuild after a fix
                            exportCsv.mutate();
                          }} 
                        />
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
