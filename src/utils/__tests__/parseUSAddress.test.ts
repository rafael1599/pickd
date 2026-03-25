import { describe, it, expect } from 'vitest';
import { parseUSAddress } from '../parseUSAddress';

describe('parseUSAddress', () => {
  // ── Standard comma-separated formats ────────────────────────────────

  it('parses "street, city, STATE ZIP"', () => {
    expect(parseUSAddress('123 Main St, Miami, FL 33101')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  it('parses "street, city STATE ZIP"', () => {
    expect(parseUSAddress('123 Main St, Miami FL 33101')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  it('parses with ZIP+4', () => {
    expect(parseUSAddress('123 Main St, Miami, FL 33101-1234')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101-1234',
    });
  });

  // ── Country suffix stripping ────────────────────────────────────────

  it('strips "USA" suffix', () => {
    expect(parseUSAddress('123 Main St, Miami, FL 33101 USA')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  it('strips "US" suffix', () => {
    expect(parseUSAddress('123 Main St, Miami, FL 33101 US')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  it('strips "United States" suffix', () => {
    expect(parseUSAddress('123 Main St, Miami, FL 33101 United States')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  it('strips "United States of America" suffix', () => {
    expect(parseUSAddress('123 Main St, Miami, FL 33101 United States of America')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  // ── No comma between street and city (suffix-based split) ───────────

  it('parses suffix-based split: "37 OCEAN ST South Portland, ME 04106 USA"', () => {
    expect(parseUSAddress('37 OCEAN ST South Portland, ME 04106 USA')).toEqual({
      street: '37 OCEAN ST',
      city: 'South Portland',
      state: 'ME',
      zip: '04106',
    });
  });

  it('uses LAST suffix for split (Court Street case)', () => {
    expect(parseUSAddress('123 Court Street Palmyra, NJ 08065')).toEqual({
      street: '123 Court Street',
      city: 'Palmyra',
      state: 'NJ',
      zip: '08065',
    });
  });

  it('uses LAST suffix for split (Park Place case)', () => {
    expect(parseUSAddress('100 Point Drive Miami, FL 33101')).toEqual({
      street: '100 Point Drive',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  // ── THE BUG: typo in suffix ─────────────────────────────────────────

  it('handles typo "STREE" → fuzzy matches STREET', () => {
    expect(parseUSAddress('107 EAST BROAD STREE PALMYRA, NJ 08065 USA')).toEqual({
      street: '107 EAST BROAD STREE',
      city: 'PALMYRA',
      state: 'NJ',
      zip: '08065',
    });
  });

  it('handles typo "AVENU" → fuzzy matches AVENUE', () => {
    expect(parseUSAddress('456 Oak Avenu Denver, CO 80202')).toEqual({
      street: '456 Oak Avenu',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
    });
  });

  // ── Post-directional after suffix ───────────────────────────────────

  it('handles post-directional: "123 Main St N Miami, FL 33101"', () => {
    expect(parseUSAddress('123 Main St N Miami, FL 33101')).toEqual({
      street: '123 Main St N',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  it('handles post-directional NW', () => {
    expect(parseUSAddress('500 Pennsylvania Ave NW Washington, DC 20500')).toEqual({
      street: '500 Pennsylvania Ave NW',
      city: 'Washington',
      state: 'DC',
      zip: '20500',
    });
  });

  // ── Apartment/unit variations ───────────────────────────────────────

  it('handles Apt after suffix', () => {
    expect(parseUSAddress('456 Oak Ave Apt 3 Denver, CO 80202')).toEqual({
      street: '456 Oak Ave Apt 3',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
    });
  });

  it('handles Suite after suffix', () => {
    expect(parseUSAddress('789 Elm Blvd Suite 100 Chicago, IL 60601')).toEqual({
      street: '789 Elm Blvd Suite 100',
      city: 'Chicago',
      state: 'IL',
      zip: '60601',
    });
  });

  it('handles # unit after suffix', () => {
    expect(parseUSAddress('321 Pine Rd #5B Austin, TX 73301')).toEqual({
      street: '321 Pine Rd #5B',
      city: 'Austin',
      state: 'TX',
      zip: '73301',
    });
  });

  it('handles BLDG after suffix', () => {
    expect(parseUSAddress('100 Cedar Ln Bldg A Portland, OR 97201')).toEqual({
      street: '100 Cedar Ln Bldg A',
      city: 'Portland',
      state: 'OR',
      zip: '97201',
    });
  });

  it('handles FL (floor) after suffix', () => {
    expect(parseUSAddress('200 Market St FL 3 Boston, MA 02101')).toEqual({
      street: '200 Market St FL 3',
      city: 'Boston',
      state: 'MA',
      zip: '02101',
    });
  });

  // ── PO Box ──────────────────────────────────────────────────────────

  it('parses PO Box address', () => {
    expect(parseUSAddress('PO Box 123, Palmyra, NJ 08065')).toEqual({
      street: 'PO Box 123',
      city: 'Palmyra',
      state: 'NJ',
      zip: '08065',
    });
  });

  it('parses P.O. Box address', () => {
    expect(parseUSAddress('P.O. Box 456, Denver, CO 80202')).toEqual({
      street: 'P.O. Box 456',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
    });
  });

  // ── Full state name ─────────────────────────────────────────────────

  it('parses full state name "New Jersey"', () => {
    expect(parseUSAddress('123 Main St, Miami, New Jersey 08065')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'NJ',
      zip: '08065',
    });
  });

  it('parses full state name "Pennsylvania"', () => {
    expect(parseUSAddress('456 Oak Ave, Philadelphia, Pennsylvania 19101')).toEqual({
      street: '456 Oak Ave',
      city: 'Philadelphia',
      state: 'PA',
      zip: '19101',
    });
  });

  // ── Multiline pasted addresses ──────────────────────────────────────

  it('handles multiline address', () => {
    expect(parseUSAddress('107 East Broad Street\nPalmyra, NJ 08065\nUSA')).toEqual({
      street: '107 East Broad Street',
      city: 'Palmyra',
      state: 'NJ',
      zip: '08065',
    });
  });

  it('handles multiline with apartment', () => {
    expect(parseUSAddress('456 Oak Ave Apt 3\nDenver, CO 80202')).toEqual({
      street: '456 Oak Ave Apt 3',
      city: 'Denver',
      state: 'CO',
      zip: '80202',
    });
  });

  // ── Extra whitespace ────────────────────────────────────────────────

  it('handles extra spaces', () => {
    expect(parseUSAddress('  123  Main  St,   Miami,   FL   33101  ')).toEqual({
      street: '123 Main St',
      city: 'Miami',
      state: 'FL',
      zip: '33101',
    });
  });

  // ── No suffix, no comma (fallback) ─────────────────────────────────

  it('returns street only when no suffix/comma to split', () => {
    expect(parseUSAddress('107 Broadway Palmyra, NJ 08065')).toEqual({
      street: '107 Broadway',
      city: 'Palmyra',
      state: 'NJ',
      zip: '08065',
    });
  });

  // ── Non-address inputs return null ──────────────────────────────────

  it('returns null for empty string', () => {
    expect(parseUSAddress('')).toBeNull();
  });

  it('returns null for random text', () => {
    expect(parseUSAddress('hello world')).toBeNull();
  });

  it('returns null for partial address without ZIP', () => {
    expect(parseUSAddress('123 Main St, Miami, FL')).toBeNull();
  });
});
