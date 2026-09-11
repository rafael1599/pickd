import { useEffect, useMemo, useRef } from 'react';
import { LedRenderer, subscribeLedTick, type LedBoardSpec } from './ledRenderer';
import { LED_MODE_LABEL, type LedMode, type LedNote } from '../../utils/led/ledText';

export type LedSignSize = 'large' | 'small';

/**
 * Picked on the bench of 11 Sep 2026 (Rafael: "grande está bien" for Ship, "la
 * versión más pequeña" for the board).
 */
const SPECS: Record<LedSignSize, LedBoardSpec> = {
  // 6×10 font on 12 rows, an LED every 4 px: 48 px tall, capitals 28 px.
  large: { font: '6x10', rows: 12, pitch: 4 },
  // 5×7 font on 9 rows, an LED every 3 px: 27 px tall, capitals 18 px.
  small: { font: '5x7', rows: 9, pitch: 3 },
};

/** Reading pace, in letters, so both sizes read at the same speed. */
const LETTERS_PER_SECOND = 5.5;
const SEPARATOR = '#5d6472';
const ANNOUNCE_COLOR = '#9aa3b2';
const ANNOUNCE_MS = 1200;

interface LedSignProps {
  /** One entry per note, in the order they are read. */
  notes: readonly LedNote[];
  size: LedSignSize;
  mode: LedMode;
  /** What a screen reader says instead of the dots. */
  label: string;
}

/**
 * A dot-matrix LED sign: black in both themes, like the hardware, one colour per
 * run of text. Draws on a canvas (`ledRenderer.ts`) and stops drawing while it is
 * scrolled out of view. With reduced motion it holds still pages instead of
 * scrolling.
 */
export function LedSign({ notes, size, mode, label }: LedSignProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<LedRenderer | null>(null);
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    []
  );
  const shownMode: LedMode = reducedMotion ? 'hold' : mode;
  const notesKey = JSON.stringify(notes);
  const spec = SPECS[size];

  // Declared first so the renderer exists when the scene effect below runs.
  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const renderer = LedRenderer.create(canvas);
    if (!renderer) return;
    rendererRef.current = renderer;
    renderer.setWidth(host.clientWidth);

    const resize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(([entry]) => renderer.setWidth(entry.contentRect.width))
        : null;
    resize?.observe(host);

    let leave: (() => void) | null = null;
    const start = () => {
      leave ??= subscribeLedTick(renderer.tick);
    };
    const stop = () => {
      leave?.();
      leave = null;
    };
    const visibility =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()))
        : null;
    if (visibility) visibility.observe(host);
    else start();

    return () => {
      stop();
      visibility?.disconnect();
      resize?.disconnect();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setScene({
      notes: JSON.parse(notesKey) as LedNote[],
      spec: SPECS[size],
      mode: shownMode,
      separatorColor: SEPARATOR,
      lettersPerSecond: LETTERS_PER_SECOND,
    });
  }, [notesKey, size, shownMode]);

  // A new mode says its name for a moment, the way a sign confirms a setting.
  const lastMode = useRef(shownMode);
  useEffect(() => {
    if (lastMode.current === shownMode) return;
    lastMode.current = shownMode;
    rendererRef.current?.announce(LED_MODE_LABEL[shownMode], ANNOUNCE_COLOR, ANNOUNCE_MS);
  }, [shownMode]);

  return (
    <div
      role="img"
      aria-label={label}
      className={`w-full bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ${
        size === 'large' ? 'rounded-xl p-2' : 'rounded-lg p-1'
      }`}
    >
      <div
        ref={hostRef}
        className="flex w-full justify-center"
        style={{ minHeight: spec.rows * spec.pitch }}
      >
        <canvas ref={canvasRef} className="block" aria-hidden="true" />
      </div>
    </div>
  );
}
