import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import Camera from 'lucide-react/dist/esm/icons/camera';
import X from 'lucide-react/dist/esm/icons/x';
import Plus from 'lucide-react/dist/esm/icons/plus';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useAddFedExReturn } from '../hooks/useFedExReturns';
import { uploadReturnLabelPhoto } from '../services/returnPhotoUpload.service';

const FEDEX_TRACKING_RE = /^\d{12,15}$/;

/**
 * Given raw scan results, extract likely tracking-number candidates.
 * FedEx tracking is typically 12, 15, or 20 digits. In GS1-128 encoded
 * strings (the real FedEx barcodes) the tracking lives at the END of a
 * longer numeric string, so we extract BOTH prefix matches and suffix
 * slices. The caller prioritizes shorter/standard-length candidates.
 */
function extractCandidates(rawResults: string[]): string[] {
  const out = new Set<string>();
  for (const raw of rawResults) {
    // Suffix slices FIRST — in GS1-128 the tracking is at the end.
    // Adding these first gives them priority in the Set's insertion order.
    if (/^\d+$/.test(raw)) {
      if (raw.length >= 12) out.add(raw.slice(-12));
      if (raw.length >= 15) out.add(raw.slice(-15));
      if (raw.length >= 20) out.add(raw.slice(-20));
    }
    // Forward (from start) numeric substrings
    const forwardMatches = raw.match(/\d{20}|\d{15}|\d{12}/g);
    if (forwardMatches) forwardMatches.forEach((m) => out.add(m));
    // Raw value as-is (user might want the full encoded string)
    out.add(raw);
  }
  return Array.from(out);
}

export const IntakeBar: React.FC = () => {
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [notesOpen, setNotesOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const { scan, isScanning } = useBarcodeScanner();
  const addReturn = useAddFedExReturn();

  useEffect(() => {
    return () => {
      if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    };
  }, [photoPreviewUrl]);

  const reset = () => {
    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    setPhotoFile(null);
    setPhotoPreviewUrl(null);
    setTrackingNumber('');
    setCandidates([]);
    setNotes('');
    setNotesOpen(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
    const preview = URL.createObjectURL(file);
    setPhotoFile(file);
    setPhotoPreviewUrl(preview);

    // Auto-scan barcode
    try {
      const results = await scan(file);
      const candidateList = extractCandidates(results);
      setCandidates(candidateList);

      // Auto-pick best candidate: prefer 12-digit (standard FedEx Ground tracking)
      const best =
        candidateList.find((c) => /^\d{12}$/.test(c)) ??
        candidateList.find((c) => /^\d{15}$/.test(c)) ??
        candidateList.find((c) => /^\d+$/.test(c)) ??
        candidateList[0];

      if (best) {
        setTrackingNumber(best);
      } else {
        toast('No barcode detected — enter tracking manually', { icon: 'ℹ️' });
      }
    } catch {
      toast('Scan failed — enter tracking manually', { icon: '⚠️' });
    }
  };

  const submit = async () => {
    const tracking = trackingNumber.trim();
    if (!tracking) {
      toast.error('Tracking number is required');
      return;
    }
    if (!photoFile) {
      toast.error('Photo is required');
      return;
    }

    setIsUploading(true);
    try {
      const photoUrl = await uploadReturnLabelPhoto(tracking, photoFile);
      await addReturn.mutateAsync({
        tracking_number: tracking,
        label_photo_url: photoUrl,
        notes: notes.trim() || undefined,
      });
      toast.success('Return added to queue');
      reset();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add return';
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const showTrackingWarning =
    trackingNumber.length > 0 && !FEDEX_TRACKING_RE.test(trackingNumber.trim());
  const busy = isScanning || isUploading || addReturn.isPending;

  return (
    <div className="bg-card border border-subtle rounded-2xl p-3 mb-4 space-y-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileSelected}
        className="hidden"
      />

      {photoPreviewUrl ? (
        <div className="relative">
          <img
            src={photoPreviewUrl}
            alt="Label preview"
            className="w-full max-h-48 object-contain bg-surface rounded-xl"
          />
          <button
            onClick={reset}
            className="absolute top-2 right-2 p-1.5 bg-black/60 backdrop-blur-sm rounded-full text-white hover:bg-black/80"
            aria-label="Remove photo"
          >
            <X size={14} />
          </button>
          {isScanning && (
            <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-xl">
              <Loader2 size={24} className="animate-spin text-white" />
            </div>
          )}
        </div>
      ) : (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full bg-surface border border-dashed border-subtle rounded-xl p-6 flex flex-col items-center gap-2 text-muted hover:text-content hover:border-accent/40 transition-colors"
        >
          <Camera size={24} />
          <span className="text-sm font-medium">Scan Label</span>
        </button>
      )}

      {photoFile && (
        <>
          <div>
            <input
              type="text"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="Tracking number"
              className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent"
            />
            {showTrackingWarning && (
              <div className="flex items-center gap-1.5 mt-1.5 text-xs text-yellow-400">
                <AlertTriangle size={12} />
                <span>Unusual format (expected 12-15 digits)</span>
              </div>
            )}
            {candidates.length > 1 && (
              <div className="mt-2">
                <div className="text-[10px] text-muted uppercase tracking-widest mb-1.5">
                  Detected codes — tap to use
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((c) => {
                    const active = c === trackingNumber;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setTrackingNumber(c)}
                        className={`rounded-full px-3 py-1 text-xs font-mono transition-colors ${
                          active
                            ? 'bg-accent text-white'
                            : 'bg-surface border border-subtle text-muted hover:text-content'
                        }`}
                      >
                        {c.length > 24 ? `${c.slice(0, 22)}…` : c}
                        <span
                          className={`ml-1.5 text-[9px] ${active ? 'text-white/70' : 'text-muted/60'}`}
                        >
                          {c.length}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => setNotesOpen(!notesOpen)}
            className="flex items-center gap-1 text-xs text-muted hover:text-content"
          >
            <ChevronDown
              size={12}
              className={`transition-transform ${notesOpen ? 'rotate-180' : ''}`}
            />
            Notes
          </button>
          {notesOpen && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes"
              rows={2}
              className="w-full bg-surface border border-subtle rounded-xl px-3 py-2 text-sm text-content placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          )}

          <button
            onClick={submit}
            disabled={busy || !trackingNumber.trim()}
            className="w-full bg-accent text-white rounded-xl py-2.5 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {isUploading ? 'Uploading...' : 'Add to Queue'}
          </button>
        </>
      )}
    </div>
  );
};
