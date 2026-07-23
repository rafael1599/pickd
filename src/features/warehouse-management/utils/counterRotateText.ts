import type { CSSProperties } from 'react';

/**
 * Text inside the WarehouseGrid always counter-rotates against the grid's
 * rotation so it stays readable. At a quarter turn (90°/270°) a cell's
 * on-screen footprint swaps from wide-short to narrow-tall, so a horizontal
 * string would overflow into its neighbors above/below — instead switch the
 * text to a vertical stack of upright characters (one letter under another)
 * so it fits the cell's actual on-screen shape.
 */
function isQuarterTurn(rotation: number): boolean {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 270;
}

export function counterRotateTextStyle(rotation: number): CSSProperties {
  const quarter = isQuarterTurn(rotation);
  return {
    transform: `rotate(${-rotation}deg)`,
    transition: 'transform 500ms ease-in-out',
    writingMode: quarter ? 'vertical-rl' : 'horizontal-tb',
    textOrientation: quarter ? 'upright' : 'mixed',
  };
}
