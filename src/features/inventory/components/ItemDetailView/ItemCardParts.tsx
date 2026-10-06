/**
 * The pieces of the item card, shared by registering a box (`RegisterItemView`)
 * and editing one (`ItemCardView`) — docs/prds/item-detail-register.md. One
 * label, one Where, one How many, one carton line: the two screens never draw
 * the same answer two ways.
 */
import React, { useState } from 'react';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';

import { REGISTER_FIELDS, type RegisterField, type RegisterStatus } from '../../utils/registerItem';
import { FIELD_LABEL, HEADING, whereText, type useWhereChoices } from './itemCardShared';

/** What a label field shows: its value, and how sure anyone is of it. */
export interface LabelFieldView {
  value: string;
  status: RegisterStatus;
  options?: string[];
  /** Edited and not saved yet: the amber ring. */
  changed?: boolean;
}

// Green / amber / red — copied from DraftFieldRow (the batch pile); if the
// meaning of a colour changes there, change it here.
const DOT: Partial<Record<RegisterStatus, string>> = {
  read: 'bg-emerald-600',
  choose: 'bg-amber-600',
  missing: 'bg-red-600',
};

// ── The label ──────────────────────────────────────────────────────────────

interface CartonLabelProps {
  fields: Record<RegisterField, LabelFieldView>;
  isBike: boolean | null;
  isScratchDent: boolean;
  /** A PH bike (idea-248): the chip reads PH and is changed from ⋯, not here. */
  isPhoto?: boolean;
  /** The S/D number given on first print (#n). */
  sdNumber?: number | null;
  photoUrl: string | null;
  /** What an empty field says. */
  emptyText: (key: RegisterField) => string;
  onField: (key: RegisterField) => void;
  onChoose: (key: RegisterField, value: string) => void;
  onType: (isBike: boolean) => void;
  onSd: () => void;
  onPhoto: () => void;
  /** The type changed and is not saved yet. */
  typeChanged?: boolean;
  sdChanged?: boolean;
  /** More than one unit: a serial names one carton, so the row has none to show. */
  hideSerial?: boolean;
}

/** The one light surface on a dark screen: every colour is explicit (ui-rules 10). */
export const CartonLabel: React.FC<CartonLabelProps> = ({
  fields,
  isBike,
  isScratchDent,
  isPhoto = false,
  sdNumber,
  photoUrl,
  emptyText,
  onField,
  onChoose,
  onType,
  onSd,
  onPhoto,
  typeChanged,
  sdChanged,
  hideSerial,
}) => {
  const typeButton = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={isBike === value}
      onClick={() => onType(value)}
      className={`px-2.5 py-1 font-mono text-[11px] font-bold ${
        isBike === value
          ? 'bg-[#111214] text-[#F7F5EF]'
          : isBike === null
            ? 'animate-pulse bg-amber-300/50 text-[#111214]'
            : 'text-[#111214]'
      }`}
    >
      {label}
    </button>
  );

  const field = (key: RegisterField) => {
    const f = fields[key];
    const dot = f.changed ? 'bg-amber-600 ring-[3px] ring-amber-600/25' : DOT[f.status];
    const empty = !f.value;
    const big = key === 'sku' ? 'text-2xl tracking-tight' : key === 'model' ? 'text-xl' : 'text-sm';
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => onField(key)}
          className="relative -mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-2 rounded px-1 py-0.5 text-left active:bg-black/5"
        >
          <span className="w-14 shrink-0 font-mono text-[9.5px] tracking-wider text-[#6B6E73]">
            {FIELD_LABEL[key]}
          </span>
          <span
            className={`min-w-0 break-all ${
              empty
                ? `text-[13px] font-medium ${f.status === 'choose' ? 'text-amber-700' : f.status === 'missing' ? 'text-red-700' : 'text-[#6B6E73]'}`
                : `font-bold uppercase text-[#111214] ${big} ${key === 'model' ? '' : 'font-mono'}`
            }`}
            style={key === 'model' && !empty ? HEADING : undefined}
          >
            {empty ? (f.status === 'choose' ? 'pick one' : emptyText(key)) : f.value}
          </span>
          {dot && (
            <span
              className={`absolute right-1 top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full ${dot}`}
            />
          )}
        </button>
        {f.status === 'choose' && f.options && (
          <div className="flex flex-wrap gap-1.5 pb-1.5 pl-16">
            {f.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => onChoose(key, o)}
                className="rounded border-[1.5px] border-dashed border-amber-600 bg-amber-200/40 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-900"
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <section
      aria-label="Carton label"
      className="relative rounded-md bg-[#F7F5EF] p-3.5 text-[#111214] shadow-[0_12px_30px_rgba(0,0,0,0.35)]"
    >
      <div className="pointer-events-none absolute inset-1.5 rounded-sm border-[1.5px] border-[#111214]/85" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[11px] font-extrabold tracking-[0.22em]" style={HEADING}>
          JAMIS BIKES
        </span>
        <div
          role="group"
          aria-label="Bike or part"
          className={`flex overflow-hidden rounded border-[1.5px] ${
            typeChanged ? 'border-amber-600' : 'border-[#111214]'
          }`}
        >
          {typeButton(true, 'BIKE')}
          {typeButton(false, 'PART')}
        </div>
      </div>
      <div className="relative mt-2.5 flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {REGISTER_FIELDS.filter((k) => !(hideSerial && k === 'serial')).map((k) => field(k))}
        </div>
        <button
          type="button"
          onClick={onPhoto}
          aria-label={photoUrl ? 'Change the photo' : 'Shoot the label'}
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border-[1.5px] border-[#111214] bg-black/5"
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Camera size={20} className="text-[#6B6E73]" />
          )}
        </button>
      </div>
      <div className="relative mt-2 flex items-end justify-between gap-3">
        <div
          aria-hidden
          className="h-6 max-w-[180px] flex-1"
          style={{
            background:
              'repeating-linear-gradient(90deg,#111214 0 2px,transparent 2px 3px,#111214 3px 4px,transparent 4px 7px,#111214 7px 10px,transparent 10px 11px)',
          }}
        />
        {isPhoto ? (
          <span className="rounded border-[1.5px] border-[#111214] bg-[#111214] px-2 py-0.5 font-mono text-[11px] font-bold text-[#F7F5EF]">
            PH
          </span>
        ) : isScratchDent && sdNumber != null ? (
          <button
            type="button"
            onClick={onSd}
            className="text-right leading-none text-[#111214]"
            aria-label={`S/D number ${sdNumber}`}
          >
            <span className="block font-mono text-[10px] font-bold tracking-[0.15em]">S/D</span>
            <span className="text-3xl font-extrabold" style={HEADING}>
              #{sdNumber}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onSd}
            aria-pressed={isScratchDent}
            className={`rounded border-[1.5px] px-2 py-0.5 font-mono text-[11px] font-bold ${
              sdChanged ? 'border-amber-600' : 'border-[#111214]'
            } ${isScratchDent ? 'bg-[#111214] text-[#F7F5EF]' : 'text-[#111214]'}`}
          >
            {isScratchDent ? 'S/D' : 'NEW'}
          </button>
        )}
      </div>
    </section>
  );
};

// ── Where and How many ─────────────────────────────────────────────────────

export const WhereTile: React.FC<{
  location: string | null;
  squares: string[];
  open: boolean;
  onToggle: () => void;
  sub: string;
  changed?: boolean;
}> = ({ location, squares, open, onToggle, sub, changed }) => {
  const text = whereText(location, squares);
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex min-w-0 flex-col gap-1.5 rounded-2xl border bg-[#161920] px-3.5 py-3 text-left ${
        open
          ? 'border-white'
          : changed
            ? 'border-amber-400'
            : location
              ? 'border-[#2A2F36]'
              : 'border-dashed border-[#2A2F36]'
      }`}
    >
      <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] text-white/45">
        Where {changed && <span className="h-[7px] w-[7px] rounded-full bg-amber-400" />}
      </span>
      <span
        className={`break-words font-extrabold leading-none tracking-tight ${
          location ? 'text-white' : 'text-white/40'
        } ${text.length > 10 ? 'text-2xl' : 'text-3xl'}`}
        style={HEADING}
      >
        {text}
      </span>
      <span className="text-xs text-white/45">{sub}</span>
    </button>
  );
};

export const HowManyTile: React.FC<{
  quantity: number | null;
  onChange: (n: number) => void;
  onTap: () => void;
  /** Edit: the difference from what the row had. */
  delta?: number;
}> = ({ quantity, onChange, onTap, delta }) => {
  const changed = delta !== undefined && delta !== 0;
  return (
    <div
      className={`flex min-w-0 items-stretch gap-2 rounded-2xl border bg-[#161920] py-2.5 pl-3.5 pr-2.5 ${
        changed
          ? 'border-amber-400'
          : quantity == null
            ? 'border-dashed border-[#2A2F36]'
            : 'border-[#2A2F36]'
      }`}
    >
      {/* Label and figure in one column; + and − in their own column to the
          right, the full height of the tile, + on top. */}
      <button
        type="button"
        onClick={onTap}
        className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 text-left"
      >
        <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] text-white/45">
          How many {changed && <span className="h-[7px] w-[7px] rounded-full bg-amber-400" />}
        </span>
        <span
          className={`block truncate text-5xl font-extrabold leading-none tabular-nums ${
            quantity == null ? 'text-white/40' : 'text-violet-300'
          }`}
          style={HEADING}
        >
          {quantity ?? '?'}
        </span>
        {changed && (
          <span className="block font-mono text-xs text-amber-400">
            {delta > 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </button>
      <div className="flex shrink-0 flex-col gap-1.5">
        <button
          type="button"
          aria-label="One more"
          onClick={() => onChange((quantity ?? 0) + 1)}
          className="flex min-h-9 w-11 flex-1 items-center justify-center rounded-xl border border-[#2A2F36] bg-[#0F1115] text-white/80 active:scale-95"
        >
          <Plus size={18} />
        </button>
        <button
          type="button"
          aria-label="One less"
          onClick={() => onChange(Math.max(0, (quantity ?? 1) - 1))}
          className="flex min-h-9 w-11 flex-1 items-center justify-center rounded-xl border border-[#2A2F36] bg-[#0F1115] text-white/80 active:scale-95"
        >
          <Minus size={18} />
        </button>
      </div>
    </div>
  );
};

// ── The Where picker ───────────────────────────────────────────────────────

export const WherePicker: React.FC<{
  choices: ReturnType<typeof useWhereChoices>;
  location: string | null;
  selected: string[];
  /** The square the row is in now (edit), outlined. */
  current?: string[];
  /** More than one unit: the squares toggle, several can be on. */
  multi?: boolean;
  query: string;
  onQuery: (q: string) => void;
  onLocation: (loc: string) => void;
  onSquare: (letter: string) => void;
}> = ({
  choices,
  location,
  selected,
  current = [],
  multi = false,
  query,
  onQuery,
  onLocation,
  onSquare,
}) => {
  const { chips, results, isRow, squares, squareUnits } = choices;
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-white bg-[#161920] p-3">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const on = location === c.location;
          return (
            <button
              key={c.location}
              type="button"
              aria-pressed={on}
              onClick={() => onLocation(c.location)}
              className={`rounded-full border px-3 py-1.5 font-mono text-xs font-bold ${
                on
                  ? 'border-white bg-white text-[#0F1115]'
                  : 'border-[#2A2F36] bg-[#0F1115] text-white'
              }`}
            >
              {c.location}
              {c.why && (
                <span className={`ml-1 font-medium ${on ? 'text-black/60' : 'text-white/45'}`}>
                  {c.why}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-[#2A2F36] bg-[#0F1115] px-3 py-2">
        <Search size={14} className="text-white/40" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) onLocation(results[0] ?? query.trim());
          }}
          placeholder="Other location…"
          aria-label="Search location"
          className="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase text-white placeholder:normal-case placeholder:text-white/30 focus:outline-none"
        />
      </label>
      {results.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {results.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => onLocation(l)}
              className="rounded-full border border-[#2A2F36] bg-[#0F1115] px-3 py-1.5 font-mono text-xs font-bold text-white"
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {isRow && (
        <>
          <span className="text-xs text-white/45">
            {location} — {multi ? 'tap every square its units are in.' : 'tap a square.'} The number
            is what is there now.
          </span>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${squares.length}, minmax(0, 1fr))` }}
          >
            {squares.map((l) => {
              const n = squareUnits.get(l) ?? 0;
              const on = selected.includes(l);
              const mine = current.includes(l);
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onSquare(l)}
                  className={`flex aspect-[1/1.25] min-w-0 flex-col items-center justify-center rounded-md border font-mono ${
                    on
                      ? 'border-violet-300 bg-violet-300 text-[#0F1115]'
                      : mine
                        ? 'border-violet-300 bg-[#0F1115] text-white'
                        : 'border-[#2A2F36] bg-[#0F1115] text-white'
                  }`}
                >
                  <b className="text-xs">{l}</b>
                  <span
                    className={`text-[9px] ${
                      on ? 'text-black/70' : n >= 30 ? 'text-amber-400' : 'text-white/45'
                    }`}
                  >
                    {n || '·'}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

// ── The carton ─────────────────────────────────────────────────────────────

export type CartonTruth = 'DEFAULT' | 'MEASURED' | 'LABEL G.W.' | 'WEIGHED';

const Badge: React.FC<{ truth: CartonTruth }> = ({ truth }) => (
  <span
    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider ${
      truth === 'DEFAULT'
        ? 'border border-dashed border-[#2A2F36] text-white/45'
        : 'border border-emerald-400/40 text-emerald-400'
    }`}
  >
    {truth}
  </span>
);

export const CartonLine: React.FC<{
  isBike: boolean;
  dims: { length: number | null; width: number | null; height: number | null };
  weight: number | null;
  dimsTruth: CartonTruth;
  weightTruth: CartonTruth;
  onTap?: () => void;
}> = ({ isBike, dims, weight, dimsTruth, weightTruth, onTap }) => {
  const n = (v: number | null) => (v == null ? '?' : String(Number(v)));
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-sm font-bold text-white">
        {isBike && (
          <span className="flex items-center gap-2">
            {n(dims.length)} × {n(dims.width)} × {n(dims.height)}
            <span className="font-medium text-white/45">in</span>
            <Badge truth={dimsTruth} />
          </span>
        )}
        <span className="flex items-center gap-2">
          {n(weight)} lb
          {!isBike && <span className="font-medium text-white/45">· no box size</span>}
          {(weightTruth !== dimsTruth || !isBike) && <Badge truth={weightTruth} />}
        </span>
      </span>
    </>
  );
  const cls =
    'flex w-full items-center gap-3 rounded-2xl border border-[#2A2F36] bg-[#161920] px-3.5 py-3 text-left';
  return onTap ? (
    <button type="button" onClick={onTap} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
};

// ── One field, one sheet ───────────────────────────────────────────────────

export const FieldSheet: React.FC<{
  label: string;
  initial: string;
  numeric?: boolean;
  /** Keep the typed case (a size's `cm`); everything else is capitals. */
  keepCase?: boolean;
  multiline?: boolean;
  hint?: string;
  onCancel: () => void;
  onDone: (value: string) => void;
}> = ({ label, initial, numeric, keepCase, multiline, hint, onCancel, onDone }) => {
  const [value, setValue] = useState(initial);
  const done = () => onDone(keepCase || multiline || numeric ? value : value.toUpperCase());
  const inputCls =
    'w-full rounded-xl border border-white bg-[#0F1115] p-3.5 font-mono text-xl font-bold text-white focus:outline-none';
  return (
    <div
      className="fixed inset-0 z-[190] flex items-end justify-center bg-black/55"
      onClick={onCancel}
    >
      <form
        className="flex w-full max-w-[430px] flex-col gap-3 rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          done();
        }}
      >
        <label
          htmlFor="item-card-field"
          className="text-[10.5px] uppercase tracking-[0.14em] text-white/45"
        >
          {label}
        </label>
        {multiline ? (
          <textarea
            id="item-card-field"
            autoFocus
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={`${inputCls} text-base font-medium`}
          />
        ) : (
          <input
            id="item-card-field"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode={numeric ? 'numeric' : 'text'}
            autoComplete="off"
            autoCapitalize="characters"
            className={`${inputCls} ${keepCase ? '' : 'uppercase'}`}
          />
        )}
        {hint && <span className="text-xs text-white/45">{hint}</span>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[#2A2F36] py-3 font-semibold text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="flex-1 rounded-xl bg-white py-3 font-semibold text-[#0F1115]"
          >
            Done
          </button>
        </div>
      </form>
    </div>
  );
};
