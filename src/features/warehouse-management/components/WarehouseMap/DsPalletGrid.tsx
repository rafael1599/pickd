import React from 'react';
import {
  positionLetters,
  type BlockConfig,
  type PalletSlot,
} from '../../../../utils/dsPalletPlanner';
import { orientationFor, type Orientation } from '../../utils/gridOrientation';
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

export const DsPalletGrid: React.FC<DsPalletGridProps> = ({
  block,
  slots,
  rotation,
  onSelectSku,
}) => {
  // Positions come from the block's configuration, never a constant — the floor
  // is being re-labelled by hand and the map has to follow without a deploy.
  const letters = positionLetters(block.positionsPerRow);
  const lastLetter = letters[letters.length - 1];

  const slotAt = (row: string, letter: string) =>
    slots.find((s) => s.row === row && s.letter === letter);

  // A shelf row is always the dark chip and a position always the pale one, on
  // whichever axis they land, so the two never trade places on a turn.
  const axisLabel = (label: string, axis: 'rows' | 'letters', borders: string) =>
    axis === 'rows' ? (
      <div
        className={`flex items-center justify-center bg-slate-800 text-white text-center py-2 font-bold tracking-widest text-sm print:text-base ${borders}`}
      >
        {label}
      </div>
    ) : (
      <div
        className={`flex items-center justify-center bg-slate-100 text-slate-500 font-mono font-bold text-xs print:text-sm ${borders}`}
      >
        {label}
      </div>
    );

  const renderGrid = (o: Orientation, forPrint: boolean) => {
    const bandAxis: 'rows' | 'letters' = o.columnAxis === 'rows' ? 'letters' : 'rows';
    // The row axis carries the SKU code and needs the wide track; the letter
    // axis only ever labels a position.
    const columnTrack = o.columnAxis === 'rows' ? 'minmax(9rem, 1fr)' : 'minmax(7rem, 1fr)';
    const gutter = bandAxis === 'rows' ? '3rem' : '2.5rem';

    return (
      <div
        className={
          forPrint
            ? 'hidden print:grid print:break-inside-avoid border border-gray-400 rounded-none overflow-hidden bg-white w-full'
            : 'grid print:hidden border-2 border-gray-300 rounded-lg overflow-hidden shadow-sm bg-white'
        }
        style={{
          gridTemplateColumns: `${gutter} repeat(${o.columns.length}, ${columnTrack}) ${gutter}`,
        }}
      >
        {/* Header — corner, one label per column, corner */}
        <div className="bg-white border-r border-b border-gray-300" />
        {o.columns.map((column, i) => (
          <React.Fragment key={column}>
            {axisLabel(
              column,
              o.columnAxis,
              `border-b border-gray-300 ${
                i < o.columns.length - 1
                  ? o.columnAxis === 'rows'
                    ? 'border-r border-slate-600'
                    : 'border-r border-gray-300'
                  : ''
              }`
            )}
          </React.Fragment>
        ))}
        <div className="bg-white border-l border-b border-gray-300" />

        {/* One band per position (or per shelf row, transposed), labelled both sides */}
        {o.bands.map((band, bandIndex) => {
          const notLastBand = bandIndex < o.bands.length - 1;
          const sideLabel = (side: 'left' | 'right') =>
            axisLabel(
              band,
              bandAxis,
              `${side === 'left' ? 'border-r' : 'border-l'} border-gray-300 ${
                notLastBand ? 'border-b' : ''
              }`
            );

          return (
            <React.Fragment key={band}>
              {sideLabel('left')}

              {o.columns.map((column) => {
                const row = o.columnAxis === 'rows' ? column : band;
                const letter = o.columnAxis === 'rows' ? band : column;
                const slot = slotAt(row, letter);

                return (
                  <DsPalletCell
                    key={`${row}-${letter}`}
                    usage={slot?.usage ?? { kind: 'empty' }}
                    heightRem={CELL_HEIGHT_REM}
                    dashed={letter === lastLetter && block.reserveLastPosition}
                    onSelectSku={(selection) =>
                      onSelectSku({
                        ...selection,
                        sublocationLabel: selection.sublocationLabel ?? `ROW ${row} (${letter})`,
                      })
                    }
                    borderRight
                    borderBottom={notLastBand}
                  />
                );
              })}

              {sideLabel('right')}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <>
      {/* Narrow windows scroll the grid, never the page. */}
      <div className="overflow-x-auto print:overflow-visible">
        {renderGrid(orientationFor(rotation, block.rows, letters), false)}
      </div>
      {/* Print always reads in the 180° orientation, matching how the block is walked. */}
      {renderGrid(orientationFor(180, block.rows, letters), true)}
    </>
  );
};
