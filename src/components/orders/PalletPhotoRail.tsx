/**
 * Pallet photos as a column down the card's right edge, and the one tile in
 * the header that takes another or opens them all.
 *
 * Rafael's layout of 2026-08-28: the photos leave the customer block so the
 * address fits on one line, and they stack vertically at the right — "las
 * fotos ahora crecen porque hay espacio" — one thumbnail per photo, no cap.
 * The tile (camera / "…") sits in the header row next to the date; the
 * column starts right under it inside the card, so together they read as one
 * strip. Each thumbnail opens the lightbox on its own photo.
 *
 * A photo whose reading found something wrong is **red** (Rafael, 6 Oct 2026:
 * «la alerta … también se debe ver en ship y mostrar en rojo la imagen en la
 * que se detectó»): `flags` maps a photo URL to what the reading said.
 */
import React, { useState } from 'react';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import { usePhotoOverrides } from '../../lib/photoOverrides';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Images from 'lucide-react/dist/esm/icons/images';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';

/**
 * Thumbnail URL for a full-size gallery photo:
 * `.../photos/gallery/{id}.webp` → `.../photos/gallery/thumbs/{id}.webp`.
 * blob:/data: URLs (the local-dev fallback) are returned as they are.
 */
export function toThumbUrl(url: string): string {
  if (url.startsWith('blob:') || url.startsWith('data:')) return url;
  // A rotated photo carries `?v=` (photoRotate.service): the thumb keeps it.
  const [base, query] = url.split('?');
  const thumb = base.replace(/(photos\/gallery\/)([^/]+\.webp)$/, '$1thumbs/$2');
  return query ? `${thumb}?${query}` : thumb;
}

const TILE =
  'w-11 h-11 shrink-0 rounded-xl overflow-hidden border border-subtle hover:border-accent transition-colors active:scale-95 bg-surface';

interface PalletPhotoRailProps {
  photos: string[];
  orderNumber?: string;
  className?: string;
  /** Photo URL → what its reading found (wrong pick, not in order). */
  flags?: Record<string, string[]>;
}

/** The vertical strip of thumbnails. Renders nothing without photos. */
export const PalletPhotoRail: React.FC<PalletPhotoRailProps> = ({
  photos,
  orderNumber,
  className = '',
  flags = {},
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const resolve = usePhotoOverrides();
  if (photos.length === 0) return null;
  const flagged = (url: string) => (flags[url] ?? []).length > 0;
  return (
    <div className={`flex flex-col gap-2 ${className}`} aria-label="Pallet photos">
      {photos.map((url, i) => (
        <button
          key={i}
          type="button"
          onClick={() => setLightboxIndex(i)}
          className={`${TILE} relative ${flagged(url) ? 'border-2 border-red-500 ring-2 ring-red-500/40' : ''}`}
          title={flagged(url) ? flags[url].join(' · ') : `Pallet photo ${i + 1}`}
        >
          <img
            src={resolve(toThumbUrl(url))}
            alt=""
            loading="lazy"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).src = resolve(url);
            }}
          />
          {flagged(url) && (
            <span className="absolute inset-0 bg-red-500/25 flex items-end justify-end p-0.5">
              <span className="rounded bg-red-500 px-1 text-[9px] font-black leading-tight text-white">
                !
              </span>
            </span>
          )}
        </button>
      ))}
      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={photos}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
          caption={
            [orderNumber ? `Order #${orderNumber}` : null, ...(flags[photos[lightboxIndex]] ?? [])]
              .filter(Boolean)
              .join(' · ') || undefined
          }
        />
      )}
    </div>
  );
};

interface PalletPhotoTileProps {
  photos: string[];
  orderNumber?: string;
  onAddPhoto?: () => void;
  isAddingPhoto?: boolean;
  className?: string;
}

/**
 * The header tile: with no photos a single tap takes one; with photos it
 * opens a two-item menu — take another, or view them all in the lightbox.
 */
export const PalletPhotoTile: React.FC<PalletPhotoTileProps> = ({
  photos,
  orderNumber,
  onAddPhoto,
  isAddingPhoto = false,
  className = '',
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (photos.length === 0 && !onAddPhoto) return null;
  const direct = photos.length === 0 && onAddPhoto;
  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => (direct ? onAddPhoto?.() : setMenuOpen((v) => !v))}
        disabled={isAddingPhoto}
        className={`${TILE} flex items-center justify-center text-content/70 hover:text-accent bg-card disabled:opacity-50 border-dashed`}
        title={direct ? 'Take pallet photo' : 'Photo actions'}
        aria-label={direct ? 'Take pallet photo' : 'Photo actions'}
        aria-haspopup={direct ? undefined : 'menu'}
        aria-expanded={direct ? undefined : menuOpen}
      >
        {isAddingPhoto ? (
          <Loader2 size={16} className="animate-spin text-accent" />
        ) : direct ? (
          <Camera size={16} />
        ) : (
          <MoreHorizontal size={16} />
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
              Take another photo
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
