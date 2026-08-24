// Builds and downloads the FedEx Ship Manager Dimensions CSV.
//
// FSM imports it with "Replace current data", which empties the Dimensions table
// before loading — so a file that is short by a hundred rows does not fail, it
// deletes those hundred cartons from FedEx. Two consequences shape this hook:
//
//   - the read is paginated explicitly rather than trusting PostgREST's default
//     row cap, because a silent truncation here is indistinguishable from a
//     successful export until someone quotes a shipment;
//   - every run is logged with its record and exception counts, which is what
//     later identifies a partial catalog.
//
// Access is enforced by RLS on fedex_dimension_exports (is_admin()); the Settings
// card hides the button for non-admins as a courtesy, not as the boundary.

import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import {
  buildFedexDimensions,
  fedexDimensionsFilename,
  toFsmCsv,
  type DimensionSourceRow,
  type FedexDimensionsResult,
} from '../utils/fedexDimensions';

const COLUMNS = 'sku, model, size, length_in, width_in, height_in, dimensions_verified';
const PAGE = 500;

/**
 * Every bike SKU, in pages. Scratch & Dent is excluded: each of those rows is a
 * single used bike with its own SKU, so they would swamp the table with
 * one-offs — and they all sit on default dimensions anyway.
 */
async function fetchBikeDimensions(): Promise<DimensionSourceRow[]> {
  const rows: DimensionSourceRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('sku_metadata')
      .select(COLUMNS)
      .eq('is_bike', true)
      .eq('is_scratch_dent', false)
      .order('sku', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as DimensionSourceRow[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
}

function downloadCsv(csv: string, filename: string) {
  // FSM reads the file as ASCII; no BOM, or the first description picks up three
  // stray characters and the ID lookup misses on re-import.
  const blob = new Blob([csv], { type: 'text/csv;charset=us-ascii' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface FedexDimensionsExport extends FedexDimensionsResult {
  filename: string;
  csv: string;
}

export function useFedexDimensionsExport() {
  return useMutation({
    mutationKey: ['fedex-dimensions', 'export'],
    mutationFn: async (): Promise<FedexDimensionsExport> => {
      const rows = await fetchBikeDimensions();
      const { records, exceptions } = buildFedexDimensions(rows);

      if (records.length === 0) {
        // Importing an empty file in Replace mode would clear the FSM table.
        throw new Error('No verified dimensions to export — nothing was downloaded.');
      }

      const exceptionSkus = exceptions.map((e) => e.sku);
      if (exceptionSkus.length > 0) {
        const { data: invData } = await supabase
          .from('inventory')
          .select('sku, location')
          .in('sku', exceptionSkus);
        
        if (invData) {
          for (const ex of exceptions) {
            const matches = invData.filter((i) => i.sku === ex.sku && i.location);
            // Grab the first valid location we find for this SKU
            ex.location = matches[0]?.location ?? null;
          }
        }
      }

      const csv = toFsmCsv(records);
      const filename = fedexDimensionsFilename();
      downloadCsv(csv, filename);

      const { data: auth } = await supabase.auth.getUser();
      const { error: logError } = await supabase.from('fedex_dimension_exports').insert({
        exported_by: auth.user?.id ?? null,
        filename,
        record_count: records.length,
        exception_count: exceptions.length,
      });
      // The file is already on disk. Losing the log line is worth a warning, not
      // a failure that tells the operator the export did not happen.
      if (logError) {
        console.error('FedEx dimensions export log failed:', logError);
        toast('Exported, but the export log could not be written.', { icon: '⚠️' });
      }

      return { records, exceptions, csv, filename };
    },
    onSuccess: ({ records, exceptions }) => {
      toast.success(
        exceptions.length
          ? `${records.length} records exported · ${exceptions.length} SKUs held back`
          : `${records.length} records exported`
      );
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Export failed.');
    },
  });
}
