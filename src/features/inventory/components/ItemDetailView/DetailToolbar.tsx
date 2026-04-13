import React, { useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import Printer from 'lucide-react/dist/esm/icons/printer';
import PenLine from 'lucide-react/dist/esm/icons/pen-line';

interface DetailToolbarProps {
  title: string;
  mode: 'add' | 'edit';
  onBack: () => void;
  onDelete?: () => void;
  onMarkInactive?: () => void;
  onPrintLabel?: () => void;
  onEditLabel?: () => void;
}

export const DetailToolbar: React.FC<DetailToolbarProps> = ({
  title,
  mode,
  onBack,
  onDelete,
  onMarkInactive,
  onPrintLabel,
  onEditLabel,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="sticky top-0 z-20 bg-surface border-b border-subtle">
      <div className="flex items-center justify-between px-4 py-3">
        {/* Menu (left side) */}
        {mode === 'edit' ? (
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 -ml-2 text-muted hover:text-content transition-colors active:scale-95"
            >
              <MoreVertical size={20} />
            </button>

            {menuOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                <div className="absolute left-0 top-full mt-1 z-30 bg-surface border border-subtle rounded-xl shadow-xl overflow-hidden min-w-[180px] animate-in fade-in slide-in-from-top-2 duration-150">
                  {onPrintLabel && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onPrintLabel();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-content hover:bg-card transition-colors"
                    >
                      <Printer size={16} className="text-muted" />
                      Print Label
                    </button>
                  )}
                  {onEditLabel && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onEditLabel();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-content hover:bg-card transition-colors"
                    >
                      <PenLine size={16} className="text-muted" />
                      Edit Label
                    </button>
                  )}
                  {onMarkInactive && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onMarkInactive();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-content hover:bg-card transition-colors"
                    >
                      <EyeOff size={16} className="text-muted" />
                      Mark Inactive
                    </button>
                  )}
                  {onDelete && (
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        onDelete();
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 size={16} />
                      Delete Item
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="w-10" /> /* spacer for centering */
        )}

        {/* Title */}
        <h1
          className="flex-1 text-center text-sm font-black uppercase tracking-tight text-content truncate mx-4"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {mode === 'add' ? 'New Item' : title}
        </h1>

        {/* Close (right side) */}
        <button
          onClick={onBack}
          className="p-2 -mr-2 text-muted hover:text-content transition-colors active:scale-95"
        >
          <X size={22} />
        </button>
      </div>
    </div>
  );
};
