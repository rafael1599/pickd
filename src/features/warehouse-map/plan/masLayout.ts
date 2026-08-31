// MAS on the floor: the south main hall drawn as a place, not a list.
//
// Rafael, 31 Aug 2026: "quiero tener la libertad de poner todos los SKU que
// quiera en el pasillo, sin que se mezclen, que estén uno al costado del otro,
// respetando sus tamaños". So each line parked in MAS gets its own rectangle,
// as wide as the pallets it needs (30 units a pallet), and they are packed
// side by side — never stacked on top of one another, never merged into one
// pile. Each one starts as close as it can to the block it came from ("delante
// de su bloque correspondiente"), and when the hall runs out of width the row
// wraps into a second lane.
//
// Pure: inches in, inches out. The drawing just paints what this returns.

import { squaresFor } from '../stock/rowStock';
import type { PlanMove } from './slotPlan';

export interface MasTile {
  move: PlanMove;
  /** Inches inside the zone, like every other coordinate. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pallets this line needs — the tile is that many wide. */
  pallets: number;
}

export interface MasHall {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MasOptions {
  hall: MasHall;
  /** A pallet: its width along the hall and its depth into it. */
  palletW: number;
  palletD: number;
  /** Where the line comes from, in inches along the hall; null = no preference. */
  preferredX: (move: PlanMove) => number | null;
}

/** Lays the parked lines out along the hall. Order is stable: by where they want to be. */
export function layoutMas(moves: PlanMove[], opts: MasOptions): MasTile[] {
  const { hall, palletW, palletD } = opts;
  const gap = 2;
  // A 120" hall takes two 60" pallets deep. Parking blocks the aisle — that is
  // what parking in an aisle means — so the lanes are flush, not spaced.
  const lanes = Math.max(1, Math.floor(hall.h / palletD));

  const wanted = moves.map((move) => ({
    move,
    pallets: squaresFor(move.qty),
    want: opts.preferredX(move),
  }));
  // The ones that asked for a place go first, left to right; the rest follow.
  wanted.sort((a, b) => (a.want ?? Infinity) - (b.want ?? Infinity) || a.move.id - b.move.id);

  // One cursor per lane: a tile never overlaps the one before it.
  const cursor = Array.from({ length: lanes }, () => hall.x);
  const tiles: MasTile[] = [];
  for (const { move, pallets, want } of wanted) {
    const w = pallets * palletW;
    // The first lane with room where it wants to be; else the emptiest one.
    let lane = 0;
    let x = Math.max(cursor[0], want ?? hall.x);
    for (let i = 0; i < lanes; i++) {
      const start = Math.max(cursor[i], want ?? hall.x);
      if (start + w <= hall.x + hall.w) {
        lane = i;
        x = start;
        break;
      }
      if (cursor[i] < cursor[lane]) {
        lane = i;
        x = Math.max(cursor[i], want ?? hall.x);
      }
    }
    tiles.push({ move, x, y: hall.y + lane * palletD + gap, w, h: palletD - gap * 2, pallets });
    cursor[lane] = x + w + gap;
  }
  return tiles;
}
