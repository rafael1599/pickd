// MAS is a place on the floor: every parked line its own tile, side by side,
// as wide as the pallets it needs — never one pile (Rafael, 31 Aug 2026).

import { describe, it, expect } from 'vitest';
import { layoutMas, type MasTile } from '../masLayout';
import type { PlanMove } from '../slotPlan';

let id = 1;
const parked = (sku: string, qty: number, fromLocation = 'ROW 30'): PlanMove => ({
  id: id++,
  planId: 'p',
  position: id,
  inventoryId: id,
  sku,
  qty,
  itemName: null,
  warehouse: 'LUDLOW',
  fromLocation,
  fromSublocation: null,
  toLocation: 'MAS',
  toLetters: [],
  kind: 'move',
  origin: 'hand',
  status: 'planned',
  error: null,
});

const hall = { x: 0, y: 745.5, w: 1366, h: 120 };
const opts = (preferredX: (m: PlanMove) => number | null = () => null) => ({
  hall,
  palletW: 62,
  palletD: 60,
  preferredX,
});

const overlaps = (a: MasTile, b: MasTile) =>
  !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

describe('layoutMas', () => {
  it('gives each line its own tile, as wide as the pallets it needs', () => {
    const tiles = layoutMas([parked('A', 30), parked('B', 90), parked('C', 1)], opts());
    expect(tiles.map((t) => t.pallets)).toEqual([1, 3, 1]);
    expect(tiles.map((t) => t.w)).toEqual([62, 186, 62]);
    expect(tiles.every((t) => t.h === 56)).toBe(true);
  });

  it('lays them side by side, never one on top of another', () => {
    const tiles = layoutMas(
      Array.from({ length: 12 }, (_, i) => parked(`SKU-${i}`, 60)),
      opts()
    );
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) {
        expect(overlaps(tiles[i], tiles[j]), `${i} vs ${j}`).toBe(false);
      }
    }
  });

  it('starts each one in front of the block it came from', () => {
    const west = parked('W', 30, 'ROW 18');
    const east = parked('E', 30, 'ROW 33');
    const tiles = layoutMas(
      [east, west],
      opts((m) => (m.sku === 'W' ? 100 : 1200))
    );
    const at = (sku: string) => tiles.find((t) => t.move.sku === sku)!;
    expect(at('W').x).toBe(100);
    expect(at('E').x).toBe(1200);
  });

  it('wraps into a second lane when the hall runs out of width', () => {
    const many = Array.from({ length: 40 }, (_, i) => parked(`X-${i}`, 30));
    const tiles = layoutMas(many, opts());
    expect(new Set(tiles.map((t) => t.y)).size).toBeGreaterThan(1);
    for (const t of tiles) expect(t.y).toBeGreaterThanOrEqual(hall.y);
    for (let i = 0; i < tiles.length; i++) {
      for (let j = i + 1; j < tiles.length; j++) expect(overlaps(tiles[i], tiles[j])).toBe(false);
    }
  });

  it('is empty when nothing is parked', () => {
    expect(layoutMas([], opts())).toEqual([]);
  });
});
