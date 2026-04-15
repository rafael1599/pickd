import React, { useState, useRef } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import {
  useGalleryPhotos,
  useUploadGalleryPhoto,
  useSoftDeletePhotos,
  useTrashPhotos,
} from '../hooks/useGalleryPhotos';
import { PhotoThumbnail } from './PhotoThumbnail';
import { GalleryToolbar } from './GalleryToolbar';
import { TrashView } from './TrashView';

export const PhotoGallery: React.FC = () => {
  const { data: photos = [], isLoading } = useGalleryPhotos();
  const uploadPhoto = useUploadGalleryPhoto();
  const softDelete = useSoftDeletePhotos();
  const { data: trashPhotos = [] } = useTrashPhotos();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showTrash, setShowTrash] = useState(false);

  const handleCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadPhoto.mutate({ file });
    e.target.value = ''; // Reset input
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
          {trashPhotos.length > 0 && (
            <button
              onClick={() => setShowTrash(!showTrash)}
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
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadPhoto.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-xl text-xs font-bold uppercase tracking-wider active:scale-95 transition-all disabled:opacity-50"
          >
            {uploadPhoto.isPending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Camera size={14} />
            )}
            Capture
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCapture}
            className="hidden"
          />
        </div>
      </div>

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
              onCancel={() => setSelectedIds(new Set())}
              isDeleting={softDelete.isPending}
            />
          )}

          {/* Trash */}
          {showTrash && <TrashView onClose={() => setShowTrash(false)} />}
        </>
      )}
    </div>
  );
};
