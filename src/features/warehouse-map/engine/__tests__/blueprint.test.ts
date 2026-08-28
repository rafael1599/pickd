// The cross-checks are the feature: a wrong measurement has to fail here
// instead of drawing a building that looks fine and is quietly wrong.

import { describe, it, expect } from 'vitest';
import {
  M,
  G,
  ft,
  toFtIn,
  sqft,
  crossChecks,
  formatCheck,
  BAYS,
  FREE_ZONES,
  bayAreas,
  warehouseAreas,
  OPERATIONAL_AREAS,
  TOLERANCE,
  BAY3_OFFICE_WIDTH_WARNING,
  SOUTH_Y,
} from '../blueprint';
import { ZONES } from '../zones';

describe('the ten cross-checks', () => {
  const checks = crossChecks();

  it('are ten, and every one agrees within a foot', () => {
    expect(checks).toHaveLength(10);
    for (const c of checks) {
      expect(c.ok, formatCheck(c)).toBe(true);
    }
  });

  it('read the way the blueprint printed them', () => {
    expect(formatCheck(checks[0])).toBe(
      "✓ Bays + dividers sum vs total length: 362' 6\" vs 362' → 0' 6\"  (within tolerance)"
    );
  });

  it('the largest disagreement is the Bay 1 rooms sum, 8.4" (prints as 8.5")', () => {
    const worst = [...checks].sort((a, b) => b.diff - a.diff)[0];
    expect(worst.label).toBe('Bay 1: rooms sum vs bay width');
    expect(worst.diff).toBeCloseTo(8.4, 6);
    expect(TOLERANCE).toBe(12);
  });

  it('a measurement moved past tolerance is caught', () => {
    const c = { ...checks[7], a: checks[7].a + ft(2) };
    c.diff = Math.abs(c.a - c.b);
    c.ok = c.diff <= TOLERANCE;
    expect(c.ok).toBe(false);
    expect(formatCheck(c)).toContain('OUT OF TOLERANCE');
  });

  it('says out loud that the Bay 3 office width is not measured', () => {
    expect(BAY3_OFFICE_WIDTH_WARNING).toContain('61\' 6"');
    expect(BAY3_OFFICE_WIDTH_WARNING).toContain('NOT measured');
  });
});

describe('V5 — the areas on the index page', () => {
  it('Bay 1 7,830 · Bay 2 5,928 · Bay 3 9,779 sq ft free', () => {
    const byId = Object.fromEntries(BAYS.map((b) => [b.id, bayAreas(b)]));
    expect(Math.round(byId.bay1.freeArea)).toBe(7830);
    expect(Math.round(byId.bay2.freeArea)).toBe(5928);
    expect(Math.round(byId.bay3.freeArea)).toBe(9779);
  });

  it('37,478 sq ft of building, 23,536 free, 63 % free', () => {
    const w = warehouseAreas();
    expect(Math.round(w.totalArea)).toBe(37478);
    expect(Math.round(w.freeArea)).toBe(23536);
    expect(Math.round(w.pctFree)).toBe(63);
  });

  it('the eight free zones, as the blueprint lists them', () => {
    const areas = Object.fromEntries(FREE_ZONES.map((z) => [z.name, Math.round(sqft(z.w, z.h))]));
    expect(areas).toEqual({
      'BAY 1 NORTH': 6886,
      'OFFICE GAP': 944,
      'BAY 2 NORTH': 3704,
      'BAY 3 NORTH': 7072,
      'BAY 2 SOUTH': 2224,
      'BAY 3 SOUTH/EAST': 2296,
      'PRE-KITCHEN': 159,
      'PRE-RESTROOM #2': 251,
    });
  });

  it('shipping, cage and main hall are counted apart', () => {
    expect(Math.round(OPERATIONAL_AREAS.shipping())).toBe(1886);
    expect(Math.round(OPERATIONAL_AREAS.cage())).toBe(1120);
    expect(Math.round(OPERATIONAL_AREAS.mainHall())).toBe(3425);
  });
});

describe('the zones are the blueprint, in inches', () => {
  // Each engine zone is one of the free rectangles plus its stretch of the
  // main hall. They were typed in twice (zones.js and the blueprint); this is
  // what keeps the two copies from drifting until zones.ts derives from here.
  const hallOf = { bay1: G.hall1Bot - G.hall1Top, bay2: M.hallwayWidth, bay3: M.hallwayWidth };

  for (const zone of FREE_ZONES) {
    if (!zone.zoneId) continue;
    it(`${zone.zoneId} matches ${zone.name} within tolerance`, () => {
      const z = ZONES[zone.zoneId!];
      expect(Math.abs(z.width - zone.w)).toBeLessThanOrEqual(TOLERANCE);
      expect(Math.abs(z.height - (zone.h + hallOf[zone.bay]))).toBeLessThanOrEqual(TOLERANCE);
    });
  }

  it('Bay 2 North is the one known 2" disagreement', () => {
    const z = FREE_ZONES.find((f) => f.zoneId === 'bay2_north')!;
    expect(ZONES.bay2_north.width - z.w).toBe(2);
  });

  it('every free zone lies inside its bay, north of the south wall', () => {
    for (const z of FREE_ZONES) {
      const bay = BAYS.find((b) => b.id === z.bay)!;
      expect(z.x).toBeGreaterThanOrEqual(bay.x0);
      expect(z.x + z.w).toBeLessThanOrEqual(bay.x1 + 1e-9);
      expect(z.y).toBeGreaterThanOrEqual(bay.north);
      expect(z.y + z.h).toBeLessThanOrEqual(SOUTH_Y + 1e-9);
    }
  });
});

describe('feet and inches', () => {
  it('ft() is inches', () => {
    expect(ft(10)).toBe(120);
    expect(ft(14, 11.5)).toBe(179.5);
    expect(ft(0, 55)).toBe(55);
  });

  it('toFtIn() rounds to the half inch', () => {
    expect(toFtIn(120)).toBe("10'");
    expect(toFtIn(179.5)).toBe('14\' 11.5"');
    expect(toFtIn(745.5)).toBe('62\' 1.5"');
    expect(toFtIn(8.4)).toBe('0\' 8.5"');
  });
});
