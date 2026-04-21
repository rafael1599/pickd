/**
 * Reusable @react-pdf/renderer primitives shared across every PDF
 * document produced by the app.
 */

import { View, Text, Svg, Rect } from '@react-pdf/renderer';
import { TONE, MONO } from './tokens';

// ── Step pill ──────────────────────────────────────────────────────────

/**
 * Numbered circle used by the reading-path ("01", "02", etc.).
 * Rendered as an SVG so the text is centered on the em-box (`fill` is
 * used instead of CSS `color` because react-pdf's SVG Text ignores it).
 */
export function Step({
  n,
  size = 16,
  color = TONE.ink,
}: {
  n: string;
  size?: number;
  color?: string;
}) {
  const fontSize = size * 0.5;
  const r = size / 2;
  return (
    <Svg width={size} height={size}>
      <Rect x={0} y={0} width={size} height={size} fill={color} rx={r} ry={r} />
      <Text
        fill="#ffffff"
        style={{
          fontFamily: MONO,
          fontSize,
          fontWeight: 600,
        }}
        x={r}
        y={r + fontSize * 0.35}
        textAnchor="middle"
      >
        {n}
      </Text>
    </Svg>
  );
}

// ── Corner registration marks ──────────────────────────────────────────

interface Corner {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
  hSide: 'top' | 'bottom';
  vSide: 'left' | 'right';
}

export function CornerMarks({
  color = TONE.teal,
  inset = 16,
  size = 14,
  weight = 1.2,
}: {
  color?: string;
  inset?: number;
  size?: number;
  weight?: number;
} = {}) {
  const corners: Corner[] = [
    { top: inset, left: inset, hSide: 'top', vSide: 'left' },
    { top: inset, right: inset, hSide: 'top', vSide: 'right' },
    { bottom: inset, left: inset, hSide: 'bottom', vSide: 'left' },
    { bottom: inset, right: inset, hSide: 'bottom', vSide: 'right' },
  ];
  return (
    <>
      {corners.map((c, i) => (
        <View
          key={i}
          style={{
            position: 'absolute',
            width: size,
            height: size,
            ...(c.top !== undefined ? { top: c.top } : {}),
            ...(c.left !== undefined ? { left: c.left } : {}),
            ...(c.right !== undefined ? { right: c.right } : {}),
            ...(c.bottom !== undefined ? { bottom: c.bottom } : {}),
          }}
        >
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              height: weight,
              backgroundColor: color,
              ...(c.hSide === 'top' ? { top: 0 } : { bottom: 0 }),
            }}
          />
          <View
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: weight,
              backgroundColor: color,
              ...(c.vSide === 'left' ? { left: 0 } : { right: 0 }),
            }}
          />
        </View>
      ))}
    </>
  );
}

// ── Top/bottom edge band ──────────────────────────────────────────────

export function EdgeBand({
  side = 'top',
  color = TONE.teal,
  height = 5,
}: {
  side?: 'top' | 'bottom';
  color?: string;
  height?: number;
} = {}) {
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        height,
        backgroundColor: color,
        ...(side === 'top' ? { top: 0 } : { bottom: 0 }),
      }}
    />
  );
}
