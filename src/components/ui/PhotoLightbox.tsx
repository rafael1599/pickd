import React, { useEffect } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

interface PhotoLightboxProps {
  photos: string[]; // full-size URLs
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  caption?: string;
}

/** Reusable fullscreen photo viewer with prev/next nav. */
export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  index,
  onClose,
  onIndexChange,
  caption,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, onIndexChange]);

  if (!photos[index]) return null;

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/95 flex items-center justify-center"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute top-4 right-4 p-2 text-white/70 hover:text-white z-10"
      >
        <X size={24} />
      </button>

      {index > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index - 1);
          }}
          className="absolute left-4 p-2 text-white/70 hover:text-white"
        >
          <ChevronLeft size={32} />
        </button>
      )}

      <img
        src={photos[index]}
        alt=""
        className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl"
        onClick={(e) => e.stopPropagation()}
      />

      {index < photos.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onIndexChange(index + 1);
          }}
          className="absolute right-4 p-2 text-white/70 hover:text-white"
        >
          <ChevronRight size={32} />
        </button>
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1">
        {caption && <span className="text-white/80 text-sm font-bold">{caption}</span>}
        <span className="text-white/50 text-xs font-bold">
          {index + 1} / {photos.length}
        </span>
      </div>
    </div>
  );
};
