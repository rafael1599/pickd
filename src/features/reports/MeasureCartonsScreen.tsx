/**
 * /export/measure -- the bike boxes worth putting a tape measure on, most
 * ordered first.
 *
 * The Dimensions export already lists every SKU FedEx has no carton for. What
 * it could not say is which one matters: 154 unmeasured boxes look identical in
 * a table, and the one ordered ninety times since January is mis-rated every
 * week while the one ordered once is a walk across the building for nothing.
 * So this is the same list, ordered by demand, with the form to fix it on the
 * card -- the same shape as Double Check, because it is the same job: work down
 * a list with the thing physically in front of you.
 *
 * A measured card stays where it is, green, showing what was saved. Dropping it
 * out of the list would shift every row under the operator's thumb mid-scroll,
 * and would take away the only confirmation that the three numbers landed.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import ArrowLeftRight from 'lucide-react/dist/esm/icons/arrow-left-right';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Ruler from 'lucide-react/dist/esm/icons/ruler';
import Upload from 'lucide-react/dist/esm/icons/upload';
import toast from 'react-hot-toast';
import { SearchInput } from '../../components/ui/SearchInput';
import { useDebounce } from '../../hooks/useDebounce';
import {
  fedexCartonGap,
  FEDEX_CARTON_GAP_LABELS,
  sidesToColumns,
} from '../../utils/fedexCarton';
import { useUpdateCartonDimensions } from '../picking/hooks/useUpdateCartonDimensions';
import {
  draftColumns,
  DRAFT_SIDES,
  EMPTY_CARTON_DRAFT,
  type CartonDraft,
} from '../picking/utils/cartonDraft';
import {
  MEASURE_QUEUE_MIN_STOCK,
  MEASURE_QUEUE_MONTHS,
  useMeasureQueue,
} from './hooks/useMeasureQueue';
import { describeBike, formatAddress, matchesQuery, type MeasureQueueEntry } from './utils/measureQueue';
import { lbsToUnit, planBoxSave, weightToLbs, type WeightUnit } from './utils/boxDraft';

/** The three columns a save writes when a tape measure was involved. */
interface SavedSides {
  length_in: number;
  width_in: number;
  height_in: number;
}

/**
 * What this screen has written for a SKU so far.
 *
 * Sides and weight are separate because either can be taken without the other:
 * a scale and no tape measure is still a trip worth making, and the queue's
 * "to measure" count means cartons FedEx can rate -- which is the sides.
 */
interface SavedBox {
  sides?: SavedSides;
  weightLbs?: number;
}


/** Longest × middle × edge -- the order a person reads a box in. */
const readOut = (s: { length_in: number | null; width_in: number | null; height_in: number | null }) =>
  s.length_in == null || s.width_in == null || s.height_in == null
    ? null
    : `${s.length_in} × ${s.height_in} × ${s.width_in}`;

/** R2 serves a thumbnail beside every full-size image; the card only needs that. */
function thumbUrl(url: string): string {
  if (url.includes('/catalog/')) {
    return url.replace('/catalog/', '/catalog/thumbs/').replace('.png', '.webp');
  }
  if (url.includes('/photos/')) return url.replace('/photos/', '/photos/thumbs/');
  return url;
}

/**
 * The weight unit is one choice for the whole screen, not one per card: it is a
 * property of the scale on the bench, and somebody working a queue of 154 boxes
 * should not re-pick it 154 times. Remembered, because the scale does not change
 * between visits either.
 */
const WEIGHT_UNIT_KEY = 'pickd.measure.weightUnit';

function readStoredUnit(): WeightUnit {
  try {
    return localStorage.getItem(WEIGHT_UNIT_KEY) === 'kg' ? 'kg' : 'lbs';
  } catch {
    return 'lbs';
  }
}

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;

function MeasureCard({
  entry,
  saved,
  unit,
  onToggleUnit,
  onSaved,
}: {
  entry: MeasureQueueEntry;
  saved: SavedBox | undefined;
  unit: WeightUnit;
  onToggleUnit: () => void;
  onSaved: (sku: string, saved: SavedBox) => void;
}) {
  const [draft, setDraft] = useState<CartonDraft>(EMPTY_CARTON_DRAFT);
  const [weightInput, setWeightInput] = useState('');
  const update = useUpdateCartonDimensions();
  const busy = update.isPending && update.variables?.sku === entry.sku;

  const preview = draftColumns(draft);
  const stored = readOut(entry);
  const address = formatAddress(entry);

  const savedSides = saved?.sides;
  const savedWeight = saved?.weightLbs;
  // Only the sides settle whether FedEx can rate this box, so only they close
  // the card. A weight taken on its own is confirmed in place and the form
  // stays open for the tape measure.
  const isDone = savedSides !== undefined;

  const currentLbs = savedWeight ?? entry.weight_lbs;
  // A fact off the row, not a guess from the number: `weight_verified` is false
  // on 241 of the 264 bikes on hand, which is the trigger's 45 lbs and not
  // anything a scale said.
  const weightIsDefault = savedWeight === undefined && !entry.weight_verified;
  const typedLbs = weightToLbs(weightInput, unit);
  const plan = planBoxSave(draft, weightInput, unit, currentLbs);

  // Three numbers are not always enough. A row with no model still cannot be
  // named in the FSM record, so measuring it leaves it held back -- and telling
  // the operator "FedEx gets it on the next export" would be the same quiet lie
  // the export's exceptions list exists to prevent. Two SKUs in prod, but it is
  // the class that matters: the same rule decides, after the save as before it.
  const remainingGap = savedSides
    ? fedexCartonGap({ model: entry.model, ...savedSides, dimensions_verified: true })
    : null;

  const save = async () => {
    if (plan.blocked) return;
    try {
      await update.mutateAsync({
        sku: entry.sku,
        ...(plan.sides ? { sides: plan.sides } : {}),
        ...(plan.weightLbs !== null ? { weightLbs: plan.weightLbs } : {}),
      });
      const sides = plan.sides ? sidesToColumns(plan.sides) : undefined;
      toast.success(
        sides ? `${entry.sku} measured` : `${entry.sku} weighed — ${plan.weightLbs} lbs`
      );
      onSaved(entry.sku, {
        ...(sides ? { sides } : {}),
        ...(plan.weightLbs !== null ? { weightLbs: plan.weightLbs } : {}),
      });
      setWeightInput('');
    } catch {
      // useUpdateCartonDimensions already surfaced it, and the draft stays put
      // so the numbers just read off the tape are not thrown away.
    }
  };

  return (
    <li
      className={`relative rounded-2xl border p-3 transition-colors ${
        !isDone
          ? 'bg-card border-subtle'
          : remainingGap
            ? 'bg-amber-500/5 border-amber-500/30'
            : 'bg-green-500/10 border-green-500/30'
      }`}
    >
      <div className="flex items-start gap-3 min-w-0">
        {/* The reason this card is here, and the biggest number on it. */}
        <div className="flex flex-col items-center justify-center shrink-0 border-r border-subtle pr-3 min-w-[3rem]">
          <span className="text-[9px] font-black uppercase tracking-widest text-muted/50 leading-none">
            #{entry.rank}
          </span>
          <span
            className={`text-4xl font-black leading-none tabular-nums ${
              isDone ? 'text-muted' : 'text-content'
            }`}
          >
            {entry.orders}
          </span>
          <span className="text-[9px] font-black uppercase tracking-widest text-muted/60 mt-0.5">
            Orders
          </span>
        </div>

        {entry.image_url && (
          <img
            src={thumbUrl(entry.image_url)}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
            className="w-11 h-11 object-contain rounded border border-subtle shrink-0"
          />
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`font-black text-lg tracking-tight leading-none ${
                isDone && !remainingGap ? 'text-green-400' : 'text-content'
              }`}
            >
              {entry.sku}
            </span>
            {isDone && !remainingGap && <Check size={16} className="text-green-400" />}
          </div>
          <p className="text-xs font-medium text-muted mt-0.5 truncate">{describeBike(entry)}</p>

          <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-[11px] font-medium text-muted">
            {address && (
              <span className="inline-flex items-center gap-1 text-content">
                <MapPin size={11} className="text-muted" />
                {address}
              </span>
            )}
            <span className="tabular-nums">{entry.stock} in stock</span>
            <span className="tabular-nums">{entry.units} units shipped</span>
            {shortDate(entry.last_ordered) && <span>last {shortDate(entry.last_ordered)}</span>}
          </div>
        </div>
      </div>

      <div className="mt-2.5 pt-2.5 border-t border-subtle">
        {isDone ? (
          remainingGap ? (
            <p className="text-xs font-medium text-amber-400/90">
              Saved as <span className="font-mono font-black">{readOut(savedSides)}</span>
              {savedWeight !== undefined && (
                <span className="font-mono font-black"> · {savedWeight} lbs</span>
              )}{' '}
              — still held back: {FEDEX_CARTON_GAP_LABELS[remainingGap].toLowerCase()}.
            </p>
          ) : (
            <p className="text-xs font-medium text-green-400/90">
              Saved as <span className="font-mono font-black">{readOut(savedSides)}</span>
              {savedWeight !== undefined && (
                <span className="font-mono font-black"> · {savedWeight} lbs</span>
              )}{' '}
              — FedEx gets it on the next export.
            </p>
          )
        ) : (
          <>
            <p className="text-[11px] font-medium text-muted mb-2">
              {entry.gap === 'unverified' && stored ? (
                <>
                  Now <span className="font-mono text-muted/80">{stored}</span>
                </>
              ) : (
                FEDEX_CARTON_GAP_LABELS[entry.gap]
              )}
              {currentLbs !== null && (
                <>
                  {' · '}
                  <span className="font-mono text-muted/80">{currentLbs} lbs</span>
                </>
              )}
              {weightIsDefault && entry.gap === 'unverified'
                ? ' — neither was taken off the box.'
                : weightIsDefault
                  ? ' — the weight is the default nobody took.'
                  : ''}
            </p>

            {/* The tape measure. Any order — sidesToColumns decides which side
                is which, so nobody kneeling next to a pallet has to sort them. */}
            <div className="flex items-center gap-2 flex-wrap">
              {DRAFT_SIDES.map((key, i) => (
                <div key={key} className="flex items-center gap-2">
                  {i > 0 && <span className="text-muted text-xs">×</span>}
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    inputMode="decimal"
                    value={draft[key]}
                    onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                    disabled={busy}
                    aria-label={`Side ${i + 1} of ${entry.sku}, in inches`}
                    className="w-[4.5rem] py-2 rounded-lg bg-surface border border-subtle text-center text-base font-mono font-bold text-content focus:outline-none focus:border-accent disabled:opacity-50"
                  />
                </div>
              ))}
              <span className="text-[10px] font-black uppercase tracking-widest text-muted/50">
                in
              </span>
            </div>

            {/* The scale. The unit is a property of the scale, not of the box,
                so the chip switches the whole screen and is remembered. */}
            <div className="flex items-center gap-2 flex-wrap mt-2">
              <input
                type="number"
                step="0.1"
                min="0"
                inputMode="decimal"
                value={weightInput}
                onChange={(e) => setWeightInput(e.target.value)}
                disabled={busy}
                placeholder={currentLbs !== null ? String(lbsToUnit(currentLbs, unit)) : '—'}
                aria-label={`Weight of ${entry.sku}, in ${unit === 'kg' ? 'kilograms' : 'pounds'}`}
                className="w-[4.5rem] py-2 rounded-lg bg-surface border border-subtle text-center text-base font-mono font-bold text-content placeholder:text-muted/30 placeholder:font-normal focus:outline-none focus:border-accent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={onToggleUnit}
                disabled={busy}
                aria-label={`Weight unit: ${unit}. Switch to ${unit === 'kg' ? 'pounds' : 'kilograms'}`}
                className="h-[40px] px-2.5 rounded-lg border border-subtle bg-surface text-[10px] font-black uppercase tracking-widest text-muted hover:text-content hover:border-accent/40 active:scale-95 transition-all inline-flex items-center gap-1 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {unit}
                <ArrowLeftRight size={11} className="opacity-50" />
              </button>

              {/* What the pound column will hold. Pickd stores pounds, so a
                  kilogram reading has to show its landing place before it is
                  saved — the same reason the sides echo their columns. */}
              {unit === 'kg' && typedLbs !== null && (
                <span className="text-[11px] font-medium text-muted">
                  = <span className="font-mono font-bold text-content">{typedLbs}</span> lbs
                </span>
              )}

              <button
                type="button"
                onClick={save}
                disabled={plan.blocked !== null || busy}
                className="ml-auto h-[40px] px-4 rounded-lg bg-accent text-white text-[11px] font-black uppercase tracking-widest hover:brightness-110 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {busy && <Loader2 size={12} className="animate-spin" />}
                Save
              </button>
            </div>

            {/* The echo that catches a typo: "875 long" is visibly not a bike box,
                where a silently sorted 875 would not be. */}
            {preview && (
              <p className="text-[11px] font-medium text-muted mt-2">
                Saves as{' '}
                <span className="font-mono font-bold text-content">{preview.length_in}</span> long ×{' '}
                <span className="font-mono font-bold text-content">{preview.height_in}</span> ×{' '}
                <span className="font-mono font-bold text-content">{preview.width_in}</span> edge
              </p>
            )}
            {plan.blocked === 'bad_sides' && (
              <p className="text-[11px] font-bold text-rose-400 mt-2">
                A side is missing or too large for FedEx&rsquo;s three-character field.
              </p>
            )}

            {/* A weight taken without a tape measure. The box still needs
                measuring, so the form stays open and this just confirms. */}
            {savedWeight !== undefined && (
              <p className="text-[11px] font-medium text-green-400/90 mt-2 inline-flex items-center gap-1">
                <Check size={12} />
                <span className="font-mono font-black">{savedWeight} lbs</span> saved — the box
                still needs measuring.
              </p>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function MeasureCartonsScreen() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useMeasureQueue();
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 200);
  const [saved, setSaved] = useState<Record<string, SavedBox>>({});
  const [unit, setUnit] = useState<WeightUnit>(readStoredUnit);

  const toggleUnit = () =>
    setUnit((u) => {
      const next: WeightUnit = u === 'kg' ? 'lbs' : 'kg';
      try {
        localStorage.setItem(WEIGHT_UNIT_KEY, next);
      } catch {
        // A locked-down browser just means the choice lasts this visit.
      }
      return next;
    });

  const entries = data?.entries ?? [];
  const visible = useMemo(
    () => entries.filter((e) => matchesQuery(e, debouncedQuery)),
    [entries, debouncedQuery]
  );

  // "To measure" counts cartons FedEx cannot rate, so only a saved set of sides
  // takes one off the list — a weight on its own leaves the box still unmeasured.
  const doneCount = Object.values(saved).filter((b) => b.sides !== undefined).length;
  const left = entries.length - doneCount;

  // How many of those will actually reach FedEx. A box measured on a row with
  // no model is still held back by the export, so pointing at it and saying
  // "run the export" would send somebody after a file that will not contain it.
  const readyCount = useMemo(
    () =>
      entries.filter((e) => {
        const sides = saved[e.sku]?.sides;
        return (
          sides !== undefined &&
          fedexCartonGap({ model: e.model, ...sides, dimensions_verified: true }) === null
        );
      }).length,
    [entries, saved]
  );

  return (
    <div className="min-h-screen bg-main">
      {/* Parks flush under LayoutMain's fixed brand bar rather than at top-0,
          where a header this tall scrolls up behind it and the counters end up
          printed over the logo. 65px is the bar as it renders (40px control +
          py-3 + border); its spacer div rounds that down to 60. */}
      <header className="sticky top-[65px] z-10 bg-surface border-b border-subtle px-4 py-3">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/export')}
              aria-label="Back to Export"
              className="p-2 bg-surface border border-subtle rounded-xl text-muted hover:text-content active:scale-90 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-2xl font-black uppercase tracking-tighter leading-none text-content">
                Measure
              </h1>
              <p className="text-[10px] text-muted font-black uppercase tracking-widest">
                Boxes FedEx cannot rate
              </p>
            </div>

            {/* Figures, not sentences: how many are left and how many are done. */}
            <div className="ml-auto flex items-baseline gap-4">
              <div className="text-right">
                <div className="text-2xl font-black text-content tabular-nums leading-none">
                  {isLoading ? '—' : left}
                </div>
                <div className="text-[9px] font-black uppercase tracking-widest text-muted/70">
                  To measure
                </div>
              </div>
              {doneCount > 0 && (
                <div className="text-right">
                  <div className="text-2xl font-black text-green-400 tabular-nums leading-none">
                    {doneCount}
                  </div>
                  <div className="text-[9px] font-black uppercase tracking-widest text-muted/70">
                    Done
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-3">
            <SearchInput
              value={query}
              onChange={setQuery}
              placeholder="Search SKU, model, row…"
              variant="inline"
              preferenceId="measure-cartons"
            />
          </div>
        </div>
      </header>

      {/* pb-32 clears the BottomNavigation; the export reminder below sits on top
          of it, so the last card needs room for both or it is unreachable. */}
      <div
        className={`max-w-3xl mx-auto px-3 sm:px-4 py-4 ${readyCount > 0 ? 'pb-48' : 'pb-32'}`}
      >
        <p className="text-xs text-muted leading-relaxed mb-4">
          Every bike ordered in the last {MEASURE_QUEUE_MONTHS} months with at least{' '}
          {MEASURE_QUEUE_MIN_STOCK} on the shelf, most ordered first. Measure the box and type the
          three sides in <span className="font-black text-content">any order</span> — Pickd works
          out which is which.
        </p>

        {error ? (
          <div className="text-center text-sm text-rose-400 py-12">
            {error instanceof Error ? error.message : 'Could not load the queue.'}
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="animate-spin text-accent w-6 h-6 opacity-30" />
          </div>
        ) : visible.length === 0 ? (
          <div className="text-center text-muted text-sm py-12">
            {debouncedQuery.trim() ? (
              `No box in the queue matches "${debouncedQuery.trim()}".`
            ) : (
              <span className="inline-flex items-center gap-2">
                <Ruler size={16} className="opacity-40" />
                Every bike on hand that shipped this year is measured.
              </span>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((entry) => (
              <MeasureCard
                key={entry.sku}
                entry={entry}
                saved={saved[entry.sku]}
                unit={unit}
                onToggleUnit={toggleUnit}
                onSaved={(sku, box) =>
                  setSaved((s) => ({ ...s, [sku]: { ...(s[sku] ?? {}), ...box } }))
                }
              />
            ))}
          </ul>
        )}
      </div>

      {/* Measured is not the same as FedEx knowing. Ship Manager keeps the old
          carton until somebody exports the file and imports it. */}
      {readyCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-[110] pb-28 px-3 pointer-events-none">
          <div className="max-w-3xl mx-auto pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 backdrop-blur">
            <p className="text-xs font-medium text-content flex-1 min-w-0">
              <span className="font-black tabular-nums">{readyCount}</span> measured — FedEx keeps
              the old carton until the Dimensions export runs.
            </p>
            <button
              onClick={() => navigate('/export')}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-amber-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-amber-500 active:scale-95 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Upload size={12} />
              Export
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
