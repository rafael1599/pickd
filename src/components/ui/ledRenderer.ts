/**
 * Draws an LED sign on a canvas. What to show at each instant is decided in
 * `utils/led/ledText.ts`; this file only puts dots on the screen, as cheaply as a
 * board of 30 cards needs:
 *
 * - **One atlas for the page.** Each character is drawn once per colour and size
 *   (its lit dots with their glow) and then stamped, so a frame is ~20 image
 *   copies, not a loop over every LED.
 * - **One clock for the page.** Every sign on screen shares a single
 *   requestAnimationFrame loop, and a sign scrolled out of view leaves it.
 * - **A frame is drawn only when it changes** — the text moves a whole LED at a
 *   time, so most animation frames draw nothing.
 */
import { LED_FONTS, type LedFont, type LedFontName } from '../../utils/led/ledFonts';
import {
  glyphTop,
  layoutRuns,
  ledFrame,
  ledFrameKey,
  ledPages,
  rotateRuns,
  stillGlyphs,
  stillRuns,
  visibleGlyphs,
  type LedGlyph,
  type LedLayout,
  type LedNote,
  type LedShowMode,
} from '../../utils/led/ledText';

export interface LedBoardSpec {
  font: LedFontName;
  /** Rows of LEDs, the margins included. */
  rows: number;
  /** CSS pixels from one LED to the next. */
  pitch: number;
}

export interface LedScene {
  notes: readonly LedNote[];
  spec: LedBoardSpec;
  mode: LedShowMode;
  separatorColor: string;
  /** Reading pace in characters, so every font reads at the same speed. */
  lettersPerSecond: number;
}

const OFF_LED = '#1b1e26';
/** LEDs are soft glows; past 2x the extra pixels buy nothing but memory. */
const MAX_DPR = 2;

const dotCache = new Map<string, HTMLCanvasElement>();
const glyphCache = new Map<string, HTMLCanvasElement | null>();

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(width));
  c.height = Math.max(1, Math.ceil(height));
  return c;
}

function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** A lit LED: a core the size of an unlit one, and a halo that bleeds into its neighbours. */
function dotSprite(color: string, p: number): HTMLCanvasElement {
  const key = `${color}|${p}`;
  const cached = dotCache.get(key);
  if (cached) return cached;
  const size = Math.ceil(p * 2.6);
  const c = makeCanvas(size, size);
  const g = c.getContext('2d');
  if (g) {
    const mid = size / 2;
    const grad = g.createRadialGradient(mid, mid, 0, mid, mid, p * 1.3);
    grad.addColorStop(0, color);
    grad.addColorStop(0.28, color);
    grad.addColorStop(0.42, withAlpha(color, 0.35));
    grad.addColorStop(1, withAlpha(color, 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  dotCache.set(key, c);
  return c;
}

/** Halo room around a glyph sprite, in device pixels. */
const padFor = (p: number) => Math.ceil(p * 1.3);

function glyphSprite(
  fontName: LedFontName,
  font: LedFont,
  glyph: LedGlyph,
  p: number
): HTMLCanvasElement | null {
  const key = `${fontName}|${p}|${glyph.color}|${glyph.ch}`;
  const cached = glyphCache.get(key);
  if (cached !== undefined) return cached;
  const rows = font.glyphs[glyph.ch];
  if (!rows || rows.every((v) => v === 0)) {
    glyphCache.set(key, null);
    return null;
  }
  const pad = padFor(p);
  const c = makeCanvas(font.w * p + pad * 2, font.h * p + pad * 2);
  const g = c.getContext('2d');
  if (g) {
    const dot = dotSprite(glyph.color, p);
    rows.forEach((bits, r) => {
      for (let x = 0; x < font.w; x++) {
        if (!(bits & (1 << (font.w - 1 - x)))) continue;
        g.drawImage(dot, pad + x * p + p / 2 - dot.width / 2, pad + r * p + p / 2 - dot.height / 2);
      }
    });
  }
  glyphCache.set(key, c);
  return c;
}

export class LedRenderer {
  private scene: LedScene | null = null;
  private width = 0;
  private cols = 0;
  private rows = 0;
  /** Device pixels per LED. */
  private p = 0;
  private top = 0;
  private font: LedFont = LED_FONTS['5x7'];
  private fontName: LedFontName = '5x7';
  private off: HTMLCanvasElement | null = null;
  private strip: LedLayout = { glyphs: [], width: 0 };
  private still: LedLayout = { glyphs: [], width: 0 };
  private pages: LedLayout[] = [];
  private t0 = 0;
  private lastKey = '';
  private announcement: { layout: LedLayout; until: number } | null = null;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D
  ) {}

  /** Null where there is no 2D canvas (tests); the sign's frame still shows. */
  static create(canvas: HTMLCanvasElement): LedRenderer | null {
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      ctx = null;
    }
    return ctx ? new LedRenderer(canvas, ctx) : null;
  }

  setScene(scene: LedScene): void {
    this.scene = scene;
    this.rebuild();
  }

  /** The CSS width the board may take; the LEDs that fit decide its columns. */
  setWidth(width: number): void {
    const w = Math.floor(width);
    if (w === this.width) return;
    this.width = w;
    this.rebuild();
  }

  /** Show a word for a moment (the mode just chosen), then start the content over. */
  announce(text: string, color: string, ms: number): void {
    this.announcement = {
      layout: layoutRuns([{ text, color }], this.font),
      until: performance.now() + ms,
    };
    this.lastKey = '';
  }

  private rebuild(): void {
    const scene = this.scene;
    if (!scene || this.width <= 0) return;
    const { spec } = scene;
    const font = LED_FONTS[spec.font];
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    const cols = Math.max(1, Math.floor(this.width / spec.pitch));
    const p = spec.pitch * dpr;
    if (cols !== this.cols || spec.rows !== this.rows || p !== this.p || font !== this.font) {
      this.cols = cols;
      this.rows = spec.rows;
      this.p = p;
      this.canvas.width = cols * p;
      this.canvas.height = spec.rows * p;
      this.canvas.style.width = `${cols * spec.pitch}px`;
      this.canvas.style.height = `${spec.rows * spec.pitch}px`;
      this.off = this.offGrid();
    }
    this.font = font;
    this.fontName = spec.font;
    this.top = glyphTop(font, spec.rows);
    this.strip = layoutRuns(rotateRuns(scene.notes, scene.separatorColor), font);
    this.still = layoutRuns(stillRuns(scene.notes, scene.separatorColor), font);
    this.pages = ledPages(scene.notes, font, cols).map((runs) => layoutRuns(runs, font));
    this.t0 = performance.now();
    this.lastKey = '';
  }

  private offGrid(): HTMLCanvasElement {
    const c = makeCanvas(this.canvas.width, this.canvas.height);
    const g = c.getContext('2d');
    if (g) {
      const p = this.p;
      const r = Math.max(0.6, p * 0.36);
      g.fillStyle = OFF_LED;
      for (let y = 0; y < this.rows; y++) {
        for (let x = 0; x < this.cols; x++) {
          g.beginPath();
          g.arc(x * p + p / 2, y * p + p / 2, r, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    return c;
  }

  /** Called by the shared clock on every animation frame. */
  readonly tick = (now: number): void => {
    const scene = this.scene;
    if (!scene || this.cols === 0) return;

    if (this.announcement) {
      if (now < this.announcement.until) {
        if (this.lastKey === 'announce') return;
        this.lastKey = 'announce';
        this.drawPage(this.announcement.layout, 0, this.cols);
        return;
      }
      this.announcement = null;
      this.t0 = now;
    }

    const frame = ledFrame(scene.mode, now - this.t0, {
      stripWidth: this.strip.width,
      pageCount: this.pages.length,
      boardCols: this.cols,
      boardRows: this.rows,
      colsPerSecond: scene.lettersPerSecond * this.font.w,
    });
    const key = ledFrameKey(frame);
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (frame.kind === 'still') {
      this.clear();
      for (const { glyph, x } of stillGlyphs(this.still, this.cols, this.font.w)) {
        this.drawGlyph(glyph, x, 0);
      }
    } else if (frame.kind === 'strip') {
      this.clear();
      for (const { glyph, x } of visibleGlyphs(this.strip, frame.offset, this.cols, this.font.w)) {
        this.drawGlyph(glyph, x, 0);
      }
    } else if (frame.kind === 'page') {
      const page = this.pages[frame.index];
      if (!frame.lit || !page) this.clear();
      else this.drawPage(page, frame.rise, frame.reveal);
    } else {
      this.clear();
    }
  };

  private clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.off) this.ctx.drawImage(this.off, 0, 0);
  }

  private drawPage(page: LedLayout, rise: number, reveal: number): void {
    this.clear();
    if (reveal <= 0) return;
    const left = Math.max(0, Math.floor((this.cols - (page.width - 1)) / 2));
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, reveal * this.p, this.rows * this.p);
    this.ctx.clip();
    for (const glyph of page.glyphs) this.drawGlyph(glyph, left + glyph.col, rise);
    this.ctx.restore();
  }

  private drawGlyph(glyph: LedGlyph, x: number, rise: number): void {
    const sprite = glyphSprite(this.fontName, this.font, glyph, this.p);
    if (!sprite) return;
    const pad = padFor(this.p);
    this.ctx.drawImage(sprite, x * this.p - pad, (this.top + rise) * this.p - pad);
  }
}

const ticks = new Set<(now: number) => void>();
let frameId = 0;

function loop(now: number) {
  for (const tick of ticks) tick(now);
  frameId = ticks.size > 0 ? requestAnimationFrame(loop) : 0;
}

/** Join the page's single animation loop; the returned function leaves it. */
export function subscribeLedTick(tick: (now: number) => void): () => void {
  ticks.add(tick);
  if (!frameId) frameId = requestAnimationFrame(loop);
  return () => {
    ticks.delete(tick);
  };
}
