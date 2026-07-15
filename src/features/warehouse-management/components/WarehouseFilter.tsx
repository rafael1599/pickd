import { memo } from 'react';
import { getWarehouseButtonStyle } from '../utils/zoneUtils';

/**
 * WarehouseFilter - Toggle buttons to filter by warehouse
 */
interface WarehouseFilterProps {
  warehouses: string[];
  selected: string;
  onChange: (warehouse: string) => void;
}

export const WarehouseFilter = memo(({ warehouses, selected, onChange }: WarehouseFilterProps) => {
  return (
    <div className="flex bg-neutral-800 rounded-lg p-1 gap-1">
      <button
        onClick={() => onChange('ALL')}
        className={`flex-1 px-3 py-2.5 rounded-md font-bold text-sm transition-all ${
          selected === 'ALL' ? 'bg-white text-black' : 'text-neutral-400 hover:text-white'
        }`}
      >
        All
      </button>
      {warehouses.map((wh) => (
        <button
          key={wh}
          onClick={() => onChange(wh)}
          className={`flex-1 px-3 py-2.5 rounded-md font-bold text-sm transition-all ${getWarehouseButtonStyle(
            wh,
            selected === wh
          )}`}
        >
          {wh}
        </button>
      ))}
    </div>
  );
});

WarehouseFilter.displayName = 'WarehouseFilter';
