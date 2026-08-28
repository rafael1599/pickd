/**
 * The font size that keeps a row of big figures on ONE line.
 *
 * Rafael, 2026-08-27: the four numbers of the Ship card (and the e-bike rows
 * under them) "grow or shrink with the space available, but the data always
 * stays on one line". A phone in landscape, a tablet, the desktop split at
 * 40 % or 60 % — the row never wraps and never clips; the digits get smaller.
 *
 * How: the row renders its figures with `data-fit-figure` and everything else
 * (labels, gaps, copy buttons) at fixed size. One measurement gives the width
 * the figures take at the current size and the width everything else takes;
 * the size that fits is current × (room left for figures / figures width),
 * clamped to [minPx, basePx]. A ResizeObserver re-measures when the row's box
 * changes. Only the figures scale, so a label never becomes unreadable.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

export function useFitFontSize(
  rowRef: RefObject<HTMLElement | null>,
  basePx: number,
  minPx: number,
  deps: readonly unknown[]
): number {
  const [size, setSize] = useState(basePx);
  const sizeRef = useRef(basePx);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;

    const measure = () => {
      const figures = row.querySelectorAll<HTMLElement>('[data-fit-figure]');
      if (figures.length === 0) return;
      let figuresWidth = 0;
      figures.forEach((f) => {
        figuresWidth += f.getBoundingClientRect().width;
      });
      if (figuresWidth <= 0) return;
      const current = sizeRef.current;
      const fixed = Math.max(0, row.scrollWidth - figuresWidth);
      const available = row.clientWidth - fixed;
      const next = Math.max(
        minPx,
        Math.min(basePx, Math.floor((current * available) / figuresWidth))
      );
      if (Math.abs(next - current) >= 1) {
        sizeRef.current = next;
        setSize(next);
      }
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
    // The figures' text is what changes their width; callers list it in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowRef, basePx, minPx, ...deps]);

  return size;
}
