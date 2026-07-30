// What the block could not take, sitting above the block it came out of.
//
// Every one of these is a trip someone has to make on the floor, so the list is
// worth more than the count that used to stand in for it. Each row says where
// the units are and why they were turned away, because the three reasons are
// resolved differently: a remainder is topped up or moved on, a short SKU never
// belonged, and an overflow means the block is genuinely out of room.

import React, { useState } from 'react';
import { ChevronDown, PackageMinus } from 'lucide-react';
import type { PullFirstEntry } from '../../../../utils/dsPalletPlanner';

interface PullFirstPanelProps {
  blockId: string;
  entries: PullFirstEntry[];
  /** What the plan was fitted to. Absent on plans saved before it was recorded. */
  minUnits?: number;
}

function reasonText(entry: PullFirstEntry, minUnits?: number): string {
  switch (entry.reason) {
    case 'below-min':
      return minUnits
        ? `${entry.units}u — under the ${minUnits}u minimum`
        : 'under the minimum for a pallet';
    case 'partition-remainder':
      return minUnits
        ? `${entry.units}u left over — under the ${minUnits}u minimum`
        : 'left over after its full pallets';
    case 'no-space':
      return 'no cell left in the block';
  }
}

export const PullFirstPanel: React.FC<PullFirstPanelProps> = ({ blockId, entries, minUnits }) => {
  const [open, setOpen] = useState(false);

  if (entries.length === 0) return null;

  const units = entries.reduce((sum, e) => sum + e.units, 0);
  const sorted = [...entries].sort((a, b) => b.units - a.units || a.sku.localeCompare(b.sku));

  return (
    <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 text-slate-800 print:border-gray-400 print:bg-white print:break-inside-avoid">
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
          {sorted.map((entry) => (
            <li
              key={`${entry.sku}-${entry.reason}`}
              className="flex items-center gap-3 px-3 py-1.5 text-xs print:py-0.5"
            >
              <span className="font-mono font-bold text-slate-800 w-28 shrink-0">{entry.sku}</span>
              <span className="font-semibold text-slate-700 w-12 text-right shrink-0">
                {entry.units}u
              </span>
              <span className="text-slate-500 w-28 shrink-0">{entry.from ?? '—'}</span>
              <span className="text-amber-700 print:text-black">{reasonText(entry, minUnits)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
