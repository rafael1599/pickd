/**
 * The cartons in this order that FedEx does not have the current measurement
 * for -- and the place to fix that without leaving the order.
 *
 * It is a form rather than a notice because of where it sits. This is the last
 * screen where the box is physically in front of someone; sending them to the
 * item screen to type three numbers means putting the box down, losing the
 * order, and usually not coming back. The measuring tape is already in hand.
 *
 * Two states, because they need two different people. `unmeasured` is work for
 * whoever is standing here. `pending_export` is measured already and waiting on
 * an admin to run the Dimensions export and import it -- nothing the operator
 * can do, but still a carton FedEx is quoting wrong, so it says so quietly
 * rather than disappearing.
 */
import { useState } from 'react';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Check from 'lucide-react/dist/esm/icons/check';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import toast from 'react-hot-toast';
import { ManualLinkButton } from '../../../components/manuals/ManualLinkButton';
import {
  FEDEX_CARTON_GAP_LABELS,
  sidesToColumns,
  type FedexCartonGap,
  type FedexCartonState,
} from '../../../utils/fedexCarton';
import {
  draftColumns,
  draftProblem,
  draftSides,
  DRAFT_SIDES,
  EMPTY_CARTON_DRAFT,
  type CartonDraft,
} from '../utils/cartonDraft';
import { useUpdateCartonDimensions } from '../hooks/useUpdateCartonDimensions';

/** A cart SKU FedEx does not have the current carton for. */
export interface UnratedCarton {
  sku: string;
  model: string | null;
  size: string | null;
  state: Exclude<FedexCartonState, 'synced'>;
  /** Why it cannot be exported, when that is the problem. */
  gap: FedexCartonGap | null;
  /** What the row holds today, so the operator can see what they are replacing. */
  stored: { length: number | null; width: number | null; height: number | null };
}

interface UnratedCartonsBannerProps {
  cartons: UnratedCarton[];
  /**
   * Called when a SKU has been measured, so the row can move to pending.
   *
   * It carries the saved sides, not just the SKU. The parent owns the list and
   * would otherwise keep rendering the numbers the save just replaced — which
   * reads as the save not having worked, on the one line whose whole job is to
   * say what FedEx is missing.
   */
  onMeasured: (sku: string, stored: UnratedCarton['stored']) => void;
}

const describeCarton = (c: UnratedCarton) =>
  [c.model, c.size].filter(Boolean).join(' ') || 'no model on the record';

/** Longest x middle x edge -- the order a person reads a box in. */
const formatStored = (s: UnratedCarton['stored']) =>
  s.length == null || s.width == null || s.height == null
    ? null
    : `${s.length} × ${s.height} × ${s.width}`;

export const UnratedCartonsBanner: React.FC<UnratedCartonsBannerProps> = ({
  cartons,
  onMeasured,
}) => {
  const [drafts, setDrafts] = useState<Record<string, CartonDraft>>({});
  const [pendingSku, setPendingSku] = useState<string | null>(null);
  const update = useUpdateCartonDimensions();

  if (cartons.length === 0) return null;

  const toMeasure = cartons.filter((c) => c.state === 'unmeasured');
  const waiting = cartons.filter((c) => c.state === 'pending_export');

  const draftFor = (sku: string) => drafts[sku] ?? EMPTY_CARTON_DRAFT;

  const setSide = (sku: string, key: keyof CartonDraft, value: string) =>
    setDrafts((d) => ({ ...d, [sku]: { ...(d[sku] ?? EMPTY_CARTON_DRAFT), [key]: value } }));

  const save = async (carton: UnratedCarton) => {
    const draft = draftFor(carton.sku);
    const sides = draftSides(draft);
    if (!sides || draftProblem(draft)) return;
    setPendingSku(carton.sku);
    // Same pure sort the mutation applies, so the row shows the columns the
    // save wrote rather than the order the tape happened to go round.
    const columns = sidesToColumns(sides);
    try {
      await update.mutateAsync({ sku: carton.sku, sides });
      toast.success(`${carton.sku} measured`);
      onMeasured(carton.sku, {
        length: columns.length_in,
        width: columns.width_in,
        height: columns.height_in,
      });
    } catch {
      // useUpdateCartonDimensions already surfaced it; the row stays editable so
      // the numbers just read off the tape are not thrown away.
    } finally {
      setPendingSku(null);
    }
  };

  return (
    <div className="mb-4 p-4 bg-amber-500/5 border border-amber-500/20 rounded-2xl flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
        <AlertCircle size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-black text-amber-500/80 uppercase tracking-widest mb-1">
          FedEx does not have {cartons.length > 1 ? 'these cartons' : 'this carton'}
        </p>

        {toMeasure.length > 0 && (
          <>
            <p className="text-[11px] font-medium text-muted mb-3 leading-relaxed">
              Ship Manager has no dimensions for {toMeasure.length > 1 ? 'these boxes' : 'this box'}
              , so the rate is whatever gets typed in by hand. Measure it and enter the three sides
              in <span className="font-black text-content">any order</span> — Pickd works out which
              is which.
            </p>
            <ul className="space-y-2">
              {toMeasure.map((carton) => {
                const draft = draftFor(carton.sku);
                const problem = draftProblem(draft);
                const preview = draftColumns(draft);
                const stored = formatStored(carton.stored);
                const busy = pendingSku === carton.sku;

                return (
                  <li
                    key={carton.sku}
                    className="p-3 rounded-xl border border-subtle bg-surface/40"
                  >
                    <p className="text-sm font-medium text-content">
                      <span className="font-black">{carton.sku}</span>{' '}
                      <span className="text-muted">{describeCarton(carton)}</span>
                      {carton.gap && carton.gap !== 'unverified' && (
                        <span className="text-amber-500/80">
                          {' '}
                          · {FEDEX_CARTON_GAP_LABELS[carton.gap]}
                        </span>
                      )}
                    </p>
                    {stored && (
                      <p className="text-[10px] font-mono text-muted/70 mt-0.5">now {stored}</p>
                    )}

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {DRAFT_SIDES.map((key, i) => (
                        <div key={key} className="flex items-center gap-2">
                          {i > 0 && <span className="text-muted text-xs">×</span>}
                          <input
                            type="number"
                            step="0.25"
                            min="0"
                            inputMode="decimal"
                            value={draft[key]}
                            onChange={(e) => setSide(carton.sku, key, e.target.value)}
                            disabled={busy}
                            aria-label={`Side ${i + 1} of ${carton.sku}, in inches`}
                            className="w-16 py-1.5 rounded-lg bg-card border border-subtle text-center text-sm font-mono font-semibold text-content focus:outline-none focus:border-amber-500 disabled:opacity-50"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => save(carton)}
                        disabled={problem !== null || busy}
                        className="h-[34px] px-3 rounded-lg bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-500 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                      >
                        {busy && <Loader2 size={12} className="animate-spin" />}
                        Update
                      </button>
                    </div>

                    {/*
                      With the ordering check gone, this echo is what catches a
                      typo: "875 long" is visibly not a bike box, where a
                      silently sorted 875 would not be.
                    */}
                    {preview && !problem && (
                      <p className="text-[11px] font-medium text-muted mt-1.5">
                        Saves as{' '}
                        <span className="font-mono font-bold text-content">
                          {preview.length_in}
                        </span>{' '}
                        long ×{' '}
                        <span className="font-mono font-bold text-content">
                          {preview.height_in}
                        </span>{' '}
                        ×{' '}
                        <span className="font-mono font-bold text-content">{preview.width_in}</span>{' '}
                        edge
                      </p>
                    )}
                    {problem && problem !== 'incomplete' && (
                      <p className="text-[11px] font-bold text-rose-400 mt-1.5">
                        {FEDEX_CARTON_GAP_LABELS[problem]}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {waiting.length > 0 && (
          <div className={toMeasure.length > 0 ? 'mt-3 pt-3 border-t border-subtle' : ''}>
            <p className="text-[11px] font-medium text-muted mb-2 leading-relaxed flex items-start gap-1.5">
              <Clock size={13} className="text-muted/70 shrink-0 mt-0.5" />
              <span>
                Measured in Pickd, but no dimensions export has run since. Ship Manager keeps the
                old carton until someone exports the file and imports it.
              </span>
            </p>
            <ul className="space-y-1 mb-2">
              {waiting.map((carton) => (
                <li key={carton.sku} className="text-sm font-medium text-content">
                  <Check size={12} className="inline text-emerald-400 mr-1" />
                  <span className="font-black">{carton.sku}</span>{' '}
                  <span className="text-muted">{describeCarton(carton)}</span>{' '}
                  <span className="font-mono text-muted/80">{formatStored(carton.stored)}</span>
                </li>
              ))}
            </ul>
            <ManualLinkButton
              slug="fedex-dimensions-import"
              label="How to send these to FedEx"
              tone="amber"
            />
          </div>
        )}
      </div>
    </div>
  );
};
