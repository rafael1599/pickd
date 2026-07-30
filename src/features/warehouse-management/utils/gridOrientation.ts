// How a block's grid is laid out at each quarter turn.
//
// Rotation used to be a CSS transform on the whole grid with the text
// counter-rotated inside it. That leaves every cell in its original 9rem-wide
// box while the box only *looks* as wide as a shelf row is tall, so at a
// quarter turn the SKU had to stack one character per line to fit — `03-3753BL`
// came out unreadable, and the rotated grid overflowed its column.
//
// A quarter turn transposes the grid instead: the letters become the columns
// and the shelf rows become the bands. Every cell is then laid out at the size
// it is actually drawn, and nothing needs to be un-rotated.

/** Which axis runs across the top, and in what order each axis is read. */
export interface Orientation {
  /** What the column headers hold; the other axis fills the side gutters. */
  columnAxis: 'rows' | 'letters';
  columns: string[];
  bands: string[];
}

function turnOf(rotation: number): number {
  return ((rotation % 360) + 360) % 360;
}

/**
 * The order follows the turn. Rotating the picture a quarter clockwise sends
 * its top edge to the right, which reads the letters backwards and the shelf
 * rows downwards; the opposite turn mirrors both.
 */
export function orientationFor(rotation: number, rows: string[], letters: string[]): Orientation {
  switch (turnOf(rotation)) {
    case 90:
      return { columnAxis: 'letters', columns: [...letters].reverse(), bands: rows };
    case 180:
      return { columnAxis: 'rows', columns: [...rows].reverse(), bands: [...letters].reverse() };
    case 270:
      return { columnAxis: 'letters', columns: letters, bands: [...rows].reverse() };
    default:
      return { columnAxis: 'rows', columns: rows, bands: letters };
  }
}

/**
 * True when the block is drawn on its side. Callers need this for layout: a
 * transposed block is ten columns wide instead of three and no longer fits
 * beside its neighbour.
 */
export function isTransposed(rotation: number): boolean {
  const turn = turnOf(rotation);
  return turn === 90 || turn === 270;
}
