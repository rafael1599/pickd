/**
 * Text that jsPDF can actually draw.
 *
 * Every PDF in PickD uses jsPDF's built-in fonts (Helvetica, Courier), which
 * only carry WinAnsi (Windows-1252). Anything outside it — `→`, `≥`, `✓`, an
 * emoji — comes out as garbage glyphs and throws off the spacing of the whole
 * line (Rafael, 30 Sep 2026: «nunca pongas flechita en ningún pdf porque
 * distorsiona todo muy feo»). PickD itself writes some of these into data that
 * reaches a PDF (Edit Order notes say «Replaced 03-3768BL → …», and log notes
 * are printed raw by the daily History PDF), so the fix lives at the PDF, not
 * in every writer: `guardPdfText(new jsPDF(...))`.
 */

/** Readable ASCII stand-ins for symbols that PickD (or a person) actually writes. */
const REPLACEMENTS: Record<string, string> = {
  '→': '->',
  '⟶': '->',
  '➔': '->',
  '➜': '->',
  '⇒': '=>',
  '←': '<-',
  '⇐': '<=',
  '↔': '<->',
  '↑': '^',
  '↓': 'v',
  '✕': 'x',
  '✖': 'x',
  '≥': '>=',
  '≤': '<=',
  '≠': '!=',
  '≈': '~',
  '−': '-',
  '‐': '-',
  '‑': '-',
  '✓': 'OK',
  '✔': 'OK',
  ' ': ' ',
  ' ': ' ',
  ' ': ' ',
};

// Windows-1252 outside Latin-1: the 0x80–0x9F block jsPDF's WinAnsi encoding maps.
const CP1252_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

function isWinAnsi(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return CP1252_EXTRA.has(ch);
}

/** Replace or drop every character the built-in PDF fonts cannot draw. */
export function pdfSafeText(text: string): string {
  let out = '';
  for (const ch of text) {
    if (isWinAnsi(ch)) {
      out += ch;
    } else if (REPLACEMENTS[ch] !== undefined) {
      out += REPLACEMENTS[ch];
    } else {
      // An accented letter outside Latin-1 (ő, ł) keeps its base letter; an
      // emoji or a symbol with no ASCII reading is dropped.
      const base = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      out += [...base].filter(isWinAnsi).join('');
    }
  }
  return out;
}

type PdfText = string | string[];

function safe<T>(value: T): T {
  if (typeof value === 'string') return pdfSafeText(value) as T;
  if (Array.isArray(value)) {
    return value.map((v) => (typeof v === 'string' ? pdfSafeText(v) : v)) as T;
  }
  return value;
}

/**
 * The jsPDF methods that draw or measure text. Measuring has to see the same
 * string that gets drawn, or wrapping and right-alignment are computed for a
 * different width. jspdf-autotable draws through these same instance methods.
 */
interface TextDoc {
  text: (text: PdfText, ...rest: never[]) => unknown;
  splitTextToSize: (text: string, ...rest: never[]) => unknown;
  getTextWidth: (text: string) => number;
  getStringUnitWidth: (text: string, ...rest: never[]) => number;
}

/** Make one jsPDF document sanitise all of its text. Returns the same document. */
export function guardPdfText<D>(doc: D): D {
  const d = doc as unknown as TextDoc;
  for (const name of ['text', 'splitTextToSize', 'getTextWidth', 'getStringUnitWidth'] as const) {
    const original = d[name].bind(d) as (...args: unknown[]) => unknown;
    (d as unknown as Record<string, unknown>)[name] = (first: unknown, ...rest: unknown[]) =>
      original(safe(first), ...rest);
  }
  return doc;
}
