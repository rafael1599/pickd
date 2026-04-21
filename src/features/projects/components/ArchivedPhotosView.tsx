import React, { useMemo, useState } from 'react';
import Archive from 'lucide-react/dist/esm/icons/archive';
import Download from 'lucide-react/dist/esm/icons/download';
import Undo2 from 'lucide-react/dist/esm/icons/undo-2';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import { useArchivedPhotos, type ArchivedPhoto } from '../hooks/useGalleryPhotos';
import { useUnassignPhoto } from '../hooks/useTaskPhotos';
import { downloadPhoto } from '../utils/downloadPhoto';

const STATUS_STYLE: Record<ArchivedPhoto['task_status'], string> = {
  future: 'text-blue-400 bg-blue-500/10',
  in_progress: 'text-amber-400 bg-amber-500/10',
  done: 'text-emerald-400 bg-emerald-500/10',
};

/**
 * Archive view — photos that have been assigned to a project/task. These
 * disappear from the main gallery and accumulate here, grouped by task,
 * so the user can review assignments or unassign/download without losing
 * context.
 *
 * Clicking a thumbnail opens a fullscreen lightbox. Navigation (← / →)
 * cycles through every archived photo across all projects.
 */
export const ArchivedPhotosView: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { data: archived = [], isLoading } = useArchivedPhotos();
  const unassignPhoto = useUnassignPhoto();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Group photos by task so the archive reads as "one project = one block".
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      { title: string; status: ArchivedPhoto['task_status']; photos: ArchivedPhoto[] }
    >();
    for (const p of archived) {
      const g = map.get(p.task_id) ?? {
        title: p.task_title,
        status: p.task_status,
        photos: [],
      };
      g.photos.push(p);
      map.set(p.task_id, g);
    }
    return [...map.entries()]; // [taskId, group]
  }, [archived]);

  // Flat list (same order as grouped rendering) so lightbox index maps
  // 1:1 with what the user clicks.
  const flatPhotos = useMemo(() => grouped.flatMap(([, g]) => g.photos), [grouped]);
  const activePhoto = lightboxIndex !== null ? flatPhotos[lightboxIndex] : null;

  const handleDownload = async (photo: ArchivedPhoto) => {
    setDownloadingId(photo.id);
    try {
      await downloadPhoto(photo);
    } catch (err) {
      console.error('Archive photo download failed:', err);
      toast.error('Download failed.');
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="mt-4 p-3 bg-card border border-subtle rounded-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Archive size={14} className="text-muted" />
          <h3 className="text-xs font-black uppercase tracking-wider text-content">Archived</h3>
          <span className="text-[10px] font-bold text-muted bg-surface px-1.5 py-0.5 rounded-md">
            {archived.length}
          </span>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-full bg-surface text-muted active:scale-95"
          aria-label="Close archive"
        >
          <X size={14} />
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="animate-spin text-accent w-5 h-5 opacity-40" />
        </div>
      ) : archived.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-muted/40">
          <Archive size={28} className="mb-2" />
          <p className="text-xs font-bold uppercase tracking-wider">No archived photos</p>
          <p className="text-[10px] text-muted/50 mt-1">
            Photos move here when you assign them to a project.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([taskId, g]) => (
            <div key={taskId}>
              <div className="flex items-baseline gap-2 mb-2">
                <h4 className="text-sm font-bold text-content">{g.title}</h4>
                <span
                  className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md ${STATUS_STYLE[g.status]}`}
                >
                  {g.status.replace('_', ' ')}
                </span>
                <span className="text-[10px] text-muted ml-auto">{g.photos.length}</span>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
                {g.photos.map((photo) => {
                  const flatIndex = flatPhotos.findIndex((p) => p.id === photo.id);
                  return (
                    <div
                      key={photo.id}
                      className="relative aspect-square rounded-xl overflow-hidden border border-subtle group"
                    >
                      {/* Click the image itself to open lightbox. Using a
                          button so it's keyboard-focusable + tap-target sized. */}
                      <button
                        type="button"
                        onClick={() => setLightboxIndex(flatIndex)}
                        className="w-full h-full block active:scale-95 transition-transform"
                        aria-label={`Open photo ${photo.filename}`}
                      >
                        <img
                          src={photo.thumbnail_url}
                          alt={photo.filename}
                          loading="lazy"
                          className="w-full h-full object-cover"
                        />
                      </button>
                      {/* Action overlay — positioned above the button via
                          higher stacking order. Buttons stopPropagation so
                          the lightbox doesn't also open on action taps. */}
                      <div className="pointer-events-none absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-end justify-center gap-1 p-1 opacity-100 sm:opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(photo);
                          }}
                          disabled={downloadingId === photo.id}
                          className="pointer-events-auto w-7 h-7 rounded-full bg-white/90 text-black flex items-center justify-center shadow hover:bg-white disabled:opacity-60"
                          title="Download"
                        >
                          {downloadingId === photo.id ? (
                            <Loader2 size={12} className="animate-spin" />
                          ) : (
                            <Download size={12} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            unassignPhoto.mutate({
                              taskId: photo.task_id,
                              photoId: photo.id,
                            });
                          }}
                          className="pointer-events-auto w-7 h-7 rounded-full bg-white/90 text-black flex items-center justify-center shadow hover:bg-white"
                          title="Return to gallery"
                        >
                          <Undo2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fullscreen lightbox */}
      {activePhoto && lightboxIndex !== null && (
        <div
          className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center"
          onClick={() => setLightboxIndex(null)}
          role="dialog"
          aria-modal="true"
        >
          {/* Close */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setLightboxIndex(null);
            }}
            className="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-10"
            aria-label="Close"
          >
            <X size={24} />
          </button>

          {/* Caption with task title + filename */}
          <div className="absolute top-4 left-4 right-16 text-white/80 pointer-events-none">
            <p className="text-sm font-bold truncate">{activePhoto.task_title}</p>
            <p className="text-xs text-white/50 truncate">{activePhoto.filename}</p>
          </div>

          {/* Prev */}
          {lightboxIndex > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex - 1);
              }}
              className="absolute left-4 p-2 text-white/70 hover:text-white"
              aria-label="Previous"
            >
              <ChevronLeft size={32} />
            </button>
          )}

          {/* Full-res image. stopPropagation so clicking the image itself
              doesn't close the lightbox (backdrop close still works). */}
          <img
            src={activePhoto.url}
            alt={activePhoto.filename}
            className="max-w-[90vw] max-h-[85vh] object-contain rounded-xl"
            onClick={(e) => e.stopPropagation()}
          />

          {/* Next */}
          {lightboxIndex < flatPhotos.length - 1 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setLightboxIndex(lightboxIndex + 1);
              }}
              className="absolute right-4 p-2 text-white/70 hover:text-white"
              aria-label="Next"
            >
              <ChevronRight size={32} />
            </button>
          )}

          {/* Footer actions — download + unassign + counter */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-white/10 backdrop-blur-md border border-white/20 rounded-full px-4 py-2">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload(activePhoto);
              }}
              disabled={downloadingId === activePhoto.id}
              className="flex items-center gap-1.5 text-xs font-bold text-white/90 hover:text-white disabled:opacity-60"
              title="Download"
            >
              {downloadingId === activePhoto.id ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Download size={14} />
              )}
              Download
            </button>
            <div className="w-px h-4 bg-white/20" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                unassignPhoto.mutate({
                  taskId: activePhoto.task_id,
                  photoId: activePhoto.id,
                });
                setLightboxIndex(null);
              }}
              className="flex items-center gap-1.5 text-xs font-bold text-white/90 hover:text-white"
              title="Return to gallery"
            >
              <Undo2 size={14} />
              Return
            </button>
            <div className="w-px h-4 bg-white/20" />
            <span className="text-[10px] text-white/50 font-bold tabular-nums">
              {lightboxIndex + 1} / {flatPhotos.length}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
