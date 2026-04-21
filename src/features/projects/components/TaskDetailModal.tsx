import React, { useRef, useState } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Download from 'lucide-react/dist/esm/icons/download';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import {
  useTaskPhotoDetails,
  useUnassignPhoto,
  useAssignPhotosToTask,
} from '../hooks/useTaskPhotos';
import { useUploadGalleryPhoto } from '../hooks/useGalleryPhotos';
import type { ProjectTask } from '../hooks/useProjectTasks';
import toast from 'react-hot-toast';

interface TaskDetailModalProps {
  task: ProjectTask;
  onClose: () => void;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({ task, onClose }) => {
  const { data: photos = [] } = useTaskPhotoDetails(task.id);
  const unassignPhoto = useUnassignPhoto();
  const uploadPhoto = useUploadGalleryPhoto();
  const assignPhotos = useAssignPhotosToTask();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const statusColors: Record<string, string> = {
    future: 'bg-blue-500/20 text-blue-400',
    in_progress: 'bg-amber-500/20 text-amber-400',
    done: 'bg-emerald-500/20 text-emerald-400',
  };

  const isUploading = uploadPhoto.isPending || assignPhotos.isPending;

  // Flow: file input → upload to R2 via edge function → auto-assign the new
  // photo to this task so it appears in the grid without a separate drag.
  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (!file) return;
    try {
      const photo = await uploadPhoto.mutateAsync({ file });
      await assignPhotos.mutateAsync({ taskId: task.id, photoIds: [photo.id] });
    } catch (err) {
      console.error('Task photo upload failed:', err);
      toast.error('Upload failed. Check console for details.');
    }
  };

  const handleDownloadPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const { exportTaskPdf } = await import('../utils/exportTaskPdf');
      await exportTaskPdf({
        task: {
          id: task.id,
          title: task.title,
          note: task.note,
          status: task.status,
        },
        photoUrls: photos.map((p) => p.url),
      });
    } catch (err) {
      console.error('Task PDF export failed:', err);
      toast.error('PDF export failed. Check console for details.');
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    // z-[105] clears the app's bottom nav (z-100). The sheet anchors to the
    // TOP of the viewport on mobile (slides down from above) so the title +
    // PDF/close controls land in a comfortable thumb zone and never overlap
    // with the bottom nav.
    <div className="fixed inset-0 z-[105] flex items-start sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full sm:max-w-lg bg-card border border-subtle rounded-b-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-top-4 duration-200">
        {/* Header */}
        <div className="sticky top-0 bg-card/95 backdrop-blur-sm border-b border-subtle p-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <span
              className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md ${statusColors[task.status] ?? ''}`}
            >
              {task.status.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="p-1.5 hover:bg-surface rounded-lg text-muted disabled:opacity-50 disabled:cursor-not-allowed"
              title={isExportingPdf ? 'Generating PDF…' : 'Download project as PDF'}
            >
              {isExportingPdf ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Download size={18} />
              )}
            </button>
            <button onClick={onClose} className="p-1 hover:bg-surface rounded-lg text-muted">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content — pb-8 (regular) keeps inner breathing room; the sheet
            itself is already above the bottom nav via z-index. */}
        <div className="p-4 pb-8 space-y-4">
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

            <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4">
              {/* "+" upload tile — always first, always visible. Same
                  dimensions as a photo thumbnail. */}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                aria-label="Add photo"
                className="relative shrink-0 w-20 h-20 rounded-xl border-2 border-dashed border-subtle hover:border-accent/60 hover:bg-accent/5 transition-colors flex items-center justify-center text-muted hover:text-accent disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isUploading ? <Loader2 size={22} className="animate-spin" /> : <Plus size={22} />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFilePick}
              />

              {photos.length === 0 ? (
                <div className="shrink-0 flex items-center px-3">
                  <p className="text-xs text-muted/50 font-bold uppercase tracking-wider">
                    Tap + or drag from the gallery
                  </p>
                </div>
              ) : (
                photos.map((photo, index) => (
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
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Fullscreen Lightbox */}
      {lightboxIndex !== null && photos[lightboxIndex] && (
        <div
          className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center"
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
