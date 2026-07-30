// The Plan tab under the DS-Pallet model.
//
// Both blocks are shown side by side, but they remain independent plans: each
// keeps its own saved timestamp and its own Recalculate, so recalculating one
// never touches the other (RF-015).

import React, { useMemo, useState } from 'react';
import { Loader2, Printer, RefreshCw, RotateCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { DsPalletGrid } from './DsPalletGrid';
import { SkuDetailPanel, type SelectedSku, type SkuDetailInfo } from './SkuDetailPanel';
import { BLOCKS, DS_PALLET_MIN_DEFAULT, type BlockConfig } from '../../../../utils/dsPalletPlanner';
import { blockWithSettings, useBlockSettings } from '../../hooks/useNoMoverList';
import {
  useDsPalletCandidates,
  useDsPalletPlan,
  useRecalculateDsPalletPlan,
} from '../../hooks/useDsPalletPlan';

interface BlockPanelProps {
  block: BlockConfig;
  minUnits: number;
  rotation: number;
  onSelectSku: (selection: SelectedSku) => void;
  onSkuInfo: (info: Map<string, SkuDetailInfo>) => void;
}

const BlockPanel: React.FC<BlockPanelProps> = ({
  block,
  minUnits,
  rotation,
  onSelectSku,
  onSkuInfo,
}) => {
  const { data: saved, isLoading, isError } = useDsPalletPlan(block.id);
  const { data: candidates } = useDsPalletCandidates(block);
  const recalculate = useRecalculateDsPalletPlan();

  const slots = saved?.plan_data?.slots ?? [];
  const pullFirstCount = saved?.pull_first?.length ?? 0;

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
    if (!candidates) return;
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

  const handleRecalculate = async () => {
    if (!candidates || candidates.length === 0) {
      toast.error('Define the no-mover list for this block first.');
      return;
    }
    const plan = await recalculate.mutateAsync({ block, candidates, minUnits });
    const placed = plan.slots.filter((s) => s.usage.kind === 'pallet').length;
    toast.success(
      `Block ${block.id}: ${placed} pallets placed, ${plan.pullFirst.length} to Pull First`
    );
  };

  const hasList = (candidates?.length ?? 0) > 0;

  return (
    <section className="flex-1 min-w-[26rem] print:min-w-0 print:break-after-page">
      <div className="print:hidden flex flex-wrap items-center gap-3 mb-2">
        <div className="min-w-0">
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

        <button
          onClick={handleRecalculate}
          disabled={recalculate.isPending || !hasList}
          title={hasList ? undefined : 'Define the no-mover list for this block first'}
          className="ml-auto flex items-center gap-1.5 px-3 h-9 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100 active:scale-95 disabled:opacity-40 transition-all font-semibold text-xs tracking-wide"
        >
          <RefreshCw className={`w-4 h-4 ${recalculate.isPending ? 'animate-spin' : ''}`} />
          <span>{recalculate.isPending ? 'Recalculating…' : `Recalculate ${block.id}`}</span>
        </button>
      </div>

      {/* Print keeps the block identified once the buttons are gone. */}
      <h3 className="hidden print:block text-base font-bold mb-1">
        Block {block.id} · {block.label}
      </h3>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading plan…
        </div>
      ) : isError ? (
        <div className="flex items-center justify-center gap-2 py-16 text-rose-600 text-sm font-medium">
          <AlertTriangle className="w-4 h-4" /> Failed to load this block&apos;s plan.
        </div>
      ) : slots.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1 py-16 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
          <span>No plan saved for block {block.id}.</span>
          <span className="text-xs">
            {hasList ? 'Press Recalculate to build it.' : 'Define its no-mover list first.'}
          </span>
        </div>
      ) : (
        <DsPalletGrid block={block} slots={slots} rotation={rotation} onSelectSku={onSelectSku} />
      )}
    </section>
  );
};

export const DsPalletPlanView: React.FC = () => {
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

  const handlePrint = () => {
    const style = document.createElement('style');
    style.id = 'print-landscape-override';
    style.innerHTML = '@page { size: A4 landscape !important; margin: 6mm !important; }';
    document.head.appendChild(style);

    const cleanup = () => {
      document.getElementById('print-landscape-override')?.remove();
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    window.print();
    setTimeout(cleanup, 2000);
  };

  return (
    <div className="w-full h-full overflow-auto bg-white">
      <div className="p-6 pb-32 print:p-0">
        <div className="print:hidden flex flex-wrap justify-between items-center gap-3 mb-5">
          <h2 className="text-2xl font-bold text-slate-800">Warehouse Top View</h2>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 h-10 rounded-lg border border-gray-200 bg-white text-slate-700 shadow-sm hover:bg-gray-50 active:scale-95 transition-all font-semibold text-xs tracking-wide"
              title="Print — one sheet per block"
            >
              <Printer className="w-4 h-4 text-slate-500" />
              <span>Print (2 sheets)</span>
            </button>
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
                rotation={rotation}
                onSelectSku={setSelectedSku}
                onSkuInfo={mergeSkuInfo}
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
