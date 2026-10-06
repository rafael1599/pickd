// Which squares of each ROW a picker reaches without moving another pallet
// (idea-253, P2). The answer is the engine's `isFast`, laid out with each
// zone's default state — the map as it opens. Double Check and the deduction
// read it from `row_squares` in the database (migration
// 20261006222921_de_que_cuadro_se_recoge.sql), a copy of this list; a test
// fails when the two drift, and prints the rows for a new migration.
// Bay 1 is left out: it is not measured (Rafael, 28 Aug 2026), so its rows
// pick from A first.

import { calculateLayout } from './palletEngine';
import { ZONE_IDS, ZONES } from './zones';
import type { EngineState, ZoneConfig } from './types';

export interface SquareAccess {
  location: string;
  letter: string;
  isFast: boolean;
}

export function squareAccessRows(stateFor: (config: ZoneConfig) => EngineState): SquareAccess[] {
  const out = new Map<string, SquareAccess>();
  for (const id of ZONE_IDS) {
    if (id.startsWith('bay1')) continue;
    const config = ZONES[id];
    const model = calculateLayout(config, stateFor(config));
    if (!model) continue;
    for (const cell of [...model.validCells, ...model.lost]) {
      const n = Number(cell.row.num);
      if (!(n >= 1)) continue;
      const location = `ROW ${n}`;
      const key = `${location}-${cell.letter}`;
      if (!out.has(key)) out.set(key, { location, letter: cell.letter, isFast: cell.isFast });
    }
  }
  return [...out.values()].sort(
    (a, b) =>
      Number(a.location.slice(4)) - Number(b.location.slice(4)) || a.letter.localeCompare(b.letter)
  );
}
