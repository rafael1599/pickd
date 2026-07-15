/**
 * Per-order color coding for combined orders.
 *
 * Each order inside a combined set gets a stable color used consistently in:
 *  - the Live Board cards (3D last-3 digits tinted per order),
 *  - the DoubleCheck header (flat colored numbers, no 3D),
 *  - the DoubleCheck item rows (colored line = which order the item belongs to).
 *
 * Assignment is by position in the SORTED unique number list, so every surface
 * agrees on the color no matter the display order.
 */

export interface OrderColor {
  /** Tailwind text class for the light "face" of the 3D digits. */
  face: string;
  /** Layered text-shadow producing the 3D emboss in this hue. */
  shadow: string;
  /** Solid hex for flat uses: header text, item-row stripe. */
  hex: string;
}

const PALETTE: OrderColor[] = [
  {
    face: 'text-yellow-100',
    shadow:
      '-1px 1px 0px #d97706, -2px 2px 0px #b45309, -3px 3px 0px #78350f, -4px 4px 5px rgba(0,0,0,0.8)',
    hex: '#fbbf24', // amber-400
  },
  {
    face: 'text-sky-100',
    shadow:
      '-1px 1px 0px #0284c7, -2px 2px 0px #0369a1, -3px 3px 0px #0c4a6e, -4px 4px 5px rgba(0,0,0,0.8)',
    hex: '#38bdf8', // sky-400
  },
  {
    face: 'text-fuchsia-100',
    shadow:
      '-1px 1px 0px #c026d3, -2px 2px 0px #a21caf, -3px 3px 0px #701a75, -4px 4px 5px rgba(0,0,0,0.8)',
    hex: '#e879f9', // fuchsia-400
  },
  {
    face: 'text-emerald-100',
    shadow:
      '-1px 1px 0px #059669, -2px 2px 0px #047857, -3px 3px 0px #064e3b, -4px 4px 5px rgba(0,0,0,0.8)',
    hex: '#34d399', // emerald-400
  },
  {
    face: 'text-orange-100',
    shadow:
      '-1px 1px 0px #ea580c, -2px 2px 0px #c2410c, -3px 3px 0px #7c2d12, -4px 4px 5px rgba(0,0,0,0.8)',
    hex: '#fb923c', // orange-400
  },
  {
    face: 'text-violet-100',
    shadow:
      '-1px 1px 0px #7c3aed, -2px 2px 0px #6d28d9, -3px 3px 0px #4c1d95, -4px 4px 5px rgba(0,0,0,0.8)',
    hex: '#a78bfa', // violet-400
  },
];

/** Classic single-order yellow — index 0 of the palette. */
export const SINGLE_ORDER_COLOR = PALETTE[0];

/** Stable color for one order within a combined set. */
export function orderColorFor(orderNumber: string, allNumbers: string[]): OrderColor {
  const sorted = [...new Set(allNumbers.map((n) => n.trim()))].sort();
  const idx = sorted.indexOf(orderNumber.trim());
  return PALETTE[(idx < 0 ? 0 : idx) % PALETTE.length];
}
