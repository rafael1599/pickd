// The criteria that decide what fills the blocks, next to the thing they fill.
//
// They used to live in the No-movers tab while their only visible consequence —
// which cells fill — was here. Changing a number meant switching tabs, coming
// back and recalculating to find out what it did. The count below moves as the
// numbers are typed, so the answer arrives before anything is saved.

import React, { useMemo, useState } from 'react';
import { Check, RotateCcw, SlidersHorizontal } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  APTITUDE_DEFAULTS,
  BLOCKS,
  DS_PALLET_MIN_DEFAULT,
  blockCapacity,
  assignToFill,
  palletsAt,
  type AptitudeCriteria,
} from '../../../../utils/dsPalletPlanner';
import { useBikeCandidates } from '../../hooks/useBikeCandidates';
import { useUpdateBlockSettings } from '../../hooks/useNoMoverList';

interface MapCriteriaBarProps {
  criteria: AptitudeCriteria;
  minUnits: number;
  recencyDays: number;
}

const TOTAL_CELLS = BLOCKS.reduce((sum, b) => sum + blockCapacity(b).cells, 0);

const field =
  'w-16 border border-slate-300 rounded-md px-2 py-1 text-sm font-semibold bg-white text-slate-800';

export const MapCriteriaBar: React.FC<MapCriteriaBarProps> = ({
  criteria,
  minUnits,
  recencyDays,
}) => {
  const [draft, setDraft] = useState({ ...criteria, minUnits });
  const { data: candidates } = useBikeCandidates(recencyDays);
  const updateSettings = useUpdateBlockSettings();

  const dirty =
    draft.maxOrders !== criteria.maxOrders ||
    draft.minStock !== criteria.minStock ||
    draft.minUnits !== minUnits;

  // What the draft would actually produce. It runs the same assignToFill the
  // plan runs, minimum stepping and all — a preview computed at the typed
  // minimum would claim 47 of 54 cells while Recalculate quietly fits down and
  // delivers 54, and a control that contradicts its own result is worse than
  // no control.
  const preview = useMemo(() => {
    const pool = (candidates ?? [])
      .filter((c) => !c.excludedReason && c.totalQty > 0)
      .map((c) => ({
        sku: c.sku,
        totalQty: c.totalQty,
        ordersCompleted: c.ordersCompleted,
      }));

    const filled = assignToFill(pool, BLOCKS, draft.minUnits, draft);
    const placed = BLOCKS.reduce(
      (sum, b) => sum + palletsAt(filled.byBlock.get(b.id) ?? [], filled.minUnits),
      0
    );
    const preferred = pool.filter(
      (c) => c.ordersCompleted <= draft.maxOrders && c.totalQty >= draft.minStock
    );

    return {
      cells: Math.min(placed, TOTAL_CELLS),
      fittedMin: filled.minUnits,
      preferred: preferred.length,
      preferredCells: palletsAt(preferred, draft.minUnits),
    };
  }, [candidates, draft]);

  const apply = async () => {
    // The pool is shared, so the criteria are global; both rows carry the same
    // numbers rather than letting the blocks disagree about what "apt" means.
    for (const block of BLOCKS) {
      await updateSettings.mutateAsync({
        blockId: block.id,
        max_orders: draft.maxOrders,
        min_stock: draft.minStock,
        min_units: draft.minUnits,
      });
    }
    toast.success('Criteria saved. Recalculate a block to apply them.', { duration: 6000 });
  };

  const reset = () => setDraft({ ...APTITUDE_DEFAULTS, minUnits: DS_PALLET_MIN_DEFAULT });

  const num = (key: keyof typeof draft) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft((d) => ({ ...d, [key]: Math.max(0, Number(e.target.value) || 0) }));

  return (
    <div className="print:hidden mb-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800">
      <div className="flex items-center gap-2 mb-3">
        <SlidersHorizontal className="w-4 h-4 text-slate-500" />
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
          What fills the blocks
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-slate-600">Prefer bikes with at most</span>
          <input
            type="number"
            min={0}
            value={draft.maxOrders}
            onChange={num('maxOrders')}
            className={field}
          />
          <span className="text-slate-600">orders</span>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-slate-600">and at least</span>
          <input
            type="number"
            min={1}
            value={draft.minStock}
            onChange={num('minStock')}
            className={field}
          />
          <span className="text-slate-600">units in stock</span>
        </label>

        <label className="flex items-center gap-2">
          <span className="text-slate-600">A pallet needs</span>
          <input
            type="number"
            min={1}
            max={25}
            value={draft.minUnits}
            onChange={num('minUnits')}
            className={field}
          />
          <span className="text-slate-600">units</span>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        <span className="text-slate-600">
          <span className="font-bold text-slate-800">{preview.preferred}</span> bikes match this
          preference ({preview.preferredCells} of {TOTAL_CELLS} cells)
        </span>
        <span className={preview.cells >= TOTAL_CELLS ? 'text-emerald-700' : 'text-amber-700'}>
          {preview.cells} of {TOTAL_CELLS} cells filled
          {preview.fittedMin < draft.minUnits
            ? ` — the pallet minimum drops to ${preview.fittedMin}u to get there`
            : ' once the rest of the queue is used'}
        </span>

        {dirty && (
          <div className="flex items-center gap-2 ml-auto">
            <button
              onClick={apply}
              disabled={updateSettings.isPending}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-600 text-white font-bold disabled:opacity-40"
            >
              <Check className="w-3 h-3" /> Apply
            </button>
            <button
              onClick={() => setDraft({ ...criteria, minUnits })}
              className="px-2.5 py-1 rounded-md border border-slate-300 text-slate-600 font-semibold"
            >
              Cancel
            </button>
          </div>
        )}

        {!dirty && (
          <button
            onClick={reset}
            className="ml-auto flex items-center gap-1.5 text-slate-500 hover:text-slate-800"
            title="Back to 0 orders, 21 units, 20 per pallet"
          >
            <RotateCcw className="w-3 h-3" /> Defaults
          </button>
        )}
      </div>

      {/* The number is read as a floor otherwise, and it is not one. */}
      <p className="mt-2 text-[11px] text-slate-500">
        These order and stock numbers rank the queue — they never rule a bike out. When the
        preferred ones run out, the next best still fill the block.
      </p>
    </div>
  );
};
