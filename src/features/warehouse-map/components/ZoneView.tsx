// One zone. On the floor it reads stock: how many squares hold something, a
// capacity bar (units in stock against the bikes the layout holds), the
// drawing with a pallet's worth per square, and what the drawing has no
// place for — never hidden. PLAN draws moves as ghosts; LIVE moves now, after
// a confirmation — the only two buttons (Rafael, 31 Aug 2026: "lo menos
// compleja posible la interfaz"); tapping the active one rests back to the
// stock. Measures live in LAYOUT, reached only by `?mode=layout`; the pallet
// itself is 60 × 62 and not a control.
//
// Presentational: `data` from useZoneData, `editor` (optional) from
// useZoneEditor, `onOpenLine` (optional) is the app's item detail. The public
// map mounts it with `data` and `mode="layout"`.

import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Maximize2 from 'lucide-react/dist/esm/icons/maximize-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import X from 'lucide-react/dist/esm/icons/x';
import { HALL_MIN, slotKey } from '../engine';
import type { Cell } from '../engine';
import type { ZoneData } from '../hooks/useZoneData';
import type { EditMode, ZoneEditor } from '../hooks/useZoneEditor';
import {
  groupUnplaced,
  PALLET_UNITS,
  SQUARE_MAX,
  type StockRow,
  type Unplaced,
} from '../stock/rowStock';
import type { Occupant } from '../plan/slotPlan';
import { skuColorDark } from '../../../utils/skuColor';
import { ZoneSvg, COLOR, type HoverTarget } from './ZoneSvg';

const fmt = (n: number) => new Intl.NumberFormat('en-US').format(n);

export type OpenLine = (
  sku: string,
  itemName: string | null,
  location: string,
  warehouse: string
) => void;

/** A big figure and a short label, never a sentence. */
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

/** Units in stock against the bikes the layout holds — the zone in one glance. */
const CapacityBar: React.FC<{ units: number | null; capacity: number | null }> = ({
  units,
  capacity,
}) => {
  const pct = units !== null && capacity ? (units / capacity) * 100 : null;
  const tone =
    pct === null ? COLOR.depthMinor : pct > 100 ? '#f87171' : pct >= 85 ? COLOR.fast : COLOR.bikes;
  return (
    <div className="min-w-[260px] flex-1 max-w-xl">
      <div className="flex items-baseline justify-between font-mono text-[9.5px] tracking-[.14em] text-muted/70">
        <span>IN STOCK</span>
        <span>TOTAL BIKES</span>
      </div>
      <div className="flex items-baseline justify-between font-mono font-extrabold tabular-nums mt-1.5">
        <span className="text-[28px] leading-none text-content">
          {units === null ? '—' : fmt(units)}
          <small className="text-[13px] font-semibold text-muted ml-1">u</small>
        </span>
        <span className="text-[18px] leading-none" style={{ color: COLOR.bikes }}>
          {capacity === null ? '—' : fmt(capacity)}
        </span>
      </div>
      <div className="h-2 rounded-sm bg-[#111a2b] overflow-hidden mt-2">
        <i
          className="block h-full rounded-sm transition-[width] duration-300"
          style={{ width: `${Math.min(100, pct ?? 0)}%`, background: tone }}
        />
      </div>
      <div className="font-mono text-[10px] text-muted mt-1 tabular-nums">
        {pct === null
          ? 'capacity unknown'
          : `${Math.round(pct)}% of capacity · ${PALLET_UNITS} a square`}
      </div>
    </div>
  );
};

const MODE_TONE: Record<'plan' | 'live', string> = {
  plan: 'bg-[#a78bfa] text-black',
  live: 'bg-accent text-black',
};

const switchBtn = (on: boolean, tone = 'bg-accent text-black') =>
  `px-3 py-2 font-mono text-[11px] tracking-[.1em] font-bold whitespace-nowrap transition-colors ${
    on ? tone : 'text-muted hover:text-content'
  }`;

const ZOOM_STEP = 1.35;
/** Below this width a square is too small to tap; PLAN and LIVE zoom in on entry. */
const PHONE_WIDTH = 640;
const PHONE_EDIT_ZOOM = 2.5;
const LONG_PRESS_MS = 500;

const UNPLACED_REASON: Record<Unplaced['reason'], (u: Unplaced) => string> = {
  letter: (u) => `no square ${u.letters.join(', ')} on this plan`,
  suffix: (u) => `beside row ${u.parsed.number}`,
  'no-letter': () => 'no letter',
  row: (u) => `row ${u.parsed.number} not drawn in this layout`,
};

/** A button with two meanings: tap, and hold for half a second. */
const PressButton: React.FC<{
  onTap: () => void;
  onLong?: () => void;
  className?: string;
  style?: React.CSSProperties;
  title?: string;
  children: React.ReactNode;
}> = ({ onTap, onLong, className, style, title, children }) => {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return (
    <button
      type="button"
      className={className}
      style={style}
      title={title}
      onPointerDown={() => {
        fired.current = false;
        if (!onLong) return;
        clear();
        timer.current = window.setTimeout(() => {
          fired.current = true;
          onLong();
        }, LONG_PRESS_MS);
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (fired.current) {
          fired.current = false;
          return;
        }
        onTap();
      }}
    >
      {children}
    </button>
  );
};

export const ZoneView: React.FC<{
  data: ZoneData;
  editor?: ZoneEditor;
  onOpenLine?: OpenLine;
  /** Without an editor, the mode the zone is shown in. */
  mode?: EditMode;
}> = ({ data, editor, onOpenLine, mode: modeProp }) => {
  const { config, state, update, model, stockQuery, stock } = data;
  const mode: EditMode = editor?.mode ?? modeProp ?? 'view';
  const layout = mode === 'layout';
  const editing = !!editor && editor.editing;
  const planMode = mode === 'plan';
  const held = editor?.held ?? null;

  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [hallEdit, setHallEdit] = useState<{ idx: number; w: number } | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // A phone cannot tap a 12 px square: PLAN and LIVE start zoomed in.
  const phoneZoom = () => (window.innerWidth < PHONE_WIDTH ? PHONE_EDIT_ZOOM : 1);
  const [zoom, setZoom] = useState(() => (editing ? phoneZoom() : 1));

  const openLine: OpenLine = (sku, itemName, location, warehouse) =>
    onOpenLine?.(sku, itemName, location, warehouse);

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

  const stockLine = stockQuery.isError
    ? 'Stock unavailable — sign in to see what is in each square.'
    : stockQuery.isLoading
      ? 'Loading stock…'
      : stock && stock.lines === 0
        ? 'No stock recorded in these rows.'
        : null;

  const changeMode = (m: EditMode) => {
    if (!editor) return;
    editor.cancel();
    editor.setMode(m);
    setSelectedKey(null);
    if (m === 'plan' || m === 'live') setZoom((z) => (z === 1 ? phoneZoom() : z));
  };

  // What a tapped square holds: the DB's lines, or the planned state in PLAN.
  const selectedOccupants: Occupant[] | null = selectedKey
    ? editor
      ? editor.state.occupancy(selectedKey)
      : (stock?.cells.get(selectedKey)?.entries ?? []).map((e) => ({
          inventoryId: e.rowId,
          sku: e.sku,
          qty: e.qty,
          qtyHere: e.qtyHere,
          itemName: e.itemName,
          warehouse: e.warehouse,
          location: `ROW ${selectedKey.slice(0, selectedKey.lastIndexOf('-'))}`,
          sublocation: [selectedKey.slice(selectedKey.lastIndexOf('-') + 1)],
          ghost: null,
          liveKey: selectedKey,
          atKey: selectedKey,
        }))
    : null;

  // One tap picks a line up when the square has one; two taps put it down.
  const onCellTap = (cell: Cell) => {
    const key = slotKey(cell);
    if (editor && editing) {
      if (editor.drop(cell)) {
        setSelectedKey(null);
        return;
      }
      const occ = editor.state.occupancy(key);
      if (occ.length === 1) {
        editor.pickOccupant(occ[0]);
        setSelectedKey(null);
        return;
      }
      setSelectedKey(occ.length > 1 ? key : null);
      return;
    }
    setSelectedKey(stock?.cells.get(key) ? key : null);
  };

  const pickRow = (row: StockRow) => {
    editor?.pickRow(row);
    setSelectedKey(null);
  };

  const occupied = stock ? stock.cells.size : null;
  const capacity = model ? model.pallets : null;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to={{ search: '' }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-subtle bg-card font-mono text-[11px] tracking-[.1em] font-semibold text-content hover:border-muted transition-colors whitespace-nowrap"
        >
          <ArrowLeft size={14} /> MAP
        </Link>
        <div className="min-w-[150px] flex-1">
          <h1 className="font-mono text-[13px] sm:text-[15px] font-extrabold tracking-[.18em] text-content truncate">
            {config.name}
          </h1>
          <p className="font-mono text-[10px] tracking-[.14em] text-muted truncate">
            {layout ? `PALLET LAYOUT · ${rowDir} ROWS` : `${rowDir} ROWS`}
          </p>
        </div>
        {/* The two buttons; at rest the zone is the stock. Tapping the active
            one puts the tools away. */}
        {editor && (
          <div className="flex rounded-lg border border-subtle overflow-hidden bg-card shrink-0 ml-auto">
            {(['plan', 'live'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={switchBtn(mode === m, MODE_TONE[m])}
                onClick={() => changeMode(mode === m ? 'view' : m)}
              >
                {m.toUpperCase()}
                {m === 'plan' && mode !== 'plan' && editor.summary.count > 0
                  ? ` · ${editor.summary.count}`
                  : ''}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => stockQuery.refetch()}
          disabled={stockQuery.isFetching}
          className="p-2 rounded-lg border border-subtle bg-card text-muted hover:text-content transition-colors disabled:opacity-60"
          aria-label="Refresh stock"
          title="Refresh stock"
        >
          <RefreshCw size={14} className={stockQuery.isFetching ? 'animate-spin' : undefined} />
        </button>
      </div>

      {layout ? (
        <>
          {/* The four counters of the plans — anchored at the top, large */}
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
            {stock && stock.lines > 0 && (
              <Figure
                label="IN STOCK"
                value={fmt(stock.units)}
                small={`${stock.rows} row${stock.rows === 1 ? '' : 's'} · ${stock.cells.size} squares`}
                color="#e2e8f0"
              />
            )}
          </div>
          {specs && (
            <p className="px-4 pb-3 font-mono text-[11px] tracking-[.05em] text-muted leading-relaxed">
              {specs}
            </p>
          )}

          {/* No switches: the orientation, the hall toggles and the presets left
              the interface (Rafael, 31 Aug 2026: "ya no lo necesitamos") — like
              the pallet size before them, a link still carries them for the
              planner: `rows=ew`, `west=1`, `preset=center|solid`, `pd`/`pw`. */}

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
                    hallOverrides: {
                      ...state.hallOverrides,
                      [hallEdit.idx]: Number(e.target.value),
                    },
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
        </>
      ) : (
        /* The floor's two numbers: squares in use, and the capacity bar */
        <div className="px-4 pt-4 pb-3 flex flex-wrap items-end gap-x-10 gap-y-4">
          <Figure
            label="PALLETS"
            value={occupied === null ? '—' : String(occupied)}
            small={capacity === null ? undefined : `/ ${capacity} squares`}
            color={COLOR.buried}
          />
          <CapacityBar
            units={stock ? stock.units : null}
            capacity={model ? model.totalBikes : null}
          />
        </div>
      )}

      {!model && (
        <div className="mx-4 mb-3 px-4 py-3 rounded-lg bg-red-500 text-black text-sm font-semibold">
          No layout: a {state.pw}" × {state.pd}" pallet in {rowDir.toLowerCase()} rows does not fit
          this zone's rules.
        </div>
      )}

      {/* The plan bar: what is planned, and what you can do with it */}
      {planMode && editor && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg border border-dashed border-[#a78bfa]/60 bg-card flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px]">
          <span className="font-bold tracking-[.1em] text-[#a78bfa]">PLAN</span>
          <span className="text-content">
            <b className="tabular-nums">{editor.summary.count}</b> move
            {editor.summary.count === 1 ? '' : 's'} ·{' '}
            <b className="tabular-nums">{fmt(editor.summary.units)}</b> u
            {editor.summary.rows > 0 ? (
              <>
                {' '}
                · <b className="tabular-nums">{editor.summary.rows}</b> rows
              </>
            ) : null}
          </span>
          <span className="text-muted">
            {editor.summary.count === 0
              ? 'Tap a SKU, then the square it goes to.'
              : 'Nothing moves until PLAN COMPLETED.'}
          </span>
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={editor.distribute}
              disabled={editor.busy || !stock}
              className="px-3 py-1.5 rounded-lg border border-[#a78bfa]/60 text-[#a78bfa] hover:bg-[#a78bfa]/10 font-bold tracking-[.1em] disabled:opacity-40"
              title={`Spread every line at ${PALLET_UNITS} a square: its own row first, then free buried squares; what finds no square goes to the MAIN HALL in front of its block`}
            >
              DISTRIBUTE
            </button>
            {editor.summary.count > 0 && (
              <button
                type="button"
                onClick={editor.discard}
                disabled={editor.busy}
                className="px-3 py-1.5 rounded-lg border border-subtle text-muted hover:text-red-400 font-bold tracking-[.1em] disabled:opacity-40"
              >
                DISCARD
              </button>
            )}
            <button
              type="button"
              onClick={editor.complete}
              disabled={editor.busy || editor.summary.count === 0}
              className="px-3 py-1.5 rounded-lg bg-[#a78bfa] text-black font-bold tracking-[.1em] disabled:opacity-40"
            >
              PLAN COMPLETED
            </button>
          </span>
        </div>
      )}

      {mode === 'live' && editor && (
        <div className="mx-4 mb-3 px-3 py-2 rounded-lg border border-accent/60 bg-card flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px]">
          <span className="font-bold tracking-[.1em] text-accent">LIVE</span>
          <span className="text-content">
            Tap a SKU, tap where it goes, confirm — it moves now.
          </span>
        </div>
      )}

      {/* The line in hand, the tapped square, or what the pointer is on */}
      <div className="px-4 pb-2 flex items-center gap-3">
        {held && editor ? (
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span
              className="px-2 py-1 rounded-md font-bold text-white whitespace-nowrap"
              style={{
                background: skuColorDark(held.sku).bg,
                border: `1px solid ${skuColorDark(held.sku).border}`,
              }}
            >
              {held.sku} · {held.qty}u
            </span>
            <span className="text-content">
              from {held.location.trim().toUpperCase()}
              {held.sublocation?.length ? ` ${held.sublocation.join('')}` : ''} — tap where it goes
            </span>
            <button
              type="button"
              className="p-1 text-muted hover:text-content"
              onClick={editor.cancel}
              aria-label="Put it back"
            >
              <X size={14} />
            </button>
          </div>
        ) : selectedKey && selectedOccupants ? (
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[11px] font-bold text-content whitespace-nowrap">
              ROW {selectedKey.slice(0, selectedKey.lastIndexOf('-'))} ·{' '}
              {selectedKey.slice(selectedKey.lastIndexOf('-') + 1)}
            </span>
            {selectedOccupants.length === 0 && (
              <span className="font-mono text-[11px] text-muted">empty once the plan runs</span>
            )}
            {selectedOccupants.map((o) => {
              const tone = skuColorDark(o.sku);
              const open = () => openLine(o.sku, o.itemName, o.location, o.warehouse);
              return (
                <span
                  key={`${o.inventoryId}-${o.ghost?.id ?? 'live'}`}
                  className="inline-flex items-stretch"
                >
                  <PressButton
                    onTap={editing && editor ? () => editor.pickOccupant(o) : open}
                    onLong={editing && onOpenLine ? open : undefined}
                    className={`px-2 py-1 rounded-md font-mono text-[11px] font-bold text-white whitespace-nowrap hover:brightness-110 ${
                      o.ghost ? 'rounded-r-none opacity-80' : ''
                    }`}
                    style={{
                      background: tone.bg,
                      border: `1px ${o.ghost ? 'dashed' : 'solid'} ${tone.border}`,
                    }}
                    title={
                      o.ghost
                        ? `Planned from ${o.ghost.fromLocation}${o.ghost.fromSublocation?.join('') ?? ''}${editing ? ' · tap to move again · hold for detail' : ''}`
                        : (o.itemName ?? o.sku) +
                          (editing ? ' · tap to pick up · hold for detail' : '')
                    }
                  >
                    {o.ghost ? '→ ' : ''}
                    {o.sku} · {o.qtyHere}u{o.qtyHere < o.qty ? ` of ${o.qty}` : ''}
                  </PressButton>
                  {o.ghost && editor && (
                    <button
                      type="button"
                      onClick={() => editor.removeMove(o.ghost!.id)}
                      className="px-1.5 rounded-r-md border border-l-0 border-dashed text-white/80 hover:text-white"
                      style={{ borderColor: tone.border, background: tone.bg }}
                      aria-label="Remove from plan"
                      title="Remove from plan"
                    >
                      <X size={12} />
                    </button>
                  )}
                </span>
              );
            })}
            <button
              type="button"
              className="p-1 text-muted hover:text-content"
              onClick={() => setSelectedKey(null)}
              aria-label="Clear selection"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <p
            className="flex-1 min-w-0 font-mono text-[11px] text-content truncate"
            aria-live="polite"
          >
            {hover?.text ?? (
              <span className="text-muted">
                {stockLine ??
                  (editing
                    ? 'Tap a SKU to pick it up.'
                    : layout
                      ? 'Hover or tap a square, a hall or a post for its measure.'
                      : 'Tap a square for its SKUs.')}
              </span>
            )}
          </p>
        )}
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
        <div
          className={`mx-4 rounded-xl border bg-[#070b14] overflow-auto ${
            planMode
              ? 'border-dashed border-[#a78bfa]/50'
              : mode === 'live'
                ? 'border-accent/50'
                : 'border-subtle'
          } ${held ? 'cursor-crosshair' : ''}`}
        >
          <div style={{ width: `${zoom * 100}%` }}>
            <ZoneSvg
              config={config}
              state={state}
              model={model}
              stock={stock?.cells}
              showMeasures={layout}
              ghosts={planMode ? editor?.state.ghosts : undefined}
              gone={planMode ? editor?.state.gone : undefined}
              heldKey={editing ? editor?.heldKey : null}
              onHover={setHover}
              onHallClick={(idx, w) => setHallEdit({ idx, w: state.hallOverrides[idx] ?? w })}
              onCellTap={onCellTap}
            />
          </div>
        </div>
      )}

      {stock && stock.unplaced.length > 0 && (
        <div className="mx-4 mt-4 rounded-lg border border-amber-400/40 bg-card px-4 py-3">
          <p className="font-mono text-[11px] font-bold tracking-[.1em] text-amber-400">
            NOT ON THIS PLAN · {stock.unplaced.length} LINE{stock.unplaced.length === 1 ? '' : 'S'}{' '}
            · {fmt(stock.unplaced.reduce((s, u) => s + u.row.quantity, 0))} U
            {editing ? ' · TAP ONE TO PICK IT UP' : ''}
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {groupUnplaced(stock.unplaced).map((g) =>
              g.items.length === 1 ? (
                <li key={`${g.location}|${g.reason}`}>
                  <UnplacedLine
                    u={g.items[0]}
                    onOpen={openLine}
                    onPick={editing ? pickRow : undefined}
                    planned={planMode && !!editor?.state.vacated.has(g.items[0].row.id)}
                  />
                </li>
              ) : (
                <li key={`${g.location}|${g.reason}`}>
                  <details>
                    <summary className="cursor-pointer select-none font-mono text-[11px] text-content hover:text-accent flex flex-wrap gap-x-2">
                      <span className="font-bold">{g.location}</span>
                      <span>
                        {g.items.length} lines · <b>{fmt(g.units)}u</b>
                      </span>
                      <span className="text-amber-400/80">
                        {UNPLACED_REASON[g.reason](g.items[0])}
                      </span>
                    </summary>
                    <ul className="mt-1 ml-3 flex flex-col gap-0.5">
                      {g.items.map((u) => (
                        <li key={u.row.id}>
                          <UnplacedLine
                            u={u}
                            onOpen={openLine}
                            onPick={editing ? pickRow : undefined}
                            planned={planMode && !!editor?.state.vacated.has(u.row.id)}
                            compact
                          />
                        </li>
                      ))}
                    </ul>
                  </details>
                </li>
              )
            )}
          </ul>
        </div>
      )}

      <details className="mx-4 mt-4 rounded-lg border border-subtle bg-card px-4 py-3">
        <summary className="font-mono text-[11px] font-bold tracking-[.1em] text-muted cursor-pointer select-none">
          LEGEND
        </summary>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 font-mono text-[10px] tracking-[.1em] text-muted">
          <Legend
            color="#ffffff"
            alpha={0.7}
            fill="hsl(210 58% 42%)"
            text="UNITS IN THE SQUARE · SKU (ONE COLOUR PER SKU)"
          />
          <Legend
            color={COLOR.over}
            alpha={0.2}
            text={`! OVER THE CAP — MORE THAN ${SQUARE_MAX} IN ONE SQUARE`}
          />
          <Legend color={COLOR.fast} alpha={0.4} text="FAST PICKING — TOUCHES OPEN FLOOR" />
          <Legend color={COLOR.buried} alpha={0.2} text="BURIED — NEEDS THE FRONT MOVED" />
          <Legend color={COLOR.bikes} alpha={0.3} text="BIKE BLOCK — LEFTOVER AT THE FRONT" />
          {hasPosts && <Legend color={COLOR.post} alpha={1} text="STRUCTURAL POST (HITS SLOT)" />}
          {editor && (
            <>
              <Legend color={COLOR.buried} alpha={0.3} dashed text="PLAN — LANDS HERE (→)" />
              <Legend color={COLOR.fast} alpha={0.15} text="PLAN — LEAVES (↗, DIMMED)" />
            </>
          )}
        </div>
        <p className="mt-3 font-mono text-[10px] leading-relaxed text-muted">
          A square holds one double-stacked pallet, {PALLET_UNITS} units — {SQUARE_MAX} is the hard
          cap, and PLAN spreads any square over it automatically; a line with more spans as many
          squares as it needs and shows its share in each. A line the plan has no square for is
          listed above, never squeezed in.
          {editor
            ? ' PLAN: tap a square to pick up its pallet (a line spread over squares moves one square at a time), tap where it goes — empty → it goes; one line there → they swap; several → it joins; DISTRIBUTE spreads every line at 30 a square, overflow to free buried squares and then the MAIN HALL in front of its block; nothing moves until PLAN COMPLETED. LIVE: the same two taps, then a confirmation, and it moves now.'
            : ''}
        </p>
      </details>
    </div>
  );
};

const UnplacedLine: React.FC<{
  u: Unplaced;
  compact?: boolean;
  planned?: boolean;
  onOpen: OpenLine;
  onPick?: (row: StockRow) => void;
}> = ({ u, compact, planned, onOpen, onPick }) => {
  const open = () => onOpen(u.row.sku, u.row.itemName, u.row.location, u.row.warehouse);
  return (
    <PressButton
      onTap={onPick ? () => onPick(u.row) : open}
      onLong={onPick ? open : undefined}
      className={`w-full text-left font-mono text-[11px] hover:text-accent flex flex-wrap gap-x-2 ${
        planned ? 'text-muted line-through decoration-[#a78bfa]' : 'text-content'
      }`}
      title={onPick ? 'Tap to pick up · hold for detail' : undefined}
    >
      {!compact && <span className="font-bold">{u.row.location.trim().toUpperCase()}</span>}
      <span className="text-muted">
        {u.row.sublocation && u.row.sublocation.length > 0 ? u.row.sublocation.join('') : '—'}
      </span>
      <span>{u.row.sku}</span>
      <span className="font-bold">{u.row.quantity}u</span>
      {!compact && <span className="text-amber-400/80">{UNPLACED_REASON[u.reason](u)}</span>}
    </PressButton>
  );
};

const Legend: React.FC<{
  color: string;
  alpha: number;
  fill?: string;
  dashed?: boolean;
  text: string;
}> = ({ color, alpha, fill, dashed, text }) => (
  <span className="flex items-center gap-2">
    <i
      className={`inline-block w-3 h-3 rounded-[3px] border-[1.5px] ${dashed ? 'border-dashed' : ''}`}
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
