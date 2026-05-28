// idea-117 — popover that lets the operator hide specific rows from the
// current consolidation tab's results. Selection persists via `useHiddenRows`.
//
// Visual contract: a single button "Hidden: N" that opens a panel with a
// grid of all rows present in the data + quick-action shortcuts. The button
// stays visible even when N = 0, so the operator can always find the toggle.

import React, { useEffect, useRef, useState } from 'react';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import X from 'lucide-react/dist/esm/icons/x';

import type { HiddenRowsApi } from '../hooks/useHiddenRows';

export interface HiddenRowsPickerProps {
  /** All distinct rows present in the current data (post-search-filter pre-hide).
      The picker enumerates these so the operator only sees rows that exist. */
  availableRows: string[];
  api: HiddenRowsApi;
  /** Optional preset shortcuts shown as buttons (e.g. "Deep slow 20-34"). */
  presets?: Array<{ label: string; rows: string[] }>;
}

function sortRows(rows: string[]): string[] {
  // Sort "ROW N" numerically; non-ROW labels go last alphabetically.
  return [...rows].sort((a, b) => {
    const ma = a.match(/^ROW\s+([\d.]+)/i);
    const mb = b.match(/^ROW\s+([\d.]+)/i);
    if (ma && mb) return Number(ma[1]) - Number(mb[1]);
    if (ma) return -1;
    if (mb) return 1;
    return a.localeCompare(b);
  });
}

export const HiddenRowsPicker: React.FC<HiddenRowsPickerProps> = ({
  availableRows,
  api,
  presets = [],
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — cheap popover, no need for a portal.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const sorted = sortRows(availableRows);
  const hiddenCount = api.hidden.size;
  // Some hidden rows may not be in `availableRows` (e.g. operator left them
  // hidden but the data set changed). Surface that as extra info so the
  // operator can clear-all if confused.
  const hiddenNotPresent = [...api.hidden].filter((r) => !availableRows.includes(r));

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-bold uppercase tracking-wider text-xs transition-colors ${
          hiddenCount > 0
            ? 'bg-accent/10 border-accent/30 text-accent'
            : 'bg-card border-subtle text-muted hover:border-accent/40'
        }`}
        title="Hide specific rows from this tab"
      >
        <EyeOff size={12} />
        Hidden: {hiddenCount}
      </button>

      {open && (
        <>
          {/* Mobile backdrop — tap to dismiss the bottom sheet. Hidden on
              desktop where the panel is a popover anchored to the button. */}
          <div
            className="fixed inset-0 z-30 bg-black/40 sm:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className="
              fixed inset-x-0 bottom-0 z-40 max-h-[75vh] rounded-t-2xl
              sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:mt-2 sm:w-72 sm:max-h-none sm:rounded-2xl
              bg-card border border-subtle shadow-2xl p-3 space-y-2 overflow-y-auto
            "
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted">
                Hide rows
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted hover:text-content"
                aria-label="Close"
              >
                <X size={14} />
              </button>
            </div>

            {presets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {presets.map((p) => {
                  // A preset is "active" when every row in it is currently hidden.
                  const allHidden = p.rows.every((r) => api.isHidden(r));
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => api.setMany(p.rows, !allHidden)}
                      className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border ${
                        allHidden
                          ? 'bg-accent/15 border-accent/30 text-accent'
                          : 'bg-surface border-subtle text-muted hover:border-accent/40'
                      }`}
                    >
                      {p.label}
                    </button>
                  );
                })}
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={api.clear}
                    className="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest border bg-surface border-subtle text-muted hover:border-red-500/50 hover:text-red-500"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}

            <div className="sm:max-h-64 sm:overflow-y-auto">
              {sorted.length === 0 && (
                <div className="text-[11px] text-muted/70 py-3 text-center">
                  No rows in current data.
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                {sorted.map((row) => {
                  const isHidden = api.isHidden(row);
                  return (
                    <button
                      key={row}
                      type="button"
                      onClick={() => api.toggle(row)}
                      className={`px-2 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-tight border transition-colors ${
                        isHidden
                          ? 'bg-accent/15 border-accent/40 text-accent line-through'
                          : 'bg-surface border-subtle text-content hover:border-accent/40'
                      }`}
                      title={isHidden ? 'Click to show' : 'Click to hide'}
                    >
                      {row.replace(/^ROW\s+/i, '')}
                    </button>
                  );
                })}
              </div>
            </div>

            {hiddenNotPresent.length > 0 && (
              <div className="text-[10px] text-muted/70 pt-1 border-t border-subtle">
                {hiddenNotPresent.length} hidden row{hiddenNotPresent.length === 1 ? '' : 's'} not
                in current data ({hiddenNotPresent.join(', ')}).
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
