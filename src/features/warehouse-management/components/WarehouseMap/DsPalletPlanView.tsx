// The Plan tab under the DS-Pallet model.
//
// Both blocks are shown side by side, but they remain independent plans: each
// keeps its own saved timestamp and its own Recalculate, so recalculating one
// never touches the other (RF-015).

import React, { useMemo, useState } from 'react';
import { Loader2, Printer, RefreshCw, RotateCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { DsPalletGrid } from './DsPalletGrid';
import { isTransposed } from '../../utils/gridOrientation';
import { BlockReadinessPanel } from './BlockReadinessPanel';
import { PullFirstPanel } from './PullFirstPanel';
import { SkuDetailPanel, type SelectedSku, type SkuDetailInfo } from './SkuDetailPanel';
import { BLOCKS, DS_PALLET_MIN_DEFAULT, type BlockConfig } from '../../../../utils/dsPalletPlanner';
import { blockWithSettings, useBlockSettings } from '../../hooks/useNoMoverList';
import { useBlockReadiness } from '../../hooks/useBlockReadiness';
import { useDsPalletPlan, useRecalculateDsPalletPlan } from '../../hooks/useDsPalletPlan';

interface BlockPanelProps {
  block: BlockConfig;
  minUnits: number;
  /** Drives what counts as a mover, and so what the pool contains. */
  recencyDays: number;
  rotation: number;
  onSelectSku: (selection: SelectedSku) => void;
  onSkuInfo: (info: Map<string, SkuDetailInfo>) => void;
  onGoToNoMovers: () => void;
  /** True while the *other* block is the one being sent to the printer. */
  hiddenForPrint: boolean;
}

const BlockPanel: React.FC<BlockPanelProps> = ({
  block,
  minUnits,
  recencyDays,
  rotation,
  onSelectSku,
  onSkuInfo,
  onGoToNoMovers,
  hiddenForPrint,
}) => {
  const { data: planResult, isLoading, isError, error } = useDsPalletPlan(block.id);
  const { checks, blocker, candidates, revalidate } = useBlockReadiness(
    block,
    minUnits,
    recencyDays
  );
  const recalculate = useRecalculateDsPalletPlan();

  const saved = planResult?.plan ?? null;
  const staleVersion = planResult?.staleVersion ?? null;
  const slots = saved?.plan_data?.slots ?? [];
  const pullFirstCount = saved?.pull_first?.length ?? 0;

  // Pull First shows a leftover against the SKU's whole stock, which the plan
  // does not record — the live candidates do.
  const totalBySku = useMemo(
    () => new Map(candidates.map((c) => [c.sku, c.totalQty])),
    [candidates]
  );

  // Only the stock stranded *from* this block. A SKU that never earned a cell
  // is not this block's problem to walk — it was never here, and listing it
  // sent someone to a sublocation that holds nothing of it.
  const strandedHere = useMemo(() => {
    const placed = new Set(slots.flatMap((s) => (s.usage.kind === 'pallet' ? [s.usage.sku] : [])));
    return (saved?.pull_first ?? []).filter((e) => placed.has(e.sku));
  }, [slots, saved]);

  const stamp = useMemo(() => {
    if (!saved?.updated_at) return null;
    const d = new Date(saved.updated_at);
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(
      [],
      { hour: '2-digit', minute: '2-digit' }
    )}${saved.updated_by ? ` · ${saved.updated_by.split('@')[0]}` : ''}`;
  }, [saved]);

  // The detail panel needs a name and a source per SKU; candidates carry both.
  React.useEffect(() => {
    if (candidates.length === 0) return;
    const map = new Map<string, SkuDetailInfo>();
    for (const c of candidates) {
      map.set(c.sku, {
        itemName: null,
        pullFrom: c.currentPlacements?.[0]
          ? `ROW ${c.currentPlacements[0].row} · ${c.currentPlacements[0].letter}`
          : '—',
        ordersCompleted: 0,
        totalQty: c.totalQty,
      });
    }
    onSkuInfo(map);
  }, [candidates, onSkuInfo]);

  // The button always does something. A missing precondition is often stale
  // rather than real — the list is usually edited in the other tab, seconds
  // ago — so it re-reads everything first, then names the one still blocking
  // instead of sitting there disabled.
  const handleRecalculate = async () => {
    const { blocker: fresh, candidates: rows, minUnits: fitted } = await revalidate();

    if (fresh) {
      toast.error(`${fresh.label}: ${fresh.fix ?? fresh.detail}`, { duration: 7000 });
      return;
    }
    if (rows.length === 0) {
      toast('Stock is still loading for this block — press Recalculate again.');
      return;
    }

    const plan = await recalculate.mutateAsync({
      block,
      candidates: rows,
      minUnits: fitted,
      autoFit: false,
    });
    const placed = plan.slots.filter((s) => s.usage.kind === 'pallet').length;
    const empty = plan.slots.filter((s) => s.usage.kind === 'empty').length;

    // The fitted minimum has to be said out loud: it silently changes what a
    // pallet means on the floor, and the operator has to be able to veto it.
    const summary = `Block ${block.id}: ${placed} pallets placed, ${plan.pullFirst.length} to Pull First`;

    if (fitted < minUnits) {
      toast.success(`${summary}. Minimum fitted to ${fitted}u (from ${minUnits}u).`, {
        duration: 7000,
      });
    } else if (empty > 0) {
      toast(
        `${summary}. ${empty} cells stay empty — not enough non-mover bikes to fill the block.`,
        { duration: 7000 }
      );
    } else {
      toast.success(summary);
    }
  };

  // The width goes where the information is. A block showing its grid is worth
  // twice one showing a setup checklist, so with one of each the checklist
  // takes a third and the map two thirds; two blocks in the same state split
  // the row evenly. A quarter turn overrides both — transposed, a block is ten
  // columns wide and gets the row to itself.
  const width = isTransposed(rotation)
    ? 'w-full'
    : slots.length > 0
      ? 'flex-[2_1_0%] min-w-[24rem]'
      : 'flex-[1_1_0%] min-w-[15rem]';

  // Printing is one block per job, so nothing here forces a page break: the
  // other block is simply not in the document being printed.
  //
  // The section itself must stay breakable. Block B's Pull First runs to 23
  // rows, and a section that cannot break does not shrink to fit — it gets
  // clipped. Only the grid is kept whole, so the overflow lands in the list.
  return (
    <section
      className={`print:min-w-0 print:w-full ${hiddenForPrint ? 'print:hidden' : ''} ${width}`}
    >
      <div className="print:hidden flex flex-wrap items-center gap-x-3 gap-y-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-bold text-slate-800 text-sm">
            Block {block.id} · {block.label}
          </h3>
          {stamp ? (
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Saved {stamp}</span>
              {pullFirstCount > 0 && (
                <span className="text-amber-700">· {pullFirstCount} in Pull First</span>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-400 mt-0.5">No plan yet</div>
          )}
        </div>

        {/* Only ever disabled while it is working: a disabled button is not an
            error message, and this one used to be the whole explanation.
            `shrink-0` over `ml-auto` — pinned to the right it was the first
            thing to slide under the clipped edge of the layout. */}
        <button
          onClick={handleRecalculate}
          disabled={recalculate.isPending}
          className={`shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-lg border shadow-sm active:scale-95 disabled:opacity-40 transition-all font-semibold text-xs tracking-wide ${
            blocker
              ? 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          }`}
        >
          <RefreshCw className={`w-4 h-4 ${recalculate.isPending ? 'animate-spin' : ''}`} />
          <span>{recalculate.isPending ? 'Recalculating…' : `Recalculate ${block.id}`}</span>
        </button>
      </div>

      {/* Keyed on the blocked/clear state: crossing that line remounts the
          panel so the fold returns to the default for the new situation. */}
      <div className="mb-3">
        <BlockReadinessPanel
          key={blocker ? 'blocked' : 'clear'}
          blockId={block.id}
          checks={checks}
          defaultOpen={blocker !== null}
          onGoToNoMovers={onGoToNoMovers}
        />
      </div>

      {/* Print keeps the block identified once the buttons are gone. */}
      {/* The root mounts with `dark` on <html>, so inherited text is white and
          this came out invisible on paper. Print titles fix their own colour. */}
      <h3 className="hidden print:block print:text-black text-base font-bold mb-1">
        Block {block.id} · {block.label}
      </h3>

      {/* Above the grid: what came out of this block is read before walking it. */}
      <PullFirstPanel blockId={block.id} entries={strandedHere} totalBySku={totalBySku} />

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading plan…
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-16 px-4 text-center text-rose-600 text-sm font-medium">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Failed to load this block&apos;s plan.
          </span>
          <span className="text-xs font-normal text-rose-500 break-words">
            {(error as Error)?.message}
          </span>
        </div>
      ) : slots.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 py-16 px-4 text-center text-slate-500 text-sm border-2 border-dashed border-slate-200 rounded-lg">
          <span>
            {staleVersion !== null
              ? `Block ${block.id} has a plan from an older model (v${staleVersion}).`
              : `No plan saved for block ${block.id}.`}
          </span>
          <span className="text-xs text-slate-400">
            {blocker
              ? `${blocker.label}: ${blocker.fix ?? blocker.detail}`
              : staleVersion !== null
                ? 'Press Recalculate to rebuild it under the DS-Pallet model.'
                : 'Press Recalculate to build it.'}
          </span>
        </div>
      ) : (
        <DsPalletGrid block={block} slots={slots} rotation={rotation} onSelectSku={onSelectSku} />
      )}
    </section>
  );
};

interface DsPalletPlanViewProps {
  /** Lets a blocked block send the user straight to where its fix lives. */
  onGoToNoMovers: () => void;
}

export const DsPalletPlanView: React.FC<DsPalletPlanViewProps> = ({ onGoToNoMovers }) => {
  const [rotation, setRotation] = useState(0);
  const [selectedSku, setSelectedSku] = useState<SelectedSku | null>(null);
  const [skuInfo, setSkuInfo] = useState<Map<string, SkuDetailInfo>>(new Map());

  const { data: settings } = useBlockSettings();

  const mergeSkuInfo = React.useCallback((incoming: Map<string, SkuDetailInfo>) => {
    setSkuInfo((prev) => {
      const next = new Map(prev);
      for (const [k, v] of incoming) next.set(k, v);
      return next;
    });
  }, []);

  // One block per print job. Page breaks between the two never survived the
  // scrolling ancestors — a scroll container is not fragmented, so every
  // break-after inside it was dropped and both blocks landed on one sheet.
  // Printing them separately removes the fragmentation problem instead of
  // fighting it: the other block is not in the document being printed.
  const [printing, setPrinting] = useState<string | null>(null);

  React.useEffect(() => {
    if (!printing) return;

    const style = document.createElement('style');
    style.id = 'print-portrait-override';
    style.innerHTML = '@page { size: A4 portrait !important; margin: 8mm !important; }';
    document.head.appendChild(style);

    // Runs after the commit that hid the other block, so the printer sees it.
    window.print();

    style.remove();
    setPrinting(null);
  }, [printing]);

  return (
    <div className="w-full h-full overflow-auto bg-white print:h-auto print:overflow-visible">
      <div className="p-6 pb-32 print:p-0">
        <div className="print:hidden flex flex-wrap justify-between items-center gap-3 mb-5">
          <h2 className="text-2xl font-bold text-slate-800 min-w-0">Warehouse Top View</h2>

          {/* shrink-0 so the controls wrap under the title instead of sliding
              past the layout's clipped right edge, where they are unreachable. */}
          <div className="flex items-center gap-2 shrink-0">
            {BLOCKS.map((b) => (
              <button
                key={b.id}
                onClick={() => setPrinting(b.id)}
                disabled={printing !== null}
                className="flex items-center gap-1.5 px-3.5 h-10 rounded-lg border border-gray-200 bg-white text-slate-700 shadow-sm hover:bg-gray-50 active:scale-95 disabled:opacity-40 transition-all font-semibold text-xs tracking-wide"
                title={`Print block ${b.id} on its own sheet`}
              >
                <Printer className="w-4 h-4 text-slate-500" />
                <span>Print {b.id}</span>
              </button>
            ))}
            <button
              onClick={() => setRotation((r) => r + 90)}
              className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white text-slate-600 shadow-sm hover:bg-gray-50 hover:text-slate-800 transition-colors"
              title="Rotate 90°"
            >
              <RotateCw className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-8 print:block print:gap-0">
          {BLOCKS.map((b) => {
            const merged = blockWithSettings(b, settings?.[b.id]);
            return (
              <BlockPanel
                key={b.id}
                block={merged}
                minUnits={settings?.[b.id]?.min_units ?? DS_PALLET_MIN_DEFAULT}
                recencyDays={settings?.[b.id]?.recency_days ?? 30}
                rotation={rotation}
                onSelectSku={setSelectedSku}
                onSkuInfo={mergeSkuInfo}
                onGoToNoMovers={onGoToNoMovers}
                hiddenForPrint={printing !== null && printing !== b.id}
              />
            );
          })}
        </div>

        {selectedSku && (
          <SkuDetailPanel
            selected={selectedSku}
            info={skuInfo.get(selectedSku.sku)}
            onClose={() => setSelectedSku(null)}
          />
        )}
      </div>
    </div>
  );
};
