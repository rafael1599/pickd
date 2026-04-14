import React from 'react';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { type DistributionItem } from '../../../../schemas/inventory.schema.ts';

interface DistributionPreviewProps {
  distribution: DistributionItem[];
  quantity: number;
  onTap: () => void;
}

/**
 * Compact summary of distribution. Shows abbreviations like "2T 3L 1 unassigned".
 * Tap opens the full editor sheet.
 */
export const DistributionPreview: React.FC<DistributionPreviewProps> = ({
  distribution,
  quantity,
  onTap,
}) => {
  const total = distribution.reduce((sum, d) => sum + d.count * d.units_each, 0);
  const unassigned = Math.max(0, quantity - total);
  const isOver = total > quantity;

  const TYPE_NAMES: Record<DistributionItem['type'], { singular: string; plural: string }> = {
    TOWER: { singular: 'tower', plural: 'towers' },
    LINE: { singular: 'line', plural: 'lines' },
    PALLET: { singular: 'pallet', plural: 'pallets' },
    OTHER: { singular: 'other', plural: 'others' },
  };

  const descriptions = [...distribution]
    .sort((a, b) => b.count * b.units_each - a.count * a.units_each)
    .map((d) => {
      let typeName: string;
      if (d.type === 'OTHER' && d.label?.trim()) {
        const lbl = d.label.trim().toLowerCase();
        typeName = d.count === 1 ? lbl : `${lbl}s`;
      } else {
        const names = TYPE_NAMES[d.type] || TYPE_NAMES.OTHER;
        typeName = d.count === 1 ? names.singular : names.plural;
      }
      return `${d.count} ${typeName} of ${d.units_each}`;
    });

  const hasDistribution = distribution.length > 0;

  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full text-left px-4 py-3 hover:bg-white/5 active:bg-white/10 transition-colors"
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-bold text-muted uppercase tracking-wider">
          Distribution
        </span>
        <ChevronRight size={16} className="text-muted/40 shrink-0" />
      </div>
      {hasDistribution ? (
        <div className="mt-1.5">
          <span className="text-sm text-content font-semibold">
            {descriptions.map((desc, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span className="inline-block mx-2.5 w-[5px] h-[5px] rounded-full bg-white/50 align-middle" />
                )}
                {desc}
              </React.Fragment>
            ))}
          </span>
          <div className="mt-1">
            {unassigned > 0 && !isOver && (
              <span className="text-xs text-amber-400 font-bold">{unassigned} unassigned</span>
            )}
            {isOver && (
              <span className="text-xs text-red-400 font-bold">{total - quantity} over</span>
            )}
            {!isOver && unassigned === 0 && (
              <span className="text-xs text-green-400 font-bold">All accounted</span>
            )}
          </div>
        </div>
      ) : (
        <span className="text-sm text-muted/40 italic mt-1 block">No distribution set</span>
      )}
    </button>
  );
};
