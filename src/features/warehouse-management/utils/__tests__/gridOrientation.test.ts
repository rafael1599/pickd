// The turn order is the kind of thing that regresses silently: the grid still
// renders, it just no longer matches the block you are standing in front of.

import { describe, it, expect } from 'vitest';
import { isTransposed, orientationFor } from '../gridOrientation';

const ROWS = ['31', '32', '33'];
const LETTERS = ['A', 'B', 'C'];

describe('orientationFor', () => {
  it('puts the shelf rows across the top upright', () => {
    expect(orientationFor(0, ROWS, LETTERS)).toEqual({
      columnAxis: 'rows',
      columns: ['31', '32', '33'],
      bands: ['A', 'B', 'C'],
    });
  });

  it('transposes a quarter turn clockwise, reading the letters backwards', () => {
    // The old top edge lands on the right, so the last position leads.
    expect(orientationFor(90, ROWS, LETTERS)).toEqual({
      columnAxis: 'letters',
      columns: ['C', 'B', 'A'],
      bands: ['31', '32', '33'],
    });
  });

  it('mirrors both axes at half a turn without transposing', () => {
    expect(orientationFor(180, ROWS, LETTERS)).toEqual({
      columnAxis: 'rows',
      columns: ['33', '32', '31'],
      bands: ['C', 'B', 'A'],
    });
  });

  it('transposes the opposite way at three quarters', () => {
    expect(orientationFor(270, ROWS, LETTERS)).toEqual({
      columnAxis: 'letters',
      columns: ['A', 'B', 'C'],
      bands: ['33', '32', '31'],
    });
  });

  it('keeps turning past a full circle', () => {
    // The button only ever increments, so the angle grows without bound.
    expect(orientationFor(360, ROWS, LETTERS)).toEqual(orientationFor(0, ROWS, LETTERS));
    expect(orientationFor(450, ROWS, LETTERS)).toEqual(orientationFor(90, ROWS, LETTERS));
    expect(orientationFor(-90, ROWS, LETTERS)).toEqual(orientationFor(270, ROWS, LETTERS));
  });

  it('never mutates the arrays it was given', () => {
    orientationFor(90, ROWS, LETTERS);
    orientationFor(180, ROWS, LETTERS);
    orientationFor(270, ROWS, LETTERS);

    expect(ROWS).toEqual(['31', '32', '33']);
    expect(LETTERS).toEqual(['A', 'B', 'C']);
  });
});

describe('isTransposed', () => {
  it('is true only on the quarter turns', () => {
    expect([0, 90, 180, 270, 360, 450].map(isTransposed)).toEqual([
      false,
      true,
      false,
      true,
      false,
      true,
    ]);
  });
});
