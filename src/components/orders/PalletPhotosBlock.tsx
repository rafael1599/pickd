import React, { useState } from 'react';
import { PhotoLightbox } from '../ui/PhotoLightbox';

interface PalletPhotosBlockProps {
  photos: string[];
  orderNumber?: string;
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
export const PalletPhotosBlock: React.FC<PalletPhotosBlockProps> = ({ photos, orderNumber }) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <div className="w-full px-1 md:px-4">
      <div className="flex flex-wrap gap-2 animate-soft-in">
        {photos.map((url, i) => {
          const thumb = toThumbUrl(url);
          return (
            <button
              key={i}
              onClick={() => setLightboxIndex(i)}
              className="w-20 h-20 rounded-xl overflow-hidden border border-subtle hover:border-accent transition-colors active:scale-95"
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
