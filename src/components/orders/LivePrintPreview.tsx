/* eslint-disable react-refresh/only-export-components */
import React from 'react';
import { TransportLogo } from './TransportLogo';
import { CombinedOrderNumbers } from './CombinedOrderNumbers';

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
  /** When true, render a single info-label card regardless of palletCount and
   *  skip the "PALLET X of Y" cards. Used by the on-screen preview in
   *  OrdersScreen — operationally there's no value seeing the same label
   *  repeated N times. The PDF print path keeps the full multi-page output. */
  screenOnly?: boolean;
  /** Screen-only slot rendered next to the watcher note (e.g. in-app notes
   *  preview). Caller-composed so this component stays print/PDF-agnostic. */
  notesSlot?: React.ReactNode;
  /** Click-to-filter for a combined order — only meaningful when screenOnly;
   *  the print/PDF path never passes these, so the header stays plain text there. */
  combinedNumbers?: string[];
  activeOrderFilter?: string | null;
  onToggleOrderFilter?: (orderNumber: string) => void;
  /** Screen-only: the pallet-photo tile, at the right end of the header row
   *  (Rafael's layout, 2026-08-28) — the photo column continues below it. */
  photoTile?: React.ReactNode;
}

/** Build the BIKES/PARTS lines for labels */
function unitsLines(bikes: number, parts: number): string[] {
  const lines: string[] = [];
  if (bikes > 0) lines.push(`BIKES: ${bikes}`);
  if (parts > 0) lines.push(`PARTS: ${parts}`);
  if (lines.length === 0) lines.push('UNITS: 0');
  return lines;
}

export const LivePrintPreview: React.FC<LivePrintPreviewProps> = ({
  orderNumber,
  watcherNote,
  completedAt,
  transportCompany,
  notesSlot,
  combinedNumbers,
  activeOrderFilter,
  onToggleOrderFilter,
  photoTile,
}) => {
  const isClickableCombined = (combinedNumbers?.length ?? 0) > 1 && onToggleOrderFilter;
  return (
    <div className="w-full px-1 md:px-4 bg-transparent">
      {/* Compact horizontal header — order # + carrier on the left, date +
          note on the right — instead of a tall centered stack, so this
          block uses the full width and leaves more vertical room for the
          editable card below. */}
      <div className="w-full flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2 shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          {isClickableCombined ? (
            <h2 className="text-xl md:text-2xl font-[900] tracking-tighter uppercase truncate animate-soft-in">
              <CombinedOrderNumbers
                numbers={combinedNumbers!}
                activeOrderFilter={activeOrderFilter ?? null}
                onToggle={onToggleOrderFilter!}
                variant="header"
                full
              />
            </h2>
          ) : (
            <h2 className="text-xl md:text-2xl font-[900] text-content tracking-tighter uppercase truncate animate-soft-in">
              Order #{orderNumber}
            </h2>
          )}
          {transportCompany && (
            <div className="shrink-0 animate-soft-in hidden md:block">
              <TransportLogo company={transportCompany} height={28} plain />
            </div>
          )}
        </div>
        {/* Order on a wide screen: note · date · photo tile. On a phone the
            date stays beside the number and the note wraps to its own line
            (Rafael's two layouts, 2026-08-28). */}
        {(completedAt || (watcherNote && watcherNote.trim()) || notesSlot || photoTile) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0 flex-1 justify-end pr-8">
            {completedAt && (
              <p className="order-1 md:order-2 text-muted text-xs font-bold tracking-wide whitespace-nowrap animate-soft-in">
                {new Date(completedAt).toLocaleDateString('en-US', {
                  timeZone: 'America/New_York',
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {' · '}
                {new Date(completedAt).toLocaleTimeString('en-US', {
                  timeZone: 'America/New_York',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                })}
              </p>
            )}
            {/* When notesSlot is provided (screen-only), it already covers the
                watcher note as a clickable preview — this static duplicate
                would otherwise render the same text twice, once inert. */}
            {!notesSlot && watcherNote && watcherNote.trim() && (
              <p className="order-2 md:order-1 text-red-500 text-xs font-bold tracking-wide animate-soft-in">
                {watcherNote.trim()}
              </p>
            )}
            {notesSlot && <div className="order-2 md:order-1 min-w-0 md:mr-auto">{notesSlot}</div>}
            {photoTile && <div className="order-3 shrink-0">{photoTile}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

/** Export the units lines builder for use in PDF generation */
export { unitsLines };
