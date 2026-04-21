/**
 * Shared PDF design tokens + helpers used by activity-report and
 * per-project PDF documents. Keeps visual language consistent across
 * every report produced by the app.
 */

export const A4 = { w: 595, h: 842 };
export const A4_MARGIN = 36;

export const TONE = {
  paperWarm: '#FAF8F5',
  paperPure: '#FFFFFF',
  ink: '#111111',
  ink2: '#3A3A3A',
  muted: '#6B6B6B',
  mute2: '#8A8A8A',
  hair: '#E6E4DE',
  teal: '#0E8C6B',
  tealSoft: '#E8F3EE',
  tealDeep: '#0A6B52',
  amber: '#B8761F',
  amberSoft: '#FAEFD9',
};

export const SANS = 'Inter';
export const MONO = 'JetBrains Mono';

export function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateShort(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    .toUpperCase();
}

/** Pick photo-grid column count so the tiles stay roughly square. */
export function pickCols(totalPhotos: number): number {
  if (totalPhotos <= 2) return 2;
  if (totalPhotos <= 8) return 3;
  if (totalPhotos <= 16) return 4;
  return 5;
}
