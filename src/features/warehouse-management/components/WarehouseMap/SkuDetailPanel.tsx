import React from 'react';
import { X } from 'lucide-react';
import { skuColor } from '../../utils/skuColor';

export interface SelectedSku {
  sku: string;
  unitsHere: number;
  kind: 'tower' | 'line';
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
  const color = skuColor(selected.sku);

  return (
    <div className="print:hidden absolute top-4 right-4 z-30 w-72 bg-white rounded-xl border border-gray-200 shadow-xl overflow-hidden">
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
    </div>
  );
};
