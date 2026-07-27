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
  borderRight?: boolean;
  borderBottom?: boolean;
}

// Print gets a noticeably bigger, easier-to-read SKU code — the cell height
// scales up to match (via the --cell-h custom property) so a taller font
// never gets clipped or forces a wrap onto a second line.
const PRINT_HEIGHT_SCALE = 1.5;

export const SkuCell: React.FC<SkuCellProps> = ({
  usage,
  rotation,
  dashed,
  heightRem,
  onSelectSku,
  borderRight,
  borderBottom,
}) => {
  const counterRotate = counterRotateTextStyle(rotation);
  const heightVars = {
    '--cell-h': `${heightRem}rem`,
    '--cell-h-print': `${heightRem * PRINT_HEIGHT_SCALE}rem`,
  } as React.CSSProperties;
  const heightClass = 'h-[var(--cell-h)] print:h-auto';
  const borderClass = `${borderRight ? 'border-r' : ''} ${borderBottom ? 'border-b' : ''} border-gray-300`;

  if (usage.kind === 'reserved') {
    return (
      <div
        className={`flex items-center justify-center bg-gray-50 text-gray-300 text-[10px] italic ${heightClass} ${borderClass} ${
          dashed
            ? 'relative z-10 outline outline-2 outline-dashed outline-gray-300 outline-offset-[-2px]'
            : ''
        }`}
        style={heightVars}
      >
        <span style={counterRotate}>reserved</span>
      </div>
    );
  }

  if (usage.kind === 'empty') {
    return <div className={`bg-white ${heightClass} ${borderClass}`} style={heightVars} />;
  }

  if (usage.kind === 'tower') {
    const { sku, units } = usage;
    const color = skuColor(sku);
    return (
      <div
        className={`flex flex-col justify-center gap-0.5 px-2.5 py-1.5 print:px-1.5 print:py-0 border-l-4 print:border-l-2 cursor-pointer hover:brightness-95 overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
        style={{ ...heightVars, backgroundColor: color.bg, borderLeftColor: color.border }}
        onClick={() => onSelectSku({ sku, unitsHere: units, kind: 'tower' })}
      >
        <div
          className="font-mono font-bold text-[11px] print:text-xs print:font-bold whitespace-nowrap overflow-hidden text-ellipsis"
          style={{ ...counterRotate, color: color.text }}
        >
          {sku}
        </div>
        <div
          className="text-[10px] print:text-[10px] text-slate-400 whitespace-nowrap"
          style={counterRotate}
        >
          {units}u tower
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col print:flex-row print:flex-wrap print:items-center print:content-center justify-center gap-1 print:gap-x-2 print:gap-y-0.5 px-2.5 py-1.5 print:px-1.5 print:py-0.5 bg-white overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
      style={heightVars}
    >
      {usage.entries.map((e) => {
        const color = skuColor(e.sku);
        return (
          <div
            key={e.sku}
            style={counterRotate}
            className="cursor-pointer hover:brightness-90 rounded whitespace-nowrap overflow-hidden text-ellipsis print:inline-flex print:items-baseline print:gap-0.5"
            onClick={() => onSelectSku({ sku: e.sku, unitsHere: e.units, kind: 'line' })}
          >
            <span
              className="font-mono font-bold text-[11px] print:text-xs tracking-tight"
              style={{ color: color.text }}
            >
              {e.sku}
            </span>
            <span className="text-[10px] print:text-[10px] text-slate-500 font-semibold print:text-slate-600">
              ·{e.units}u
            </span>
          </div>
        );
      })}
    </div>
  );
};
