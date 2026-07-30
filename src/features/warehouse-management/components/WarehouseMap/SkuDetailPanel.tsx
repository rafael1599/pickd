import React from 'react';
import { X, CheckCircle, Ban, ArrowLeftRight, Trash2, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { skuColor } from '../../utils/skuColor';
import { BLOCKS } from '../../../../utils/dsPalletPlanner';
import { EXCLUSION_REASONS, useExcludeSkus } from '../../hooks/useBikeCandidates';
import { useNoMovers, useRemoveNoMovers, useSetNoMovers } from '../../hooks/useNoMoverList';

export interface SelectedSku {
  sku: string;
  unitsHere: number;
  kind: 'tower' | 'line' | 'pallet' | 'empty' | 'reserved';
  sublocationLabel?: string;
}

export interface SkuDetailInfo {
  itemName: string | null;
  pullFrom: string;
  ordersCompleted: number;
  totalQty: number;
}

interface SkuDetailPanelProps {
  selected: SelectedSku;
  info?: SkuDetailInfo;
  onClose: () => void;
}

export const SkuDetailPanel: React.FC<SkuDetailPanelProps> = ({ selected, info, onClose }) => {
  if (selected.kind === 'empty' || selected.kind === 'reserved') {
    return (
      <div className="print:hidden fixed top-24 right-6 z-[110] w-72 bg-white rounded-xl border border-slate-200 shadow-xl overflow-hidden animate-in fade-in zoom-in duration-150">
        <div className="flex items-start justify-between px-4 pt-3 pb-2 border-b border-slate-100 bg-slate-50">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="font-bold text-sm text-slate-800 uppercase tracking-wide">
                {selected.kind === 'reserved' ? 'Reserved Space' : 'Empty Sublocation'}
              </span>
            </div>
            <div className="text-xs text-slate-500 font-medium mt-0.5">
              {selected.sublocationLabel || 'Available Space'}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 shrink-0"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <dl className="px-4 py-3 space-y-2.5 text-xs">
          <div className="flex items-center justify-between">
            <dt className="text-slate-400">Current Stock</dt>
            <dd className="font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
              0 units (Empty)
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-slate-400">Status</dt>
            <dd className="font-semibold text-slate-700 flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
              {selected.kind === 'reserved' ? 'Reserved for putaway' : 'Available for storage'}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400 mb-1">Location</dt>
            <dd className="font-semibold text-slate-700 leading-snug">
              {selected.sublocationLabel || info?.pullFrom || '—'}
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return <PalletDetail selected={selected} info={info} onClose={onClose} />;
};

/**
 * The map is where the bad placements are actually noticed — a juvenile sitting
 * in a block is obvious on the grid and invisible in a list — so the decisions
 * are reachable from the cell itself rather than only from the classification
 * screen. None of them redraw the map on their own: the plan is a saved
 * snapshot, so the panel says which block to recalculate.
 */
const PalletDetail: React.FC<SkuDetailPanelProps> = ({ selected, info, onClose }) => {
  const color = skuColor(selected.sku);

  const { data: listed } = useNoMovers();
  const excludeSkus = useExcludeSkus();
  const removeNoMovers = useRemoveNoMovers();
  const setNoMovers = useSetNoMovers();

  const entry = (listed ?? []).find((n) => n.sku === selected.sku);
  const currentBlock = entry?.block_id ?? null;
  const otherBlock = BLOCKS.find((b) => b.id !== currentBlock);

  const busy = excludeSkus.isPending || removeNoMovers.isPending || setNoMovers.isPending;
  const after = (blockId: string | null) =>
    blockId ? ` Recalculate block ${blockId} to redraw the map.` : '';

  const handleExclude = async (reason: string) => {
    await excludeSkus.mutateAsync({ skus: [selected.sku], reason });
    toast.success(`${selected.sku} excluded as ${reason}.${after(currentBlock)}`, {
      duration: 6000,
    });
    onClose();
  };

  const handleRemove = async () => {
    await removeNoMovers.mutateAsync([selected.sku]);
    toast.success(`${selected.sku} off block ${currentBlock}.${after(currentBlock)}`, {
      duration: 6000,
    });
    onClose();
  };

  const handleMove = async () => {
    if (!otherBlock) return;
    await setNoMovers.mutateAsync([
      { sku: selected.sku, blockId: otherBlock.id, qty: info?.totalQty ?? null },
    ]);
    toast.success(
      `${selected.sku} → block ${otherBlock.id}. Recalculate both blocks to redraw the map.`,
      { duration: 6000 }
    );
    onClose();
  };

  return (
    <div className="print:hidden fixed top-24 right-6 z-[110] w-72 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden animate-in fade-in zoom-in duration-150">
      <div className="flex items-start justify-between px-4 pt-3 pb-2 border-b border-gray-100">
        <div className="min-w-0">
          <div className="font-mono font-bold text-sm" style={{ color: color.text }}>
            {selected.sku}
          </div>
          {info?.itemName && <div className="text-xs text-slate-500 truncate">{info.itemName}</div>}
        </div>
        <button
          onClick={onClose}
          className="p-1 text-slate-400 hover:text-slate-700 shrink-0"
          title="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <dl className="px-4 py-3 space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">Here ({selected.kind})</dt>
          <dd className="font-semibold text-slate-700">{selected.unitsHere}u</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">Total stock</dt>
          <dd className="font-semibold text-slate-700">{info?.totalQty ?? '—'}u</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-slate-400">Orders (last 12mo)</dt>
          <dd className="font-semibold text-slate-700">{info?.ordersCompleted ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-slate-400 mb-1">Pull from</dt>
          <dd className="font-medium text-slate-700 leading-snug">{info?.pullFrom || '—'}</dd>
        </div>
      </dl>

      <div className="border-t border-gray-100 bg-slate-50 px-4 py-3">
        <div className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
          Actions
        </div>

        <div className="flex flex-col gap-1.5">
          {currentBlock && (
            <button
              onClick={handleRemove}
              disabled={busy}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-500" />
              Take off block {currentBlock}
            </button>
          )}

          {otherBlock && (
            <button
              onClick={handleMove}
              disabled={busy}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-bold bg-white text-slate-700 border border-slate-200 hover:bg-slate-100 disabled:opacity-40 transition-colors"
            >
              <ArrowLeftRight className="w-3.5 h-3.5 text-slate-500" />
              Move to block {otherBlock.id}
            </button>
          )}

          <div className="flex gap-1.5">
            {EXCLUSION_REASONS.map((r) => (
              <button
                key={r.id}
                onClick={() => handleExclude(r.id)}
                disabled={busy}
                title={`Never place ${selected.sku} in any block — ${r.hint}`}
                className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-bold bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 disabled:opacity-40 transition-colors"
              >
                <Ban className="w-3.5 h-3.5" />
                {r.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5 mt-2 text-[11px] text-slate-500">
          {busy && <Loader2 className="w-3 h-3 animate-spin" />}
          <span>The saved plan does not change until you recalculate.</span>
        </div>
      </div>
    </div>
  );
};
