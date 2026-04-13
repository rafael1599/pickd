import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useDoubleCheckList } from '../hooks/useDoubleCheckList';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { VerificationBoard } from './VerificationBoard';

// ─── Main Component ───────────────────────────────────────────────────────────
// The header button that opens the full-screen Verification Board.
// All board logic (DnD, zones, layout) lives in VerificationBoard.tsx.

export const DoubleCheckHeader = () => {
  const { readyCount, correctionCount, refresh } = useDoubleCheckList();
  const [isOpen, setIsOpen] = useState(false);
  useScrollLock(isOpen, () => setIsOpen(false));

  const totalActions = readyCount + correctionCount;

  return (
    <div className="relative">
      <button
        onClick={() => {
          const nextState = !isOpen;
          setIsOpen(nextState);
          if (nextState) refresh();
        }}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-full transition-all active:scale-95 relative ${
          totalActions > 0
            ? 'bg-accent/10 text-accent border border-accent/30 shadow-lg shadow-accent/5'
            : 'bg-surface border border-subtle text-muted opacity-60'
        }`}
      >
        <div className="relative">
          <ClipboardCheck size={18} className={totalActions > 0 ? 'text-accent' : ''} />
          {totalActions > 0 && (
            <span className="absolute -top-2.5 -right-2.5 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center border-2 border-card animate-bounce">
              {totalActions}
            </span>
          )}
        </div>
        <span className="text-xs font-black uppercase tracking-widest hidden sm:block">
          Verification
        </span>
        <ChevronDown
          size={14}
          className={`transition-transform duration-300 hidden sm:block ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isOpen &&
        createPortal(
          <VerificationBoard onClose={() => setIsOpen(false)} />,
          document.body
        )}
    </div>
  );
};
