// The URL is the link someone sends: it has to say only what differs from
// the plan, and read back the same state it wrote.

import { describe, it, expect } from 'vitest';
import { parseEngineState, writeEngineState, toggleKeys } from '../useZoneState';
import { ZONES, defaultEngineState } from '../../engine';

describe('toggleKeys', () => {
  it("come from the zone's own obstacles", () => {
    expect(toggleKeys(ZONES.bay3_north)).toEqual(['west']);
    expect(toggleKeys(ZONES.bay2_south)).toEqual(['west', 'east']);
    expect(toggleKeys(ZONES.bay1_north)).toEqual([]);
  });
});

describe('parseEngineState', () => {
  it('an empty query is the default state', () => {
    const s = parseEngineState(new URLSearchParams(''), ZONES.bay3_north);
    expect(s.pd).toBe(60);
    expect(s.pw).toBe(62);
    expect(s.isEW).toBe(false);
    expect(s.layoutPreset).toBe('standard');
    expect(s.toggles).toEqual({ west: true });
  });

  it('reads every key', () => {
    const s = parseEngineState(
      new URLSearchParams('zone=bay2_south&pd=65&pw=57&rows=ew&preset=center&west=0'),
      ZONES.bay2_south
    );
    expect(s.pd).toBe(65);
    expect(s.pw).toBe(57);
    expect(s.isEW).toBe(true);
    expect(s.layoutPreset).toBe('center_hall');
    expect(s.toggles).toEqual({ west: false, east: true });
  });

  it('ignores a pallet nobody has (typos, garbage)', () => {
    const s = parseEngineState(new URLSearchParams('pd=6&pw=abc'), ZONES.bay3_north);
    expect(s.pd).toBe(60);
    expect(s.pw).toBe(62);
  });
});

describe('writeEngineState', () => {
  it('writes nothing for the default state and keeps the other keys', () => {
    const next = writeEngineState(
      new URLSearchParams('zone=bay3_north&pd=65'),
      defaultEngineState({ toggles: { west: true } }),
      ZONES.bay3_north
    );
    expect(next.toString()).toBe('zone=bay3_north');
  });

  it('writes only what differs, and reads it back', () => {
    const state = defaultEngineState({
      pd: 65,
      isEW: true,
      layoutPreset: 'solid',
      toggles: { west: false, east: true },
    });
    const next = writeEngineState(new URLSearchParams('zone=bay2_south'), state, ZONES.bay2_south);
    expect(next.toString()).toBe('zone=bay2_south&pd=65&rows=ew&preset=solid&west=0');
    const back = parseEngineState(next, ZONES.bay2_south);
    expect(back).toEqual({ ...state, hallOverrides: {} });
  });
});
