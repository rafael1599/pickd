import { describe, expect, it } from 'vitest';
import { LED_FONTS } from '../ledFonts';
import {
  ENTER_MS,
  FLASH_MS,
  PAGE_MS,
  charsThatFit,
  glyphTop,
  layoutRuns,
  ledFrame,
  ledFrameKey,
  ledPages,
  ledSafeText,
  nextLedMode,
  rotateRuns,
  stillGlyphs,
  stillRuns,
  visibleGlyphs,
} from '../ledText';

const F5 = LED_FONTS['5x7'];
const F6 = LED_FONTS['6x10'];
const RED = '#ff4a3d';
const WHITE = '#f2f5ff';
const DIM = '#8a93a3';

describe('the fonts', () => {
  it('are the X11 misc-fixed cells the bench showed', () => {
    expect([F5.w, F5.h]).toEqual([5, 7]);
    expect([F6.w, F6.h]).toEqual([6, 10]);
  });

  it('every glyph has one row per font row and fits its width', () => {
    for (const font of [F5, F6]) {
      for (const [ch, rows] of Object.entries(font.glyphs)) {
        expect(rows, ch).toHaveLength(font.h);
        for (const bits of rows) expect(bits, ch).toBeLessThan(1 << font.w);
      }
    }
  });

  it('centres the capitals on the board — the rows each size was picked with', () => {
    // 5×7 capitals are 6 rows: rows 1–6 of 9. 6×10 capitals are 7: rows 2–8 of 12.
    expect(glyphTop(F5, 9)).toBe(1);
    expect(glyphTop(F6, 12)).toBe(1);
  });
});

describe('ledSafeText — what the font can print', () => {
  it('prints in capitals and folds accents and typographic punctuation', () => {
    expect(ledSafeText('Café – “ok”…', F5)).toBe('CAFE - "OK"...');
  });
  it('one space for any run of whitespace', () => {
    expect(ledSafeText('HOLD   FOR\nADDS', F5)).toBe('HOLD FOR ADDS');
  });
  it("marks what it cannot print with '?', the classic sign's answer", () => {
    expect(ledSafeText('SHIP → 881416 😀', F5)).toBe('SHIP ? 881416 ?');
  });
});

describe('layoutRuns', () => {
  it('one font cell per character; a space takes room but draws nothing', () => {
    const layout = layoutRuns([{ text: 'A B', color: RED }], F5);
    expect(layout.width).toBe(15);
    expect(layout.glyphs.map((g) => [g.ch, g.col])).toEqual([
      ['A', 0],
      ['B', 10],
    ]);
  });
  it('each run keeps its colour', () => {
    const layout = layoutRuns(
      [
        { text: '#347 ', color: DIM },
        { text: 'NOTE', color: WHITE },
      ],
      F5
    );
    expect(layout.glyphs[0]).toEqual({ ch: '#', color: DIM, col: 0 });
    expect(layout.glyphs[4]).toEqual({ ch: 'N', color: WHITE, col: 25 });
  });
});

describe('ledPages — the still modes, one board-width line per page', () => {
  it('fits as many characters as there are columns for (no spacing after the last)', () => {
    expect(charsThatFit(89, F5)).toBe(18);
    expect(charsThatFit(96, F6)).toBe(16);
  });

  it('word-wraps a note, and a new note starts a new page', () => {
    const pages = ledPages(
      [
        [{ text: 'PICK UP · DO NOT SHIP. HP PICKUP FRI', color: RED }],
        [{ text: 'NOTE', color: WHITE }],
      ],
      F5,
      69 // 14 characters
    );
    expect(pages.map((p) => p.map((r) => r.text).join(''))).toEqual([
      'PICK UP · DO',
      'NOT SHIP. HP',
      'PICKUP FRI',
      'NOTE',
    ]);
    expect(pages[3][0].color).toBe(WHITE);
  });

  it('keeps the colour of each word across runs', () => {
    const [page] = ledPages(
      [
        [
          { text: '#347 ', color: DIM },
          { text: 'HOLD', color: RED },
        ],
      ],
      F5,
      89
    );
    expect(page).toEqual([
      { text: '#347', color: DIM },
      { text: ' HOLD', color: RED },
    ]);
  });

  it('never leaves the label separator alone at the edge of a page', () => {
    // Seen on the first build: '#003 NOTE ·' on one page, 'JAMES TO…' on the next.
    const pages = ledPages(
      [
        [
          { text: '#003 ', color: DIM },
          { text: 'NOTE · JAMES TO ASSEMBLE', color: WHITE },
        ],
      ],
      F6,
      96 // 16 characters
    );
    expect(pages.map((p) => p.map((r) => r.text).join(''))).toEqual([
      '#003 NOTE',
      'JAMES TO',
      'ASSEMBLE',
    ]);
    const edge = ledPages([[{ text: 'HOLD · ADDS', color: RED }]], F5, 24); // 5 characters
    expect(edge.map((p) => p[0].text)).toEqual(['HOLD', 'ADDS']);
  });

  it('cuts a word wider than the board instead of pushing it off the edge', () => {
    const pages = ledPages([[{ text: 'ABCDEFGHIJ', color: RED }]], F5, 19); // 4 characters
    expect(pages.map((p) => p[0].text)).toEqual(['ABCD', 'EFGH', 'IJ']);
  });
});

describe('ledFrame — what each mode shows at an instant', () => {
  const board = { stripWidth: 300, pageCount: 3, boardCols: 90, boardRows: 9, colsPerSecond: 30 };

  it('ROTATE enters at the right edge and moves a whole LED at a time', () => {
    expect(ledFrame('rotate', 0, board)).toEqual({ kind: 'strip', offset: -90 });
    expect(ledFrame('rotate', 1000, board)).toEqual({ kind: 'strip', offset: -60 });
    expect(ledFrame('rotate', 1010, board)).toEqual(ledFrame('rotate', 1000, board));
  });

  it('shows a blank board only when there is nothing to show', () => {
    expect(ledFrame('rotate', 0, { ...board, stripWidth: 0 })).toEqual({ kind: 'blank' });
    expect(ledFrame('hold', 0, { ...board, pageCount: 0 })).toEqual({ kind: 'blank' });
  });

  it('HOLD turns the page every PAGE_MS and loops', () => {
    const index = (t: number) => {
      const f = ledFrame('hold', t, board);
      return f.kind === 'page' ? f.index : null;
    };
    expect([0, PAGE_MS, 2 * PAGE_MS, 3 * PAGE_MS].map(index)).toEqual([0, 1, 2, 0]);
    expect(ledFrame('hold', 10, board)).toMatchObject({ lit: true, rise: 0, reveal: 90 });
  });

  it('FLASH blinks, starting lit', () => {
    const lit = (t: number) => (ledFrame('flash', t, board) as { lit: boolean }).lit;
    expect([0, FLASH_MS, 2 * FLASH_MS].map(lit)).toEqual([true, false, true]);
  });

  it('ROLL UP rises from below the board into place', () => {
    const rise = (t: number) => (ledFrame('roll', t, board) as { rise: number }).rise;
    expect(rise(0)).toBe(9);
    expect(rise(ENTER_MS / 2)).toBe(4);
    expect(rise(ENTER_MS)).toBe(0);
  });

  it('WIPE lights the page left to right in the same time at any width', () => {
    const reveal = (t: number) => (ledFrame('wipe', t, board) as { reveal: number }).reveal;
    expect([0, ENTER_MS / 2, ENTER_MS, PAGE_MS - 1].map(reveal)).toEqual([0, 45, 90, 90]);
  });

  it('the same pixels, the same key — nothing redraws between LED steps', () => {
    expect(ledFrameKey(ledFrame('rotate', 1000, board))).toBe(
      ledFrameKey(ledFrame('rotate', 1020, board))
    );
    expect(ledFrameKey(ledFrame('flash', 0, board))).not.toBe(
      ledFrameKey(ledFrame('flash', FLASH_MS, board))
    );
  });
});

describe('visibleGlyphs — the strip on the board', () => {
  const layout = layoutRuns([{ text: 'AB', color: RED }], F5); // 10 columns

  it('nothing shows before the strip enters; its first column appears at the right edge', () => {
    expect(visibleGlyphs(layout, -25, 25, 5)).toEqual([]);
    expect(visibleGlyphs(layout, -24, 25, 5).map((v) => [v.glyph.ch, v.x])).toEqual([['A', 24]]);
  });

  it('repeats end to end with no gap, and wraps from its end back to its start', () => {
    expect(visibleGlyphs(layout, 7, 25, 5).map((v) => [v.glyph.ch, v.x])).toEqual([
      ['B', -2],
      ['A', 3],
      ['B', 8],
      ['A', 13],
      ['B', 18],
      ['A', 23],
    ]);
  });
});

describe('rotateRuns and the modes', () => {
  it('follows every note with a dim diamond', () => {
    const runs = rotateRuns(
      [[{ text: 'PICK UP', color: RED }], [{ text: 'NOTE', color: WHITE }]],
      DIM
    );
    expect(runs.map((r) => r.text)).toEqual(['PICK UP', '  ◆  ', 'NOTE', '  ◆  ']);
    expect(runs[1].color).toBe(DIM);
  });

  it('holding the sign steps through the modes and comes back to ROTATE', () => {
    expect(nextLedMode('rotate')).toBe('hold');
    expect(nextLedMode('wipe')).toBe('rotate');
  });
});

describe('a still sign — a finished order on the board', () => {
  const board = { stripWidth: 300, pageCount: 3, boardCols: 90, boardRows: 9, colsPerSecond: 30 };

  it('is the same frame at any time, so it is drawn once', () => {
    expect(ledFrame('still', 0, board)).toEqual({ kind: 'still' });
    expect(ledFrameKey(ledFrame('still', 5000, board))).toBe(
      ledFrameKey(ledFrame('still', 0, board))
    );
    expect(ledFrame('still', 0, { ...board, stripWidth: 0 })).toEqual({ kind: 'blank' });
  });

  it('shows the notes from their start, and only the letters that fit whole', () => {
    const layout = layoutRuns([{ text: 'AB', color: RED }], F5);
    expect(stillGlyphs(layout, 9, 5).map((v) => [v.glyph.ch, v.x])).toEqual([
      ['A', 0],
      ['B', 5],
    ]);
    // B would lose its last lit column to the frame. A single word wider than the
    // board is the one thing cut — an empty sign would say there is no note.
    expect(stillGlyphs(layout, 8, 5).map((v) => v.glyph.ch)).toEqual(['A']);
  });

  it('ends on the last whole word, never on half a word or a separator', () => {
    // Seen on the first build: 'HOLD · WAITING FOR JAMES TO LOCA'.
    const words = layoutRuns([{ text: 'HOLD FOR ADDS', color: RED }], F5);
    expect(
      stillGlyphs(words, 52, 5)
        .map((v) => v.glyph.ch)
        .join('')
    ).toBe('HOLDFOR');
    const label = layoutRuns([{ text: 'HOLD · ADDS', color: RED }], F5);
    expect(
      stillGlyphs(label, 47, 5)
        .map((v) => v.glyph.ch)
        .join('')
    ).toBe('HOLD');
  });

  it('puts a diamond between the notes and none after the last', () => {
    const runs = stillRuns(
      [[{ text: 'PICK UP', color: RED }], [{ text: 'NOTE', color: WHITE }]],
      DIM
    );
    expect(runs.map((r) => r.text)).toEqual(['PICK UP', '  ◆  ', 'NOTE']);
  });
});
