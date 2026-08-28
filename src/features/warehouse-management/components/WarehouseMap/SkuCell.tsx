import React from 'react';
import type { SlotUsage } from '../../../../utils/overstockPutaway';
import { skuColor } from '../../../../utils/skuColor';
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

  if (usage.kind === 'reserved' || usage.kind === 'empty') {
    const isReserved = usage.kind === 'reserved';
    return (
      <div
        className={`flex items-center justify-center bg-slate-50/80 hover:bg-slate-100 text-slate-400 text-xs font-semibold italic cursor-pointer transition-colors ${heightClass} ${borderClass} ${
          dashed
            ? 'relative z-10 outline outline-2 outline-dashed outline-slate-300 outline-offset-[-2px]'
            : ''
        }`}
        style={heightVars}
        onClick={() =>
          onSelectSku({
            sku: 'EMPTY',
            unitsHere: 0,
            kind: isReserved ? 'reserved' : 'empty',
          })
        }
      >
        <span style={counterRotate}>{isReserved ? 'reserved' : 'empty'}</span>
      </div>
    );
  }

  if (usage.kind === 'tower') {
    const { sku, units } = usage;
    const color = skuColor(sku);
    return (
      <div
        className={`flex flex-col justify-center gap-1 px-3 py-2 print:px-2 print:py-1 border-l-4 print:border-l-2 cursor-pointer hover:brightness-95 overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
        style={{ ...heightVars, backgroundColor: color.bg, borderLeftColor: color.border }}
        onClick={() => onSelectSku({ sku, unitsHere: units, kind: 'tower' })}
      >
        <div
          className="font-mono font-extrabold text-xs print:text-lg whitespace-nowrap overflow-hidden text-ellipsis tracking-tight leading-snug"
          style={{ ...counterRotate, color: color.text }}
        >
          {sku}
        </div>
        <div
          className="text-[11px] print:text-xs text-slate-500 whitespace-nowrap font-semibold leading-snug"
          style={counterRotate}
        >
          {units}u tower
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col justify-center gap-1.5 px-3 py-2 print:px-2 print:py-1 bg-white overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
      style={heightVars}
    >
      {usage.entries.map((e, i) => {
        const color = skuColor(e.sku);
        return (
          <div
            key={`${e.sku}-${i}`}
            style={counterRotate}
            className="cursor-pointer hover:brightness-90 rounded whitespace-nowrap overflow-hidden text-ellipsis flex items-center justify-between gap-2 leading-snug py-0.5"
            onClick={() => onSelectSku({ sku: e.sku, unitsHere: e.units, kind: 'line' })}
          >
            <span
              className="font-mono font-bold text-xs print:text-sm print:font-extrabold tracking-tight"
              style={{ color: color.text }}
            >
              {e.sku}
            </span>
            <span className="text-[11px] print:text-xs text-slate-500 font-bold print:text-slate-700">
              ·{e.units}u
            </span>
          </div>
        );
      })}
    </div>
  );
};
