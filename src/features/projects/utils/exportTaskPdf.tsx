/**
 * Per-project (per-task) PDF export.
 *
 * Fetches every task photo through the shared inline-image pipeline
 * (cache-bust CORS + WebP→JPEG transcode) then renders a single-page
 * A4 document via @react-pdf/renderer and triggers a browser download.
 */

import { pdf } from '@react-pdf/renderer';
import { TaskPdfDoc, type TaskPdfDocProps } from '../pdf/TaskPdfDoc';
import { buildInlineMap, applyInlineMap } from '../../../lib/pdf/inlineImages';

export interface ExportTaskPdfArgs {
  task: TaskPdfDocProps['task'];
  /** Full-size photo URLs (pre-transcode — any http(s):// URL is fine). */
  photoUrls: string[];
  /** Optional override. Defaults to `project-<slug>-<YYYY-MM-DD>.pdf`. */
  filenameStem?: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export async function exportTaskPdf(args: ExportTaskPdfArgs): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const {
    filenameStem = `project-${slugify(args.task.title) || args.task.id.slice(0, 8)}-${today}`,
  } = args;

  // Inline photos (same CORS cache-bust + JPEG normalisation as the
  // activity report exporter).
  const urlMap = await buildInlineMap(args.photoUrls);
  const inlinedPhotos = applyInlineMap(args.photoUrls, urlMap);

  const blob = await pdf(
    <TaskPdfDoc task={args.task} photoUrls={inlinedPhotos} exportDate={today} />
  ).toBlob();

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenameStem}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
