import React from 'react';
import Box from 'lucide-react/dist/esm/icons/box';
import Printer from 'lucide-react/dist/esm/icons/printer';
import { useLocation, useNavigate } from 'react-router-dom';
import { useViewMode } from '../../../../../context/ViewModeContext';

interface FeedHeaderToolbarProps {
  shippedCount: number;
  eligibleShippingCount: number;
  includeShipped: boolean;
  onIncludeShippedChange: (include: boolean) => void;
  onStartShippingClick: () => void;
}

const StockNavPills = () => {
  const { viewMode, requestStockView } = useViewMode();
  const navigate = useNavigate();
  const location = useLocation();

  const handleStockClick = () => {
    requestStockView();
    if (location.pathname !== '/') navigate('/');
  };

  return (
    <div className="inline-flex items-center gap-1 p-0.5 rounded-full bg-surface border border-subtle/60 shadow-inner">
      <button
        type="button"
        onClick={handleStockClick}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${
          location.pathname === '/' && viewMode === 'stock'
            ? 'bg-accent/15 border border-accent/30 text-accent shadow-sm'
            : 'text-muted hover:text-content'
        }`}
      >
        <Box size={13} />
        <span>STOCK</span>
      </button>
      <button
        type="button"
        onClick={() => navigate('/ship')}
        className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider transition-all active:scale-95 ${
          location.pathname === '/ship'
            ? 'bg-accent/15 border border-accent/30 text-accent shadow-sm'
            : 'text-muted hover:text-content'
        }`}
      >
        <Printer size={13} />
        <span>SHIP</span>
      </button>
    </div>
  );
};

export const FeedHeaderToolbar: React.FC<FeedHeaderToolbarProps> = ({
  shippedCount,
  eligibleShippingCount,
  includeShipped,
  onIncludeShippedChange,
  onStartShippingClick,
}) => {
  return (
    <div className="px-2 pb-2 flex items-center justify-between min-h-[36px] gap-3 border-b border-subtle/40 mb-2">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-base font-black uppercase tracking-wider text-content shrink-0">
          Orders
        </span>
        <StockNavPills />
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
