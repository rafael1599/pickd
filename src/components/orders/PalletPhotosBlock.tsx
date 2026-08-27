import React, { useState } from 'react';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Images from 'lucide-react/dist/esm/icons/images';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';

/** Thumbnails shown inline before the actions tile takes over (idea-163). */
const MAX_INLINE_PHOTOS = 2;

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
  const [menuOpen, setMenuOpen] = useState(false);

  if (photos.length === 0 && !onAddPhoto) return null;

  // Two thumbnails at most; everything else — take another, see them all —
  // lives behind one actions tile so the header stays one row (idea-163).
  const inlinePhotos = photos.slice(0, MAX_INLINE_PHOTOS);
  const hiddenCount = photos.length - inlinePhotos.length;
  const showActions = !!onAddPhoto || hiddenCount > 0;

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
      <div className={`${gridClass} relative`}>
        {inlinePhotos.map((url, i) => {
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

        {showActions && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              disabled={isAddingPhoto}
              className={`${thumbClass} flex items-center justify-center text-content/70 hover:text-accent bg-card disabled:opacity-50 border border-dashed border-subtle hover:border-accent transition-all`}
              title="Photo actions"
              aria-label="Photo actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              {isAddingPhoto ? (
                <Loader2 size={compact ? 14 : 20} className="animate-spin text-accent" />
              ) : hiddenCount > 0 ? (
                <span className={compact ? 'text-[11px] font-black' : 'text-sm font-black'}>
                  +{hiddenCount}
                </span>
              ) : photos.length === 0 ? (
                <Camera size={compact ? 16 : 20} />
              ) : (
                <MoreHorizontal size={compact ? 16 : 20} />
              )}
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 z-30 min-w-[11rem] rounded-xl border border-subtle bg-surface shadow-xl p-1 animate-soft-in"
              >
                {onAddPhoto && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onAddPhoto();
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs font-bold text-content hover:bg-card"
                  >
                    <Camera size={14} className="text-accent" />
                    {photos.length === 0 ? 'Take photo' : 'Take another photo'}
                  </button>
                )}
                {photos.length > 0 && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setLightboxIndex(0);
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-xs font-bold text-content hover:bg-card"
                  >
                    <Images size={14} className="text-accent" />
                    View all ({photos.length})
                  </button>
                )}
              </div>
            )}
          </div>
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
