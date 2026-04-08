import React, { useRef, useState } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import { useDominantColor } from './useDominantColor';

interface PhotoHeroProps {
  photoUrl: string | null;
  isUploading: boolean;
  disabled?: boolean;
  onCapture: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

export const PhotoHero: React.FC<PhotoHeroProps> = ({
  photoUrl,
  isUploading,
  disabled,
  onCapture,
  onRemove,
}) => {
  const [showActions, setShowActions] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const dominantColor = useDominantColor(photoUrl);

  const handleTap = () => {
    if (disabled || isUploading) return;
    setShowActions(true);
  };

  const handleAction = (action: 'camera' | 'gallery' | 'remove') => {
    setShowActions(false);
    if (action === 'camera') {
      cameraInputRef.current?.click();
    } else if (action === 'gallery') {
      galleryInputRef.current?.click();
    } else if (action === 'remove') {
      onRemove();
    }
  };

  return (
    <div className="relative">
      {/* Hidden file inputs */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onCapture}
        className="hidden"
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        onChange={onCapture}
        className="hidden"
      />

      {/* Hero area */}
      <button
        type="button"
        onClick={handleTap}
        disabled={disabled || isUploading}
        className="w-full relative aspect-[4/3] md:aspect-video bg-neutral-100 dark:bg-neutral-900 overflow-hidden focus:outline-none"
      >
        {photoUrl ? (
          <>
            {/* Dynamic glow */}
            <div
              className="absolute inset-0 blur-3xl opacity-25 transition-colors duration-700"
              style={{
                background: `radial-gradient(circle at center, ${dominantColor} 0%, transparent 70%)`,
              }}
            />
            {/* Subtle directional gradient */}
            <div
              className="absolute inset-0 transition-colors duration-700"
              style={{
                background: `linear-gradient(160deg, ${dominantColor}18, transparent 60%)`,
              }}
            />
            {/* Image */}
            <img
              src={photoUrl}
              alt="Item photo"
              className="relative z-10 w-full h-full object-contain p-5"
            />
            {/* Bottom fade to main */}
            <div className="absolute inset-x-0 bottom-0 h-1/3 z-10 bg-gradient-to-t from-main/90 to-transparent" />
            {/* Hint text */}
            <span className="absolute bottom-3 left-0 right-0 z-10 text-center text-[10px] text-white/40 font-bold uppercase tracking-widest">
              Tap to change photo
            </span>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3 border-2 border-dashed border-subtle">
            <Camera size={40} className="text-muted/30" />
            <span className="text-[10px] text-muted font-bold uppercase tracking-widest">
              {disabled ? 'Enter SKU first' : 'Tap to add photo'}
            </span>
          </div>
        )}

        {/* Upload spinner overlay */}
        {isUploading && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </button>

      {/* Action sheet */}
      {showActions && (
        <>
          <div
            className="fixed inset-0 z-[60] bg-black/40"
            onClick={() => setShowActions(false)}
          />
          <div className="fixed bottom-0 inset-x-0 z-[60] p-4 pb-safe animate-in slide-in-from-bottom duration-200">
            <div className="bg-surface border border-subtle rounded-2xl overflow-hidden shadow-2xl">
              <button
                onClick={() => handleAction('camera')}
                className="w-full px-5 py-4 text-left text-sm font-bold text-content hover:bg-white/5 transition-colors border-b border-subtle"
              >
                Take Photo
              </button>
              <button
                onClick={() => handleAction('gallery')}
                className="w-full px-5 py-4 text-left text-sm font-bold text-content hover:bg-white/5 transition-colors"
              >
                Choose from Library
              </button>
              {photoUrl && (
                <button
                  onClick={() => handleAction('remove')}
                  className="w-full px-5 py-4 text-left text-sm font-bold text-red-400 hover:bg-red-500/10 transition-colors border-t border-subtle"
                >
                  Remove Photo
                </button>
              )}
            </div>
            <button
              onClick={() => setShowActions(false)}
              className="w-full mt-2 px-5 py-4 bg-surface border border-subtle rounded-2xl text-sm font-bold text-muted hover:bg-white/5 transition-colors"
            >
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
};
