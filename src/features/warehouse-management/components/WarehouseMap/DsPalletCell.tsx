import React from 'react';
import type { SlotUsage } from '../../../../utils/dsPalletPlanner';
import { DS_PALLET_MAX } from '../../../../utils/dsPalletPlanner';
import { skuColor } from '../../../../utils/skuColor';
import type { CellSelection } from './SkuDetailPanel';

interface DsPalletCellProps {
  usage: SlotUsage;
  strandedUnits?: number;
  heightRem: number;
  onSelectSku: (selection: CellSelection) => void;
  borderRight?: boolean;
  borderBottom?: boolean;
  dashed?: boolean;
  moveMode?: { sku: string };
  onMoveTarget?: () => void;
}

const PRINT_HEIGHT_SCALE = 1.8;

export const DsPalletCell: React.FC<DsPalletCellProps> = ({
  usage,
  strandedUnits = 0,
  heightRem,
  onSelectSku,
  borderRight,
  borderBottom,
  dashed,
  moveMode,
  onMoveTarget,
}) => {
  const heightVars = {
    '--cell-h': `${heightRem}rem`,
    '--cell-h-print': `${heightRem * PRINT_HEIGHT_SCALE}rem`,
  } as React.CSSProperties;
  const heightClass = 'h-[var(--cell-h)] print:h-[var(--cell-h-print)]';
  const borderClass = `${borderRight ? 'border-r' : ''} ${borderBottom ? 'border-b' : ''} border-gray-300`;

  let moveClass = '';
  if (moveMode) {
    if (usage.kind === 'empty' || usage.kind === 'reserved') {
      moveClass = 'ring-2 ring-blue-400 animate-pulse relative z-20';
    } else if (usage.kind === 'pallet' && usage.sku === moveMode.sku) {
      moveClass = 'outline-2 outline-orange-400 relative z-20';
    } else {
      moveClass = 'ring-1 ring-blue-300 relative z-10';
    }
  }

  if (usage.kind === 'reserved' || usage.kind === 'empty') {
    const isReserved = usage.kind === 'reserved';
    return (
      <div
        className={`flex items-center justify-center bg-slate-50/80 hover:bg-slate-100 text-slate-400 text-xs print:text-sm font-semibold italic cursor-pointer transition-colors ${heightClass} ${borderClass} ${
          dashed
            ? 'relative z-10 outline outline-2 outline-dashed outline-slate-300 outline-offset-[-2px]'
            : ''
        } ${moveClass}`}
        style={heightVars}
        onClick={() =>
          moveMode
            ? onMoveTarget?.()
            : onSelectSku({ sku: 'EMPTY', unitsHere: 0, kind: isReserved ? 'reserved' : 'empty' })
        }
      >
        <span className="print:text-slate-400">{isReserved ? 'reserved' : 'empty'}</span>
      </div>
    );
  }

  if (usage.kind === 'sobrante') {
    const { sku, units } = usage;
    const color = skuColor(sku);
    return (
      <div
        className={`flex flex-col justify-center gap-1.5 px-3 py-2 print:px-3 print:py-2 border-l-4 border-amber-500 bg-amber-50/60 cursor-pointer hover:bg-amber-100/80 overflow-hidden min-h-0 ${heightClass} ${borderClass} ${moveClass}`}
        style={heightVars}
        onClick={() =>
          moveMode ? onMoveTarget?.() : onSelectSku({ sku, unitsHere: units, kind: 'sobrante' })
        }
        title={`${sku} — Surplus (${units}u)`}
      >
        <div
          className="font-mono font-extrabold text-xs print:text-xl print:font-black whitespace-nowrap overflow-hidden text-ellipsis tracking-tight leading-tight"
          style={{ color: color.text }}
        >
          {sku}
        </div>
        <div className="flex items-center gap-2 text-[11px] print:text-sm print:font-bold text-amber-700 whitespace-nowrap leading-tight">
          <span>{units}u</span>
          <span className="bg-amber-200/80 text-amber-800 px-1 py-0.5 rounded text-[10px] print:text-xs print:font-black uppercase font-bold">
            Surplus
          </span>
        </div>
      </div>
    );
  }

  const { sku, units, capacity = DS_PALLET_MAX, anchored } = usage;
  const isPinned = (usage as any).pinned === true;
  const color = skuColor(sku);
  const isFull = units >= capacity;

  return (
    <div
      className={`flex flex-col justify-center gap-1.5 px-3 py-2 print:px-3 print:py-2 border-l-4 print:border-l-4 cursor-pointer hover:brightness-95 overflow-hidden min-h-0 ${heightClass} ${borderClass} ${moveClass}`}
      style={{ ...heightVars, backgroundColor: color.bg, borderLeftColor: color.border }}
      onClick={() =>
        moveMode ? onMoveTarget?.() : onSelectSku({ sku, unitsHere: units, kind: 'pallet' })
      }
      title={
        anchored
          ? `${sku} — already in this sublocation`
          : `${sku} — to be placed here (${capacity}u pallet)`
      }
    >
      <div
        className="font-mono font-extrabold text-xs print:text-xl print:font-black whitespace-nowrap overflow-hidden text-ellipsis tracking-tight leading-tight"
        style={{ color: color.text }}
      >
        {sku}
      </div>
      <div className="flex items-center gap-2 text-[11px] print:text-sm print:font-extrabold text-slate-500 print:text-black whitespace-nowrap leading-tight">
        <span>{units}u</span>
        <span
          className={isFull ? 'text-slate-500 print:text-black' : 'text-amber-700 print:text-black'}
        >
          {isFull ? `● ${capacity}u` : `◐ ${units}/${capacity}u`}
        </span>
        {anchored && (
          <span
            className="font-bold text-slate-600 print:text-black print:text-base"
            title="Already in this block — leave it where it is"
          >
            ⚓
          </span>
        )}
        {isPinned && !anchored && (
          <span
            className="font-bold text-slate-600 print:text-black print:text-base"
            title="Manually pinned to this sublocation"
          >
            📌
          </span>
        )}
        {strandedUnits > 0 && (
          <span
            className="font-bold text-amber-700 print:text-black print:text-base"
            title={`${strandedUnits}u of this SKU are in Pull First`}
          >
            ★{strandedUnits}
          </span>
        )}
      </div>
    </div>
  );
};
