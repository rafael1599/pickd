/**
 * Where to paint a label on top of the photo it was read from.
 *
 * The recogniser hands back a `bbox` per label in pixels; a screen needs a
 * fraction of the rendered image, because the same photo is 4032 px wide on the
 * phone that took it and 380 px wide in the sheet that shows it. Percentages
 * survive that, and they survive `object-contain` as long as the box sits in
 * the same frame as the picture.
 *
 * **Which frame that is depends on the rotation cascade.** `runClientOcr` retries
 * a photo turned 90° or 270° when the upright pass finds no anchors, and the
 * boxes it returns then live in the turned canvas — nobody ever mapped them
 * back, which is invisible while the only reader is a text summary and very
 * visible the moment someone draws a rectangle. So the rotation travels with
 * the result and gets undone here.
 */
import type { OcrBox } from './clientOcr';

/** A rectangle over the rendered photo, in percent of its box. */
export interface OverlayRect {
  leftPct: number;
  topPct: number;
  widthPct: number;
  heightPct: number;
}

/** What the recogniser says about the photo the boxes came from. */
export interface OverlayImageFrame {
  width?: number;
  height?: number;
  rotationUsed?: number;
}

/**
 * The inverse of `mapBoxToRotation`: from the turned canvas back to the photo.
 * `imageWidth`/`imageHeight` are the photo's own, never the canvas's.
 */
export function unmapBoxFromRotation(
  box: OcrBox,
  rotation: number,
  imageWidth: number,
  imageHeight: number
): OcrBox {
  if (rotation === 90) {
    return {
      x: box.y,
      y: imageHeight - (box.x + box.width),
      width: box.height,
      height: box.width,
    };
  }
  if (rotation === 270) {
    return {
      x: imageWidth - (box.y + box.height),
      y: box.x,
      width: box.height,
      height: box.width,
    };
  }
  return { ...box };
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * `null` when the photo never reported its size: a rectangle over an unknown
 * frame would land somewhere arbitrary, and a label painted in the wrong place
 * is worse than a label not painted at all.
 */
export function toOverlayRect(bbox: OcrBox, image: OverlayImageFrame): OverlayRect | null {
  const { width, height } = image;
  if (!width || !height || width <= 0 || height <= 0) return null;

  const box = unmapBoxFromRotation(bbox, image.rotationUsed ?? 0, width, height);
  const leftPct = clamp((box.x / width) * 100, 0, 100);
  const topPct = clamp((box.y / height) * 100, 0, 100);

  return {
    leftPct,
    topPct,
    widthPct: clamp((box.width / width) * 100, 0, 100 - leftPct),
    heightPct: clamp((box.height / height) * 100, 0, 100 - topPct),
  };
}
