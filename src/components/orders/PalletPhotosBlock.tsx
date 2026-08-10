import React, { useState } from 'react';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

interface PalletPhotosBlockProps {
  photos: string[];
  orderNumber?: string;
  compact?: boolean;
  className?: string;
  onAddPhoto?: () => void;
  isAddingPhoto?: boolean;
}

/**
 * Derives a thumbnail URL from a full-size gallery photo URL.
 * Pattern: `.../photos/gallery/{id}.webp` → `.../photos/gallery/thumbs/{id}.webp`
 * Falls back to the original URL when the pattern doesn't match or is a blob/data URL.
 */
function toThumbUrl(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return url;
  }
  return url.replace(/(photos\/gallery\/)([^/]+\.webp)$/, '$1thumbs/$2');
}

/** Pallet photo grid + lightbox — its own block on the Ship screen, below
 *  the print-preview header and the editable card. */
export const PalletPhotosBlock: React.FC<PalletPhotosBlockProps> = ({
  photos,
  orderNumber,
  compact = false,
  className = '',
  onAddPhoto,
  isAddingPhoto = false,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0 && !onAddPhoto) return null;

  const wrapperClass = compact
    ? `w-full flex items-start justify-end ${className}`
    : `w-full px-1 md:px-4 ${className}`;
  const gridClass = compact
    ? 'flex flex-row flex-wrap gap-2 items-center justify-end animate-soft-in'
    : 'flex flex-wrap gap-2 animate-soft-in';
  const thumbClass = compact
    ? 'w-8 h-8 sm:w-10 sm:h-10 shrink-0 aspect-square rounded-xl overflow-hidden border border-subtle hover:border-accent transition-colors active:scale-95 bg-surface'
    : 'w-20 h-20 rounded-xl overflow-hidden border border-subtle hover:border-accent transition-colors active:scale-95';

  return (
    <div className={wrapperClass}>
      <div className={gridClass}>
        {photos.map((url, i) => {
          const thumb = toThumbUrl(url);
          return (
            <button
              key={i}
              onClick={() => setLightboxIndex(i)}
              className={thumbClass}
              title={`Pallet photo ${i + 1}`}
            >
              <img
                src={thumb}
                alt=""
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = url;
                }}
              />
            </button>
          );
        })}

        {onAddPhoto && (
          <button
            type="button"
            onClick={onAddPhoto}
            disabled={isAddingPhoto}
            className={`${thumbClass} flex items-center justify-center text-content/60 hover:text-accent bg-card disabled:opacity-50 border border-dashed border-subtle hover:border-accent transition-all`}
            title={photos.length === 0 ? 'Take photo' : 'Take another photo'}
            aria-label={photos.length === 0 ? 'Take photo' : 'Take another photo'}
          >
            {isAddingPhoto ? (
              <Loader2 size={compact ? 14 : 20} className="animate-spin text-accent" />
            ) : photos.length === 0 ? (
              <Camera size={compact ? 16 : 20} className="text-muted hover:text-accent" />
            ) : (
              <span
                className={
                  compact ? 'text-base font-light leading-none' : 'text-2xl font-light leading-none'
                }
              >
                +
              </span>
            )}
          </button>
        )}
      </div>

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          caption={orderNumber ? `Order #${orderNumber}` : undefined}
        />
      )}
    </div>
  );
};
