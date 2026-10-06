import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import X from 'lucide-react/dist/esm/icons/x';
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { canRotatePhoto, rotatePhoto } from '../../services/photoRotate.service';
import { usePhotoOverrides } from '../../lib/photoOverrides';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

interface PhotoLightboxProps {
  photos: string[]; // full-size URLs
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  caption?: string;
  /** Buttons for the photo on screen (top left), e.g. Delete on the item card. */
  toolbar?: React.ReactNode;
}

/**
 * The one fullscreen photo viewer: item card, pallets, orders, Double Check,
 * Projects, FedEx labels. A view adds its own buttons through `toolbar`
 * instead of copying this. z-[110]: above the bottom nav (ui-rules).
 *
 * ↻ turns the photo 90° and saves it that way for everyone (Rafael, 6 Oct
 * 2026), on the same R2 key with a new version (`photoRotate.service.ts`).
 */
export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  index,
  onClose,
  onIndexChange,
  caption,
  toolbar,
}) => {
  const resolve = usePhotoOverrides();
  const [rotating, setRotating] = useState(false);
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
  const shown = resolve(photos[index]);
  const turn = async () => {
    if (rotating) return;
    setRotating(true);
    try {
      await rotatePhoto(shown, 1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not rotate the photo');
    } finally {
      setRotating(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] bg-black/95 flex items-center justify-center"
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

      {canRotatePhoto(shown) && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void turn();
          }}
          disabled={rotating}
          aria-label="Rotate photo"
          title="Rotate 90° (saved for everyone)"
          className="absolute top-4 right-16 p-2 text-white/70 hover:text-white z-10 disabled:opacity-50"
        >
          {rotating ? <Loader2 size={24} className="animate-spin" /> : <RotateCw size={24} />}
        </button>
      )}

      {toolbar && (
        <div className="absolute top-4 left-4 z-10 flex gap-2" onClick={(e) => e.stopPropagation()}>
          {toolbar}
        </div>
      )}

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
        src={shown}
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
