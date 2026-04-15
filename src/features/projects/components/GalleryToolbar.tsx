import React from 'react';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

interface GalleryToolbarProps {
  selectedCount: number;
  onDelete: () => void;
  onCancel: () => void;
  isDeleting: boolean;
}

export const GalleryToolbar: React.FC<GalleryToolbarProps> = ({
  selectedCount,
  onDelete,
  onCancel,
  isDeleting,
}) => {
  return (
    <div className="fixed bottom-20 left-4 right-4 z-30 flex items-center justify-between bg-card border border-subtle rounded-2xl p-3 shadow-xl animate-in slide-in-from-bottom-4 duration-200">
      <span className="text-xs font-black uppercase tracking-wider text-content">
        {selectedCount} selected
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-muted bg-surface rounded-xl active:scale-95 transition-all"
        >
          <X size={14} />
        </button>
        <button
          onClick={onDelete}
          disabled={isDeleting}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-red-500 bg-red-500/10 border border-red-500/30 rounded-xl active:scale-95 transition-all disabled:opacity-50"
        >
          {isDeleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          Delete
        </button>
      </div>
    </div>
  );
};
