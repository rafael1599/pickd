import React from 'react';
import { SearchInput } from '../../../../../components/ui/SearchInput';

interface FeedHeaderToolbarProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  shippedCount: number;
  eligibleShippingCount: number;
  includeShipped: boolean;
  onIncludeShippedChange: (include: boolean) => void;
  onStartShippingClick: () => void;
}

export const FeedHeaderToolbar: React.FC<FeedHeaderToolbarProps> = ({
  searchQuery,
  onSearchChange,
  shippedCount,
  eligibleShippingCount,
  includeShipped,
  onIncludeShippedChange,
  onStartShippingClick,
}) => {
  return (
    <div className="px-2 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-subtle/40 mb-2">
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-base font-black uppercase tracking-wider text-content">Orders</span>
      </div>

      <div className="flex-1 max-w-xs min-w-[180px]">
        <SearchInput
          variant="inline"
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search orders or customer..."
          preferenceId="ship"
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {eligibleShippingCount > 0 && (
          <button
            onClick={onStartShippingClick}
            className="text-[9px] font-black uppercase tracking-wider px-2 py-1 rounded-lg border border-accent/30 bg-accent/10 text-accent hover:bg-accent hover:text-white transition-all select-none font-bold"
          >
            Start Shipping ({eligibleShippingCount})
          </button>
        )}
        <label className="flex items-center gap-1.5 cursor-pointer select-none min-w-0">
          <input
            type="checkbox"
            checked={includeShipped}
            onChange={(e) => onIncludeShippedChange(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-subtle accent-emerald-500 cursor-pointer shrink-0"
          />
          <span
            className={`text-[10px] font-black uppercase tracking-wider ${
              includeShipped ? 'text-emerald-400' : 'text-muted'
            }`}
          >
            Shipped ({shippedCount})
          </span>
        </label>
      </div>
    </div>
  );
};
