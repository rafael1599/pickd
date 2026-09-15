import { useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useGenerateLabels } from './useGenerateLabels';
import {
  buildSkuLabelEntry,
  pickItemName,
  type SkuLabelMetadata,
  type SkuLabelRequest,
} from '../utils/skuLabelEntry';

/**
 * Print a SKU's labels from any screen (Stock card, Item Detail). Reads the SKU
 * itself instead of trusting what the calling screen happened to load, so every
 * button prints the same label — see `buildSkuLabelEntry`.
 */
export function usePrintSkuLabels() {
  const { generate, isGenerating } = useGenerateLabels();

  const print = useCallback(
    async (req: SkuLabelRequest): Promise<number> => {
      const [{ data: meta }, { data: rows }] = await Promise.all([
        supabase
          .from('sku_metadata')
          .select('color, size, model, upc, serial_number, category, is_bike')
          .eq('sku', req.sku)
          .maybeSingle(),
        supabase.from('inventory').select('item_name, location, quantity').eq('sku', req.sku),
      ]);
      const entry = buildSkuLabelEntry(
        req,
        (meta as SkuLabelMetadata | null) ?? null,
        pickItemName(rows ?? [], req.location)
      );
      return generate([entry]);
    },
    [generate]
  );

  return { print, isGenerating };
}
