import { describe, it, expect } from 'vitest';
import { byPickPreference, isLastResort, toPickingOrderMap } from '../pickLocation';

// Mirrors production: 42 BURIED is ranked out of the way, ROW 28 is a normal
// shelf, and PALLETIZED sits in the same last-resort band.
const order = toPickingOrderMap([
  { location: 'ROW 28', picking_order: 145 },
  { location: 'ROW 15', picking_order: 290 },
  { location: 'PALLETIZED', picking_order: 9995 },
  { location: '42 BURIED', picking_order: 9999 },
  { location: 'D2', picking_order: null },
]);

const row = (location: string, quantity: number) => ({ location, quantity });

describe('isLastResort', () => {
  it('flags a deliberately deprioritised location', () => {
    expect(isLastResort('42 BURIED', order)).toBe(true);
    expect(isLastResort('PALLETIZED', order)).toBe(true);
  });

  it('does not flag a normal shelf', () => {
    expect(isLastResort('ROW 28', order)).toBe(false);
  });

  // Half the warehouse has no picking_order, containers included. Demoting all
  // of them would move where nearly every pick is sourced from.
  it('does not flag an unranked location', () => {
    expect(isLastResort('D2', order)).toBe(false);
    expect(isLastResort('SOMEWHERE ELSE', order)).toBe(false);
  });

  it('flags nothing without the map', () => {
    expect(isLastResort('42 BURIED')).toBe(false);
  });

  it('is case and whitespace insensitive', () => {
    expect(isLastResort('  42 buried ', order)).toBe(true);
  });
});

describe('byPickPreference', () => {
  // The reported case: 42 BURIED held 39 units against ROW 28's 17, won on
  // quantity, and pickers re-routed it by hand four times in eight days.
  it('prefers a normal shelf over a buried one holding more', () => {
    const rows = [row('42 BURIED', 39), row('ROW 28', 17)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('ROW 28');
  });

  it('still takes the deepest stock among normal shelves', () => {
    const rows = [row('ROW 28', 5), row('ROW 15', 40)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('ROW 15');
  });

  // Last resort means last, not never — once the normal shelves are dry it is
  // the only place the bike exists.
  it('falls back to the buried pallet when nothing else has stock', () => {
    const rows = [row('42 BURIED', 39)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('42 BURIED');
  });

  it('orders last-resort locations among themselves by quantity', () => {
    const rows = [row('PALLETIZED', 2), row('42 BURIED', 39)];
    const sorted = [...rows].sort(byPickPreference(order));
    expect(sorted.map((r) => r.location)).toEqual(['42 BURIED', 'PALLETIZED']);
  });

  it('is the plain quantity sort without a map', () => {
    const rows = [row('ROW 28', 17), row('42 BURIED', 39)];
    expect([...rows].sort(byPickPreference())[0].location).toBe('42 BURIED');
  });

  it('treats an unranked container as a normal candidate', () => {
    const rows = [row('D2', 500), row('ROW 28', 17)];
    expect([...rows].sort(byPickPreference(order))[0].location).toBe('D2');
  });
});
