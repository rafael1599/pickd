/**
 * Font registration for @react-pdf/renderer.
 *
 * Resolves each .woff file at build time via Vite's `?url` import so the
 * asset is bundled and served from the same origin (no CORS). Called once
 * by the PDF document module on first import.
 *
 * Side-effect: polyfills `Buffer` on globalThis. @react-pdf/renderer uses
 * Node's Buffer API internally and Vite does not provide it in browsers.
 * Done here (vs. main.tsx) so the polyfill only loads when the PDF chunk
 * is dynamically imported.
 */

import { Buffer } from 'buffer';
if (typeof (globalThis as unknown as { Buffer?: unknown }).Buffer === 'undefined') {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

import { Font } from '@react-pdf/renderer';
import Inter400 from '@fontsource/inter/files/inter-latin-400-normal.woff?url';
import Inter500 from '@fontsource/inter/files/inter-latin-500-normal.woff?url';
import Inter600 from '@fontsource/inter/files/inter-latin-600-normal.woff?url';
import Inter700 from '@fontsource/inter/files/inter-latin-700-normal.woff?url';
import JBMono400 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff?url';
import JBMono500 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff?url';
import JBMono600 from '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-600-normal.woff?url';

let registered = false;

export function registerPdfFonts(): void {
  if (registered) return;
  Font.register({
    family: 'Inter',
    fonts: [
      { src: Inter400, fontWeight: 400 },
      { src: Inter500, fontWeight: 500 },
      { src: Inter600, fontWeight: 600 },
      { src: Inter700, fontWeight: 700 },
    ],
  });
  Font.register({
    family: 'JetBrains Mono',
    fonts: [
      { src: JBMono400, fontWeight: 400 },
      { src: JBMono500, fontWeight: 500 },
      { src: JBMono600, fontWeight: 600 },
    ],
  });
  // Disable word-breaking hyphenation — the dashboard labels look odd when
  // wrapped mid-word.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}
