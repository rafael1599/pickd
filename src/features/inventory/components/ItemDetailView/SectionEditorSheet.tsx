import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import Check from 'lucide-react/dist/esm/icons/check';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import {
  type DistributionItem,
  STORAGE_TYPE_LABELS,
} from '../../../../schemas/inventory.schema.ts';
import { useAutoSelect } from '../../../../hooks/useAutoSelect.ts';

interface SectionEditorSheetProps {
  isOpen: boolean;
  onClose: () => void;
  distribution: DistributionItem[];
  quantity: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, field: keyof DistributionItem, value: string | number) => void;
}

/**
 * Bottom sheet for editing distribution — full editor with rows.
 * Mirrors the current InventoryModal distribution editor.
 */
export const SectionEditorSheet: React.FC<SectionEditorSheetProps> = ({
  isOpen,
  onClose,
  distribution,
  quantity,
  onAdd,
  onRemove,
  onUpdate,
}) => {
  const autoSelect = useAutoSelect();

  const distributionTotal = useMemo(
    () => distribution.reduce((sum, d) => sum + d.count * d.units_each, 0),
    [distribution]
  );

  useScrollLock(isOpen, onClose);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[55] flex flex-col justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Sheet */}
      <div className="relative bg-surface border-t border-subtle rounded-t-3xl max-h-[80vh] overflow-hidden animate-in slide-in-from-bottom duration-300 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-subtle shrink-0">
          <h3 className="text-sm font-black uppercase tracking-tight text-content">
            Physical Distribution
          </h3>
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent rounded-lg font-black text-[10px] uppercase tracking-widest hover:bg-accent/20 transition-colors"
          >
            <Check size={14} strokeWidth={3} />
            Done
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-5 space-y-3 flex-1">
          {distribution.map((row, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-150"
            >
              <select
                value={row.type}
                onChange={(e) => onUpdate(idx, 'type', e.target.value)}
                className="bg-surface border border-subtle rounded-lg px-2 py-2 text-content text-xs font-bold focus:border-accent focus:outline-none flex-shrink-0 w-24"
              >
                {Object.entries(STORAGE_TYPE_LABELS).map(([key, { icon }]) => (
                  <option key={key} value={key}>
                    {icon} {key}
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={row.count === 0 ? '' : row.count}
                onChange={(e) =>
                  onUpdate(idx, 'count', e.target.value === '' ? 0 : parseInt(e.target.value) || 0)
                }
                onBlur={(e) => {
                  if (e.target.value === '' || Number(e.target.value) < 1)
                    onUpdate(idx, 'count', 1);
                }}
                {...autoSelect}
                className="w-14 bg-surface border border-subtle rounded-lg px-2 py-2 text-content text-center text-xs font-mono font-bold focus:border-accent focus:outline-none"
                min={1}
                placeholder="#"
              />
              <span className="text-muted text-[10px] font-black">&times;</span>
              <input
                type="number"
                value={row.units_each === 0 ? '' : row.units_each}
                onChange={(e) =>
                  onUpdate(
                    idx,
                    'units_each',
                    e.target.value === '' ? 0 : parseInt(e.target.value) || 0
                  )
                }
                onBlur={(e) => {
                  if (e.target.value === '' || Number(e.target.value) < 1)
                    onUpdate(idx, 'units_each', 1);
                }}
                {...autoSelect}
                className="w-14 bg-surface border border-subtle rounded-lg px-2 py-2 text-content text-center text-xs font-mono font-bold focus:border-accent focus:outline-none"
                min={1}
                placeholder="u"
              />
              <span className="text-[10px] text-muted font-bold">
                = {row.count * row.units_each}u
              </span>
              <button
                type="button"
                onClick={() => onRemove(idx)}
                className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Minus size={14} />
              </button>
            </div>
          ))}

          <button
            type="button"
            onClick={onAdd}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-subtle hover:border-accent/40 rounded-xl text-muted hover:text-accent text-[10px] font-black uppercase tracking-widest transition-colors"
          >
            <Plus size={12} />
            Add Grouping
          </button>

          {/* Summary */}
          {distribution.length > 0 && (
            <div
              className={`flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${
                distributionTotal > (quantity || 0)
                  ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                  : distributionTotal === (quantity || 0)
                    ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                    : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
              }`}
            >
              <span>
                Accounted: {distributionTotal} / {quantity || 0} units
              </span>
              <span>
                {distributionTotal > (quantity || 0)
                  ? `${distributionTotal - (quantity || 0)} over`
                  : distributionTotal === (quantity || 0)
                    ? 'Perfect'
                    : `${(quantity || 0) - distributionTotal} loose`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
