import React, { useState, useEffect } from 'react';
import MessageSquare from 'lucide-react/dist/esm/icons/message-square';

export type ReasonActionType = 'remove' | 'swap' | 'adjust_qty' | 'add' | 'reopen';

const REASON_PRESETS: Record<ReasonActionType, string[]> = {
  remove: ['Out of stock', 'Customer cancelled', 'Damaged/defective', 'Wrong item on order'],
  swap: ['Out of stock — replacing', 'Wrong size/color', 'Customer requested', 'Damaged — swapping'],
  adjust_qty: ['Partial stock only', 'Customer changed qty', 'Damaged units', 'Count correction'],
  add: ['Replacement for removed item', 'Customer add-on', 'Missing from original order'],
  reopen: ['Item out of stock', 'Wrong item shipped', 'Customer change request', 'Correction needed'],
};

interface ReasonPickerProps {
  actionType: ReasonActionType;
  preselect?: string;
  selectedReason: string;
  onReasonChange: (reason: string) => void;
}

export const ReasonPicker: React.FC<ReasonPickerProps> = ({
  actionType,
  preselect,
  selectedReason,
  onReasonChange,
}) => {
  const [showOther, setShowOther] = useState(false);
  const presets = REASON_PRESETS[actionType];

  useEffect(() => {
    if (preselect && !selectedReason) {
      onReasonChange(preselect);
    }
  }, [preselect, selectedReason, onReasonChange]);

  const handleChipClick = (reason: string) => {
    if (selectedReason === reason) {
      onReasonChange('');
    } else {
      onReasonChange(reason);
      setShowOther(false);
    }
  };

  const handleOtherToggle = () => {
    setShowOther(true);
    onReasonChange('');
  };

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <MessageSquare size={10} className="text-white/30" />
        <span className="text-[9px] font-black text-white/30 uppercase tracking-widest">
          Why?
        </span>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {presets.map((reason) => {
          const isSelected = selectedReason === reason;
          return (
            <button
              key={reason}
              type="button"
              onClick={() => handleChipClick(reason)}
              className={`min-h-10 px-2.5 rounded-xl text-[10px] font-bold leading-tight border transition-all active:scale-[0.97] text-left ${
                isSelected
                  ? 'bg-accent/20 text-accent border-accent/40'
                  : 'bg-white/5 text-white/50 border-white/10 hover:bg-white/10'
              }`}
            >
              {reason}
            </button>
          );
        })}
        {!showOther && (
          <button
            type="button"
            onClick={handleOtherToggle}
            className="min-h-10 px-2.5 rounded-xl text-[10px] font-bold leading-tight border bg-white/5 text-white/30 border-white/10 hover:bg-white/10 transition-all active:scale-[0.97] text-left"
          >
            Other...
          </button>
        )}
      </div>

      {showOther && (
        <input
          type="text"
          value={presets.includes(selectedReason) ? '' : selectedReason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="Type reason..."
          autoFocus
          className="w-full mt-2 px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white text-xs placeholder-white/25 focus:outline-none focus:border-accent/40"
        />
      )}
    </div>
  );
};
