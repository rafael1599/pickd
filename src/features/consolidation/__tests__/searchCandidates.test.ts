import { describe, it, expect } from 'vitest';
import { searchCandidates, type SearchableCandidate } from '../searchCandidates';

const c = (overrides: Partial<SearchableCandidate> & { sku: string }): SearchableCandidate => ({
  item_name: null,
  source_row: null,
  sublocation: null,
  alias_chain: null,
  ...overrides,
});

describe('searchCandidates', () => {
  // ──────────────────────────────────────────────────────────────────
  // Empty / no-op queries
  // ──────────────────────────────────────────────────────────────────
  describe('empty queries', () => {
    it('returns input unchanged when query is empty string', () => {
      const input = [c({ sku: 'A' }), c({ sku: 'B' })];
      expect(searchCandidates(input, '')).toEqual(input);
    });

    it('returns input unchanged when query is only whitespace', () => {
      const input = [c({ sku: 'A' }), c({ sku: 'B' })];
      expect(searchCandidates(input, '   \t\n  ')).toEqual(input);
    });

    it('returns input unchanged on undefined-coerced empty', () => {
      const input = [c({ sku: 'A' })];
      // @ts-expect-error testing defensive handling of null
      expect(searchCandidates(input, null)).toEqual(input);
    });

    it('returns empty array when input is empty', () => {
      expect(searchCandidates([], 'foo')).toEqual([]);
    });

    it('does not mutate the original array', () => {
      const input = [c({ sku: 'TAXI-1' }), c({ sku: 'BIKE-2' })];
      const snapshot = [...input];
      searchCandidates(input, 'taxi');
      expect(input).toEqual(snapshot);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Basic SKU matching
  // ──────────────────────────────────────────────────────────────────
  describe('SKU matching', () => {
    it('finds by exact SKU (case-insensitive)', () => {
      const input = [c({ sku: '03-3768BLD' }), c({ sku: '03-4070BL' })];
      expect(searchCandidates(input, '03-3768BLD').map((x) => x.sku)).toEqual(['03-3768BLD']);
      expect(searchCandidates(input, '03-3768bld').map((x) => x.sku)).toEqual(['03-3768BLD']);
    });

    it('finds by prefix', () => {
      const input = [c({ sku: '03-3768BLD' }), c({ sku: '03-4070BL' })];
      expect(searchCandidates(input, '03-37').map((x) => x.sku)).toEqual(['03-3768BLD']);
    });

    it('finds by substring inside SKU', () => {
      const input = [c({ sku: '03-3768BLD' }), c({ sku: '06-4588BL' })];
      expect(searchCandidates(input, '4588').map((x) => x.sku)).toEqual(['06-4588BL']);
    });

    it('returns empty when no SKU matches', () => {
      const input = [c({ sku: '03-3768BLD' })];
      expect(searchCandidates(input, 'nope')).toEqual([]);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Other-field matching: item_name, source_row, sublocation
  // ──────────────────────────────────────────────────────────────────
  describe('other-field matching', () => {
    it('finds by item_name substring', () => {
      const input = [
        c({ sku: 'A', item_name: 'TAXI 26 17 2025 KIWI' }),
        c({ sku: 'B', item_name: 'DRAGON 29 17 2025 BLACK PEARL' }),
      ];
      expect(searchCandidates(input, 'taxi').map((x) => x.sku)).toEqual(['A']);
      expect(searchCandidates(input, 'dragon').map((x) => x.sku)).toEqual(['B']);
    });

    it('finds by source_row', () => {
      const input = [c({ sku: 'A', source_row: 'ROW 10' }), c({ sku: 'B', source_row: 'ROW 51' })];
      expect(searchCandidates(input, 'row 51').map((x) => x.sku)).toEqual(['B']);
    });

    it('finds by sublocation', () => {
      const input = [
        c({ sku: 'A', source_row: 'ROW 10', sublocation: ['D'] }),
        c({ sku: 'B', source_row: 'ROW 10', sublocation: ['F'] }),
      ];
      expect(searchCandidates(input, 'd').map((x) => x.sku)).toEqual(['A']);
      // 'f' alone matches sublocation F in B but also nothing else; check exclusively returns B
      expect(searchCandidates(input, 'f').map((x) => x.sku)).toEqual(['B']);
    });

    it('finds by alias_chain (old SKU name)', () => {
      const input = [
        c({ sku: '03-3768BLD', alias_chain: ['03-3768BLD', '03-3768BL'] }),
        c({ sku: '06-4588BL', alias_chain: ['06-4588BL'] }),
      ];
      // Search by old name surfaces the renamed candidate.
      expect(searchCandidates(input, '03-3768BL').map((x) => x.sku)).toEqual(['03-3768BLD']);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Multi-token AND semantics
  // ──────────────────────────────────────────────────────────────────
  describe('multi-token (AND)', () => {
    it('requires all tokens to match somewhere', () => {
      const input = [
        c({ sku: 'A', item_name: 'TAXI 26 17 2025 KIWI', source_row: 'ROW 15' }),
        c({ sku: 'B', item_name: 'TAXI 26 19 2025 BLUE', source_row: 'ROW 1' }),
      ];
      // Both have TAXI 26, but only A is in ROW 15.
      expect(searchCandidates(input, 'taxi row 15').map((x) => x.sku)).toEqual(['A']);
    });

    it('returns empty when one token has no match', () => {
      const input = [c({ sku: 'TAXI', item_name: 'Bike' })];
      expect(searchCandidates(input, 'taxi unicorn')).toEqual([]);
    });

    it('tokens can match different fields', () => {
      const input = [
        c({ sku: 'A', item_name: 'DRAGON 29', source_row: 'ROW 10' }),
        c({ sku: 'B', item_name: 'DRAGON 29', source_row: 'ROW 11' }),
      ];
      // "dragon row 10" — first token via name, second via row.
      expect(searchCandidates(input, 'dragon row 10').map((x) => x.sku)).toEqual(['A']);
    });

    it('collapses repeated whitespace between tokens', () => {
      const input = [c({ sku: 'A', item_name: 'foo bar' })];
      expect(searchCandidates(input, 'foo    bar').map((x) => x.sku)).toEqual(['A']);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Ranking
  // ──────────────────────────────────────────────────────────────────
  describe('ranking', () => {
    it('exact SKU match ranks above prefix and contains', () => {
      const input = [
        c({ sku: 'XX-TAXI-12' }), // contains
        c({ sku: 'TAXI-12' }), // exact
        c({ sku: 'TAXI-12X' }), // prefix
      ];
      expect(searchCandidates(input, 'TAXI-12').map((x) => x.sku)).toEqual([
        'TAXI-12',
        'TAXI-12X',
        'XX-TAXI-12',
      ]);
    });

    it('prefix match ranks above contains', () => {
      const input = [c({ sku: 'XX-TAXI-1' }), c({ sku: 'TAXI-1X' })];
      expect(searchCandidates(input, 'taxi-1').map((x) => x.sku)).toEqual(['TAXI-1X', 'XX-TAXI-1']);
    });

    it('SKU-contains beats name-only match', () => {
      const input = [
        c({ sku: 'AAA', item_name: 'taxi bike' }), // name-only
        c({ sku: 'BBB-TAXI', item_name: 'unrelated' }), // contains in sku
      ];
      expect(searchCandidates(input, 'taxi').map((x) => x.sku)).toEqual(['BBB-TAXI', 'AAA']);
    });

    it('exact alias match also lands in top tier', () => {
      const input = [
        c({ sku: 'OTHER', item_name: '03-3768BL was an old name' }),
        c({ sku: '03-3768BLD', alias_chain: ['03-3768BLD', '03-3768BL'] }),
      ];
      // Searching the exact old name should put the renamed candidate first.
      expect(searchCandidates(input, '03-3768BL').map((x) => x.sku)).toEqual([
        '03-3768BLD',
        'OTHER',
      ]);
    });

    it('preserves original order inside the same rank tier (stable)', () => {
      const input = [
        c({ sku: 'FIRST', item_name: 'taxi' }),
        c({ sku: 'SECOND', item_name: 'taxi' }),
        c({ sku: 'THIRD', item_name: 'taxi' }),
      ];
      expect(searchCandidates(input, 'taxi').map((x) => x.sku)).toEqual([
        'FIRST',
        'SECOND',
        'THIRD',
      ]);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Edge / defensive
  // ──────────────────────────────────────────────────────────────────
  describe('edge cases', () => {
    it('handles null item_name / source_row / sublocation gracefully', () => {
      const input = [
        c({ sku: 'A', item_name: null, source_row: null, sublocation: null }),
        c({ sku: 'B', item_name: undefined, source_row: undefined, sublocation: undefined }),
      ];
      expect(searchCandidates(input, 'a').map((x) => x.sku)).toEqual(['A']);
      expect(searchCandidates(input, 'b').map((x) => x.sku)).toEqual(['B']);
    });

    it('handles missing alias_chain gracefully', () => {
      const input = [c({ sku: 'A' })]; // alias_chain undefined
      expect(searchCandidates(input, 'A').map((x) => x.sku)).toEqual(['A']);
    });

    it('does not match when alias_chain is empty array', () => {
      const input = [c({ sku: 'A', alias_chain: [] })];
      expect(searchCandidates(input, 'A').map((x) => x.sku)).toEqual(['A']);
      expect(searchCandidates(input, 'B')).toEqual([]);
    });

    it('does not double-count when alias chain contains the current SKU', () => {
      // alias_chain[0] is typically the current sku; haystack should still
      // include item_name etc. once, and aliases should not blow up the rank.
      const input = [c({ sku: 'A', alias_chain: ['A', 'OLD'] })];
      const out = searchCandidates(input, 'A');
      expect(out.length).toBe(1);
    });

    it('handles sublocations with multiple letters joined by +', () => {
      const input = [c({ sku: 'A', source_row: 'ROW 22', sublocation: ['C', 'D', 'E'] })];
      expect(searchCandidates(input, 'c+d').map((x) => x.sku)).toEqual(['A']);
      expect(searchCandidates(input, 'D+E').map((x) => x.sku)).toEqual(['A']);
    });

    it('is case-insensitive across all fields', () => {
      const input = [c({ sku: 'aaa-bbb', item_name: 'lowercase name', source_row: 'row 10' })];
      expect(searchCandidates(input, 'AAA').map((x) => x.sku)).toEqual(['aaa-bbb']);
      expect(searchCandidates(input, 'LOWERCASE NAME').map((x) => x.sku)).toEqual(['aaa-bbb']);
      expect(searchCandidates(input, 'ROW 10').map((x) => x.sku)).toEqual(['aaa-bbb']);
    });

    it('matches a SKU when the query omits the dash', () => {
      const input = [c({ sku: '03-3768BL', item_name: 'DIVIDE' }), c({ sku: '99-0000ZZ' })];
      expect(searchCandidates(input, '033768BL').map((x) => x.sku)).toEqual(['03-3768BL']);
      expect(searchCandidates(input, '033768').map((x) => x.sku)).toEqual(['03-3768BL']);
    });

    it('matches a dash-less partial prefix (operator report: 03398 → 03-3982BL)', () => {
      const input = [c({ sku: '03-3982BL', item_name: 'SOME BIKE' }), c({ sku: '99-0000ZZ' })];
      expect(searchCandidates(input, '03398').map((x) => x.sku)).toEqual(['03-3982BL']);
      expect(searchCandidates(input, '033982').map((x) => x.sku)).toEqual(['03-3982BL']);
    });

    it('still matches with the dash present', () => {
      const input = [c({ sku: '03-3768BL' })];
      expect(searchCandidates(input, '03-3768BL').map((x) => x.sku)).toEqual(['03-3768BL']);
    });

    it('matches a dash-less alias in the chain when query omits the dash', () => {
      const input = [c({ sku: 'NEW-1', alias_chain: ['03-3768BL'] })];
      expect(searchCandidates(input, '033768bl').map((x) => x.sku)).toEqual(['NEW-1']);
    });

    it('does not crash on very long query strings', () => {
      const input = [c({ sku: 'A' })];
      const longQuery = 'foo '.repeat(500);
      expect(() => searchCandidates(input, longQuery)).not.toThrow();
    });

    it('returns deterministic results for the same input', () => {
      const input = [
        c({ sku: 'TAXI-1', item_name: 'a' }),
        c({ sku: 'TAXI-2', item_name: 'a' }),
        c({ sku: 'TAXI-3', item_name: 'a' }),
      ];
      const first = searchCandidates(input, 'taxi').map((x) => x.sku);
      const second = searchCandidates(input, 'taxi').map((x) => x.sku);
      expect(first).toEqual(second);
    });
  });
});
