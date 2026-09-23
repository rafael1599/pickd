/**
 * Register a batch of cartons by photographing their labels (idea-224).
 *
 * PRD: docs/prds/inventory-batch-label-intake.md. One gesture: shoot every label
 * with the camera open, close it, check the pile card by card, send once. One
 * switch (BIKES), one location (RETURN TO STOCK by default), one button.
 *
 * The labels are read after the camera closes, one at a time — see
 * `useLabelBatch` for why. A card exists before it is read (READING, same
 * height) and never moves once it is there: the pile keeps the shot order.
 */
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import { CameraCaptureSheet } from '../../components/ui/CameraCaptureSheet';
import AutocompleteInput from '../../components/ui/AutocompleteInput';
import { useLocationManagement } from './hooks/useLocationManagement';
import { useLabelBatch } from './hooks/useLabelBatch';
import { LabelBatchCard } from './components/LabelBatchCard';
import { sendLabel } from './utils/labelBatch';

const WAREHOUSE = 'LUDLOW';

const Figure: React.FC<{ value: number; label: string }> = ({ value, label }) => (
  <div className="text-center">
    <p className="text-2xl font-black leading-none text-content">{value}</p>
    <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted">{label}</p>
  </div>
);

export const LabelBatchScreen: React.FC = () => {
  const navigate = useNavigate();
  const batch = useLabelBatch(WAREHOUSE);
  const { state, dispatch, summary, thumbnails } = batch;
  const { locations } = useLocationManagement();
  const [locationText, setLocationText] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const locationNames = useMemo(
    () =>
      Array.from(
        new Set(
          (locations ?? [])
            .filter((l) => l.warehouse === WAREHOUSE)
            .map((l) => (l.location || '').toUpperCase())
            .filter(Boolean)
        )
      ),
    [locations]
  );
  const locationSuggestions = useMemo(
    () => locationNames.map((value) => ({ value })),
    [locationNames]
  );

  // Only a location that exists: resolve_location creates any name it is given,
  // so a typo would send twelve cartons to a place nobody can find.
  const commitLocation = (value: string) => {
    const name = value.trim().toUpperCase();
    if (locationNames.includes(name)) dispatch({ type: 'locationSet', location: name });
    setLocationText(null);
  };

  // Photos not read yet have no card; they wait at the bottom, card-sized.
  const pending = state.photos.filter((p) => p.status === 'queued' || p.status === 'reading');
  const label = sendLabel(summary, state.location);
  const isEmpty = state.cards.length === 0 && pending.length === 0;

  return (
    <div className="min-h-screen bg-main">
      <div className="sticky top-0 z-10 border-b border-subtle bg-surface px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/')}
              aria-label="Back to stock"
              className="-ml-2 rounded-full p-2 text-muted active:scale-90"
            >
              <ArrowLeft size={20} />
            </button>
            <h1 className="text-sm font-black uppercase tracking-widest text-content">Batch</h1>
          </div>
          <div className="flex items-center gap-3">
            {!isEmpty && (
              <button
                onClick={() => {
                  if (confirmDiscard) {
                    batch.discard();
                    setConfirmDiscard(false);
                  } else {
                    setConfirmDiscard(true);
                    setTimeout(() => setConfirmDiscard(false), 3000);
                  }
                }}
                className={`text-[11px] font-black uppercase tracking-widest ${confirmDiscard ? 'text-red-400' : 'text-muted'}`}
              >
                {confirmDiscard ? 'Tap again to discard' : 'Discard'}
              </button>
            )}
            <button
              onClick={() => dispatch({ type: 'bikesToggled' })}
              role="switch"
              aria-checked={state.bikes}
              className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-content"
            >
              {state.bikes ? 'Bikes' : 'Parts'}
              <span
                className={`relative h-5 w-9 rounded-full transition-colors ${state.bikes ? 'bg-accent' : 'bg-card border border-subtle'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${state.bikes ? 'left-[18px]' : 'left-0.5'}`}
                />
              </span>
            </button>
          </div>
        </div>

        <div className="mt-3">
          <AutocompleteInput
            id="batch_location"
            value={locationText ?? state.location}
            onChange={(v: string) => setLocationText(v.toUpperCase())}
            onSelect={(s) => commitLocation(s.value)}
            onBlur={(v: string) => commitLocation(v)}
            suggestions={locationSuggestions}
            placeholder="Location"
            minChars={1}
            className="w-full rounded-xl border border-subtle bg-card px-3 py-2.5 text-sm font-black uppercase text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>

        <div className="mt-3 grid grid-cols-3">
          <Figure value={summary.skus} label="SKUs" />
          <Figure value={summary.units} label="Units" />
          <Figure value={summary.newSkus} label="New" />
        </div>
      </div>

      <div className="space-y-2 px-4 pb-56 pt-3">
        {isEmpty ? (
          <div className="flex flex-col items-center gap-4 py-16">
            <p className="text-2xl font-black text-content">0</p>
            <p className="-mt-3 text-[10px] font-bold uppercase tracking-widest text-muted">
              Photos
            </p>
            <button
              onClick={() => batch.setCameraOpen(true)}
              className="rounded-full bg-accent px-6 py-3 text-xs font-black uppercase tracking-widest text-black active:scale-95"
            >
              Open the camera
            </button>
          </div>
        ) : (
          <>
            {state.cards.map((card) => (
              <LabelBatchCard
                key={card.id}
                card={card}
                photos={state.photos}
                thumbnails={thumbnails}
                bikes={state.bikes}
                dispatch={dispatch}
                onRemovePhoto={batch.removePhoto}
                onRemoveCard={batch.removeCard}
              />
            ))}
            {pending.map((photo) => (
              <div
                key={photo.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-subtle bg-card p-3"
              >
                <div className="flex items-center gap-3">
                  {thumbnails[photo.id] ? (
                    <img
                      src={thumbnails[photo.id]}
                      alt=""
                      className="h-12 w-12 rounded-lg border border-subtle object-cover"
                    />
                  ) : (
                    <div className="h-12 w-12 rounded-lg border border-subtle bg-surface" />
                  )}
                  <div className="space-y-1.5">
                    <div className="h-3 w-24 rounded bg-surface" />
                    <div className="h-2.5 w-40 rounded bg-surface" />
                  </div>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted">
                  {photo.status === 'reading' && <Loader2 size={12} className="animate-spin" />}
                  {photo.status === 'reading' ? 'Reading' : batch.cameraOpen ? 'Waiting' : 'Queued'}
                </div>
              </div>
            ))}
            <button
              onClick={() => dispatch({ type: 'cardAddedByHand', cardId: crypto.randomUUID() })}
              className="flex w-full items-center justify-center gap-1.5 py-3 text-[11px] font-black uppercase tracking-widest text-muted active:scale-95"
            >
              <Plus size={14} /> By hand
            </button>
          </>
        )}
      </div>

      {!isEmpty && (
        <div className="fixed bottom-0 left-0 right-0 z-[110] border-t border-subtle bg-surface px-4 pb-28 pt-3">
          {batch.sendError && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2">
              <p className="min-w-0 text-[11px] font-bold text-red-400">
                Nothing was written · {batch.sendError}
              </p>
              <button
                onClick={() => void batch.send()}
                className="flex shrink-0 items-center gap-1 text-[11px] font-black uppercase text-content active:scale-95"
              >
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => batch.setCameraOpen(true)}
              aria-label="Keep shooting"
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-subtle bg-card text-content active:scale-95"
            >
              <Camera size={20} />
            </button>
            <button
              onClick={() => void batch.send()}
              disabled={!summary.canSend || batch.sending}
              className="h-12 min-w-0 flex-1 truncate rounded-full bg-accent px-4 text-xs font-black uppercase tracking-widest text-black active:scale-95 disabled:bg-card disabled:text-muted"
            >
              {batch.sending ? 'Sending…' : label}
            </button>
          </div>
        </div>
      )}

      {batch.cameraOpen && (
        <CameraCaptureSheet
          count={state.photos.length}
          onCapture={batch.addPhoto}
          onClose={() => batch.setCameraOpen(false)}
        />
      )}
    </div>
  );
};
