import React from 'react';
import type { SlotUsage } from '../../../../utils/dsPalletPlanner';
import { DS_PALLET_MAX } from '../../../../utils/dsPalletPlanner';
import { skuColor } from '../../utils/skuColor';
import type { CellSelection } from './SkuDetailPanel';

interface DsPalletCellProps {
  usage: SlotUsage;
  strandedUnits?: number;
  heightRem: number;
  onSelectSku: (selection: CellSelection) => void;
  borderRight?: boolean;
  borderBottom?: boolean;
  dashed?: boolean;
}

const PRINT_HEIGHT_SCALE = 1.5;

export const DsPalletCell: React.FC<DsPalletCellProps> = ({
  usage,
  strandedUnits = 0,
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

  if (usage.kind === 'sobrante') {
    const { sku, units } = usage;
    const color = skuColor(sku);
    return (
      <div
        className={`flex flex-col justify-center gap-1 px-3 py-2 print:px-2 print:py-1 border-l-4 border-amber-500 bg-amber-50/60 cursor-pointer hover:bg-amber-100/80 overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
        style={heightVars}
        onClick={() => onSelectSku({ sku, unitsHere: units, kind: 'sobrante' })}
        title={`${sku} — Surplus (${units}u)`}
      >
        <div
          className="font-mono font-extrabold text-xs print:text-lg whitespace-nowrap overflow-hidden text-ellipsis tracking-tight leading-snug"
          style={{ color: color.text }}
        >
          {sku}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] print:text-xs text-amber-700 whitespace-nowrap font-bold leading-snug">
          <span>{units}u</span>
          <span className="bg-amber-200/80 text-amber-800 px-1 py-0.5 rounded text-[10px] uppercase font-bold">
            Surplus
          </span>
        </div>
      </div>
    );
  }

  const { sku, units, capacity = DS_PALLET_MAX, anchored } = usage;
  const color = skuColor(sku);
  const isFull = units >= capacity;

  return (
    <div
      className={`flex flex-col justify-center gap-1 px-3 py-2 print:px-2 print:py-1 border-l-4 print:border-l-2 cursor-pointer hover:brightness-95 overflow-hidden min-h-0 ${heightClass} ${borderClass}`}
      style={{ ...heightVars, backgroundColor: color.bg, borderLeftColor: color.border }}
      onClick={() => onSelectSku({ sku, unitsHere: units, kind: 'pallet' })}
      title={
        anchored
          ? `${sku} — already in this sublocation`
          : `${sku} — to be placed here (${capacity}u pallet)`
      }
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
          {isFull ? `● ${capacity}u` : `◐ ${units}/${capacity}u`}
        </span>
        {anchored && (
          <span
            className="font-bold text-slate-600 print:text-black"
            title="Already in this block — leave it where it is"
          >
            ⚓
          </span>
        )}
        {strandedUnits > 0 && (
          <span
            className="font-bold text-amber-700 print:text-black"
            title={`${strandedUnits}u of this SKU are in Pull First`}
          >
            ★{strandedUnits}
          </span>
        )}
      </div>
    </div>
  );
};
