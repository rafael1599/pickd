import React, { useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Camera from 'lucide-react/dist/esm/icons/camera';
import { useTaskPhotoDetails, useUnassignPhoto } from '../hooks/useTaskPhotos';
import type { ProjectTask } from '../hooks/useProjectTasks';

interface TaskDetailModalProps {
  task: ProjectTask;
  onClose: () => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ task, onClose }) => {
  const { data: photos = [] } = useTaskPhotoDetails(task.id);
  const unassignPhoto = useUnassignPhoto();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const statusColors: Record<string, string> = {
    future: 'bg-blue-500/20 text-blue-400',
    in_progress: 'bg-amber-500/20 text-amber-400',
    done: 'bg-emerald-500/20 text-emerald-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full sm:max-w-lg bg-card border border-subtle rounded-t-3xl sm:rounded-3xl max-h-[80vh] overflow-y-auto animate-in slide-in-from-bottom-4 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-subtle p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${statusColors[task.status] ?? ''}`}
            >
              {task.status.replace('_', ' ')}
            </span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-surface rounded-lg text-muted">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Task info */}
          <div>
            <h2 className="text-lg font-bold text-content">{task.title}</h2>
            {task.note && <p className="text-sm text-muted mt-1 leading-relaxed">{task.note}</p>}
          </div>

          {/* Photos section */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Camera size={14} className="text-muted" />
              <h3 className="text-xs font-black uppercase tracking-wider text-muted">
                Photos ({photos.length})
              </h3>
            </div>

            {photos.length === 0 ? (
              <p className="text-xs text-muted/40 font-bold uppercase tracking-wider py-4 text-center">
                Drag photos here from the gallery
              </p>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
                {photos.map((photo, index) => (
                  <div key={photo.id} className="relative shrink-0 group">
                    <button
                      onClick={() => setLightboxIndex(index)}
                      className="w-20 h-20 rounded-xl overflow-hidden border border-subtle"
                    >
                      <img
                        src={photo.thumbnail_url}
                        alt=""
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <button
                      onClick={() => unassignPhoto.mutate({ taskId: task.id, photoId: photo.id })}
                      className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={10} className="text-white" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Fullscreen Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(null);
            }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-10"
          >
            <X size={24} />
          </button>

          {lightboxIndex > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex - 1);
              }}
              className="absolute left-4 p-2 text-white/70 hover:text-white"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          <img
            src={photos[lightboxIndex].url}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />

          {lightboxIndex < photos.length - 1 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex + 1);
              }}
              className="absolute right-4 p-2 text-white/70 hover:text-white"
            >
              <ChevronRight size={32} />
            </button>
          )}

          <div className="absolute bottom-4 text-white/50 text-xs font-bold">
            {lightboxIndex + 1} / {photos.length}
          </div>
        </div>
      )}
    </div>
  );
};
