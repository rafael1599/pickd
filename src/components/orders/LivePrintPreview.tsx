import React, { useState } from 'react';
import { PhotoLightbox } from '../ui/PhotoLightbox';
import { TransportLogo } from './TransportLogo';

export const TRANSPORT_COLORS: Record<string, { bg: string; text: string }> = {
  'R+L': { bg: '#006647', text: '#FFFFFF' },
  '2-DAY': { bg: '#003366', text: '#FFFFFF' },
  RIST: { bg: '#8B2500', text: '#FFFFFF' },
  TFORCE: { bg: '#0053A1', text: '#FFFFFF' },
  DAYLIGHT: { bg: '#006BB7', text: '#FFFFFF' },
  'PAV EXPRESS': { bg: '#6B6B6B', text: '#FFD200' },
  ESTES: { bg: '#FFD200', text: '#000000' },
};

interface LivePrintPreviewProps {
  orderNumber?: string;
  /** Watcher-origin order note (AS400 Order Comments); shown in red, screen-only. */
  watcherNote?: string | null;
  customerName: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  pallets: number | string;
  bikeCount: number;
  partCount: number;
  loadNumber: string;
  totalWeight: number;
  completedAt?: string;
  transportCompany?: string;
  palletPhotos?: string[];
  /** When true, render a single info-label card regardless of palletCount and
   *  skip the "PALLET X of Y" cards. Used by the on-screen preview in
   *  OrdersScreen — operationally there's no value seeing the same label
   *  repeated N times. The PDF print path keeps the full multi-page output. */
  screenOnly?: boolean;
}

/** Build the BIKES/PARTS lines for labels */
function unitsLines(bikes: number, parts: number): string[] {
  const lines: string[] = [];
  if (bikes > 0) lines.push(`BIKES: ${bikes}`);
  if (parts > 0) lines.push(`PARTS: ${parts}`);
  if (lines.length === 0) lines.push('UNITS: 0');
  return lines;
}

/**
 * Derives a thumbnail URL from a full-size gallery photo URL.
 * Pattern: `.../photos/gallery/{id}.webp` → `.../photos/gallery/thumbs/{id}.webp`
 * Falls back to the original URL when the pattern doesn't match.
 */
function toThumbUrl(url: string): string {
  return url.replace(/(photos\/gallery\/)([^/]+\.webp)$/, '$1thumbs/$2');
}

export const LivePrintPreview: React.FC<LivePrintPreviewProps> = ({
  orderNumber,
  watcherNote,
  completedAt,
  transportCompany,
  palletPhotos,
}) => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const photos = palletPhotos ?? [];

  return (
    <div className="flex flex-col items-center w-full min-h-full pt-8 px-1 md:px-4 bg-transparent">
      {/* Pallet photos above the title — grid uses thumbnails for bandwidth savings */}
      {photos.length > 0 && (
        <div className="w-full mb-4 flex flex-wrap justify-center gap-2 shrink-0 animate-soft-in">
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
      )}

      <div className="w-full mb-8 text-center shrink-0">
        <h2 className="text-3xl md:text-5xl font-[900] text-content tracking-tighter uppercase animate-soft-in">
          Order #{orderNumber}
        </h2>
        {/* Carrier logo — large, prominent display below order number */}
        {transportCompany && (
          <div className="mt-4 flex justify-center">
            <TransportLogo company={transportCompany} height={120} plain />
          </div>
        )}
        {completedAt && (
          <p className="text-muted text-sm font-bold mt-2 tracking-wide animate-soft-in">
            {new Date(completedAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
            {' · '}
            {new Date(completedAt).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </p>
        )}
        {watcherNote && watcherNote.trim() && (
          <p className="text-red-500 text-sm font-bold mt-1 tracking-wide animate-soft-in">
            {watcherNote.trim()}
          </p>
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

/** Export the units lines builder for use in PDF generation */
export { unitsLines };
