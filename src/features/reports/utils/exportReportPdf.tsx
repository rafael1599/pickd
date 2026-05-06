/**
 * Activity Report → PDF exporter (idea-059).
 *
 * Uses @react-pdf/renderer — renders React components directly to a
 * vector PDF with selectable text and embedded Inter + JetBrains Mono
 * fonts. Replaces the previous html2canvas approach which produced a
 * rasterised non-selectable page that pixelated on zoom.
 *
 * Image inlining (CORS cache-bust + WebP → JPEG transcode) lives in
 * `src/lib/pdf/inlineImages.ts` and is shared with other PDF exporters.
 */

import { pdf } from '@react-pdf/renderer';
import {
  ActivityReportPdfDoc,
  type ActivityReportPdfDocProps,
} from '../pdf/ActivityReportPdfDoc';
import { buildInlineMap, applyInlineMap } from '../../../lib/pdf/inlineImages';
import type { ActivityReport, FedExReturnSummary } from '../hooks/useActivityReport';
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
  /** idea-091 weekly toggle — passed straight through to the PDF doc. */
  weeklyFedexReturns?: FedExReturnSummary[];
  showWeeklyFedex?: boolean;
  filenameStem?: string;
}

export async function exportActivityReportPdf(
  args: ExportReportPdfArgs
): Promise<void> {
  const { filenameStem = `activity-report-${args.report.date}` } = args;

  // Collect every external image URL (pallet photos + project photos) into
  // one batch, fetch them concurrently, transcode to JPEG data URLs, then
  // remap each field.
  const palletUrls = args.report.completed_orders_with_photos.flatMap((o) => o.photos);
  const projectUrls = [...args.doneToday, ...args.inProgress, ...args.comingUpNext].flatMap(
    (t) => t.all_photos_fullsize ?? t.photo_fullsize ?? []
  );
  const urlMap = await buildInlineMap([...palletUrls, ...projectUrls]);

  const inlinedOrders = args.report.completed_orders_with_photos.map((o) => ({
    ...o,
    photos: applyInlineMap(o.photos, urlMap),
  }));
  const inlineTasks = (tasks: ReportTask[]): ReportTask[] =>
    tasks.map((t) => ({
      ...t,
      all_photos_fullsize: t.all_photos_fullsize
        ? applyInlineMap(t.all_photos_fullsize, urlMap)
        : undefined,
      photo_fullsize: t.photo_fullsize
        ? applyInlineMap(t.photo_fullsize, urlMap)
        : undefined,
    }));

  const docProps: ActivityReportPdfDocProps = {
    report: { ...args.report, completed_orders_with_photos: inlinedOrders },
    accuracyPct: args.accuracyPct,
    winOfTheDay: args.winOfTheDay,
    pickdUpdates: args.pickdUpdates,
    doneToday: inlineTasks(args.doneToday),
    inProgress: inlineTasks(args.inProgress),
    comingUpNext: inlineTasks(args.comingUpNext),
    notes: args.notes,
    routineChecklist: args.routineChecklist,
    weeklyFedexReturns: args.weeklyFedexReturns,
    showWeeklyFedex: args.showWeeklyFedex,
  };

  const blob = await pdf(<ActivityReportPdfDoc {...docProps} />).toBlob();

  // Trigger download. Object URL is revoked after the anchor click.
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${filenameStem}.pdf`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
