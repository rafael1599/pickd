/**
 * What an LED sign shows at any instant — pure, so the modes are tested without a
 * canvas. The drawing lives in `components/ui/ledRenderer.ts`.
 *
 * The modes are the classic ones of the Alpha sign protocol (the industry's
 * standard, 25 modes): ROTATE runs the text right to left, which is how a note
 * longer than the board gets read whole, so it is the default (Rafael, 11 Sep
 * 2026). The others show still pages the width of the board.
 */
import type { LedFont } from './ledFonts';

export type LedMode = 'rotate' | 'hold' | 'flash' | 'roll' | 'wipe';

export const LED_MODES: readonly LedMode[] = ['rotate', 'hold', 'flash', 'roll', 'wipe'];

export const LED_MODE_LABEL: Readonly<Record<LedMode, string>> = {
  rotate: 'ROTATE',
  hold: 'HOLD',
  flash: 'FLASH',
  roll: 'ROLL UP',
  wipe: 'WIPE',
};

/**
 * What a sign is told to do: one of the modes, or stand still — a finished order
 * on the Live Board (Rafael, 11 Sep 2026: "en completed orders no se mueve la
 * nota, se mantiene firme"). 'still' is not a mode a person steps through.
 */
export type LedShowMode = LedMode | 'still';

export function nextLedMode(mode: LedMode): LedMode {
  return LED_MODES[(LED_MODES.indexOf(mode) + 1) % LED_MODES.length];
}

/** Text in one colour. */
export interface LedRun {
  text: string;
  color: string;
}

/** One note: its runs in reading order ('#347 ' dim, then the note in its colour). */
export type LedNote = readonly LedRun[];

/** How long a still page stays up. */
export const PAGE_MS = 2500;
/** FLASH blinks on and off at this half-period. */
export const FLASH_MS = 350;
/** ROLL UP and WIPE finish drawing a page in this time, whatever its width. */
export const ENTER_MS = 600;

const TYPOGRAPHIC: Readonly<Record<string, string>> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  '•': '·',
};

/**
 * What the font can print: capitals, accents dropped ("é" → "E"), typographic
 * punctuation folded to ASCII, runs of whitespace as one space; anything else '?'
 * — the classic sign's answer, and better than a gap that silently drops a symbol.
 */
export function ledSafeText(text: string, font: LedFont): string {
  const folded = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”–—…•]/g, (c) => TYPOGRAPHIC[c])
    .replace(/\s+/g, ' ')
    .toUpperCase();
  let out = '';
  for (const ch of folded) out += font.glyphs[ch] ? ch : '?';
  return out;
}

export interface LedGlyph {
  ch: string;
  color: string;
  /** Board column of the glyph's left edge, from the start of the layout. */
  col: number;
}

export interface LedLayout {
  glyphs: LedGlyph[];
  /** Columns the layout occupies, the last character's spacing column included. */
  width: number;
}

/** Runs laid end to end, one font cell per character. Spaces take room but no glyph. */
export function layoutRuns(runs: readonly LedRun[], font: LedFont): LedLayout {
  const glyphs: LedGlyph[] = [];
  let col = 0;
  for (const run of runs) {
    for (const ch of ledSafeText(run.text, font)) {
      if (ch !== ' ') glyphs.push({ ch, color: run.color, col });
      col += font.w;
    }
  }
  return { glyphs, width: col };
}

/**
 * The board row of the font's top row, so the capitals sit centred — the sign
 * prints in capitals, so the descender row may hang into the bottom margin.
 */
export function glyphTop(font: LedFont, boardRows: number): number {
  const rows = font.glyphs.H;
  const first = rows.findIndex((v) => v !== 0);
  const last = rows.length - 1 - [...rows].reverse().findIndex((v) => v !== 0);
  return Math.floor((boardRows - (last - first + 1)) / 2) - first;
}

/** How many characters fit on a board this wide (the last one needs no spacing column). */
export function charsThatFit(boardCols: number, font: LedFont): number {
  return Math.max(1, Math.floor((boardCols + 1) / font.w));
}

/**
 * Every note word-wrapped to the board: one page per line, each word keeping its
 * colour. A word longer than the board is cut, never pushed off the edge.
 */
export function ledPages(notes: readonly LedNote[], font: LedFont, boardCols: number): LedRun[][] {
  const maxChars = charsThatFit(boardCols, font);
  const pages: LedRun[][] = [];
  for (const note of notes) {
    const words: LedRun[] = [];
    for (const run of note) {
      for (const word of ledSafeText(run.text, font).split(' ')) {
        if (!word) continue;
        for (let i = 0; i < word.length; i += maxChars) {
          words.push({ text: word.slice(i, i + maxChars), color: run.color });
        }
      }
    }
    let line: LedRun[] = [];
    let length = 0;
    const flush = () => {
      // The '·' between a label and its note joins two things on one line; at a
      // page's edge it joins nothing.
      const last = line[line.length - 1];
      if (last) {
        last.text = last.text.replace(/ ?·$/, '');
        if (!last.text.trim()) line.pop();
      }
      if (line.length > 0) pages.push(line);
      line = [];
      length = 0;
    };
    for (const word of words) {
      const needed = length === 0 ? word.text.length : length + 1 + word.text.length;
      if (needed > maxChars) flush();
      if (length === 0 && word.text === '·') continue;
      const last = line[line.length - 1];
      if (last && last.color === word.color) {
        last.text += ` ${word.text}`;
      } else {
        line.push({ text: length === 0 ? word.text : ` ${word.text}`, color: word.color });
      }
      length = length === 0 ? word.text.length : length + 1 + word.text.length;
    }
    flush();
  }
  return pages;
}

export type LedFrame =
  | { kind: 'blank' }
  /** The notes from their start, not moving; what does not fit is left for the history. */
  | { kind: 'still' }
  /** The strip's column at the board's left edge; negative while it enters from the right. */
  | { kind: 'strip'; offset: number }
  /**
   * A still page. `lit` false is FLASH's dark half; `rise` is how many rows below
   * its place the page still sits (ROLL UP); `reveal` how many columns are lit (WIPE).
   */
  | { kind: 'page'; index: number; lit: boolean; rise: number; reveal: number };

export interface LedFrameInput {
  stripWidth: number;
  pageCount: number;
  boardCols: number;
  boardRows: number;
  colsPerSecond: number;
}

/** The frame `elapsedMs` after the sign started showing its content. */
export function ledFrame(mode: LedShowMode, elapsedMs: number, input: LedFrameInput): LedFrame {
  const t = Math.max(0, elapsedMs);
  if (mode === 'still') return input.stripWidth > 0 ? { kind: 'still' } : { kind: 'blank' };
  if (mode === 'rotate') {
    if (input.stripWidth <= 0) return { kind: 'blank' };
    // It enters at the right edge once and then loops with no blank gap: an
    // empty board would read as "no notes".
    const step = Math.floor((t / 1000) * input.colsPerSecond);
    return { kind: 'strip', offset: step - input.boardCols };
  }
  if (input.pageCount <= 0) return { kind: 'blank' };
  const index = Math.floor(t / PAGE_MS) % input.pageCount;
  const within = t % PAGE_MS;
  const entered = Math.min(1, within / ENTER_MS);
  return {
    kind: 'page',
    index,
    lit: mode !== 'flash' || Math.floor(within / FLASH_MS) % 2 === 0,
    rise: mode === 'roll' ? input.boardRows - Math.round(input.boardRows * entered) : 0,
    reveal: mode === 'wipe' ? Math.round(input.boardCols * entered) : input.boardCols,
  };
}

/** Two frames that would draw the same pixels get the same key, so nothing redraws. */
export function ledFrameKey(frame: LedFrame): string {
  if (frame.kind === 'blank' || frame.kind === 'still') return frame.kind;
  if (frame.kind === 'strip') return `s${frame.offset}`;
  return `p${frame.index}:${frame.lit ? 1 : 0}:${frame.rise}:${frame.reveal}`;
}

/**
 * The strip's glyphs on the board for this offset, with their board column. The
 * strip repeats end to end, so a short one shows more than once and a long one
 * wraps from its end back to its start.
 */
export function visibleGlyphs(
  layout: LedLayout,
  offset: number,
  boardCols: number,
  fontW: number
): Array<{ glyph: LedGlyph; x: number }> {
  const out: Array<{ glyph: LedGlyph; x: number }> = [];
  const length = layout.width;
  if (length <= 0) return out;
  const first = offset < 0 ? 0 : Math.floor(offset / length);
  for (let rep = first; rep * length - offset < boardCols; rep++) {
    for (const glyph of layout.glyphs) {
      const x = rep * length + glyph.col - offset;
      if (x + fontW <= 0 || x >= boardCols) continue;
      out.push({ glyph, x });
    }
  }
  return out;
}

/**
 * A still sign's glyphs: the notes from their start, up to the last word that
 * fits whole — a cut letter or half a word reads as a fault, not as "there is
 * more" (the tap opens the rest). A single word wider than the board is cut,
 * because showing nothing would say there is no note.
 */
export function stillGlyphs(
  layout: LedLayout,
  boardCols: number,
  fontW: number
): Array<{ glyph: LedGlyph; x: number }> {
  const glyphs = layout.glyphs;
  let end = glyphs.findIndex((g) => g.col + fontW - 1 > boardCols);
  if (end === -1) end = glyphs.length;
  // The next glyph sits in the very next cell: the last word is only half in.
  const adjacent = (i: number) => glyphs[i].col - glyphs[i - 1].col === fontW;
  if (end > 0 && end < glyphs.length && adjacent(end)) {
    let start = end - 1;
    while (start > 0 && adjacent(start)) start--;
    if (start > 0) end = start;
  }
  // Nor end on a separator.
  while (end > 0 && (glyphs[end - 1].ch === '·' || glyphs[end - 1].ch === '◆')) end--;
  return glyphs.slice(0, end).map((glyph) => ({ glyph, x: glyph.col }));
}

/**
 * The rotating strip: every note followed by a dim diamond, so where one ends and
 * the next begins reads at a glance, and so does the loop's seam.
 */
export function rotateRuns(notes: readonly LedNote[], separatorColor: string): LedRun[] {
  const runs: LedRun[] = [];
  for (const note of notes) {
    runs.push(...note, { text: '  ◆  ', color: separatorColor });
  }
  return runs;
}

/** The same notes for a still sign: a diamond between them, none after the last. */
export function stillRuns(notes: readonly LedNote[], separatorColor: string): LedRun[] {
  return rotateRuns(notes, separatorColor).slice(0, -1);
}
