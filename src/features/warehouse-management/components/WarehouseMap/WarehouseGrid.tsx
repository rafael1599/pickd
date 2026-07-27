import React from 'react';
import { ROWS, LETTERS, type PlannedSlot } from '../../../../utils/overstockPutaway';
import { counterRotateTextStyle } from '../../utils/counterRotateText';
import { SkuCell } from './SkuCell';
import type { SelectedSku } from './SkuDetailPanel';

interface WarehouseGridProps {
  slots: PlannedSlot[];
  rotation: number;
  onSelectSku: (selection: SelectedSku) => void;
  customRows?: number[];
  customLetters?: string[];
}

// Per-line-row footprint inside a cell (font + gap), plus the cell's own
// vertical padding — used to size every cell to match the tallest one.
const REM_PER_LINE = 1.1;
const CELL_PADDING_REM = 0.9;
const MIN_CELL_HEIGHT_REM = 3;

/**
 * At 180° the grid is visually flipped on both axes; at 90°/270° one axis
 * flips.  We reverse the *rendering order* so headers match the position
 * the eye reads after the CSS transform rotation.
 *
 *   0°  → no reversal
 *   90° → letters reversed  (left edge becomes top)
 *   180°→ both reversed     (everything flips)
 *   270°→ rows reversed     (right edge becomes top)
 */
function shouldReverse(rotation: number): { rows: boolean; letters: boolean } {
  const n = ((rotation % 360) + 360) % 360;
  return {
    rows: n === 180 || n === 270,
    letters: n === 180 || n === 90,
  };
}

export const WarehouseGrid: React.FC<WarehouseGridProps> = ({
  slots,
  rotation,
  onSelectSku,
  customRows,
  customLetters,
}) => {
  const counterRotate = counterRotateTextStyle(rotation);

  const activeRows = customRows ?? (ROWS as unknown as number[]);
  const activeLetters = customLetters ?? (LETTERS as unknown as string[]);

  const slotAt = (row: number, letter: string) =>
    slots.find(
      (s) =>
        s.row === row &&
        (s.letter === letter || (s as unknown as { sublocation: string }).sublocation === letter)
    );

  // Screen display order — depends on current rotation angle.
  const reverse = shouldReverse(rotation);
  const displayRows = reverse.rows ? [...activeRows].reverse() : activeRows;
  const displayLetters = reverse.letters ? [...activeLetters].reverse() : activeLetters;

  // Print always uses 180° order (rows reversed, letters reversed).
  const printRows = [...activeRows].reverse();
  const printLetters = [...activeLetters].reverse();

  // All sublocations get sized to match the biggest one currently on screen
  // (a "lines" cell with the most entries), instead of each growing to fit
  // its own content.
  const maxLines = slots.reduce(
    (max, s) => (s.usage.kind === 'lines' ? Math.max(max, s.usage.entries.length) : max),
    1
  );
  const cellHeightRem = Math.max(MIN_CELL_HEIGHT_REM, maxLines * REM_PER_LINE + CELL_PADDING_REM);

  const columnWidthClass = activeRows.length === 1 ? 'minmax(18rem, 1fr)' : 'minmax(11rem, 1fr)';

  return (
    <>
      {/* ── Screen grid (interactive, rotatable) ────────────────────────── */}
      <div
        className="warehouse-grid-print grid print:hidden border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm bg-white transition-transform duration-500 ease-in-out"
        style={{
          gridTemplateColumns: `2.5rem repeat(${activeRows.length}, ${columnWidthClass}) 2.5rem`,
          transform: `rotate(${rotation}deg)`,
        }}
      >
        {/* Header row — left corner, row headers, right corner */}
        <div className="bg-white border-r border-b border-gray-300" />
        {displayRows.map((row, i) => (
          <div
            key={row}
            className={`bg-slate-800 text-white text-center py-2 font-bold tracking-widest text-sm print:text-lg border-b border-gray-300 ${
              i < displayRows.length - 1 ? 'border-r border-slate-600' : ''
            }`}
          >
            <span style={counterRotate}>{row}</span>
          </div>
        ))}
        <div className="bg-white border-l border-b border-gray-300" />

        {/* One row per sublocation letter, shown on left AND right sides */}
        {displayLetters.map((letter, letterIndex) => (
          <React.Fragment key={letter}>
            {/* Left letter header */}
            <div
              className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-xs print:text-base border-r border-gray-300 ${
                letterIndex < displayLetters.length - 1 ? 'border-b' : ''
              }`}
            >
              <span style={counterRotate}>{letter}</span>
            </div>

            {/* Sublocation cells */}
            {displayRows.map((row) => {
              const slot = slotAt(row, letter);
              return (
                <SkuCell
                  key={`${row}-${letter}`}
                  usage={slot?.usage ?? { kind: 'empty' }}
                  rotation={rotation}
                  dashed={letter === 'J'}
                  heightRem={cellHeightRem}
                  onSelectSku={onSelectSku}
                  borderRight={true}
                  borderBottom={letterIndex < displayLetters.length - 1}
                />
              );
            })}

            {/* Right letter header */}
            <div
              className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-xs print:text-base border-l border-gray-300 ${
                letterIndex < displayLetters.length - 1 ? 'border-b' : ''
              }`}
            >
              <span style={counterRotate}>{letter}</span>
            </div>
          </React.Fragment>
        ))}

        {/* Bottom header row — left corner, row headers, right corner */}
        <div className="bg-white border-r border-t border-gray-300" />
        {displayRows.map((row, i) => (
          <div
            key={`bottom-${row}`}
            className={`bg-slate-800 text-white text-center py-2 font-bold tracking-widest text-sm print:text-lg border-t border-gray-300 ${
              i < displayRows.length - 1 ? 'border-r border-slate-600' : ''
            }`}
          >
            <span style={counterRotate}>{row}</span>
          </div>
        ))}
        <div className="bg-white border-l border-t border-gray-300" />
      </div>

      {/* ── Print grid — always 180° order, no CSS transform ────────────── */}
      <div
        className="warehouse-grid-print warehouse-print-fit grid hidden print:grid border-2 border-gray-300 bg-white w-full max-w-full"
        style={{
          gridTemplateColumns: `2.25rem repeat(${activeRows.length}, minmax(0, 1fr)) 2.25rem`,
        }}
      >
        <div className="bg-white border-r border-b border-gray-300" />
        {printRows.map((row, i) => (
          <div
            key={row}
            className={`bg-slate-800 text-white text-center py-1.5 font-bold tracking-widest text-lg border-b border-gray-300 ${
              i < printRows.length - 1 ? 'border-r border-slate-600' : ''
            }`}
          >
            {row}
          </div>
        ))}
        <div className="bg-white border-l border-b border-gray-300" />

        {printLetters.map((letter, letterIndex) => (
          <React.Fragment key={letter}>
            {/* Left letter header */}
            <div
              className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-sm border-r border-gray-300 ${
                letterIndex < printLetters.length - 1 ? 'border-b' : ''
              }`}
            >
              {letter}
            </div>

            {/* Sublocation cells */}
            {printRows.map((row) => {
              const slot = slotAt(row, letter);
              return (
                <SkuCell
                  key={`print-${row}-${letter}`}
                  usage={slot?.usage ?? { kind: 'empty' }}
                  rotation={0}
                  dashed={letter === 'J'}
                  heightRem={cellHeightRem}
                  onSelectSku={onSelectSku}
                  borderRight={true}
                  borderBottom={letterIndex < printLetters.length - 1}
                />
              );
            })}

            {/* Right letter header */}
            <div
              className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-sm border-l border-gray-300 ${
                letterIndex < printLetters.length - 1 ? 'border-b' : ''
              }`}
            >
              {letter}
            </div>
          </React.Fragment>
        ))}

        {/* Bottom header row */}
        <div className="bg-white border-r border-t border-gray-300" />
        {printRows.map((row, i) => (
          <div
            key={`print-bottom-${row}`}
            className={`bg-slate-800 text-white text-center py-1.5 font-bold tracking-widest text-lg border-t border-gray-300 ${
              i < printRows.length - 1 ? 'border-r border-slate-600' : ''
            }`}
          >
            {row}
          </div>
        ))}
        <div className="bg-white border-l border-t border-gray-300" />
      </div>
    </>
  );
};
