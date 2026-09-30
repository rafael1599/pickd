import { useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useGenerateLabels, type GenerateLabelsResult } from './useGenerateLabels';
import {
  buildSkuLabelEntry,
  pickItemName,
  type SkuLabelMetadata,
  type SkuLabelRequest,
} from '../utils/skuLabelEntry';

/** The SKU's UPC, or null. Decides whether the print window has anything to ask. */
export async function fetchSkuUpc(sku: string): Promise<string | null> {
  const { data } = await supabase.from('sku_metadata').select('upc').eq('sku', sku).maybeSingle();
  const upc = (data?.upc as string | null | undefined)?.trim();
  return upc ? upc : null;
}

/**
 * Nothing to ask means print straight away (Rafael, 30 Sep 2026: "quita la opción
 * de upc cuando no exista upc y de frente que se imprima"): no UPC to include and
 * no quantity to choose, because the SKU holds at most one unit — every S/D.
 */
export const printNeedsOptions = (hasUpc: boolean, unitsOnHand: number): boolean =>
  hasUpc || unitsOnHand > 1;

/**
 * Print a SKU's labels from any screen (Stock card, Item Detail). Reads the SKU
 * itself instead of trusting what the calling screen happened to load, so every
 * button prints the same label — see `buildSkuLabelEntry`.
 */
export function usePrintSkuLabels() {
  const { generate, isGenerating } = useGenerateLabels();

  const print = useCallback(
    async (req: SkuLabelRequest): Promise<GenerateLabelsResult> => {
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
