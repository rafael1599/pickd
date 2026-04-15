import React, { useState } from 'react';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import X from 'lucide-react/dist/esm/icons/x';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Check from 'lucide-react/dist/esm/icons/check';
import {
  useTrashPhotos,
  useRestorePhotos,
  usePermanentDeletePhotos,
} from '../hooks/useGalleryPhotos';

export const TrashView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { data: trashPhotos = [], isLoading } = useTrashPhotos();
  const restorePhotos = useRestorePhotos();
  const permanentDelete = usePermanentDeletePhotos();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const daysRemaining = (deletedAt: string) => {
    const expiry = new Date(deletedAt).getTime() + 14 * 24 * 60 * 60 * 1000;
    const diffMs = expiry - new Date().getTime();
    return Math.max(0, Math.ceil(diffMs / (24 * 60 * 60 * 1000)));
  };

  return (
    <div className="mt-4 p-3 bg-card border border-subtle rounded-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trash2 size={14} className="text-red-400" />
          <h3 className="text-xs font-black uppercase tracking-wider text-content">
            Trash ({trashPhotos.length})
          </h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-surface rounded-md text-muted">
          <X size={14} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="animate-spin text-muted w-5 h-5" />
        </div>
      ) : trashPhotos.length === 0 ? (
        <p className="text-xs text-muted/40 font-bold uppercase tracking-wider text-center py-4">
          Trash is empty
        </p>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          {trashPhotos.map((photo) => (
            <button
              key={photo.id}
              onClick={() => toggleSelect(photo.id)}
              className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${
                selectedIds.has(photo.id)
                  ? 'border-red-400 ring-2 ring-red-400/30'
                  : 'border-transparent opacity-60'
              }`}
            >
              <img
                src={photo.thumbnail_url}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
              />
              <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5">
                <span className="text-[8px] font-bold text-white">
                  {daysRemaining(photo.deleted_at!)}d left
                </span>
              </div>
              {selectedIds.has(photo.id) && (
                <div className="absolute inset-0 bg-red-500/20 flex items-center justify-center">
                  <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                    <Check size={12} className="text-white" strokeWidth={3} />
                  </div>
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-subtle">
          <span className="text-xs font-bold text-muted">{selectedIds.size} selected</span>
          <div className="flex gap-2">
            <button
              onClick={() =>
                restorePhotos.mutate([...selectedIds], {
                  onSuccess: () => setSelectedIds(new Set()),
                })
              }
              disabled={restorePhotos.isPending}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-accent bg-accent/10 border border-accent/30 rounded-xl active:scale-95 transition-all"
            >
              <RotateCcw size={12} /> Restore
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-red-500 bg-red-500/10 border border-red-500/30 rounded-xl active:scale-95 transition-all"
              >
                <Trash2 size={12} /> Delete Forever
              </button>
            ) : (
              <button
                onClick={() => {
                  permanentDelete.mutate([...selectedIds], {
                    onSuccess: () => {
                      setSelectedIds(new Set());
                      setConfirmDelete(false);
                    },
                  });
                }}
                disabled={permanentDelete.isPending}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white bg-red-500 border border-red-600 rounded-xl active:scale-95 transition-all animate-pulse"
              >
                <Trash2 size={12} /> Confirm ({selectedIds.size})
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
