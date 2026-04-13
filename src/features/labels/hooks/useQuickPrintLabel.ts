import toast from 'react-hot-toast';
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
        upc: null,
        poNumber: null,
        cNumber: null,
        serialNumber: null,
        madeIn: null,
        otherNotes: null,
      },
    ]);
  };

  return { quickPrint, isGenerating };
}
