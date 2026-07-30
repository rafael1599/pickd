import React from 'react';
import type { SlotUsage } from '../../../../utils/dsPalletPlanner';
import { DS_PALLET_MAX } from '../../../../utils/dsPalletPlanner';
import { skuColor } from '../../utils/skuColor';
import type { SelectedSku } from './SkuDetailPanel';

// The grid transposes instead of rotating, so a cell is always drawn upright
// and at the size it was laid out. Nothing here counter-rotates.
interface DsPalletCellProps {
  usage: SlotUsage;
  /** Fixed across the grid — every cell now holds exactly one pallet. */
  heightRem: number;
  onSelectSku: (selection: SelectedSku) => void;
  borderRight?: boolean;
  borderBottom?: boolean;
  dashed?: boolean;
}

// Print gets a bigger SKU code, so the cell grows to match and the taller font
// never clips or wraps.
const PRINT_HEIGHT_SCALE = 1.5;

export const DsPalletCell: React.FC<DsPalletCellProps> = ({
  usage,
  heightRem,
  onSelectSku,
  borderRight,
  borderBottom,
  dashed,
}) => {
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
          onSelectSku({ sku: 'EMPTY', unitsHere: 0, kind: isReserved ? 'reserved' : 'empty' })
        }
      >
        <span>{isReserved ? 'reserved' : 'empty'}</span>
      </div>
    );
  }

  const { sku, units, anchored } = usage;
  const color = skuColor(sku);
  const isFull = units >= DS_PALLET_MAX;

  return (
    <div
      className={`flex flex-col justify-center gap-1 px-3 py-2 print:px-2 print:py-1 border-l-4 print:border-l-2 cursor-pointer hover:brightness-95 overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
      style={{ ...heightVars, backgroundColor: color.bg, borderLeftColor: color.border }}
      onClick={() => onSelectSku({ sku, unitsHere: units, kind: 'pallet' })}
      // Anchoring is the difference between "leave it alone" and "go move it",
      // so it has to survive being read off a printed sheet.
      title={anchored ? `${sku} — already in this sublocation` : `${sku} — to be placed here`}
    >
      <div
        className="font-mono font-extrabold text-xs print:text-lg whitespace-nowrap overflow-hidden text-ellipsis tracking-tight leading-snug"
        style={{ color: color.text }}
      >
        {sku}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] print:text-xs text-slate-500 whitespace-nowrap font-semibold leading-snug">
        <span>{units}u</span>
        <span className={isFull ? 'text-slate-500' : 'text-amber-700'}>
          {isFull ? '● full' : '◐ partial'}
        </span>
        {anchored && (
          <span className="text-slate-400 print:text-slate-600" title="already in place">
            · in place
          </span>
        )}
      </div>
    </div>
  );
};
