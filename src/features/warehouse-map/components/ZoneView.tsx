// One zone: the four counters the floor plans always show (PALLETS · TOTAL
// BIKES · FAST PICKING · HITS), the pallet sliders, the toggles, and the
// drawing. WAREHOUSE-UI-RULES.md, as a screen.

import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2';
import X from 'lucide-react/dist/esm/icons/x';
import { ZONES, calculateLayout, HALL_MIN } from '../engine';
import type { LayoutPreset, ZoneId } from '../engine';
import { useZoneState, toggleKeys } from '../hooks/useZoneState';
import { ZoneSvg, COLOR, type HoverTarget } from './ZoneSvg';

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** The counters: a big figure and a short label, never a sentence. */
const Figure: React.FC<{ label: string; value: string; small?: string; color: string }> = ({
  label,
  value,
  small,
  color,
}) => (
  <div className="min-w-0">
    <div className="font-mono text-[9.5px] tracking-[.14em] text-muted/70">{label}</div>
    <div className="flex flex-wrap items-baseline gap-x-1.5 mt-1.5">
      <span
        className="font-mono text-[28px] font-extrabold leading-none whitespace-nowrap tabular-nums"
        style={{ color }}
      >
        {value}
      </span>
      {small && (
        <small className="font-mono text-[13px] font-semibold text-muted whitespace-nowrap">
          {small}
        </small>
      )}
    </div>
  </div>
);

const switchBtn = (on: boolean) =>
  `px-3 py-2 font-mono text-[11px] tracking-[.1em] font-bold whitespace-nowrap transition-colors ${
    on ? 'bg-accent text-black' : 'text-muted hover:text-content'
  }`;

const SLIDER_MIN = 50;
const SLIDER_MAX = 70;
const ZOOM_STEP = 1.35;

export const ZoneView: React.FC<{ zoneId: ZoneId }> = ({ zoneId }) => {
  const config = ZONES[zoneId];
  const [state, update] = useZoneState(config);
  const model = useMemo(() => calculateLayout(config, state), [config, state]);
  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [hallEdit, setHallEdit] = useState<{ idx: number; w: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  const halls = toggleKeys(config);
  const hasPosts = (config.posts ?? []).some((p) => p.size > 0);
  const rowDir = state.isEW ? 'EAST–WEST' : 'NORTH–SOUTH';

  const specs = model
    ? [
        `${model.nRows} ROWS`,
        `${model.deep} SLOTS DEEP`,
        `${model.blocks.length} BLOCKS (${[...model.blocks].reverse().join('·')} ${state.isEW ? 'N→S' : 'E→W'})`,
        model.lines > 0 ? `${model.lines} BIKE LINES FRONT` : null,
        `${model.nHalls > 0 ? `${Math.round(model.hall * 100) / 100}"` : 'NO'} HALLS`,
        model.activePosts.length > 0
          ? `${model.activePosts.length} POSTS (${model.hits.length} OBSTRUCT)`
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;

  const setPreset = (layoutPreset: LayoutPreset) => update({ layoutPreset });

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3 flex items-center gap-3">
        <Link
          to={{ search: '' }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-subtle bg-card font-mono text-[11px] tracking-[.1em] font-semibold text-content hover:border-muted transition-colors whitespace-nowrap"
        >
          <ArrowLeft size={14} /> MAP
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-[13px] sm:text-[15px] font-extrabold tracking-[.18em] text-content truncate">
            {config.name}
          </h1>
          <p className="font-mono text-[10px] tracking-[.14em] text-muted truncate">
            PALLET LAYOUT · {rowDir} ROWS
          </p>
        </div>
      </div>

      {/* The four counters — anchored at the top, large, always */}
      <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-x-7 gap-y-4 px-4 pt-4 pb-3">
        <Figure
          label="PALLETS"
          value={model ? String(model.pallets) : '—'}
          small={
            model && model.lost.length
              ? `${model.gross} gross − ${model.lost.length} hit`
              : undefined
          }
          color={COLOR.buried}
        />
        <Figure
          label="TOTAL BIKES"
          value={model ? fmt(model.totalBikes) : '—'}
          small={
            model && model.bikes > 0
              ? `${fmt(model.palletBikes)} + ${fmt(model.bikes)} block`
              : undefined
          }
          color={COLOR.bikes}
        />
        <Figure
          label="FAST PICKING"
          value={model ? String(model.accessible) : '—'}
          small={model ? `of ${model.pallets}` : undefined}
          color={COLOR.fast}
        />
        {hasPosts && (
          <Figure
            label="HITS"
            value={model ? String(model.hits.length) : '—'}
            small={model ? (model.hits.length > 0 ? 'slots' : 'clear') : undefined}
            color={model && model.hits.length > 0 ? '#f87171' : COLOR.depthMajor}
          />
        )}
      </div>
      {specs && (
        <p className="px-4 pb-3 font-mono text-[11px] tracking-[.05em] text-muted leading-relaxed">
          {specs}
        </p>
      )}

      {/* Controls: the pallet, the orientation, the halls, the preset */}
      <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-subtle bg-card font-mono text-[11px] text-muted">
          <span className="tracking-[.1em] font-bold">PALLET</span>
          <input
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            value={state.pd}
            onChange={(e) => update({ pd: Number(e.target.value) })}
            className="w-16 accent-cyan-400"
            aria-label="Pallet depth, inches"
          />
          <span className="text-cyan-400 font-bold tabular-nums">{state.pd}"</span>
          <span>D ×</span>
          <input
            type="range"
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            value={state.pw}
            onChange={(e) => update({ pw: Number(e.target.value) })}
            className="w-16 accent-cyan-400"
            aria-label="Pallet width, inches"
          />
          <span className="text-cyan-400 font-bold tabular-nums">{state.pw}"</span>
          <span>W</span>
        </label>

        <div className="flex rounded-lg border border-subtle overflow-hidden bg-card">
          <button
            type="button"
            className={switchBtn(!state.isEW)}
            onClick={() => update({ isEW: false })}
          >
            N–S ROWS
          </button>
          <button
            type="button"
            className={switchBtn(state.isEW)}
            onClick={() => update({ isEW: true })}
          >
            E–W ROWS
          </button>
        </div>

        {halls.length > 0 && (
          <div className="flex rounded-lg border border-subtle overflow-hidden bg-card">
            {halls.map((key) => {
              const on = state.toggles[key] !== false;
              return (
                <button
                  key={key}
                  type="button"
                  className={switchBtn(on)}
                  aria-pressed={on}
                  onClick={() => update({ toggles: { [key]: !on } })}
                >
                  {on ? '☑' : '☐'} {key.toUpperCase()} HALL
                </button>
              );
            })}
          </div>
        )}

        <div className="flex rounded-lg border border-subtle overflow-hidden bg-card">
          <button
            type="button"
            className={switchBtn(state.layoutPreset === 'standard')}
            onClick={() => setPreset('standard')}
            title="Blocks with a hall between them"
          >
            HALLS
          </button>
          <button
            type="button"
            className={switchBtn(state.layoutPreset === 'center_hall')}
            onClick={() => setPreset('center_hall')}
            title="Two big blocks, one wide hall in the middle"
          >
            1 CENTER
          </button>
          <button
            type="button"
            className={switchBtn(state.layoutPreset === 'solid')}
            onClick={() => setPreset('solid')}
            title="One mass block, no halls"
          >
            0 HALLS
          </button>
        </div>
      </div>

      {hallEdit && model && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg border border-cyan-400/40 bg-card flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted">
          <span className="font-bold text-content">HALL {hallEdit.idx + 1} WIDTH</span>
          <input
            type="range"
            min={Math.max(HALL_MIN, hallEdit.w - 20)}
            max={hallEdit.w + 20}
            value={state.hallOverrides[hallEdit.idx] ?? hallEdit.w}
            onChange={(e) =>
              update({
                hallOverrides: { ...state.hallOverrides, [hallEdit.idx]: Number(e.target.value) },
              })
            }
            className="w-32 accent-cyan-400"
            aria-label={`Hall ${hallEdit.idx + 1} width, inches`}
          />
          <span className="text-cyan-400 font-bold tabular-nums">
            {state.hallOverrides[hallEdit.idx] ?? hallEdit.w}"
          </span>
          <button
            type="button"
            className="text-red-400 font-bold tracking-[.1em]"
            onClick={() => {
              const next = { ...state.hallOverrides };
              delete next[hallEdit.idx];
              update({ hallOverrides: next });
            }}
          >
            RESET
          </button>
          <button
            type="button"
            className="ml-auto p-1 text-muted hover:text-content"
            onClick={() => setHallEdit(null)}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {!model && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-lg bg-red-500 text-black text-sm font-semibold">
          No layout: a {state.pw}" × {state.pd}" pallet in {rowDir.toLowerCase()} rows does not fit
          this zone's rules.
        </div>
      )}

      {/* What the pointer is on — the phone's tooltip */}
      <div className="px-4 pb-2 flex items-center gap-3">
        <p
          className="flex-1 min-w-0 font-mono text-[11px] text-content truncate"
          aria-live="polite"
        >
          {hover?.text ?? (
            <span className="text-muted">
              Hover or tap a slot, a hall or a post for its measure.
            </span>
          )}
        </p>
        <div className="flex rounded-lg border border-subtle overflow-hidden bg-card shrink-0">
          <button
            type="button"
            className="p-2 text-muted hover:text-content"
            onClick={() => setZoom((z) => Math.max(1, z / ZOOM_STEP))}
            aria-label="Zoom out"
          >
            <Minus size={14} />
          </button>
          <button
            type="button"
            className="p-2 text-muted hover:text-content"
            onClick={() => setZoom(1)}
            aria-label="Fit"
          >
            <Maximize2 size={14} />
          </button>
          <button
            type="button"
            className="p-2 text-muted hover:text-content"
            onClick={() => setZoom((z) => Math.min(6, z * ZOOM_STEP))}
            aria-label="Zoom in"
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {model && (
        <div className="mx-4 rounded-xl border border-subtle bg-[#070b14] overflow-auto">
          <div style={{ width: `${zoom * 100}%` }}>
            <ZoneSvg
              config={config}
              state={state}
              model={model}
              onHover={setHover}
              onHallClick={(idx, w) => setHallEdit({ idx, w: state.hallOverrides[idx] ?? w })}
            />
          </div>
        </div>
      )}

      <details className="mx-4 mt-4 rounded-lg border border-subtle bg-card px-4 py-3">
        <summary className="font-mono text-[11px] font-bold tracking-[.1em] text-muted cursor-pointer select-none">
          LAYOUT RULES & LEGEND
        </summary>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] tracking-[.1em] text-muted">
          <Legend color={COLOR.fast} alpha={0.4} text="FAST PICKING — TOUCHES OPEN FLOOR" />
          <Legend color={COLOR.buried} alpha={0.2} text="BURIED — NEEDS THE FRONT MOVED" />
          <Legend color={COLOR.bikes} alpha={0.3} text="BIKE BLOCK — LEFTOVER AT THE FRONT" />
          {hasPosts && <Legend color={COLOR.post} alpha={1} text="STRUCTURAL POST (HITS SLOT)" />}
          {hasPosts && <Legend color="#34d399" alpha={1} text="STRUCTURAL POST (IN HALL)" />}
          <Legend color={COLOR.wall} alpha={1} fill={COLOR.hall} text="EXISTING RACK / DEAD ZONE" />
        </div>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted">
          Rows are flush. No hall under {HALL_MIN}". A block deeper than two rows against a wall
          gets a wall hall. Leftover depth becomes loose bike lines at the front, on the main hall.
          A post inside a hall needs {HALL_MIN}" clear on one side. Tap a hall to try another width.
        </p>
      </details>
    </div>
  );
};

const Legend: React.FC<{ color: string; alpha: number; fill?: string; text: string }> = ({
  color,
  alpha,
  fill,
  text,
}) => (
  <span className="flex items-center gap-2">
    <i
      className="inline-block w-3 h-3 rounded-[3px] border-[1.5px]"
      style={{
        borderColor: color,
        background:
          fill ??
          `${color}${Math.round(alpha * 255)
            .toString(16)
            .padStart(2, '0')}`,
      }}
    />
    {text}
  </span>
);
