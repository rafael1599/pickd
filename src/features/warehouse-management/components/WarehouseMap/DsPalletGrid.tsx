import React from 'react';
import {
  positionLetters,
  type BlockConfig,
  type PalletSlot,
} from '../../../../utils/dsPalletPlanner';
import { counterRotateTextStyle } from '../../utils/counterRotateText';
import { DsPalletCell } from './DsPalletCell';
import type { SelectedSku } from './SkuDetailPanel';

interface DsPalletGridProps {
  block: BlockConfig;
  slots: PalletSlot[];
  rotation: number;
  onSelectSku: (selection: SelectedSku) => void;
}

// Every cell holds one pallet, so unlike the tower/line grid there is nothing
// variable to size against.
const CELL_HEIGHT_REM = 3.4;

/**
 * At 180° the grid is visually flipped on both axes; at 90°/270° one axis flips.
 * The rendering order is reversed so the headers match what the eye reads after
 * the CSS rotation.
 */
function shouldReverse(rotation: number): { rows: boolean; letters: boolean } {
  const n = ((rotation % 360) + 360) % 360;
  return {
    rows: n === 180 || n === 270,
    letters: n === 180 || n === 90,
  };
}

export const DsPalletGrid: React.FC<DsPalletGridProps> = ({
  block,
  slots,
  rotation,
  onSelectSku,
}) => {
  const counterRotate = counterRotateTextStyle(rotation);

  // Positions come from the block's configuration, never a constant — the floor
  // is being re-labelled by hand and the map has to follow without a deploy.
  const letters = positionLetters(block.positionsPerRow);
  const lastLetter = letters[letters.length - 1];

  const slotAt = (row: string, letter: string) =>
    slots.find((s) => s.row === row && s.letter === letter);

  const reverse = shouldReverse(rotation);
  const displayRows = reverse.rows ? [...block.rows].reverse() : block.rows;
  const displayLetters = reverse.letters ? [...letters].reverse() : letters;

  const renderGrid = (rowsOrder: string[], lettersOrder: string[], forPrint: boolean) => (
    <div
      className={
        forPrint
          ? 'hidden print:grid border border-gray-400 rounded-none overflow-hidden bg-white w-full'
          : 'grid print:hidden border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm bg-white transition-transform duration-500 ease-in-out'
      }
      style={{
        gridTemplateColumns: `2.5rem repeat(${rowsOrder.length}, minmax(9rem, 1fr)) 2.5rem`,
        ...(forPrint ? {} : { transform: `rotate(${rotation}deg)` }),
      }}
    >
      {/* Header — corner, one label per shelf row, corner */}
      <div className="bg-white border-r border-b border-gray-300" />
      {rowsOrder.map((row, i) => (
        <div
          key={row}
          className={`bg-slate-800 text-white text-center py-2 font-bold tracking-widest text-sm print:text-base border-b border-gray-300 ${
            i < rowsOrder.length - 1 ? 'border-r border-slate-600' : ''
          }`}
        >
          <span style={forPrint ? undefined : counterRotate}>{row}</span>
        </div>
      ))}
      <div className="bg-white border-l border-b border-gray-300" />

      {/* One line per position, lettered on both sides */}
      {lettersOrder.map((letter, letterIndex) => {
        const isLast = letterIndex < lettersOrder.length - 1;
        const letterHeader = (side: 'left' | 'right') => (
          <div
            className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-xs print:text-sm ${
              side === 'left' ? 'border-r' : 'border-l'
            } border-gray-300 ${isLast ? 'border-b' : ''}`}
          >
            <span style={forPrint ? undefined : counterRotate}>{letter}</span>
          </div>
        );

        return (
          <React.Fragment key={letter}>
            {letterHeader('left')}

            {rowsOrder.map((row) => {
              const slot = slotAt(row, letter);
              return (
                <DsPalletCell
                  key={`${row}-${letter}`}
                  usage={slot?.usage ?? { kind: 'empty' }}
                  rotation={forPrint ? 0 : rotation}
                  heightRem={CELL_HEIGHT_REM}
                  dashed={letter === lastLetter && block.reserveLastPosition}
                  onSelectSku={(selection) =>
                    onSelectSku({
                      ...selection,
                      sublocationLabel: selection.sublocationLabel ?? `ROW ${row} (${letter})`,
                    })
                  }
                  borderRight
                  borderBottom={isLast}
                />
              );
            })}

            {letterHeader('right')}
          </React.Fragment>
        );
      })}
    </div>
  );

  return (
    <>
      {renderGrid(displayRows, displayLetters, false)}
      {/* Print always reads in the 180° orientation, matching how the block is walked. */}
      {renderGrid([...block.rows].reverse(), [...letters].reverse(), true)}
    </>
  );
};
