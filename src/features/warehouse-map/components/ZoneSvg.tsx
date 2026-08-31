// One zone, drawn. Everything is in inches inside the viewBox — the SVG scales
// to whatever it is given — and every colour is explicit, because the floor
// is dark whatever the app's theme is (a plan reads the same on paper).
//
// Port of the old PalletEngine.renderSVG (2026-08-28, idea-170). The colours
// are the plans' own: amber = fast, violet = buried, green = loose bike
// lines, red = a post or the slot it kills. Measures (hall widths, inches on
// hover) are drawn only when asked: the floor reads stock, LAYOUT reads inches.

import React, { useState } from 'react';
import type { Cell, EngineState, LayoutModel, Obstacle, ZoneConfig } from '../engine';
import { BIKES_PER_LINE, slotKey } from '../engine';
import { describeCell, PALLET_UNITS, type CellStock } from '../stock/rowStock';
import type { GhostSlot } from '../plan/slotPlan';
import { skuColorDark } from '../../../utils/skuColor';

/** Margin around the zone, inches of viewBox, for the wall labels. */
export const SVG_MARGIN = 96;

export const COLOR = {
  ground: '#0d1524',
  wall: '#334155',
  hall: '#0a1120',
  hallLine: '#1e293b',
  hallDash: '#334155',
  hallText: '#475569',
  fast: '#f59e0b',
  buried: '#a78bfa',
  bikes: '#39ff14',
  post: '#ef4444',
  over: '#fb923c',
  gain: 'rgba(52,211,153,0.15)',
  label: '#475569',
  depthMajor: '#94a3b8',
  depthMinor: '#64748b',
} as const;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface HoverTarget {
  text: string;
  /** Set when the target is a slot, for whoever wants to act on it. */
  cell?: Cell;
  /** Set when the target is a hall that can be resized. */
  hallIdx?: number;
}

interface Props {
  config: ZoneConfig;
  state: EngineState;
  model: LayoutModel;
  /** What the DB says is in each slot, by `slotKey`. Absent = plan only. */
  stock?: Map<string, CellStock>;
  /** Draw hall widths and inches; make halls hoverable and resizable. */
  showMeasures?: boolean;
  onHover: (target: HoverTarget | null) => void;
  onHallClick?: (hallIdx: number, width: number) => void;
  onCellTap?: (cell: Cell, stock: CellStock | undefined) => void;
  /** Planned moves landing in each slot (PLAN mode): drawn as ghosts. */
  ghosts?: Map<string, GhostSlot[]>;
  /** Is this line's share gone from this square once the plan runs? */
  gone?: (inventoryId: number, letter: string) => boolean;
  /** The slot of the line in hand, marked so the eye finds it. */
  heldKey?: string | null;
}

function obstacleStyle(type: Obstacle['type']) {
  switch (type) {
    case 'non_bike_rack':
      return { fill: '#312e81', stroke: '#6366f1', strokeWidth: 2, dash: undefined };
    case 'restricted':
      return { fill: '#450a0a', stroke: '#ef4444', strokeWidth: 2, dash: undefined };
    case 'staging':
      return { fill: 'rgba(8,47,73,0.6)', stroke: '#0284c7', strokeWidth: 2, dash: '6 4' };
    case 'rack':
      return { fill: 'rgba(239,68,68,0.08)', stroke: '#ef4444', strokeWidth: 2, dash: undefined };
    default:
      return { fill: COLOR.hall, stroke: COLOR.hallLine, strokeWidth: 1, dash: '8 8' };
  }
}

/** The units and SKU inside a square — white on the SKU's own colour. */
const StockLabel: React.FC<{ stock: CellStock; cl: Cell; m: number; opacity?: number }> = ({
  stock: st,
  cl,
  m,
  opacity = 1,
}) => {
  const side = Math.min(cl.cw, cl.ch);
  const midX = m + cl.cx + cl.cw / 2;
  const midY = m + cl.cy + cl.ch / 2;
  return (
    <g opacity={opacity} pointerEvents="none">
      <text
        x={midX}
        y={midY + side * 0.06}
        fontSize={side * 0.34}
        fill="#ffffff"
        fontWeight="800"
        textAnchor="middle"
        fontFamily={MONO}
      >
        {st.units}
      </text>
      <text
        x={midX}
        y={midY + side * 0.34}
        fontSize={side * 0.15}
        fill="#ffffff"
        fillOpacity="0.9"
        textAnchor="middle"
        fontFamily={MONO}
      >
        {st.entries.length > 1 ? `${st.entries.length} SKUs` : st.entries[0].sku}
      </text>
    </g>
  );
};

/** What PLAN paints on a square: a ghost of what will land there. */
function ghostStockOf(key: string, cl: Cell, gh: GhostSlot[]): CellStock {
  return {
    key,
    rowNumber: Number(cl.row.num),
    letter: cl.letter,
    units: gh.reduce((s, g) => s + g.qtyHere, 0),
    entries: gh.map((g) => ({
      sku: g.move.sku,
      qty: g.move.qty,
      qtyHere: g.qtyHere,
      itemName: g.move.itemName,
      rowId: g.move.inventoryId,
      warehouse: g.move.warehouse,
      span: g.move.toLetters.length,
    })),
  };
}

const Marks: React.FC<{
  cl: Cell;
  m: number;
  landing: boolean;
  leaving: boolean;
  over: boolean;
}> = ({ cl, m, landing, leaving, over }) => {
  const side = Math.min(cl.cw, cl.ch);
  const fs = side * 0.24;
  return (
    <g pointerEvents="none" fontFamily={MONO} fontWeight="800" fontSize={fs}>
      {leaving && (
        <text x={m + cl.cx + fs * 0.35} y={m + cl.cy + fs} fill={COLOR.fast}>
          ↗
        </text>
      )}
      {over && !leaving && (
        <text x={m + cl.cx + fs * 0.35} y={m + cl.cy + fs} fill={COLOR.over}>
          !
        </text>
      )}
      {landing && (
        <text
          x={m + cl.cx + cl.cw - fs * 0.35}
          y={m + cl.cy + fs}
          fill={COLOR.buried}
          textAnchor="end"
        >
          →
        </text>
      )}
    </g>
  );
};

export const ZoneSvg: React.FC<Props> = ({
  config,
  state,
  model: m,
  stock,
  showMeasures = false,
  onHover,
  onHallClick,
  onCellTap,
  ghosts,
  gone,
  heldKey,
}) => {
  const c = config;
  const s = state;
  const M = SVG_MARGIN;

  const hover = (target: HoverTarget) => ({
    onPointerEnter: () => onHover(target),
    onPointerLeave: () => onHover(null),
    onClick: () => onHover(target),
  });

  const usableX0 = M + m.margins.left;
  const northY = M + m.margins.top;
  const southY = M + c.height - m.margins.bottom;
  const usableEW = c.width - m.margins.left - m.margins.right;
  const usableNS = southY - northY;
  const isReverse = c.mainAccess === 'south' || c.mainAccess === 'east';

  const bikesInBlock = m.lines * BIKES_PER_LINE;
  const hitPostIds = new Set(m.hits.map((h) => h.source.id));

  /** A square: its stock, its ghosts, what leaves it, what it holds over a pallet. */
  const square = (cl: Cell, obstructed: boolean) => {
    const key = slotKey(cl);
    const st = stock?.get(key);
    const gh = ghosts?.get(key) ?? [];
    const leaving = st ? st.entries.filter((e) => gone?.(e.rowId, st.letter) ?? false).length : 0;
    const allLeaving = !!st && leaving === st.entries.length;
    const ghostOnly = !st && gh.length > 0 ? ghostStockOf(key, cl, gh) : null;
    const over = !!st && st.units > PALLET_UNITS;
    const where = `ROW ${cl.row.num} · ${cl.letter}`;
    const plain = showMeasures
      ? `${where} · ${cl.cw}"×${cl.ch}" · ${cl.isFast ? 'Fast Picking' : 'Buried'}${obstructed ? ' · OBSTRUCTED' : ''}`
      : `${where} · empty${obstructed ? ' · OBSTRUCTED BY A POST' : ''}`;
    const text =
      (st ? `${describeCell(st)}${obstructed ? ' · OBSTRUCTED BY A POST' : ''}` : plain) +
      (gh.length
        ? ` · planned here: ${gh.map((g) => `${g.move.sku} ${g.qtyHere}u`).join(', ')}`
        : '');
    const tone = st
      ? skuColorDark(st.entries[0].sku)
      : ghostOnly
        ? skuColorDark(gh[0].move.sku)
        : null;
    const isHeld = heldKey === key;
    return { key, st, gh, leaving, allLeaving, ghostOnly, over, text, tone, isHeld };
  };

  // Hovering (or tapping) a square lights every square holding one of its
  // SKUs, live or planned — not just the one under the pointer (Rafael,
  // 31 Aug 2026).
  const [hotSkus, setHotSkus] = useState<Set<string> | null>(null);
  const skusOf = (q: ReturnType<typeof square>): Set<string> | null => {
    const skus = new Set<string>();
    for (const e of q.st?.entries ?? []) skus.add(e.sku);
    for (const g of q.gh) skus.add(g.move.sku);
    return skus.size > 0 ? skus : null;
  };
  const isHot = (q: ReturnType<typeof square>) =>
    !!hotSkus &&
    ((q.st?.entries.some((e) => hotSkus.has(e.sku)) ?? false) ||
      q.gh.some((g) => hotSkus.has(g.move.sku)));

  return (
    <svg
      viewBox={`0 0 ${c.width + 2 * M} ${c.height + 2 * M}`}
      xmlns="http://www.w3.org/2000/svg"
      className="block select-none"
      role="img"
      aria-label={`${c.name} pallet layout`}
    >
      <style>{`
        .wm-hit { cursor: crosshair; transition: fill .1s ease, stroke .1s ease; }
        .wm-hit:hover { fill: rgba(0,238,255,0.4) !important; stroke: #00eeff !important; stroke-width: 2.5 !important; stroke-dasharray: none !important; }
        .wm-hall { cursor: pointer; }
      `}</style>

      {/* Compass, top-left: north is up in every zone. */}
      <g transform="translate(45 45) scale(0.6)" pointerEvents="none">
        <circle r="25" fill="none" stroke={COLOR.wall} strokeWidth="2" />
        <path d="M 0 -30 L 7 -7 L 30 0 L 7 7 L 0 30 L -7 7 L -30 0 L -7 -7 Z" fill="#1e293b" />
        <path d="M 0 -30 L 7 -7 L 0 0 L -7 -7 Z" fill={COLOR.fast} />
        <text
          y="-38"
          fill={COLOR.depthMajor}
          fontSize="14"
          textAnchor="middle"
          fontWeight="bold"
          fontFamily={MONO}
        >
          N
        </text>
      </g>

      {/* The zone's floor */}
      <rect
        x={M}
        y={M}
        width={c.width}
        height={c.height}
        fill={COLOR.ground}
        stroke={COLOR.wall}
        strokeWidth="3"
      />

      {/* Halls, racks, clearances — and anything drawn on top */}
      {m.obstacles.map((obs) => {
        const st = obstacleStyle(obs.type);
        const name = (obs.label ?? '').replace(/\s*\(.*\)\s*$/, '') || 'HALL';
        const text = showMeasures
          ? `${obs.label ?? 'Obstacle'} (${Math.round(obs.w)}" × ${Math.round(obs.h)}")`
          : name;
        const horiz = obs.w >= obs.h;
        const thick = Math.round(horiz ? obs.h : obs.w);
        const lx = M + obs.x + obs.w / 2;
        const ly = M + obs.y + obs.h / 2 + (obs.labelDy ?? 0);
        const fs = Math.max(11, Math.min(17, Math.min(obs.w, obs.h) * 0.22));
        const inert = !showMeasures;
        return (
          <g key={obs.id}>
            <rect
              className={inert ? undefined : 'wm-hit'}
              x={M + obs.x}
              y={M + obs.y}
              width={obs.w}
              height={obs.h}
              fill={st.fill}
              stroke={st.stroke}
              strokeWidth={st.strokeWidth}
              strokeDasharray={st.dash}
              pointerEvents={inert ? 'none' : undefined}
              {...(inert ? {} : hover({ text }))}
            >
              {!inert && <title>{text}</title>}
            </rect>
            {obs.showLabel && (obs.type === 'hall' || obs.type === 'rack') && (
              <text
                x={lx}
                y={ly + fs * 0.35}
                transform={horiz ? undefined : `rotate(-90 ${lx} ${ly})`}
                fontSize={fs}
                fill={obs.type === 'rack' ? '#fca5a5' : COLOR.depthMinor}
                textAnchor="middle"
                fontWeight="800"
                letterSpacing="2"
                fontFamily={MONO}
                pointerEvents="none"
              >
                {showMeasures ? `${name} · ${thick}"` : name}
              </text>
            )}
          </g>
        );
      })}

      {/* The strip: halls between blocks, block outlines, row numbers */}
      {m.strip.map((seg, i) => {
        if (seg.type === 'hall') {
          if (seg.isExtraOnly) {
            const text = `EXTRA WEST SPACE: ${Math.round(seg.extra ?? 0)}"`;
            const props = showMeasures ? hover({ text }) : { pointerEvents: 'none' as const };
            return s.isEW ? (
              <rect
                key={i}
                x={usableX0}
                y={northY + seg.x}
                width={usableEW}
                height={seg.extra}
                fill={COLOR.gain}
                {...props}
              />
            ) : (
              <rect
                key={i}
                x={usableX0 + seg.x}
                y={northY}
                width={seg.extra}
                height={usableNS}
                fill={COLOR.gain}
                {...props}
              />
            );
          }
          const w = Math.round(seg.w);
          const resizable = showMeasures && seg.idx !== undefined;
          const text = s.isEW
            ? `HALL · ${Math.round(usableEW)}" × ${w}"${resizable ? ' (tap to resize)' : ''}`
            : `HALL · ${w}" × ${Math.round(usableNS)}"${resizable ? ' (tap to resize)' : ''}`;
          const extra = seg.extra ?? 0;
          const onClick = () => {
            onHover({ text, hallIdx: seg.idx });
            if (resizable && onHallClick) onHallClick(seg.idx!, w);
          };
          const hallProps = showMeasures
            ? {
                className: `wm-hit${resizable ? ' wm-hall' : ''}`,
                onPointerEnter: () => onHover({ text, hallIdx: seg.idx }),
                onPointerLeave: () => onHover(null),
                onClick,
              }
            : { pointerEvents: 'none' as const };
          const rectX = s.isEW ? usableX0 : usableX0 + seg.x;
          const rectY = s.isEW ? northY + seg.x : northY;
          const rectW = s.isEW ? usableEW : seg.w;
          const rectH = s.isEW ? seg.w : usableNS;
          return (
            <g key={i}>
              <rect
                x={rectX}
                y={rectY}
                width={rectW}
                height={rectH}
                fill={COLOR.hall}
                stroke={COLOR.hallLine}
                strokeWidth="1.2"
                {...hallProps}
              >
                {showMeasures && <title>{text}</title>}
              </rect>
              {extra > 0 && (
                <rect
                  x={s.isEW ? rectX : rectX + seg.w - extra}
                  y={s.isEW ? rectY + seg.w - extra : rectY}
                  width={s.isEW ? rectW : extra}
                  height={s.isEW ? extra : rectH}
                  fill={COLOR.gain}
                  pointerEvents="none"
                />
              )}
              {s.isEW ? (
                <line
                  x1={usableX0 + 10}
                  y1={rectY + seg.w / 2}
                  x2={usableX0 + usableEW - 10}
                  y2={rectY + seg.w / 2}
                  stroke={COLOR.hallDash}
                  strokeWidth="2"
                  strokeDasharray="14 12"
                  pointerEvents="none"
                />
              ) : (
                <line
                  x1={rectX + seg.w / 2}
                  y1={northY + 10}
                  x2={rectX + seg.w / 2}
                  y2={southY - 10}
                  stroke={COLOR.hallDash}
                  strokeWidth="2"
                  strokeDasharray="14 12"
                  pointerEvents="none"
                />
              )}
              {showMeasures &&
                (s.isEW ? (
                  <text
                    x={usableX0 + usableEW / 2}
                    y={rectY + seg.w / 2 + 6}
                    fontSize="24"
                    fill={COLOR.hallText}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                    pointerEvents="none"
                  >
                    {w}"
                  </text>
                ) : (
                  <text
                    x={rectX + seg.w / 2 + 7}
                    y={northY + usableNS / 2}
                    fontSize="24"
                    fill={COLOR.hallText}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                    pointerEvents="none"
                    transform={`rotate(-90 ${rectX + seg.w / 2} ${northY + usableNS / 2})`}
                  >
                    {w}"
                  </text>
                ))}
            </g>
          );
        }

        // A block: outline plus its row numbers at both ends.
        const heavy = seg.size >= 4;
        return (
          <g key={i}>
            {s.isEW ? (
              <rect
                x={usableX0 - 5}
                y={northY + seg.x0 - 5}
                width={usableEW + 10}
                height={seg.x1 - seg.x0 + 10}
                fill="none"
                rx="4"
                stroke={COLOR.buried}
                strokeWidth={heavy ? 3 : 2}
                strokeOpacity={heavy ? 0.9 : 0.5}
                pointerEvents="none"
              />
            ) : (
              <rect
                x={usableX0 + seg.x0 - 5}
                y={northY - 5}
                width={seg.x1 - seg.x0 + 10}
                height={usableNS + 10}
                fill="none"
                rx="4"
                stroke={COLOR.buried}
                strokeWidth={heavy ? 3 : 2}
                strokeOpacity={heavy ? 0.9 : 0.5}
                pointerEvents="none"
              />
            )}
            {seg.rows.map((r) =>
              s.isEW ? (
                <g key={r.num}>
                  <text
                    x={usableX0 - 45}
                    y={northY + r.x + m.rW / 2 + 9}
                    fontSize="26"
                    fill={COLOR.buried}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                  >
                    {r.num}
                  </text>
                  <text
                    x={usableX0 + usableEW + 45}
                    y={northY + r.x + m.rW / 2 + 9}
                    fontSize="26"
                    fill={COLOR.buried}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                  >
                    {r.num}
                  </text>
                </g>
              ) : (
                <g key={r.num}>
                  <text
                    x={usableX0 + r.x + m.rW / 2}
                    y={northY - 20}
                    fontSize="26"
                    fill={COLOR.buried}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                  >
                    {r.num}
                  </text>
                  <text
                    x={usableX0 + r.x + m.rW / 2}
                    y={southY + 40}
                    fontSize="26"
                    fill={COLOR.buried}
                    textAnchor="middle"
                    fontWeight="800"
                    fontFamily={MONO}
                  >
                    {r.num}
                  </text>
                </g>
              )
            )}
          </g>
        );
      })}

      {/* Depth labels, 1-A … n-X, on both sides */}
      {Array.from({ length: m.deep }, (_, d) => {
        const edge = d === 0 || d === m.deep - 1;
        const label = `${d + 1}-${String.fromCharCode(65 + d)}`;
        const fs = edge ? 22 : 18;
        const fill = edge ? COLOR.depthMajor : COLOR.depthMinor;
        if (s.isEW) {
          const cx = usableX0 + m.offs[d] + m.sD / 2;
          return (
            <g key={d}>
              <text
                x={cx}
                y={northY - 45}
                fontSize={fs}
                fill={fill}
                textAnchor="middle"
                fontWeight="800"
                fontFamily={MONO}
              >
                {label}
              </text>
              <text
                x={cx}
                y={southY + 60}
                fontSize={fs}
                fill={fill}
                textAnchor="middle"
                fontWeight="800"
                fontFamily={MONO}
              >
                {label}
              </text>
            </g>
          );
        }
        const cy = northY + m.offs[d] + m.sD / 2;
        return (
          <g key={d}>
            <text
              x={usableX0 - 45}
              y={cy + 8}
              fontSize={fs}
              fill={fill}
              textAnchor="end"
              fontWeight="800"
              fontFamily={MONO}
            >
              {label}
            </text>
            <text
              x={usableX0 + usableEW + 45}
              y={cy + 8}
              fontSize={fs}
              fill={fill}
              textAnchor="start"
              fontWeight="800"
              fontFamily={MONO}
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* The extra square's label (11-K), only beside the rows that hold it */}
      {(() => {
        const extras = m.validCells.filter((cl) => cl.d >= m.deep);
        if (extras.length === 0 || s.isEW) return null;
        const label = `${m.deep + 1}-${String.fromCharCode(65 + m.deep)}`;
        const cy = M + extras[0].cy + extras[0].ch / 2 + 8;
        const maxX = Math.max(...m.validCells.map((cl) => cl.cx));
        const minX = Math.min(...m.validCells.map((cl) => cl.cx));
        const atEast = extras.some((cl) => cl.cx === maxX);
        const atWest = extras.some((cl) => cl.cx === minX);
        return (
          <g>
            {atWest && (
              <text
                x={usableX0 - 45}
                y={cy}
                fontSize={22}
                fill={COLOR.depthMajor}
                textAnchor="end"
                fontWeight="800"
                fontFamily={MONO}
              >
                {label}
              </text>
            )}
            {atEast && (
              <text
                x={usableX0 + usableEW + 45}
                y={cy}
                fontSize={22}
                fill={COLOR.depthMajor}
                textAnchor="start"
                fontWeight="800"
                fontFamily={MONO}
              >
                {label}
              </text>
            )}
          </g>
        );
      })()}

      {/* Pallet squares — what the DB says is in them, what the plan says will be */}
      {m.validCells.map((cl) => {
        const q = square(cl, false);
        const col = cl.isFast ? COLOR.fast : COLOR.buried;
        const hot = isHot(q);
        return (
          // While a SKU is lit, its squares glow and every other square dims.
          <g key={q.key} opacity={hotSkus && !hot ? 0.3 : 1}>
            <rect
              className="wm-hit"
              x={M + cl.cx}
              y={M + cl.cy}
              width={cl.cw}
              height={cl.ch}
              rx="3"
              fill={q.tone ? q.tone.bg : col}
              fillOpacity={
                hot
                  ? 1
                  : q.tone
                    ? q.st
                      ? q.allLeaving
                        ? 0.35
                        : 0.92
                      : 0.5
                    : cl.isFast
                      ? 0.4
                      : 0.2
              }
              style={hot ? { filter: 'brightness(1.6) saturate(1.3)' } : undefined}
              stroke={
                q.isHeld
                  ? '#00eeff'
                  : hot
                    ? '#ffffff'
                    : q.gh.length
                      ? COLOR.buried
                      : q.over
                        ? COLOR.over
                        : col
              }
              strokeOpacity={q.isHeld || hot || q.gh.length || q.over ? 1 : 0.75}
              strokeWidth={q.isHeld || hot || q.gh.length || q.over ? 2.5 : 1.5}
              strokeDasharray={q.gh.length ? '6 4' : undefined}
              data-slot={q.key}
              onPointerEnter={() => {
                onHover({ text: q.text, cell: cl });
                setHotSkus(skusOf(q));
              }}
              onPointerLeave={() => {
                onHover(null);
                setHotSkus(null);
              }}
              onClick={() => {
                onHover({ text: q.text, cell: cl });
                setHotSkus(skusOf(q));
                onCellTap?.(cl, q.st);
              }}
            >
              <title>{q.text}</title>
            </rect>
            {q.st && <StockLabel stock={q.st} cl={cl} m={M} opacity={q.allLeaving ? 0.35 : 1} />}
            {q.ghostOnly && <StockLabel stock={q.ghostOnly} cl={cl} m={M} opacity={0.75} />}
            {(q.gh.length > 0 || q.leaving > 0 || q.over) && (
              <Marks
                cl={cl}
                m={M}
                landing={q.gh.length > 0}
                leaving={q.leaving > 0}
                over={q.over}
              />
            )}
          </g>
        );
      })}

      {/* Loose bike lines in the leftover depth, at the front of each row */}
      {m.front > 0 &&
        m.strip.map((seg, i) => {
          if (seg.type !== 'block') return null;
          return seg.rows.map((row) => {
            let bx = s.isEW ? usableX0 : usableX0 + row.x;
            let by = s.isEW ? northY + row.x : northY;
            const bw = s.isEW ? m.front : m.rW;
            const bh = s.isEW ? m.rW : m.front;
            if (isReverse) {
              if (s.isEW) bx += usableEW - m.front;
              else by += usableNS - m.front;
            }
            const text = showMeasures
              ? `Bike block · ${Math.round(bw)}"×${Math.round(bh)}" · ${bikesInBlock} bikes`
              : `Bike block · ${bikesInBlock} bikes`;
            const fs = Math.min(bw, bh) * 0.3;
            return (
              <g key={`${i}-${row.num}`}>
                <rect
                  className="wm-hit"
                  x={bx}
                  y={by}
                  width={bw}
                  height={bh}
                  rx="3"
                  fill={COLOR.bikes}
                  fillOpacity="0.28"
                  stroke={COLOR.bikes}
                  strokeOpacity="0.9"
                  strokeWidth="1.5"
                  {...hover({ text })}
                >
                  <title>{text}</title>
                </rect>
                <text
                  x={bx + bw / 2}
                  y={by + bh / 2 + fs * 0.35}
                  fontSize={fs}
                  fill={COLOR.bikes}
                  textAnchor="middle"
                  fontFamily={MONO}
                  fontWeight="bold"
                  pointerEvents="none"
                  transform={bh > bw ? `rotate(-90 ${bx + bw / 2} ${by + bh / 2})` : undefined}
                >
                  {bikesInBlock}u
                </text>
              </g>
            );
          });
        })}

      {/* Posts that landed in a hall */}
      {m.activePosts
        .filter((p) => !hitPostIds.has(p.id))
        .map((p) => {
          const text = `${p.note ?? p.id} (in hall)`;
          return (
            <circle
              key={String(p.id)}
              className="wm-hit"
              cx={M + p.x}
              cy={M + p.y}
              r={Math.max(3, p.size / 2)}
              fill={COLOR.post}
              {...hover({ text })}
            >
              <title>{text}</title>
            </circle>
          );
        })}

      {/* Squares a post kills — and what the DB says is in them anyway */}
      {m.lost.map((cl) => {
        const q = square(cl, true);
        const x = M + cl.cx;
        const y = M + cl.cy;
        const hot = isHot(q);
        return (
          <g key={`lost-${q.key}`} opacity={hotSkus && !hot ? 0.3 : 1}>
            <rect
              className="wm-hit"
              x={x}
              y={y}
              width={cl.cw}
              height={cl.ch}
              rx="3"
              fill={q.tone ? q.tone.bg : COLOR.post}
              fillOpacity={hot ? 1 : q.tone ? (q.st ? (q.allLeaving ? 0.35 : 0.92) : 0.5) : 0.1}
              style={hot ? { filter: 'brightness(1.6) saturate(1.3)' } : undefined}
              stroke={q.isHeld ? '#00eeff' : hot ? '#ffffff' : COLOR.post}
              strokeWidth={q.isHeld || hot || q.gh.length ? 2.5 : 1.5}
              strokeDasharray="4 4"
              data-slot={q.key}
              onPointerEnter={() => {
                onHover({ text: q.text, cell: cl });
                setHotSkus(skusOf(q));
              }}
              onPointerLeave={() => {
                onHover(null);
                setHotSkus(null);
              }}
              onClick={() => {
                onHover({ text: q.text, cell: cl });
                setHotSkus(skusOf(q));
                onCellTap?.(cl, q.st);
              }}
            >
              <title>{q.text}</title>
            </rect>
            {q.st && <StockLabel stock={q.st} cl={cl} m={M} opacity={q.allLeaving ? 0.35 : 1} />}
            {q.ghostOnly && <StockLabel stock={q.ghostOnly} cl={cl} m={M} opacity={0.75} />}
            {(q.gh.length > 0 || q.leaving > 0 || q.over) && (
              <Marks
                cl={cl}
                m={M}
                landing={q.gh.length > 0}
                leaving={q.leaving > 0}
                over={q.over}
              />
            )}
            <line
              x1={x}
              y1={y}
              x2={x + cl.cw}
              y2={y + cl.ch}
              stroke={COLOR.post}
              strokeWidth="2.5"
              pointerEvents="none"
            />
            <line
              x1={x + cl.cw}
              y1={y}
              x2={x}
              y2={y + cl.ch}
              stroke={COLOR.post}
              strokeWidth="2.5"
              pointerEvents="none"
            />
          </g>
        );
      })}

      {/* Wall names */}
      {(c.labels ?? []).map((l) => (
        <text
          key={l.text}
          x={M + l.x}
          y={M + l.y}
          fontSize="17"
          fill={COLOR.label}
          textAnchor={l.anchor}
          fontFamily={MONO}
          letterSpacing="2"
          transform={l.rotate ? `rotate(${l.rotate} ${M + l.x} ${M + l.y})` : undefined}
          pointerEvents="none"
        >
          {l.text}
        </text>
      ))}
    </svg>
  );
};
