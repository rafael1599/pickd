// Parse a JAMIS "Purchase Order Worksheet" PDF into the same ParsedSheet shape
// the xlsx path produces, so the Registrar Container flow can accept PDFs too.
//
// pdfjs extracts positioned text items; we reassemble them into visual lines
// (group by Y, sort by X) and hand the newline-joined text to the pure
// parseWorksheetText — which carries all the SKU/qty logic and the tests.

import * as pdfjsLib from 'pdfjs-dist';
// Vite resolves this to a hashed URL; pdfjs runs its parser in that worker.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseWorksheetText } from './parseWorksheetText';
import type { ParsedSheet } from './types';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

interface TextItem {
  str: string;
  transform: number[]; // [a, b, c, d, x, y]
}

/** Reassemble pdfjs text items into lines: bucket by Y (rounded), order by X. */
function itemsToText(items: TextItem[]): string {
  const lines = new Map<number, { x: number; str: string }[]>();
  for (const it of items) {
    if (!it.str) continue;
    const y = Math.round(it.transform[5]);
    // Merge items within ~2px vertically onto the same line key.
    const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
    const bucket = lines.get(key) ?? [];
    bucket.push({ x: it.transform[4], str: it.str });
    lines.set(key, bucket);
  }
  return [...lines.entries()]
    .sort((a, b) => b[0] - a[0]) // top of page first (PDF Y grows upward)
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    )
    .join('\n');
}

export async function parseShipmentPdf(file: File): Promise<ParsedSheet[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data });
  const doc = await loadingTask.promise;
  try {
    const pageTexts: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      pageTexts.push(itemsToText(content.items as TextItem[]));
    }
    return [parseWorksheetText(pageTexts.join('\n'), file.name)];
  } finally {
    void loadingTask.destroy(); // frees the worker
  }
}
