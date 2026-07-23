import React from 'react';
import { ROWS, LETTERS, type PlannedSlot } from '../../../../utils/overstockPutaway';
import { counterRotateTextStyle } from '../../utils/counterRotateText';
import { SkuCell } from './SkuCell';
import type { SelectedSku } from './SkuDetailPanel';

interface WarehouseGridProps {
  slots: PlannedSlot[];
  rotation: number;
  onSelectSku: (selection: SelectedSku) => void;
}

// Per-line-row footprint inside a cell (font + gap), plus the cell's own
// vertical padding — used to size every cell to match the tallest one.
const REM_PER_LINE = 1.1;
const CELL_PADDING_REM = 0.9;
const MIN_CELL_HEIGHT_REM = 3;

export const WarehouseGrid: React.FC<WarehouseGridProps> = ({ slots, rotation, onSelectSku }) => {
  const counterRotate = counterRotateTextStyle(rotation);

  const slotAt = (row: (typeof ROWS)[number], letter: (typeof LETTERS)[number]) =>
    slots.find((s) => s.row === row && s.letter === letter);

  // All sublocations get sized to match the biggest one currently on screen
  // (a "lines" cell with the most entries), instead of each growing to fit
  // its own content.
  const maxLines = slots.reduce(
    (max, s) => (s.usage.kind === 'lines' ? Math.max(max, s.usage.entries.length) : max),
    1
  );
  const cellHeightRem = Math.max(MIN_CELL_HEIGHT_REM, maxLines * REM_PER_LINE + CELL_PADDING_REM);

  return (
    <div
      className="warehouse-grid-print grid border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm bg-white transition-transform duration-500 ease-in-out"
      style={{
        gridTemplateColumns: `2.5rem repeat(${ROWS.length}, minmax(11rem, 1fr))`,
        transform: `rotate(${rotation}deg)`,
      }}
    >
      {/* Header row — the sublocation axis label lives on the side now, this corner stays blank.
          Dividers are real borders (not a background-color gap trick) so they still show up
          when printing — most browsers strip background colors from print output by default. */}
      <div className="bg-white border-r border-b border-gray-300" />
      {ROWS.map((row, i) => (
        <div
          key={row}
          className={`bg-slate-800 text-white text-center py-2 font-bold tracking-widest text-sm print:text-lg border-b border-gray-300 ${
            i < ROWS.length - 1 ? 'border-r border-slate-600' : ''
          }`}
        >
          <span style={counterRotate}>{row}</span>
        </div>
      ))}

      {/* One row per sublocation letter, shown once on the side */}
      {LETTERS.map((letter, letterIndex) => (
        <React.Fragment key={letter}>
          <div
            className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-xs print:text-base border-r border-gray-300 ${
              letterIndex < LETTERS.length - 1 ? 'border-b' : ''
            }`}
          >
            <span style={counterRotate}>{letter}</span>
          </div>
          {ROWS.map((row, rowIndex) => {
            const slot = slotAt(row, letter);
            return (
              <SkuCell
                key={`${row}-${letter}`}
                usage={slot?.usage ?? { kind: 'empty' }}
                rotation={rotation}
                dashed={letter === 'J'}
                heightRem={cellHeightRem}
                onSelectSku={onSelectSku}
                borderRight={rowIndex < ROWS.length - 1}
                borderBottom={letterIndex < LETTERS.length - 1}
              />
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
};
