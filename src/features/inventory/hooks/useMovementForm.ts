import { useState, useEffect } from 'react';
import { type InventoryItem } from '../../../schemas/inventory.schema';

interface FormData {
  quantity: number;
  targetLocation: string;
  targetWarehouse: string;
  targetSublocation: string[] | null;
  scanValue: string;
}

export const useMovementForm = (initialSourceItem: InventoryItem | null | undefined) => {
  const [formData, setFormData] = useState<FormData>({
    quantity: 0,
    targetLocation: '',
    targetWarehouse: 'LUDLOW',
    targetSublocation: null,
    scanValue: '',
  });

  useEffect(() => {
    if (initialSourceItem) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form from prop
      setFormData((prev) => ({
        ...prev,
        quantity: Number(initialSourceItem.quantity) || 0,
        targetWarehouse: initialSourceItem.warehouse || 'LUDLOW',
      }));
    } else {
      setFormData({
        quantity: 0,
        targetLocation: '',
        targetWarehouse: 'LUDLOW',
        targetSublocation: null,
        scanValue: '',
      });
    }
  }, [initialSourceItem]);

  const setField = <K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const validate = () => {
    const errors: string[] = [];
    if (!initialSourceItem) errors.push('No source item selected');
    if (formData.quantity <= 0) errors.push('Quantity must be greater than 0');
    if (formData.quantity > (Number(initialSourceItem?.quantity) || 0))
      errors.push('Quantity exceeds available stock');
    if (!formData.targetLocation) errors.push('Target location is required');

    // Only run this check if initial source is loaded
    if (
      initialSourceItem &&
      formData.targetLocation === initialSourceItem.location &&
      formData.targetWarehouse === initialSourceItem.warehouse
    ) {
      errors.push('Cannot move to the same location');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  };

  return {
    formData,
    setField,
    validate,
    setFormData,
  };
};
