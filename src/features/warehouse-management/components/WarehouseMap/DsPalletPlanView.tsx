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
import { MapCriteriaBar } from './MapCriteriaBar';
import { PullFirstPanel } from './PullFirstPanel';
import {
  SkuDetailPanel,
  type CellSelection,
  type SelectedSku,
  type SkuDetailInfo,
} from './SkuDetailPanel';
import {
  APTITUDE_DEFAULTS,
  BLOCKS,
  DS_PALLET_MIN_DEFAULT,
  type AptitudeCriteria,
  type BlockConfig,
} from '../../../../utils/dsPalletPlanner';
import { blockWithSettings, useBlockSettings } from '../../hooks/useNoMoverList';
import { useBlockReadiness } from '../../hooks/useBlockReadiness';
import { useDsPalletPlan, useRecalculateDsPalletPlan } from '../../hooks/useDsPalletPlan';

interface BlockPanelProps {
  block: BlockConfig;
  minUnits: number;
  /** Drives what counts as a mover, and so what the pool contains. */
  recencyDays: number;
  criteria: AptitudeCriteria;
  /** SKUs set aside for this plan only. */
  skipped: ReadonlySet<string>;
  /** Bumped when a SKU is skipped out of *this* block; rebuilds it once. */
  skipToken: number | null;
  /** Bumped when pallet capacity is updated for a SKU; rebuilds it instantly. */
  capacityToken: { token: number; overrides: Record<string, number> } | null;
  rotation: number;
  skuCapacityOverrides?: Record<string, number>;
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
  criteria,
  skipped,
  skipToken,
  capacityToken,
  rotation,
  skuCapacityOverrides,
  onSelectSku,
  onSkuInfo,
  onGoToNoMovers,
  hiddenForPrint,
}) => {
  const { data: planResult, isLoading, isError, error } = useDsPalletPlan(block.id);
  const { checks, blocker, candidates, revalidate } = useBlockReadiness(
    block,
    minUnits,
    recencyDays,
    criteria,
    skipped
  );
  const recalculate = useRecalculateDsPalletPlan();

  const saved = planResult?.plan ?? null;
  const staleVersion = planResult?.staleVersion ?? null;
  const slots = useMemo(() => saved?.plan_data?.slots ?? [], [saved]);
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

  const strandedBySku = useMemo(
    () => new Map(strandedHere.map((e) => [e.sku, e.units])),
    [strandedHere]
  );

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
  const handleRecalculate = async (customOverrides?: Record<string, number>) => {
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
      autoFit: true,
      skuCapacityOverrides: customOverrides ?? skuCapacityOverrides,
    });
    const placed = plan.slots.filter((s) => s.usage.kind === 'pallet').length;
    const summary = `Block ${block.id}: ${placed} pallets placed, ${plan.pullFirst.length} to Pull First`;
    toast.success(summary);
  };

  // A skip rebuilds the block by itself.
  //
  // Adding the SKU to `skipped` only changes what the *next* plan would hold —
  // the map on screen is a saved snapshot, so until it is rebuilt the cell keeps
  // showing the bike that was just set aside, and the action reads as broken.
  // The recalculation is fired here rather than asked for in a toast.
  //
  // Through a ref because the effect must run once per token, not every time
  // the handler is rebuilt; and the effect runs after the commit that added the
  // SKU, so revalidate() reads a pool that no longer contains it.
  const latestRecalculate = React.useRef(handleRecalculate);
  React.useEffect(() => {
    latestRecalculate.current = handleRecalculate;
  });

  const firedToken = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (skipToken === null || skipToken === firedToken.current) return;
    firedToken.current = skipToken;
    void latestRecalculate.current();
  }, [skipToken]);

  const firedCapacityToken = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (capacityToken === null || capacityToken.token === firedCapacityToken.current) return;
    firedCapacityToken.current = capacityToken.token;
    void latestRecalculate.current(capacityToken.overrides);
  }, [capacityToken]);

  // The cell knows its position, not its block — that is this panel's to add.
  const handleSelectSku = React.useCallback(
    (selection: CellSelection) => onSelectSku({ ...selection, blockId: block.id }),
    [onSelectSku, block.id]
  );

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
          onClick={() => handleRecalculate()}
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
        <>
          {/* The sheet leaves the screen behind, so the marks explain themselves. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1.5 text-[11px] text-slate-500 print:text-black">
            <span>
              <span className="font-bold text-slate-600 print:text-black">✗</span> already in this
              block — leave it
            </span>
            <span>
              <span className="font-bold text-amber-700 print:text-black">★</span> more of this SKU
              is in Pull First
            </span>
          </div>
          {/* The grid stays mounted under the loader rather than being swapped
              for one: the block keeps its size, so the replacement appears in
              place instead of the page jumping back from a collapsed panel. */}
          <div className="relative">
            <DsPalletGrid
              block={block}
              slots={slots}
              strandedBySku={strandedBySku}
              rotation={rotation}
              onSelectSku={handleSelectSku}
            />
            {recalculate.isPending && (
              <div className="print:hidden absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-lg bg-white/75 backdrop-blur-[1px] text-sm font-semibold text-slate-600">
                <Loader2 className="w-5 h-5 animate-spin" />
                Rebuilding block {block.id}…
              </div>
            )}
          </div>
        </>
      )}

      {/* Under the grid: the block is walked first, and what it could not take
          is the follow-up trip — so it reads after the map, not before it. */}
      <PullFirstPanel blockId={block.id} entries={strandedHere} totalBySku={totalBySku} />
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

  // Deliberately not persisted: a skip means "not this one, now", and it is
  // meant to be forgotten the next time the plan is built from scratch.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());

  // Which block owes a rebuild, and a token so the same block can be skipped
  // twice in a row and still fire twice.
  const [skipRebuild, setSkipRebuild] = useState<{ blockId: string; token: number } | null>(null);
  const [skuCapacityOverrides, setSkuCapacityOverrides] = useState<Record<string, number>>({});
  const [capacityToken, setCapacityToken] = useState<{
    blockId: string;
    token: number;
    overrides: Record<string, number>;
  } | null>(null);

  const skipSku = React.useCallback((sku: string, blockId: string) => {
    setSkipped((prev) => new Set(prev).add(sku));
    setSkipRebuild({ blockId, token: Date.now() });
    toast.success(`${sku} set aside — rebuilding block ${blockId}…`, { duration: 3000 });
  }, []);

  // Both blocks share one pool, so they share one definition of "apt". Block A
  // holds the canonical row; the bar writes both.
  const criteria: AptitudeCriteria = useMemo(
    () => ({
      maxOrders: settings?.A?.max_orders ?? APTITUDE_DEFAULTS.maxOrders,
      minStock: settings?.A?.min_stock ?? APTITUDE_DEFAULTS.minStock,
    }),
    [settings]
  );

  const mergeSkuInfo = React.useCallback((incoming: Map<string, SkuDetailInfo>) => {
    setSkuInfo((prev) => {
      const next = new Map(prev);
      for (const [k, v] of incoming) next.set(k, v);
      return next;
    });
  }, []);

  const handleCapacityChange = React.useCallback(
    (sku: string, newCapacity: number) => {
      setSkuCapacityOverrides((prev) => {
        const next = { ...prev, [sku]: newCapacity };
        const blockId = selectedSku?.blockId ?? 'MAIN_4ROW';
        setCapacityToken({
          blockId,
          token: Date.now(),
          overrides: next,
        });
        return next;
      });
    },
    [selectedSku]
  );

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

        <MapCriteriaBar
          criteria={criteria}
          minUnits={settings?.A?.min_units ?? DS_PALLET_MIN_DEFAULT}
          recencyDays={settings?.A?.recency_days ?? 30}
        />

        <div className="flex flex-wrap gap-8 print:block print:gap-0">
          {BLOCKS.map((b) => {
            const merged = blockWithSettings(b, settings?.[b.id]);
            return (
              <BlockPanel
                key={b.id}
                block={merged}
                minUnits={settings?.[b.id]?.min_units ?? DS_PALLET_MIN_DEFAULT}
                recencyDays={settings?.[b.id]?.recency_days ?? 30}
                criteria={criteria}
                skipped={skipped}
                skipToken={skipRebuild?.blockId === b.id ? skipRebuild.token : null}
                capacityToken={capacityToken?.blockId === b.id ? capacityToken : null}
                rotation={rotation}
                skuCapacityOverrides={skuCapacityOverrides}
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
            currentCapacity={skuCapacityOverrides[selectedSku.sku] ?? 25}
            onClose={() => setSelectedSku(null)}
            onSkip={skipSku}
            onCapacityChange={handleCapacityChange}
          />
        )}
      </div>
    </div>
  );
};
