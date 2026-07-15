// Types for this deep submodule live in src/types/jsbarcode-code128.d.ts (an
// ambient module declaration — jsbarcode ships no types for its encoders).
// Importing the encoder (not the DOM renderer) keeps this headless — no
// canvas/DOM needed, works in the browser and in tests.
import { CODE128 } from 'jsbarcode/bin/barcodes/CODE128/index.js';

/**
 * Returns the Code 128 module pattern for `data` as a string of '1' (bar) and
 * '0' (space). Uses jsbarcode's encoder (auto code-set A/B/C) without any canvas
 * or DOM, so the caller can draw the bars however it likes (e.g. vector rects in
 * a PDF). Throws if `data` contains characters outside Code 128.
 */
export function code128Pattern(data: string): string {
  return new CODE128(data, { ean128: false }).encode().data;
}
