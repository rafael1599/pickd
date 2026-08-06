// What the block could not take, sitting under the block it came out of.
//
// Three columns, because that is the whole job on the floor: which SKU, how
// much of its stock is stranded, and where to go for it. The reason a unit was
// turned away is planner bookkeeping — it changes nothing about the trip, and
// it was the widest column on the sheet.

import React, { useState } from 'react';
import { ChevronDown, PackageMinus } from 'lucide-react';
import type { PullFirstEntry } from '../../../../utils/dsPalletPlanner';

interface PullFirstPanelProps {
  blockId: string;
  entries: PullFirstEntry[];
  /** Total stock per SKU, so a leftover reads against the whole of it. */
  totalBySku: Map<string, number>;
}

export const PullFirstPanel: React.FC<PullFirstPanelProps> = ({ blockId, entries, totalBySku }) => {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  const units = entries.reduce((sum, e) => sum + e.units, 0);
  const sorted = [...entries].sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku));

  return (
    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 text-slate-800 print:border-gray-400 print:bg-white">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left print:py-1"
        aria-expanded={open}
      >
        <PackageMinus className="w-4 h-4 text-amber-700 shrink-0" />
        <span className="text-sm font-bold text-amber-800 print:text-black">
          Pull First — block {blockId}
        </span>
        <span className="text-xs text-amber-700 print:text-black">
          {entries.length} SKU{entries.length === 1 ? '' : 's'} · {units}u
        </span>
        <ChevronDown
          className={`print:hidden ml-auto w-4 h-4 text-amber-600 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {/* Always rendered so it prints, whatever the fold is doing on screen. */}
      <div className={`px-3 pb-3 print:block print:px-2 print:pb-2 ${open ? 'block' : 'hidden'}`}>
        <ul className="rounded-lg border border-white/70 bg-white divide-y divide-amber-100 print:border-gray-300">
          {sorted.map((entry, index) => (
            <li
              key={`${entry.sku}-${entry.reason}-${index}`}
              className="flex items-center gap-3 px-3 py-1.5 text-xs print:py-0.5 print:break-inside-avoid"
            >
              <span className="font-mono font-bold text-slate-800 w-28 shrink-0">{entry.sku}</span>
              <span className="font-semibold text-slate-700 w-20 text-right shrink-0">
                {entry.units}
                <span className="text-slate-400">
                  {(() => {
                    const total = entry.total ?? totalBySku.get(entry.sku);
                    return total ? `/${total}u` : 'u';
                  })()}
                </span>
              </span>
              <span className="text-slate-500">{entry.from ?? '—'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
