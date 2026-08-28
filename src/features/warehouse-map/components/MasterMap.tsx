// The three bays to scale, free space per zone; tap a zone to open its
// layout. Port of warehouse_map.html (2026-08-28, idea-170), drawn off the
// blueprint in inches. The numbers panel is a card next to the drawing, not a
// fixed corner: on a phone the corner is the drawing.

import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import {
  BAYS,
  G,
  M,
  SOUTH_Y,
  WEST_X,
  ft,
  sqft,
  toFtIn,
  bayAreas,
  warehouseAreas,
  freeZonesOf,
} from '../engine';
import { ZONES, ZONE_IDS } from '../engine';
import type { Bay, BayId, FreeZone, ZoneId } from '../engine';
import { useWarehouseStock } from '../hooks/useWarehouseStock';
import { zoneRows, outsideAnyPlan } from '../stock/rowStock';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/** Room for the bay labels above the north walls, inches. */
const PAD = ft(9);

/** Tapping the bay itself, off any zone, opens its main layout. */
const BAY_LAYOUT: Record<BayId, ZoneId> = {
  bay1: 'bay1_north',
  bay2: 'bay2_north',
  bay3: 'bay3_north',
};

/* The west rack does not move in one piece: part of it stays in Bay 3, south of
   the main hall, and part goes to the south wall of Bay 2. Off by default — the
   map is a survey of the building, and this is the one annotation that argues
   for something. */
const RACK_FROM = { x: G.bay3West, y: G.bay3North, w: ft(4), h: G.hall3Top - G.bay3North };
const RACK_P1 = { x: G.bay3West, y: G.hall3Bot + ft(0, 8), w: ft(12), h: ft(9) };
const RACK_P2 = { x: G.bay2East - ft(23), y: SOUTH_Y - ft(4), w: ft(23), h: ft(4) };

type Focus = { kind: 'bay'; bay: Bay } | { kind: 'zone'; bay: Bay; zone: FreeZone };

export const MasterMap: React.FC = () => {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rackMove = params.get('move') === 'rack';

  const [hoverBay, setHoverBay] = useState<BayId | null>(null);
  const [hoverZone, setHoverZone] = useState<FreeZone | null>(null);
  const [pinned, setPinned] = useState<FreeZone | null>(null);

  const areas = useMemo(() => Object.fromEntries(BAYS.map((b) => [b.id, bayAreas(b)])), []);
  const totals = useMemo(() => warehouseAreas(), []);

  const activeBay: BayId | null = pinned?.bay ?? hoverBay;
  const focus: Focus | null = useMemo(() => {
    const zone = pinned ?? hoverZone;
    if (zone) return { kind: 'zone', bay: BAYS.find((b) => b.id === zone.bay)!, zone };
    if (hoverBay) return { kind: 'bay', bay: BAYS.find((b) => b.id === hoverBay)! };
    return null;
  }, [pinned, hoverZone, hoverBay]);

  const openZone = (zoneId: ZoneId) => navigate({ search: `?zone=${zoneId}` });
  const toggleRackMove = () => {
    const next = new URLSearchParams(params);
    if (rackMove) next.delete('move');
    else next.set('move', 'rack');
    setParams(next, { replace: true });
  };

  // What the DB puts in the rows of each zone — the map's link to the stock.
  const stockQuery = useWarehouseStock();
  const stockByZone = useMemo(() => {
    if (!stockQuery.data) return null;
    const units: Partial<Record<ZoneId, number>> = {};
    for (const id of ZONE_IDS) {
      units[id] = zoneRows(ZONES[id], stockQuery.data).reduce((s, r) => s + r.quantity, 0);
    }
    return units;
  }, [stockQuery.data]);
  const outside = useMemo(
    () =>
      stockQuery.data
        ? outsideAnyPlan(
            ZONE_IDS.map((id) => ZONES[id]),
            stockQuery.data
          )
        : [],
    [stockQuery.data]
  );
  const stockUnitsOf = (f: Focus): number | null => {
    if (!stockByZone) return null;
    if (f.kind === 'zone') return f.zone.zoneId ? (stockByZone[f.zone.zoneId] ?? 0) : 0;
    return freeZonesOf(f.bay.id).reduce(
      (s, z) => s + (z.zoneId ? (stockByZone[z.zoneId] ?? 0) : 0),
      0
    );
  };

  const minNorth = Math.min(...BAYS.map((b) => b.north));
  const viewBox = rackMove
    ? `${G.bay2West - 26} ${Math.min(G.bay2North, G.bay3North) - 65} ${G.bay3East + 48 - (G.bay2West - 26)} ${SOUTH_Y + 41 - (Math.min(G.bay2North, G.bay3North) - 65)}`
    : `${WEST_X - PAD} ${minNorth - PAD - 41} ${G.bay3East - WEST_X + PAD * 2} ${SOUTH_Y - (minNorth - PAD - 41) + PAD}`;

  return (
    <div className="flex flex-col">
      <div className="sticky top-0 z-10 bg-surface border-b border-subtle px-4 py-3 flex items-center gap-3">
        <Link
          to="/"
          className="p-2 -ml-2 rounded-xl text-muted hover:text-content hover:bg-card transition-colors"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="font-mono text-[13px] sm:text-[15px] font-extrabold tracking-[.18em] text-content truncate">
            WAREHOUSE MAP — JAMIS BIKES
          </h1>
          <p className="font-mono text-[10px] tracking-[.14em] text-muted truncate">
            362 FT END TO END · THREE BAYS · MEASURED FROM THE INSIDE
          </p>
        </div>
        <button
          type="button"
          onClick={toggleRackMove}
          aria-pressed={rackMove}
          className={`px-3 py-2 rounded-lg border font-mono text-[11px] tracking-[.1em] font-bold whitespace-nowrap transition-colors ${
            rackMove
              ? 'border-red-400 bg-red-500/15 text-red-400'
              : 'border-subtle bg-card text-muted hover:text-content'
          }`}
        >
          RACK MOVE
        </button>
      </div>

      <div className="grid grid-cols-3 sm:flex sm:flex-wrap gap-x-8 gap-y-3 px-4 pt-4 pb-3">
        <Total label="TOTAL AREA" value={fmt(totals.totalArea)} unit="sq ft" />
        <Total label="FREE SPACE" value={fmt(totals.freeArea)} unit="sq ft" />
        <Total label="UTILIZATION" value={String(Math.round(totals.pctFree))} unit="% free" />
      </div>
      {outside.length > 0 && (
        <p className="px-4 pb-3 font-mono text-[11px] tracking-[.05em] text-amber-400">
          NOT ON ANY PLAN ·{' '}
          {outside
            .map((r) => `${r.location.trim().toUpperCase()} ${r.sku} ${r.quantity}u`)
            .join(' · ')}
        </p>
      )}

      <div className="px-4 lg:grid lg:grid-cols-[1fr_290px] lg:gap-4 lg:items-start">
        <div className="rounded-xl border border-subtle bg-[#070b14] overflow-hidden">
          <svg
            viewBox={viewBox}
            xmlns="http://www.w3.org/2000/svg"
            className="block w-full select-none"
            role="img"
            aria-label="The three bays of the warehouse"
            style={rackMove ? { maxHeight: '80vh' } : undefined}
          >
            <defs>
              <filter id="wm-glow" x="-25%" y="-25%" width="150%" height="150%">
                <feGaussianBlur stdDeviation="11" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker
                id="wm-arrow"
                viewBox="0 0 12 12"
                refX="10"
                refY="6"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 12 6 L 0 12 z" fill="#ef4444" />
              </marker>
            </defs>
            <style>{`
              .wm-bay { cursor: pointer; transition: opacity .28s ease; }
              .wm-bay-shell { transition: filter .28s ease; }
              .wm-dim { opacity: .26; }
              .wm-on .wm-bay-shell { filter: url(#wm-glow); }
              .wm-brackets { opacity: 0; transition: opacity .22s ease; }
              .wm-on .wm-brackets { opacity: 1; }
              .wm-zone { transition: fill-opacity .18s ease, stroke-opacity .18s ease; }
              .wm-zone-lit { fill-opacity: .45 !important; stroke-opacity: 1 !important; stroke-width: 3.6 !important; }
            `}</style>

            {BAYS.map((b) => {
              const w = b.x1 - b.x0;
              const hh = SOUTH_Y - b.north;
              const on = activeBay === b.id;
              const dim = (activeBay !== null && !on) || (rackMove && b.id === 'bay1');
              const L = ft(4, 5);
              const o = ft(1, 4);
              const zones = freeZonesOf(b.id);
              const litZone = pinned ?? hoverZone;
              return (
                <g
                  key={b.id}
                  className={`wm-bay${on ? ' wm-on' : ''}${dim ? ' wm-dim' : ''}`}
                  style={rackMove && b.id === 'bay1' ? { opacity: 0.16 } : undefined}
                  onPointerEnter={() => setHoverBay(b.id)}
                  onPointerLeave={() => {
                    setHoverBay(null);
                    setHoverZone(null);
                  }}
                >
                  <g className="wm-bay-shell">
                    <rect
                      x={b.x0}
                      y={b.north}
                      width={w}
                      height={hh}
                      rx="5"
                      fill={b.color}
                      fillOpacity="0.05"
                      stroke={b.color}
                      strokeOpacity="0.5"
                      strokeWidth="3.6"
                    />
                  </g>

                  {zones.map((z) => (
                    <g key={z.name} pointerEvents="none">
                      <rect
                        className={`wm-zone${litZone === z ? ' wm-zone-lit' : ''}`}
                        x={z.x}
                        y={z.y}
                        width={z.w}
                        height={z.h}
                        rx="4"
                        fill={b.color}
                        fillOpacity="0.2"
                        stroke={b.color}
                        strokeOpacity="0.55"
                        strokeWidth="1.8"
                      />
                      {z.w > ft(17) && z.h > ft(7) && (
                        <>
                          <text
                            x={z.x + z.w / 2}
                            y={z.y + z.h / 2 - 5}
                            fontSize="26"
                            fill={b.color}
                            textAnchor="middle"
                            fontWeight="800"
                            fontFamily={MONO}
                          >
                            {z.name}
                          </text>
                          <text
                            x={z.x + z.w / 2}
                            y={z.y + z.h / 2 + 20}
                            fontSize="21"
                            fill={b.color}
                            opacity="0.75"
                            textAnchor="middle"
                            fontWeight="600"
                            fontFamily={MONO}
                          >
                            {fmt(sqft(z.w, z.h))} sq ft
                          </text>
                        </>
                      )}
                    </g>
                  ))}

                  {b.used.map((u) => (
                    <g key={u.name} pointerEvents="none">
                      <rect
                        x={u.x}
                        y={u.y}
                        width={u.w}
                        height={u.h}
                        rx="4"
                        fill="#131c2e"
                        stroke="#2b3a52"
                        strokeWidth="1.8"
                      />
                      {u.w > ft(13) && u.h > ft(6) && (
                        <text
                          x={u.x + u.w / 2}
                          y={u.y + u.h / 2 + 6}
                          fontSize="20"
                          fill="#64748b"
                          textAnchor="middle"
                          fontWeight="800"
                          fontFamily={MONO}
                        >
                          {u.name}
                        </text>
                      )}
                    </g>
                  ))}
                  {b.usedPolygon && (
                    <g pointerEvents="none">
                      <path
                        d={`M ${b.usedPolygon.points.map((p) => p.join(',')).join(' L ')} Z`}
                        fill="#131c2e"
                        stroke="#2b3a52"
                        strokeWidth="1.8"
                      />
                      <text
                        x={(b.x0 + G.bay3OfficeR) / 2}
                        y={(G.bay3KitchenTop + SOUTH_Y) / 2}
                        fontSize="20"
                        fill="#64748b"
                        textAnchor="middle"
                        fontWeight="800"
                        fontFamily={MONO}
                      >
                        {b.usedPolygon.name}
                      </text>
                    </g>
                  )}

                  {/* The main hall */}
                  <g pointerEvents="none">
                    <rect
                      x={b.x0}
                      y={b.hallTop}
                      width={w}
                      height={M.hallwayWidth}
                      fill="#0c1322"
                      stroke="#1e293b"
                      strokeWidth="1.8"
                    />
                    <line
                      x1={b.x0 + 17}
                      y1={b.hallTop + M.hallwayWidth / 2}
                      x2={b.x1 - 17}
                      y2={b.hallTop + M.hallwayWidth / 2}
                      stroke="#334155"
                      strokeWidth="2.4"
                      strokeDasharray="19 17"
                    />
                  </g>

                  <text
                    x={b.x0 + w / 2}
                    y={b.north - 36}
                    fontSize="36"
                    fill={b.color}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                    letterSpacing="8"
                    pointerEvents="none"
                  >
                    {b.name}
                  </text>

                  <g
                    className="wm-brackets"
                    stroke={b.color}
                    strokeWidth="4.2"
                    fill="none"
                    strokeLinecap="round"
                    pointerEvents="none"
                  >
                    <path
                      d={`M ${b.x0 - o},${b.north - o + L} V ${b.north - o} H ${b.x0 - o + L}`}
                    />
                    <path
                      d={`M ${b.x1 + o - L},${b.north - o} H ${b.x1 + o} V ${b.north - o + L}`}
                    />
                    <path
                      d={`M ${b.x1 + o},${SOUTH_Y + o - L} V ${SOUTH_Y + o} H ${b.x1 + o - L}`}
                    />
                    <path
                      d={`M ${b.x0 - o + L},${SOUTH_Y + o} H ${b.x0 - o} V ${SOUTH_Y + o - L}`}
                    />
                  </g>

                  {/* Catches the bay; the zone hits below sit on top of it */}
                  <rect
                    x={b.x0}
                    y={b.north}
                    width={w}
                    height={hh}
                    fill="transparent"
                    onClick={() => openZone(BAY_LAYOUT[b.id])}
                  >
                    <title>{`${b.name} · ${fmt(areas[b.id].freeArea)} sq ft free · tap to open its layout`}</title>
                  </rect>
                  {zones.map((z) => (
                    <rect
                      key={`hit-${z.name}`}
                      x={z.x}
                      y={z.y}
                      width={z.w}
                      height={z.h}
                      fill="transparent"
                      style={{ cursor: 'pointer' }}
                      onPointerEnter={() => setHoverZone(z)}
                      onPointerLeave={() => setHoverZone(null)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (z.zoneId) openZone(z.zoneId);
                        else setPinned((p) => (p === z ? null : z));
                      }}
                    >
                      <title>{`${z.name} · ${fmt(sqft(z.w, z.h))} sq ft · ${z.zoneId ? 'tap to open its layout' : 'no layout modelled yet'}`}</title>
                    </rect>
                  ))}
                </g>
              );
            })}

            {rackMove && <RackMoveOverlay />}
          </svg>
        </div>

        <aside className="mt-4 lg:mt-0 lg:sticky lg:top-20 rounded-xl border border-subtle bg-card p-4">
          {focus ? (
            <Hud
              focus={focus}
              areas={areas}
              pinned={pinned !== null}
              stockUnits={stockUnitsOf(focus)}
            />
          ) : (
            <p className="font-mono text-[11px] tracking-[.1em] text-muted leading-relaxed">
              HOVER A BAY · TAP A ZONE TO OPEN ITS LAYOUT
              <br />
              <span className="text-muted/70">
                BAY 1 {fmt(areas.bay1.freeArea)} · BAY 2 {fmt(areas.bay2.freeArea)} · BAY 3{' '}
                {fmt(areas.bay3.freeArea)} SQ FT FREE
              </span>
            </p>
          )}
        </aside>
      </div>

      <p className="px-4 pt-4 font-mono text-[10px] tracking-[.1em] text-muted/70 leading-relaxed">
        MEASURED IN INCHES · GROSS AREA, COLUMNS NOT DEDUCTED ·{' '}
        <Link to="/warehouse-map/legacy" className="underline hover:text-content">
          PLAN / LIVE (LEGACY, UNTIL F4)
        </Link>
      </p>
    </div>
  );
};

const Total: React.FC<{ label: string; value: string; unit: string }> = ({
  label,
  value,
  unit,
}) => (
  <div>
    <div className="font-mono text-[9.5px] tracking-[.14em] text-muted/70">{label}</div>
    <div className="font-mono text-[21px] font-extrabold text-content mt-1 whitespace-nowrap tabular-nums">
      {value}
      <small className="text-[11px] text-muted font-semibold ml-1">{unit}</small>
    </div>
  </div>
);

const Hud: React.FC<{
  focus: Focus;
  areas: Record<string, { freeArea: number; totalArea: number; pctFree: number }>;
  pinned: boolean;
  /** Units the DB puts in this bay's or zone's rows; null while unknown. */
  stockUnits: number | null;
}> = ({ focus, areas, pinned, stockUnits }) => {
  const b = focus.bay;
  const a = areas[b.id];
  const isZone = focus.kind === 'zone';
  const area = isZone ? sqft(focus.zone.w, focus.zone.h) : a.freeArea;
  const pct = isZone ? (area / a.totalArea) * 100 : a.pctFree;
  const name = isZone ? focus.zone.name : b.name;
  const sub = isZone ? `${b.name} · ${toFtIn(focus.zone.w)} × ${toFtIn(focus.zone.h)}` : b.sub;
  const hint = isZone
    ? focus.zone.zoneId
      ? 'TAP TO OPEN LAYOUT'
      : pinned
        ? '◆ PINNED · TAP TO RELEASE'
        : 'NO LAYOUT MODELLED YET · TAP TO PIN'
    : 'TAP TO OPEN LAYOUT';
  return (
    <div>
      <div className="h-[3px] rounded-sm mb-3" style={{ background: b.color }} />
      <h2 className="text-base font-extrabold tracking-[.1em]" style={{ color: b.color }}>
        {name}
      </h2>
      <p className="font-mono text-[10px] tracking-[.13em] text-muted mt-1">{sub}</p>
      <div className="mt-4">
        <div className="font-mono text-[9.5px] tracking-[.15em] text-muted/70">FREE SPACE</div>
        <div className="font-mono text-2xl font-extrabold mt-0.5" style={{ color: b.color }}>
          {fmt(area)} <small className="text-[11px] text-muted font-semibold">sq ft</small>
        </div>
        <div className="h-1.5 bg-[#111a2b] rounded-sm mt-2 overflow-hidden">
          <i
            className="block h-full rounded-sm transition-[width] duration-300"
            style={{ width: `${Math.min(100, pct)}%`, background: b.color }}
          />
        </div>
      </div>
      <div className="mt-4">
        <div className="font-mono text-[9.5px] tracking-[.15em] text-muted/70">BAY AREA</div>
        <div className="font-mono text-2xl font-extrabold text-content mt-0.5">
          {fmt(a.totalArea)} <small className="text-[11px] text-muted font-semibold">sq ft</small>
        </div>
      </div>
      <div className="mt-4">
        <div className="font-mono text-[9.5px] tracking-[.15em] text-muted/70">
          {isZone ? 'SHARE OF THE BAY' : 'UTILIZATION'}
        </div>
        <div className="font-mono text-2xl font-extrabold mt-0.5" style={{ color: b.color }}>
          {Math.round(pct)}
          <small className="text-[11px] text-muted font-semibold">
            {isZone ? '% of bay' : '% free'}
          </small>
        </div>
      </div>
      {stockUnits !== null && (
        <div className="mt-4">
          <div className="font-mono text-[9.5px] tracking-[.15em] text-muted/70">STOCK IN ROWS</div>
          <div className="font-mono text-2xl font-extrabold text-content mt-0.5">
            {fmt(stockUnits)} <small className="text-[11px] text-muted font-semibold">units</small>
          </div>
        </div>
      )}
      <p className="mt-4 pt-3 border-t border-subtle font-mono text-[10px] tracking-[.1em] text-muted/70">
        {hint}
      </p>
    </div>
  );
};

const RackMoveOverlay: React.FC = () => {
  const RED = '#ef4444';
  const box = (b: { x: number; y: number; w: number; h: number }, dash: boolean) => (
    <rect
      x={b.x}
      y={b.y}
      width={b.w}
      height={b.h}
      fill={RED}
      fillOpacity={dash ? 0.16 : 0.3}
      stroke={RED}
      strokeWidth="3.6"
      strokeDasharray={dash ? '16 10' : undefined}
    />
  );
  const label = (x: number, y: number, txt: string, anchor: 'start' | 'middle') => (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fill={RED}
      fontFamily={MONO}
      fontSize="20"
      fontWeight="800"
      letterSpacing="3"
    >
      {txt}
    </text>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number) => (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={RED}
      strokeWidth="4.8"
      strokeLinecap="round"
      markerEnd="url(#wm-arrow)"
    />
  );
  return (
    <g pointerEvents="none">
      {box(RACK_FROM, false)}
      {label(
        RACK_FROM.x + RACK_FROM.w + 19,
        RACK_FROM.y + RACK_FROM.h * 0.5,
        'WEST RACK — TODAY',
        'start'
      )}
      {box(RACK_P1, true)}
      {label(RACK_P1.x + RACK_P1.w / 2, RACK_P1.y + RACK_P1.h + 31, 'PART 1', 'middle')}
      {box(RACK_P2, true)}
      {label(RACK_P2.x + RACK_P2.w / 2, RACK_P2.y - 19, 'PART 2', 'middle')}
      {arrow(
        RACK_FROM.x + RACK_FROM.w / 2,
        RACK_FROM.y + RACK_FROM.h + 2,
        RACK_P1.x + RACK_P1.w / 2,
        RACK_P1.y - 12
      )}
      {arrow(
        RACK_FROM.x,
        RACK_FROM.y + RACK_FROM.h - 10,
        RACK_P2.x + RACK_P2.w * 0.72,
        RACK_P2.y - 14
      )}
    </g>
  );
};
