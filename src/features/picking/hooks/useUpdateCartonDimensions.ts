import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { sidesToColumns } from '../../../utils/fedexCarton';

/**
 * Saves a carton measured at the double-check station.
 *
 * Writes only the three dimension columns, by SKU. Not an upsert of the whole
 * metadata row: the row is known to exist (the warning that opened this form
 * read it), and a partial upsert here would be a way to blank a column nobody
 * was editing. `ItemDetailView` rewrites the whole row because it owns the
 * whole row; this owns three numbers.
 *
 * `dimensions_verified` and `dimensions_measured_at` are deliberately not in
 * the payload. The DB trigger `tr_sku_metadata_dimensions_verified` sets both
 * whenever a dimension changes value, so a save that changed nothing does not
 * promote an unmeasured SKU or restamp one nobody touched -- and each flag
 * keeps one owner instead of two.
 */
export interface CartonMeasurement {
  sku: string;
  /** The three sides, in whatever order they were read off the tape. */
  sides: [number, number, number];
}

export function useUpdateCartonDimensions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['sku-metadata', 'carton-dimensions'],
    mutationFn: async ({ sku, sides }: CartonMeasurement) => {
      // Which side is which is decided from the numbers, not from which box the
      // operator typed it in. Pickd stores length/width/height as
      // longest/thinnest/middle, and a form that asked for "width" would invite
      // somebody to put 30 in the column that means 8.
      const columns = sidesToColumns(sides);
      const { error } = await supabase.from('sku_metadata').update(columns).eq('sku', sku);
      if (error) throw error;
      return { sku, ...columns };
    },
    onSuccess: () => {
      // Inventory queries embed sku_metadata, so a stale card would keep
      // showing the default it was just corrected away from.
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Could not save the measurements';
      toast.error(message);
    },
  });
}
