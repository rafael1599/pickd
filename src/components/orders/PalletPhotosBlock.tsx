import React, { useState } from 'react';
import { PhotoLightbox } from '../ui/PhotoLightbox';

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
 * Falls back to the original URL when the pattern doesn't match.
 */
function toThumbUrl(url: string): string {
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

  if (photos.length === 0) return null;

  const wrapperClass = compact
    ? `w-full h-full flex items-start justify-center ${className}`
    : `w-full px-1 md:px-4 ${className}`;
  const gridClass = compact
    ? `grid gap-1 animate-soft-in w-full ${
        photos.length === 1
          ? 'grid-cols-1 max-w-[5.5rem]'
          : photos.length === 2
            ? 'grid-cols-1 max-w-[5.5rem]'
            : photos.length === 3
              ? 'grid-cols-2 max-w-[6rem]'
              : 'grid-cols-2 max-w-[6.5rem]'
      }`
    : 'flex flex-wrap gap-2 animate-soft-in';
  const thumbClass = compact
    ? 'w-full aspect-square rounded-2xl overflow-hidden border border-subtle hover:border-accent transition-colors active:scale-95 bg-surface'
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
            className={`${thumbClass} flex items-center justify-center text-content/60 hover:text-accent bg-card disabled:opacity-50`}
            title="Take another photo"
            aria-label="Take another photo"
          >
            <span className="text-2xl font-light leading-none">+</span>
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
