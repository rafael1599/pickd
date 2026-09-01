import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { sidesToColumns } from '../../../utils/fedexCarton';
import { supabase } from '../../../lib/supabase';

/**
 * Saves what was read off a box: its three sides, its weight, or both.
 *
 * Writes only the columns that were actually read, by SKU. Not an upsert of
 * the whole metadata row: the row is known to exist (the warning or the queue
 * that opened this form read it), and a partial upsert here would be a way to
 * blank a column nobody was editing. `ItemDetailView` rewrites the whole row
 * because it owns the whole row; this owns what a tape measure and a scale say.
 *
 * The `_verified` flags ARE in the payload, and this is the one caller that
 * should send them. Every call to this hook is somebody who just put a tape or
 * a scale on a box, which is a fact no trigger can infer: `set_dimensions_verified`
 * used to deduce it from the numbers changing, so measuring a carton and finding
 * it really is 55 x 8.5 x 30.5 -- the trigger's own default -- wrote nothing,
 * left the flag false, and dropped the box back into the unmeasured queue. The
 * trigger now takes an explicit true and stamps it, and never lowers either flag,
 * so a form that does not send them (`ItemDetailView`) behaves exactly as before.
 *
 * `dimensions_measured_at` stays out: the trigger owns the clock.
 *
 * Weight is always pounds -- that is what Ship totals into the number the station
 * types into Audit Source, and what `classify_picking_list_fedex` routes on.
 * Whoever read the scale in kilograms converts before calling this; a kilogram
 * column beside the pound one would be a second number for one fact.
 */
export interface CartonMeasurement {
  sku: string;
  /** The three sides, in whatever order they were read off the tape. */
  sides?: [number, number, number];
  /** The weight in pounds, when a scale was involved. */
  weightLbs?: number;
}

export function useUpdateCartonDimensions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: ['sku-metadata', 'carton-dimensions'],
    mutationFn: async ({ sku, sides, weightLbs }: CartonMeasurement) => {
      // Which side is which is decided from the numbers, not from which box the
      // operator typed it in. Pickd stores length/width/height as
      // longest/thinnest/middle, and a form that asked for "width" would invite
      // somebody to put 30 in the column that means 8.
      const columns = sides ? sidesToColumns(sides) : null;
      const payload = {
        ...(columns ? { ...columns, dimensions_verified: true } : {}),
        ...(weightLbs !== undefined ? { weight_lbs: weightLbs, weight_verified: true } : {}),
      };
      if (Object.keys(payload).length === 0) {
        throw new Error('Nothing to save — no sides and no weight.');
      }
      const { error } = await supabase.from('sku_metadata').update(payload).eq('sku', sku);
      if (error) throw error;
      return { sku, columns, weightLbs: weightLbs ?? null };
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
