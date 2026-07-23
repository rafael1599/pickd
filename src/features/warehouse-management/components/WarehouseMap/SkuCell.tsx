import React from 'react';
import type { SlotUsage } from '../../../../utils/overstockPutaway';
import { skuColor } from '../../utils/skuColor';
import { counterRotateTextStyle } from '../../utils/counterRotateText';
import type { SelectedSku } from './SkuDetailPanel';

interface SkuCellProps {
  usage: SlotUsage;
  rotation: number;
  dashed?: boolean;
  /** Fixed height (rem) so every sublocation matches the biggest one on screen. */
  heightRem: number;
  onSelectSku: (selection: SelectedSku) => void;
}

export const SkuCell: React.FC<SkuCellProps> = ({
  usage,
  rotation,
  dashed,
  heightRem,
  onSelectSku,
}) => {
  const counterRotate = counterRotateTextStyle(rotation);
  const height = `${heightRem}rem`;

  if (usage.kind === 'reserved') {
    return (
      <div
        className={`flex items-center justify-center bg-gray-50 text-gray-300 text-[10px] italic ${
          dashed
            ? 'relative z-10 outline outline-2 outline-dashed outline-gray-300 outline-offset-[-2px]'
            : ''
        }`}
        style={{ height }}
      >
        <span style={counterRotate}>reserved</span>
      </div>
    );
  }

  if (usage.kind === 'empty') {
    return <div className="bg-white" style={{ height }} />;
  }

  if (usage.kind === 'tower') {
    const { sku, units } = usage;
    const color = skuColor(sku);
    return (
      <div
        className="flex flex-col justify-center gap-0.5 px-2.5 py-1.5 border-l-4 cursor-pointer hover:brightness-95"
        style={{ height, backgroundColor: color.bg, borderLeftColor: color.border }}
        onClick={() => onSelectSku({ sku, unitsHere: units, kind: 'tower' })}
      >
        <div
          className="font-mono font-bold text-[11px]"
          style={{ ...counterRotate, color: color.text }}
        >
          {sku}
        </div>
        <div className="text-[10px] text-slate-400" style={counterRotate}>
          {units}u tower
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col justify-center gap-1 px-2.5 py-1.5 bg-white" style={{ height }}>
      {usage.entries.map((e) => {
        const color = skuColor(e.sku);
        return (
          <div
            key={e.sku}
            style={counterRotate}
            className="cursor-pointer hover:brightness-90 rounded"
            onClick={() => onSelectSku({ sku: e.sku, unitsHere: e.units, kind: 'line' })}
          >
            <span className="font-mono font-semibold text-[11px]" style={{ color: color.text }}>
              {e.sku}
            </span>
            <span className="text-[10px] text-slate-400"> · {e.units}u</span>
          </div>
        );
      })}
    </div>
  );
};
