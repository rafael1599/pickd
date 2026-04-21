/**
 * Activity Report → PDF exporter (idea-059).
 *
 * Uses @react-pdf/renderer — renders React components directly to a
 * vector PDF with selectable text and embedded Inter + JetBrains Mono
 * fonts. Replaces the previous html2canvas approach which produced a
 * rasterised non-selectable page that pixelated on zoom.
 *
 * Image CORS: gallery photos come from a public R2 bucket that returns
 * `Access-Control-Allow-Origin` only when the request carries `Origin`.
 * The live preview pre-loads the same URLs without CORS, so the browser
 * cache holds responses without ACAO metadata. A cache-busted fetch
 * (`?_pdf=<ts>` + `cache: 'reload'`) forces a fresh request; we convert
 * each response to a same-origin data URL and pass it to react-pdf's
 * <Image src>. See skill `image-cors-cache-bust` for the full rundown.
 */

import { pdf } from '@react-pdf/renderer';
import {
  ActivityReportPdfDoc,
  type ActivityReportPdfDocProps,
} from '../pdf/ActivityReportPdfDoc';
import type { ActivityReport } from '../hooks/useActivityReport';
import type { ReportTask } from '../../projects/hooks/useProjectReportData';

interface UserNote {
  id: string;
  full_name: string;
  text: string;
}

export interface ExportReportPdfArgs {
  report: ActivityReport;
  accuracyPct: number;
  notes: UserNote[];
  winOfTheDay: string;
  routineChecklist: string[];
  pickdUpdates: string[];
  doneToday: ReportTask[];
  inProgress: ReportTask[];
  comingUpNext: ReportTask[];
  waitingOrdersCount?: number;
  filenameStem?: string;
}

// ── CORS-safe image inlining ────────────────────────────────────────────

/**
 * Decode a blob into an HTMLImageElement, draw it onto a 2D canvas, and
 * return a JPEG data URL. Used to transcode WebP (which @react-pdf/renderer
 * can't parse — it only supports PNG/JPEG) into JPEG before embedding.
 * Also benefits non-WebP sources: all images end up as same-origin JPEGs,
 * decoded once by the browser instead of by react-pdf's bundled decoder.
 */
async function blobToJpegDataUrl(blob: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          URL.revokeObjectURL(objectUrl);
          resolve(null);
          return;
        }
        // White background so JPEG (no alpha) doesn't render transparent
        // pixels as black.
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(objectUrl);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        URL.revokeObjectURL(objectUrl);
        resolve(null);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(null);
    };
    img.src = objectUrl;
  });
}

async function urlToDataUrl(url: string): Promise<string | null> {
  try {
    const sep = url.includes('?') ? '&' : '?';
    const bustUrl = `${url}${sep}_pdf=${Date.now()}`;
    const res = await fetch(bustUrl, {
      mode: 'cors',
      credentials: 'omit',
      cache: 'reload',
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    // Transcode through a canvas: react-pdf's image decoder rejects WebP
    // ("Base64 image invalid format: webp") and the source format of a URL
    // isn't guaranteed, so we normalise every image to JPEG.
    return await blobToJpegDataUrl(blob);
  } catch {
    return null;
  }
}

/**
 * Pre-fetch every pallet photo and return a copy of the orders array with
 * photo URLs swapped to same-origin data URLs. Original URLs are left in
 * place if the fetch fails (react-pdf will then try to load them directly
 * and may succeed or render a broken tile — never blocks the whole export).
 */
async function inlineOrderPhotos(
  orders: ActivityReport['completed_orders_with_photos']
): Promise<ActivityReport['completed_orders_with_photos']> {
  const uniqueUrls = [
    ...new Set(orders.flatMap((o) => o.photos).filter((u) => !u.startsWith('data:'))),
  ];
  const urlMap = new Map<string, string>();
  await Promise.all(
    uniqueUrls.map(async (url) => {
      const dataUrl = await urlToDataUrl(url);
      if (dataUrl) urlMap.set(url, dataUrl);
    })
  );
  return orders.map((o) => ({
    ...o,
    photos: o.photos.map((url) => urlMap.get(url) ?? url),
  }));
}

// ── Public entry point ─────────────────────────────────────────────────

export async function exportActivityReportPdf(
  args: ExportReportPdfArgs
): Promise<void> {
  const { filenameStem = `activity-report-${args.report.date}` } = args;

  // Inline pallet photos → data URLs before handing the doc to react-pdf.
  const inlinedOrders = await inlineOrderPhotos(
    args.report.completed_orders_with_photos
  );

  const docProps: ActivityReportPdfDocProps = {
    report: { ...args.report, completed_orders_with_photos: inlinedOrders },
    accuracyPct: args.accuracyPct,
    winOfTheDay: args.winOfTheDay,
    pickdUpdates: args.pickdUpdates,
    doneToday: args.doneToday,
    inProgress: args.inProgress,
    comingUpNext: args.comingUpNext,
    notes: args.notes,
    routineChecklist: args.routineChecklist,
  };

  const blob = await pdf(<ActivityReportPdfDoc {...docProps} />).toBlob();

  // Trigger download. Object URL is revoked after the anchor click to free memory.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenameStem}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a tick to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
