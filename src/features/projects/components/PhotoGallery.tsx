import React, { useState, useRef } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import ImageIcon from 'lucide-react/dist/esm/icons/image';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Archive from 'lucide-react/dist/esm/icons/archive';
import X from 'lucide-react/dist/esm/icons/x';
import toast from 'react-hot-toast';
import {
  useGalleryPhotos,
  useUploadGalleryPhoto,
  useSoftDeletePhotos,
  useTrashPhotos,
  useArchivedPhotos,
} from '../hooks/useGalleryPhotos';
import { PhotoThumbnail } from './PhotoThumbnail';
import { GalleryToolbar } from './GalleryToolbar';
import { TrashView } from './TrashView';
import { ArchivedPhotosView } from './ArchivedPhotosView';
import { downloadPhotos } from '../utils/downloadPhoto';

export const PhotoGallery: React.FC = () => {
  const { data: photos = [], isLoading } = useGalleryPhotos();
  const uploadPhoto = useUploadGalleryPhoto();
  const softDelete = useSoftDeletePhotos();
  const { data: trashPhotos = [] } = useTrashPhotos();
  const { data: archivedPhotos = [] } = useArchivedPhotos();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showSourceModal, setShowSourceModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    total: number;
    done: number;
    failed: number;
  } | null>(null);

  /** Upload a list of files with concurrency=3 throttling and progress tracking. */
  const uploadBulk = async (files: File[]) => {
    if (files.length === 0) return;
    if (files.length === 1) {
      // Single file — use normal mutation (cleaner UX, no progress bar)
      uploadPhoto.mutate({ file: files[0] });
      return;
    }
    setBulkProgress({ total: files.length, done: 0, failed: 0 });

    const CONCURRENCY = 3;
    let cursor = 0;
    let done = 0;
    let failed = 0;

    const worker = async () => {
      while (cursor < files.length) {
        const i = cursor++;
        const file = files[i];
        try {
          await uploadPhoto.mutateAsync({ file });
          done++;
        } catch (err) {
          console.error('Bulk upload failed for file', file.name, err);
          failed++;
        }
        setBulkProgress({ total: files.length, done, failed });
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    // Brief pause so the user sees the final count, then dismiss
    setTimeout(() => setBulkProgress(null), 1500);
  };

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // Reset input
    if (files.length === 0) return;
    uploadBulk(files);
  };

  const handlePickCamera = () => {
    setShowSourceModal(false);
    cameraInputRef.current?.click();
  };

  const handlePickGallery = () => {
    setShowSourceModal(false);
    galleryInputRef.current?.click();
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDelete = () => {
    if (selectedIds.size === 0) return;
    softDelete.mutate([...selectedIds], {
      onSuccess: () => setSelectedIds(new Set()),
    });
  };

  const handleDownload = async () => {
    if (selectedIds.size === 0) return;
    const toDownload = photos.filter((p) => selectedIds.has(p.id));
    setIsDownloading(true);
    try {
      await downloadPhotos(toDownload);
      setSelectedIds(new Set());
    } catch (err) {
      console.error('Bulk download failed:', err);
      toast.error('Download failed. Check console for details.');
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="mt-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => setIsCollapsed(!isCollapsed)} className="flex items-center gap-2">
          <h2 className="text-xs font-black uppercase tracking-wider text-content">Photos</h2>
          <span className="text-[10px] text-muted font-bold bg-surface px-1.5 py-0.5 rounded-md">
            {photos.length}
          </span>
          <ChevronDown
            size={14}
            className={`text-muted transition-transform duration-200 ${isCollapsed ? '-rotate-90' : ''}`}
          />
        </button>
        <div className="flex items-center gap-2">
          {archivedPhotos.length > 0 && (
            <button
              onClick={() => {
                setShowArchive((v) => !v);
                if (!showArchive) setShowTrash(false);
              }}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all ${
                showArchive
                  ? 'text-accent bg-accent/10 border border-accent/30'
                  : 'text-muted/60 bg-surface border border-transparent'
              }`}
              title="Assigned photos"
            >
              <Archive size={12} />
              {archivedPhotos.length}
            </button>
          )}
          {trashPhotos.length > 0 && (
            <button
              onClick={() => {
                setShowTrash((v) => !v);
                if (!showTrash) setShowArchive(false);
              }}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all ${
                showTrash
                  ? 'text-red-400 bg-red-500/10 border border-red-500/30'
                  : 'text-muted/60 bg-surface border border-transparent'
              }`}
            >
              <Trash2 size={12} />
              {trashPhotos.length}
            </button>
          )}
          <button
            onClick={() => setShowSourceModal(true)}
            disabled={uploadPhoto.isPending || !!bulkProgress}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all disabled:opacity-50"
          >
            {uploadPhoto.isPending || bulkProgress ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Camera size={14} />
            )}
            Capture
          </button>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCapture}
            className="hidden"
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleCapture}
            className="hidden"
          />
        </div>
      </div>

      {/* Source Selector Modal */}
      {showSourceModal && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setShowSourceModal(false)}
        >
          <div
            className="w-full sm:max-w-md bg-surface border-t sm:border border-accent/20 rounded-t-3xl sm:rounded-3xl p-5 pb-8 sm:pb-5 shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-sm font-black uppercase tracking-wider text-content">
                Add Photo
              </h3>
              <button
                onClick={() => setShowSourceModal(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-surface-hover text-muted active:scale-95 transition-all"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Options */}
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={handlePickCamera}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/30 active:scale-95 transition-all"
              >
                <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-accent/20 text-accent">
                  <Camera size={28} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-content">
                  Camera
                </span>
              </button>

              <button
                onClick={handlePickGallery}
                className="flex flex-col items-center justify-center gap-2 p-5 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/30 active:scale-95 transition-all"
              >
                <div className="w-14 h-14 flex items-center justify-center rounded-2xl bg-accent/20 text-accent">
                  <ImageIcon size={28} />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider text-content">
                  Gallery
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk upload progress bar */}
      {bulkProgress && (
        <div className="mb-3 p-3 bg-accent/10 border border-accent/30 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-black uppercase tracking-wider text-accent">
              {bulkProgress.done + bulkProgress.failed >= bulkProgress.total
                ? `Done — ${bulkProgress.done} uploaded${bulkProgress.failed > 0 ? `, ${bulkProgress.failed} failed` : ''}`
                : `Uploading ${bulkProgress.done + bulkProgress.failed + 1} of ${bulkProgress.total}…`}
            </span>
            {bulkProgress.failed > 0 && (
              <span className="text-[10px] font-bold text-red-400">
                {bulkProgress.failed} error{bulkProgress.failed !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="h-2 bg-surface rounded-full overflow-hidden">
            <div
              className="h-full bg-accent transition-all duration-200"
              style={{
                width: `${((bulkProgress.done + bulkProgress.failed) / bulkProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Gallery Grid */}
      {!isCollapsed && (
        <>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="animate-spin text-accent w-6 h-6 opacity-20" />
            </div>
          ) : photos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted/40">
              <Camera size={32} className="mb-2" />
              <p className="text-xs font-bold uppercase tracking-wider">No photos yet</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {photos.map((photo) => (
                <PhotoThumbnail
                  key={photo.id}
                  photo={photo}
                  isSelected={selectedIds.has(photo.id)}
                  selectedIds={selectedIds}
                  onToggleSelect={() => toggleSelect(photo.id)}
                />
              ))}
            </div>
          )}

          {/* Selection Toolbar */}
          {selectedIds.size > 0 && (
            <GalleryToolbar
              selectedCount={selectedIds.size}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onCancel={() => setSelectedIds(new Set())}
              isDeleting={softDelete.isPending}
              isDownloading={isDownloading}
            />
          )}

          {/* Archive (assigned photos) */}
          {showArchive && <ArchivedPhotosView onClose={() => setShowArchive(false)} />}

          {/* Trash */}
          {showTrash && <TrashView onClose={() => setShowTrash(false)} />}
        </>
      )}
    </div>
  );
};
