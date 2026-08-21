import { describe, it, expect } from 'vitest';
import { draftProblem, draftColumns, draftSides } from '../cartonDraft';

const draft = (one: string, two: string, three: string) => ({ one, two, three });

describe('draftProblem', () => {
  it('waits for all three sides before judging anything', () => {
    expect(draftProblem(draft('', '', ''))).toBe('incomplete');
    expect(draftProblem(draft('54', '8', ''))).toBe('incomplete');
  });

  it('rejects a side that is not a positive number', () => {
    expect(draftProblem(draft('54', '0', '30'))).toBe('incomplete');
    expect(draftProblem(draft('54', '-8', '30'))).toBe('incomplete');
    expect(draftProblem(draft('54', 'abc', '30'))).toBe('incomplete');
  });

  it('accepts the three sides in any order', () => {
    // The same box, entered six ways. Which side is the longest is a property
    // of the box, not of how the tape went round it.
    expect(draftProblem(draft('54', '8', '30'))).toBeNull();
    expect(draftProblem(draft('8', '30', '54'))).toBeNull();
    expect(draftProblem(draft('30', '54', '8'))).toBeNull();
    expect(draftProblem(draft('8', '54', '30'))).toBeNull();
  });

  it('rejects a side too wide for the 3-character FSM field', () => {
    expect(draftProblem(draft('1000', '8', '30'))).toBe('unusable_dimensions');
  });
});

describe('draftColumns', () => {
  it('sorts the sides into Pickd column order', () => {
    // length_in = longest, width_in = thinnest, height_in = middle.
    expect(draftColumns(draft('54', '8', '30'))).toEqual({
      length_in: 54,
      width_in: 8,
      height_in: 30,
    });
  });

  it('lands on the same columns whatever order they were typed in', () => {
    const expected = { length_in: 56, width_in: 8, height_in: 28.5 };
    expect(draftColumns(draft('56', '8', '28.5'))).toEqual(expected);
    expect(draftColumns(draft('8', '28.5', '56'))).toEqual(expected);
    expect(draftColumns(draft('28.5', '56', '8'))).toEqual(expected);
  });

  it('keeps a genuinely small carton intact', () => {
    // A Hot Rod at 30/17/8 and a framekit at 48/24/8 are real boxes; the rule
    // uses no threshold, so they survive.
    expect(draftColumns(draft('17', '30', '8'))).toEqual({
      length_in: 30,
      width_in: 8,
      height_in: 17,
    });
  });

  it('handles two equal sides', () => {
    expect(draftColumns(draft('30', '30', '8'))).toEqual({
      length_in: 30,
      width_in: 8,
      height_in: 30,
    });
  });

  it('is null while a side is still missing', () => {
    expect(draftColumns(draft('54', '8', ''))).toBeNull();
  });

  it('surfaces a lost decimal in the preview rather than blocking it', () => {
    // 875 for 8.75 no longer breaks the side ordering, because sorting makes
    // that ordering hold by construction. What catches it now is the echo: the
    // operator sees "875 long", which is visibly not a bike box.
    expect(draftProblem(draft('54', '875', '30'))).toBeNull();
    expect(draftColumns(draft('54', '875', '30'))).toEqual({
      length_in: 875,
      width_in: 30,
      height_in: 54,
    });
  });
});

describe('draftSides', () => {
  it('returns the three numbers as typed, unsorted', () => {
    expect(draftSides(draft('8', '54', '30'))).toEqual([8, 54, 30]);
  });

  it('is null until all three are positive numbers', () => {
    expect(draftSides(draft('8', '54', ''))).toBeNull();
  });
});
