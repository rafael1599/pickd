import React from 'react';
import Check from 'lucide-react/dist/esm/icons/check';
import { useDraggable } from '@dnd-kit/core';
import type { GalleryPhoto } from '../../../schemas/galleryPhoto';

interface PhotoThumbnailProps {
  photo: GalleryPhoto;
  isSelected: boolean;
  selectedIds: Set<string>;
  onToggleSelect: () => void;
}

export const PhotoThumbnail: React.FC<PhotoThumbnailProps> = ({
  photo,
  isSelected,
  selectedIds,
  onToggleSelect,
}) => {
  // When dragging a selected photo, include ALL selected IDs
  const dragPhotoIds = isSelected && selectedIds.size > 1 ? [...selectedIds] : [photo.id];

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: 'photo-' + photo.id,
    data: { type: 'photo', photo, photoIds: dragPhotoIds, count: dragPhotoIds.length },
  });

  return (
    <button
      ref={setNodeRef}
      onClick={onToggleSelect}
      className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all duration-150 active:scale-95 ${
        isSelected ? 'border-accent ring-2 ring-accent/30' : 'border-transparent'
      } ${isDragging ? 'opacity-50' : ''}`}
      {...attributes}
      {...listeners}
    >
      <img
        src={photo.thumbnail_url}
        alt={photo.filename}
        loading="lazy"
        className="w-full h-full object-cover"
      />
      {isSelected && (
        <div className="absolute inset-0 bg-accent/20 flex items-center justify-center">
          <div className="w-6 h-6 bg-accent rounded-full flex items-center justify-center">
            <Check size={14} className="text-white" strokeWidth={3} />
          </div>
        </div>
      )}
    </button>
  );
};
