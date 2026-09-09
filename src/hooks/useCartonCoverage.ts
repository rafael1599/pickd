/**
 * What the FedEx Dimensions file already covers, by model + size.
 *
 * FSM imports one carton per model and size, and the file carries no SKU: the
 * station picks the record by name. So the question "does FedEx have this box"
 * is not about the SKU in front of you -- it is about whether any colour of the
 * same model and size has been measured. Two screens ask it (the measuring
 * queue and the Double Check warning) and they read the same index here, for
 * the same reason `fedexCartonGap` lives in utils: a box one screen calls
 * covered and the other calls missing is a trip somebody makes twice.
 *
 * Lives in `src/hooks` rather than in either feature because picking may not
 * import from reports.
 *
 * The read is every bike row with a model, not only the measured ones: an
 * unmeasured sibling is what tells the rule that this model carries sizes, and
 * therefore that a blank size on another row is a missing value rather than a
 * bike with one frame. 618 rows today.
 *
 * One query, no pagination beyond the explicit cap. A truncated read here can
 * only under-report coverage -- somebody measures a box that was already
 * covered -- which is the safe direction, and the opposite of the export's own
 * read, where a missing row deletes a carton.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  buildCartonCoverage,
  type CartonCoverageIndex,
  type MeasuredCartonRow,
} from '../utils/fedexCarton';

export const cartonCoverageKey = ['fedex-dimensions', 'carton-coverage'] as const;

/** Well above the 618 rows that qualify today, and below PostgREST's own cap. */
const COVERAGE_LIMIT = 3000;

export function useCartonCoverage() {
  return useQuery<CartonCoverageIndex>({
    queryKey: cartonCoverageKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sku_metadata')
        .select(
          'sku, model, size, length_in, width_in, height_in, dimensions_verified, ' +
            'dimensions_measured_at, weight_lbs, weight_verified'
        )
        .eq('is_bike', true)
        .not('is_scratch_dent', 'is', true)
        .not('model', 'is', null)
        .limit(COVERAGE_LIMIT);
      if (error) throw error;
      return buildCartonCoverage((data ?? []) as unknown as MeasuredCartonRow[]);
    },
    staleTime: 5 * 60_000,
    // An empty index means "nothing is covered", which asks for a measurement
    // that was not needed. Annoying; never wrong in the dangerous direction.
    retry: false,
  });
}
