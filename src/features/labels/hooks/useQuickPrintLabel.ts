import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useGenerateLabels } from './useGenerateLabels';

/**
 * Quick-print a single label from any view (InventoryCard, DoubleCheckView).
 * No navigation needed — generates 1 label and opens PDF immediately.
 */
export function useQuickPrintLabel() {
  const { generate, isGenerating } = useGenerateLabels();

  const quickPrint = async (sku: string, itemName: string | null, location: string | null) => {
    if (!location) {
      toast.error('Location required for label');
      return;
    }

    // Pull label metadata (color/model/size/serial/upc) so quick-printed labels
    // carry the same content as Label Studio ones.
    const { data: meta } = await supabase
      .from('sku_metadata')
      .select('upc, color, model, size, serial_number')
      .eq('sku', sku)
      .maybeSingle();

    await generate([
      {
        sku,
        itemName,
        location,
        stock: 0,
        tagged: 0,
        qty: 1,
        layout: 'standard',
        prefix: null,
        extra: null,
        upc: meta?.upc ?? null,
        color: meta?.color ?? null,
        model: meta?.model ?? null,
        size: meta?.size ?? null,
        poNumber: null,
        cNumber: null,
        serialNumber: meta?.serial_number ?? null,
        madeIn: null,
        otherNotes: null,
        withQr: true,
        withBarcode: true,
      },
    ]);
  };

  return { quickPrint, isGenerating };
}
