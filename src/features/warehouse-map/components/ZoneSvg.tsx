// One zone, drawn. Everything is in inches inside the viewBox — the SVG scales
// to whatever it is given — and every colour is explicit, because the floor
// is dark whatever the app's theme is (a plan reads the same on paper).
//
// Port of PalletEngine.renderSVG (2026-08-28, idea-170). The colours are the
// plans' own: amber = fast, violet = buried, green = loose bike lines, red =
// a post or the slot it kills.

import React from 'react';
import type { Cell, EngineState, LayoutModel, Obstacle, ZoneConfig } from '../engine';
import { BIKES_PER_LINE, slotKey } from '../engine';

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
  gain: 'rgba(52,211,153,0.15)',
  label: '#475569',
  depthMajor: '#94a3b8',
  depthMinor: '#64748b',
} as const;

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

export interface HoverTarget {
  text: string;
  /** Set when the target is a slot, for whoever wants to act on it (F3). */
  cell?: Cell;
  /** Set when the target is a hall that can be resized. */
  hallIdx?: number;
}

interface Props {
  config: ZoneConfig;
  state: EngineState;
  model: LayoutModel;
  onHover: (target: HoverTarget | null) => void;
  onHallClick?: (hallIdx: number, width: number) => void;
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

export const ZoneSvg: React.FC<Props> = ({ config, state, model: m, onHover, onHallClick }) => {
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
        const text = `${obs.label ?? 'Obstacle'} (${Math.round(obs.w)}" × ${Math.round(obs.h)}")`;
        const horiz = obs.w >= obs.h;
        const thick = Math.round(horiz ? obs.h : obs.w);
        const name = (obs.label ?? '').replace(/\s*\(.*\)\s*$/, '') || 'HALL';
        const lx = M + obs.x + obs.w / 2;
        const ly = M + obs.y + obs.h / 2 + (obs.labelDy ?? 0);
        const fs = Math.max(11, Math.min(17, Math.min(obs.w, obs.h) * 0.22));
        return (
          <g key={obs.id}>
            <rect
              className="wm-hit"
              x={M + obs.x}
              y={M + obs.y}
              width={obs.w}
              height={obs.h}
              fill={st.fill}
              stroke={st.stroke}
              strokeWidth={st.strokeWidth}
              strokeDasharray={st.dash}
              {...hover({ text })}
            >
              <title>{text}</title>
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
                {name} · {thick}"
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
            return s.isEW ? (
              <rect
                key={i}
                x={usableX0}
                y={northY + seg.x}
                width={usableEW}
                height={seg.extra}
                fill={COLOR.gain}
                {...hover({ text })}
              />
            ) : (
              <rect
                key={i}
                x={usableX0 + seg.x}
                y={northY}
                width={seg.extra}
                height={usableNS}
                fill={COLOR.gain}
                {...hover({ text })}
              />
            );
          }
          const w = Math.round(seg.w);
          const resizable = seg.idx !== undefined;
          const text = s.isEW
            ? `HALL · ${Math.round(usableEW)}" × ${w}"${resizable ? ' (tap to resize)' : ''}`
            : `HALL · ${w}" × ${Math.round(usableNS)}"${resizable ? ' (tap to resize)' : ''}`;
          const extra = seg.extra ?? 0;
          const onClick = () => {
            onHover({ text, hallIdx: seg.idx });
            if (resizable && onHallClick) onHallClick(seg.idx!, w);
          };
          if (s.isEW) {
            const ay = northY + seg.x;
            return (
              <g key={i}>
                <rect
                  className={`wm-hit${resizable ? ' wm-hall' : ''}`}
                  x={usableX0}
                  y={ay}
                  width={usableEW}
                  height={seg.w}
                  fill={COLOR.hall}
                  stroke={COLOR.hallLine}
                  strokeWidth="1.2"
                  onPointerEnter={() => onHover({ text, hallIdx: seg.idx })}
                  onPointerLeave={() => onHover(null)}
                  onClick={onClick}
                >
                  <title>{text}</title>
                </rect>
                {extra > 0 && (
                  <rect
                    x={usableX0}
                    y={ay + seg.w - extra}
                    width={usableEW}
                    height={extra}
                    fill={COLOR.gain}
                    pointerEvents="none"
                  />
                )}
                <line
                  x1={usableX0 + 10}
                  y1={ay + seg.w / 2}
                  x2={usableX0 + usableEW - 10}
                  y2={ay + seg.w / 2}
                  stroke={COLOR.hallDash}
                  strokeWidth="2"
                  strokeDasharray="14 12"
                  pointerEvents="none"
                />
                <text
                  x={usableX0 + usableEW / 2}
                  y={ay + seg.w / 2 + 6}
                  fontSize="24"
                  fill={COLOR.hallText}
                  textAnchor="middle"
                  fontWeight="800"
                  fontFamily={MONO}
                  pointerEvents="none"
                >
                  {w}"
                </text>
              </g>
            );
          }
          const sx = usableX0 + seg.x;
          const midY = northY + usableNS / 2;
          return (
            <g key={i}>
              <rect
                className={`wm-hit${resizable ? ' wm-hall' : ''}`}
                x={sx}
                y={northY}
                width={seg.w}
                height={usableNS}
                fill={COLOR.hall}
                stroke={COLOR.hallLine}
                strokeWidth="1.2"
                onPointerEnter={() => onHover({ text, hallIdx: seg.idx })}
                onPointerLeave={() => onHover(null)}
                onClick={onClick}
              >
                <title>{text}</title>
              </rect>
              {extra > 0 && (
                <rect
                  x={sx + seg.w - extra}
                  y={northY}
                  width={extra}
                  height={usableNS}
                  fill={COLOR.gain}
                  pointerEvents="none"
                />
              )}
              <line
                x1={sx + seg.w / 2}
                y1={northY + 10}
                x2={sx + seg.w / 2}
                y2={southY - 10}
                stroke={COLOR.hallDash}
                strokeWidth="2"
                strokeDasharray="14 12"
                pointerEvents="none"
              />
              <text
                x={sx + seg.w / 2 + 7}
                y={midY}
                fontSize="24"
                fill={COLOR.hallText}
                textAnchor="middle"
                fontWeight="800"
                fontFamily={MONO}
                pointerEvents="none"
                transform={`rotate(-90 ${sx + seg.w / 2} ${midY})`}
              >
                {w}"
              </text>
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

      {/* Pallet slots */}
      {m.validCells.map((cl) => {
        const col = cl.isFast ? COLOR.fast : COLOR.buried;
        const text = `Row ${cl.row.num} · Slot ${cl.letter} · ${cl.cw}"×${cl.ch}" · ${cl.isFast ? 'Fast Picking' : 'Buried'}`;
        return (
          <rect
            key={slotKey(cl)}
            className="wm-hit"
            x={M + cl.cx}
            y={M + cl.cy}
            width={cl.cw}
            height={cl.ch}
            rx="3"
            fill={col}
            fillOpacity={cl.isFast ? 0.4 : 0.2}
            stroke={col}
            strokeOpacity="0.75"
            strokeWidth="1.5"
            data-slot={slotKey(cl)}
            {...hover({ text, cell: cl })}
          >
            <title>{text}</title>
          </rect>
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
            const text = `Bike block · ${Math.round(bw)}"×${Math.round(bh)}" · ${bikesInBlock} bikes`;
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

      {/* Slots a post kills */}
      {m.lost.map((cl) => {
        const x = M + cl.cx;
        const y = M + cl.cy;
        const text = `Row ${cl.row.num} · Slot ${cl.letter} (OBSTRUCTED)`;
        return (
          <g key={`lost-${slotKey(cl)}`}>
            <rect
              className="wm-hit"
              x={x}
              y={y}
              width={cl.cw}
              height={cl.ch}
              rx="3"
              fill={COLOR.post}
              fillOpacity="0.1"
              stroke={COLOR.post}
              strokeWidth="1.5"
              strokeDasharray="4 4"
              {...hover({ text, cell: cl })}
            >
              <title>{text}</title>
            </rect>
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
