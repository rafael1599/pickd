/**
 * pdfRecorder — a test harness that instruments the REAL jsPDF so a test can
 * assert structural properties of any jsPDF-based PDF without rasterizing it.
 *
 * jsPDF v3 attaches its drawing methods as OWN properties on each instance (not
 * on the prototype), so we can't patch the class once — we wrap the constructor
 * and instrument every instance it builds. Tables drawn by jspdf-autotable go
 * through the same `doc.text`/`doc.rect` calls, so they're recorded too, letting
 * us reconstruct cell geometry and check it like any hand-positioned PDF.
 *
 * Usage (the vi.mock must be top-level so it's hoisted above the generator import):
 *
 *   vi.mock('jspdf', async (importOriginal) => {
 *     const actual = await importOriginal<typeof import('jspdf')>();
 *     const { wrapJsPDFConstructor } = await import('<path>/test/pdfRecorder');
 *     const Wrapped = wrapJsPDFConstructor(actual.default);
 *     return { ...actual, default: Wrapped, jsPDF: Wrapped };
 *   });
 *   ...
 *   beforeEach(() => { rec = createRecorder(); });
 *   afterEach(() => rec.restore());
 */
import { expect } from 'vitest';

export interface Box {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface TextEvent extends Box {
  type: 'text';
  text: string;
  fontSize: number;
  color: [number, number, number];
}
export interface ShapeEvent extends Box {
  type: 'rect' | 'line' | 'image';
  fillColor?: [number, number, number];
  drawColor?: [number, number, number];
}
export type DrawEvent = TextEvent | ShapeEvent;
export interface ColorSet {
  kind: 'text' | 'fill' | 'draw';
  value: [number, number, number];
}
interface Sink {
  events: DrawEvent[];
  colors: ColorSet[];
}

// The active sink. createRecorder() points this at a fresh sink; the wrapped
// constructor instruments each new instance into whatever is current.
const slot: { current: Sink | null } = { current: null };

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const f =
    h.length === 3
      ? h
          .split('')
          .map((c) => c + c)
          .join('')
      : h;
  return [parseInt(f.slice(0, 2), 16), parseInt(f.slice(2, 4), 16), parseInt(f.slice(4, 6), 16)];
}

function normalizeColor(args: unknown[]): [number, number, number] {
  if (args.length === 1) {
    const a = args[0];
    if (typeof a === 'number') return [a, a, a];
    if (typeof a === 'string') {
      if (a.startsWith('#')) return hexToRgb(a);
      if (a === 'black') return [0, 0, 0];
      if (a === 'white') return [255, 255, 255];
      const n = Number(a);
      if (!Number.isNaN(n)) return [n, n, n];
    }
  }
  if (args.length >= 3) return [Number(args[0]), Number(args[1]), Number(args[2])];
  return [0, 0, 0];
}

type AnyDoc = Record<string, (...a: unknown[]) => unknown> & {
  getTextDimensions: (t: string) => { w: number; h: number };
  getFontSize: () => number;
};

function instrumentInstance(doc: AnyDoc): void {
  const sink = slot.current;
  if (!sink) return;
  const state = {
    text: [0, 0, 0] as [number, number, number],
    fill: [255, 255, 255] as [number, number, number],
    draw: [0, 0, 0] as [number, number, number],
    page: 1,
  };

  const colorWrap = (name: string, kind: 'text' | 'fill' | 'draw') => {
    if (typeof doc[name] !== 'function') return;
    const orig = doc[name].bind(doc);
    doc[name] = (...a: unknown[]) => {
      const v = normalizeColor(a);
      state[kind] = v;
      sink.colors.push({ kind, value: v });
      return orig(...a);
    };
  };
  colorWrap('setTextColor', 'text');
  colorWrap('setFillColor', 'fill');
  colorWrap('setDrawColor', 'draw');

  const addPageOrig = doc.addPage.bind(doc);
  doc.addPage = (...a: unknown[]) => {
    state.page += 1;
    return addPageOrig(...a);
  };

  const textOrig = doc.text.bind(doc);
  doc.text = (...a: unknown[]) => {
    const raw = a[0];
    const str = Array.isArray(raw) ? raw.join(' ') : String(raw ?? '');
    const x = Number(a[1]);
    const y = Number(a[2]);
    const opts = (a[3] ?? {}) as { align?: string };
    let w = 0;
    let h = 0;
    try {
      const d = doc.getTextDimensions(str);
      w = d.w;
      h = d.h;
    } catch {
      /* ignore */
    }
    const left = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
    sink.events.push({
      type: 'text',
      page: state.page,
      text: str,
      x: left,
      y,
      w,
      h,
      fontSize: doc.getFontSize?.() ?? 0,
      color: state.text.slice() as [number, number, number],
    });
    return textOrig(...a);
  };

  const rectOrig = doc.rect.bind(doc);
  doc.rect = (...a: unknown[]) => {
    sink.events.push({
      type: 'rect',
      page: state.page,
      x: Number(a[0]),
      y: Number(a[1]),
      w: Number(a[2]),
      h: Number(a[3]),
      fillColor: state.fill.slice() as [number, number, number],
      drawColor: state.draw.slice() as [number, number, number],
    });
    return rectOrig(...a);
  };

  const lineOrig = doc.line.bind(doc);
  doc.line = (...a: unknown[]) => {
    const x1 = Number(a[0]);
    const y1 = Number(a[1]);
    const x2 = Number(a[2]);
    const y2 = Number(a[3]);
    sink.events.push({
      type: 'line',
      page: state.page,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1),
      drawColor: state.draw.slice() as [number, number, number],
    });
    return lineOrig(...a);
  };

  // Record image placement only — do NOT call through. jsPDF would decode the
  // bytes (CRC-checked), but tests only need the geometry and the data is mocked.
  doc.addImage = (...a: unknown[]) => {
    sink.events.push({
      type: 'image',
      page: state.page,
      x: Number(a[2]),
      y: Number(a[3]),
      w: Number(a[4]),
      h: Number(a[5]),
    });
    return doc;
  };

  // jsdom doesn't fully implement URL.createObjectURL — short-circuit the blob.
  doc.output = () => 'blob:pdf-recorder-mock';
}

/**
 * Wraps a jsPDF constructor so every instance it builds is instrumented into the
 * currently-active recorder. Use inside a `vi.mock('jspdf', …)` factory.
 */
export function wrapJsPDFConstructor<T extends new (...args: never[]) => object>(Real: T): T {
  function Wrapped(this: unknown, ...args: never[]) {
    const inst = new Real(...args);
    instrumentInstance(inst as unknown as AnyDoc);
    return inst;
  }
  Wrapped.prototype = Real.prototype;
  Object.assign(Wrapped, Real);
  return Wrapped as unknown as T;
}

export interface PdfRecorder {
  events: DrawEvent[];
  colors: ColorSet[];
  texts: () => TextEvent[];
  images: () => ShapeEvent[];
  allText: () => string;
  restore: () => void;
}

/** Starts a fresh recording. Call restore() (in afterEach) to stop. */
export function createRecorder(): PdfRecorder {
  const sink: Sink = { events: [], colors: [] };
  slot.current = sink;
  return {
    events: sink.events,
    colors: sink.colors,
    texts: () => sink.events.filter((e): e is TextEvent => e.type === 'text'),
    images: () => sink.events.filter((e): e is ShapeEvent => e.type === 'image'),
    allText: () =>
      sink.events
        .filter((e): e is TextEvent => e.type === 'text')
        .map((e) => e.text)
        .join('\n'),
    restore: () => {
      slot.current = null;
    },
  };
}

const isGray = ([r, g, b]: [number, number, number]) => r === g && g === b;

/**
 * Asserts the PDF only ever set black/white/grey colours — no hue at all. QR
 * codes / barcodes are raster images (inherently black on white) and aren't
 * colour-set calls, so they're outside this check by construction.
 */
export function expectGrayscaleOnly(rec: PdfRecorder): void {
  const colored = rec.colors.filter((c) => !isGray(c.value));
  expect(
    colored,
    `Expected black & white only, but found coloured draws: ${JSON.stringify(colored)}`
  ).toEqual([]);
}

const overlapH = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);

// Vertical band of a text run, from its line height. 0.6× the reported height
// (≈ glyph box) keeps adjacent wrapped lines — a full line height apart — from
// registering as overlaps.
function vBand(e: TextEvent): [number, number] {
  const cap = e.h * 0.6;
  return [e.y - cap, e.y + e.h * 0.12];
}

/**
 * Asserts no two text runs on the same page overlap, and that no image (QR /
 * barcode) covers a text run. Text drawn on top of its own background rect is
 * fine — rects are intentionally behind text, so rect-vs-text is not checked.
 */
export function expectNoTextOverlap(rec: PdfRecorder, tol = 0.01): void {
  const texts = rec.texts().filter((t) => t.text.trim() && t.w > 0);
  const hits: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i];
      const b = texts[j];
      if (a.page !== b.page) continue;
      const [at, ab] = vBand(a);
      const [bt, bb] = vBand(b);
      const vy = Math.min(ab, bb) - Math.max(at, bt);
      if (overlapH(a, b) > tol && vy > tol) {
        hits.push(`"${a.text}" ↔ "${b.text}" (page ${a.page})`);
      }
    }
  }

  for (const img of rec.images()) {
    for (const t of texts) {
      if (t.page !== img.page) continue;
      const [tt, tb] = vBand(t);
      const vy = Math.min(tb, img.y + img.h) - Math.max(tt, img.y);
      if (overlapH(t, img) > tol && vy > tol) {
        hits.push(`image ↔ "${t.text}" (page ${t.page})`);
      }
    }
  }

  expect(hits, `Expected nothing overlapping, but found:\n${hits.join('\n')}`).toEqual([]);
}

/**
 * Asserts the given strings were drawn, in top-to-bottom order, on one page.
 * Each entry matches the first text run that contains it (substring).
 */
export function expectOrderedText(rec: PdfRecorder, expected: string[], page?: number): void {
  const resolvedPage =
    page ?? rec.texts().find((t) => expected[0] && t.text.includes(expected[0]))?.page ?? 1;
  const texts = rec.texts().filter((t) => t.page === resolvedPage);
  let lastY = -Infinity;
  let cursor = 0;
  for (const needle of expected) {
    const idx = texts.findIndex((t, i) => i >= cursor && t.text.includes(needle));
    expect(idx, `Missing on page ${resolvedPage}: "${needle}"`).toBeGreaterThanOrEqual(0);
    const y = texts[idx].y;
    expect(
      y,
      `"${needle}" is above the previous element (y=${y} < ${lastY}) — out of order`
    ).toBeGreaterThanOrEqual(lastY - 0.01);
    lastY = y;
    cursor = idx + 1;
  }
}

/**
 * Asserts every expected string appears in the drawn text. Whitespace (including
 * line wraps) is collapsed first, so content split across wrapped lines — e.g.
 * "GLOSS BLACK" breaking after "GLOSS" — still counts as present.
 */
export function expectContains(rec: PdfRecorder, expected: string[]): void {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
  const all = norm(rec.allText());
  const missing = expected.filter((s) => !all.includes(norm(s)));
  expect(missing, `PDF is missing content: ${JSON.stringify(missing)}`).toEqual([]);
}
