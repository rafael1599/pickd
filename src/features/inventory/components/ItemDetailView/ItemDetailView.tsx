import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Save from 'lucide-react/dist/esm/icons/save';

import { useInventory } from '../../hooks/useInventoryData.ts';
import { INVENTORY_ROOT_KEY, PARTS_BINS_KEY } from '../../hooks/useInventoryRealtime';
import { useLocationManagement } from '../../hooks/useLocationManagement.ts';
import { useConfirmation } from '../../../../context/ConfirmationContext.tsx';
import { useViewMode } from '../../../../context/ViewModeContext.tsx';

import AutocompleteInput from '../../../../components/ui/AutocompleteInput.tsx';
import {
  InventoryItemWithMetadata,
  InventoryItemInput,
  InventoryFormSchema,
  type InventoryFormValues,
  type DistributionItem,
} from '../../../../schemas/inventory.schema.ts';
import { predictLocation } from '../../../../utils/locationPredictor.ts';
import { calculateBikeDistribution } from '../../../../utils/distributionCalculator.ts';
import { inventoryService } from '../../api/inventory.service.ts';
import { uploadPhoto, deletePhoto } from '../../../../services/photoUpload.service';
import { useScrollLock } from '../../../../hooks/useScrollLock';

import { useActiveField } from './useActiveField.ts';
import { DetailToolbar } from './DetailToolbar.tsx';
import { PhotoHero } from './PhotoHero.tsx';
import { TappableField } from './TappableField.tsx';
import { SectionRow } from './SectionRow.tsx';
import { QuantityControl } from './QuantityControl.tsx';
import { DistributionPreview } from './DistributionPreview.tsx';
import { SectionEditorSheet } from './SectionEditorSheet.tsx';
import { ItemHistorySheet } from './ItemHistorySheet.tsx';

type WarehouseType = 'LUDLOW' | 'ATS' | 'DELETED ITEMS';

const DEFAULT_UNITS: Record<string, number> = { TOWER: 30, LINE: 5, PALLET: 10, OTHER: 1 };

/** Dimension defaults: bikes get standard box dims, parts get zeros */
function dimensionDefaults(isBike?: boolean | null) {
  return isBike !== false // default to bike dims when unknown (null/undefined)
    ? { length_in: 54, width_in: 8, height_in: 30, weight_lbs: 45 }
    : { length_in: 0, width_in: 0, height_in: 0, weight_lbs: 0 };
}

interface ItemDetailViewProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    data: InventoryItemInput & { length_in?: number; width_in?: number; height_in?: number }
  ) => void;
  onDelete?: () => void;
  initialData?: InventoryItemWithMetadata | null;
  mode?: 'add' | 'edit';
  screenType?: WarehouseType | string;
}

export const ItemDetailView: React.FC<ItemDetailViewProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  initialData,
  mode = 'add',
  screenType,
}) => {
  useScrollLock(isOpen, onClose);
  const queryClient = useQueryClient();

  const { ludlowData, atsData, isAdmin, updateSKUMetadata } = useInventory();
  const { locations } = useLocationManagement();
  const { setIsNavHidden } = useViewMode();
  const { showConfirmation } = useConfirmation();
  const { activeField, setActiveField, isActive } = useActiveField();

  // Distribution state
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [isDistributionSheetOpen, setIsDistributionSheetOpen] = useState(false);
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false);
  const [userEditedDistribution, setUserEditedDistribution] = useState(false);

  // Photo state
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

  // React Hook Form
  const {
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<InventoryFormValues>({
    resolver: zodResolver(InventoryFormSchema) as unknown as Parameters<
      typeof useForm<InventoryFormValues>
    >[0]['resolver'],
    mode: 'onChange',
    defaultValues: {
      sku: '',
      location: '',
      quantity: 0,
      item_name: '',
      warehouse: 'LUDLOW',
      ...dimensionDefaults(null),
      internal_note: '',
    },
  });

  // Selective watches
  const sku = watch('sku');
  const location = watch('location');
  const warehouse = watch('warehouse');
  const quantity = watch('quantity');
  const itemName = watch('item_name');
  const internalNote = watch('internal_note');
  const lengthIn = watch('length_in');
  const widthIn = watch('width_in');
  const heightIn = watch('height_in');
  const weightLbs = watch('weight_lbs');

  // ─── Sync Initial Data ───
  useEffect(() => {
    if (isOpen) {
      setIsNavHidden?.(true);
      setActiveField(null);

      if (mode === 'edit' && initialData) {
        reset({
          sku: initialData.sku || '',
          location: initialData.location || '',
          quantity: Number(initialData.quantity) || 0,
          item_name: initialData.item_name || '',
          warehouse: initialData.warehouse || (screenType as WarehouseType) || 'LUDLOW',
          length_in: initialData.sku_metadata?.length_in ?? dimensionDefaults(initialData.sku).length_in,
          width_in: initialData.sku_metadata?.width_in ?? dimensionDefaults(initialData.sku).width_in,
          height_in: initialData.sku_metadata?.height_in ?? dimensionDefaults(initialData.sku).height_in,
          weight_lbs: initialData.sku_metadata?.weight_lbs ?? null,
          internal_note: initialData.internal_note || '',
        });
        setDistribution(Array.isArray(initialData.distribution) ? initialData.distribution : []);
        setUserEditedDistribution(false);
        setPhotoPreview(initialData?.sku_metadata?.image_url || null);
      } else {
        reset({
          sku: '',
          location: '',
          quantity: 0,
          item_name: '',
          warehouse: (screenType as WarehouseType) || 'LUDLOW',
          ...dimensionDefaults(null),
          internal_note: '',
        });
        setDistribution([]);
        setUserEditedDistribution(false);
        setPhotoPreview(null);
      }
    } else {
      setIsNavHidden?.(false);
    }
    return () => setIsNavHidden?.(false);
  }, [isOpen, initialData, mode, screenType, reset, setIsNavHidden, setActiveField]);

  // Sync distribution from realtime
  useEffect(() => {
    if (!isOpen || mode !== 'edit' || !initialData || userEditedDistribution) return;
    const allItems = [...ludlowData, ...atsData];
    const liveItem = allItems.find((i) => i.id === initialData.id);
    if (!liveItem) return;
    const liveDist = Array.isArray(liveItem.distribution) ? liveItem.distribution : [];
    if (JSON.stringify(distribution) !== JSON.stringify(liveDist)) {
      setDistribution(liveDist);
    }
  }, [isOpen, mode, initialData, ludlowData, atsData, userEditedDistribution, distribution]);

  // Auto-distribution for bike SKUs in Add mode
  useEffect(() => {
    if (!isOpen || mode !== 'add' || userEditedDistribution) return;
    if (!sku || !quantity || quantity <= 0) return;
    const isBike = initialData?.sku_metadata?.is_bike ?? true; // default bike in add mode
    if (isBike) {
      setDistribution(calculateBikeDistribution(quantity));
    }
  }, [isOpen, mode, sku, quantity, userEditedDistribution, initialData]);

  // Auto-set dimension defaults based on SKU type in Add mode
  useEffect(() => {
    if (!isOpen || mode !== 'add' || !sku || sku.length < 5) return;
    const defaults = dimensionDefaults(initialData?.sku_metadata?.is_bike);
    setValue('length_in', defaults.length_in);
    setValue('width_in', defaults.width_in);
    setValue('height_in', defaults.height_in);
    setValue('weight_lbs', defaults.weight_lbs);
  }, [isOpen, mode, sku, setValue]);

  // Sync sku_metadata from realtime
  useEffect(() => {
    if (!isOpen || mode !== 'edit' || !initialData) return;
    const allItems = [...ludlowData, ...atsData];
    const liveItem = allItems.find((i) => i.id === initialData.id);
    if (!liveItem?.sku_metadata) return;
    const liveMeta = liveItem.sku_metadata;
    const initMeta = initialData.sku_metadata;
    if (JSON.stringify(liveMeta) !== JSON.stringify(initMeta)) {
      if (liveMeta.length_in != null) setValue('length_in', liveMeta.length_in);
      if (liveMeta.width_in != null) setValue('width_in', liveMeta.width_in);
      if (liveMeta.height_in != null) setValue('height_in', liveMeta.height_in);
      if (liveMeta.weight_lbs != null) setValue('weight_lbs', liveMeta.weight_lbs);
    }
  }, [isOpen, mode, initialData, ludlowData, atsData, setValue]);

  // ─── Dirty check ───
  const hasChanges = useMemo(() => {
    if (mode !== 'edit' || !initialData) return true;
    const n = (v: string | number | null | undefined) => String(v ?? '').trim();
    const num = (v: string | number | null | undefined) => Number(v ?? 0);
    const formChanged =
      n(sku) !== n(initialData.sku) ||
      n(location) !== n(initialData.location) ||
      n(warehouse) !== n(initialData.warehouse || screenType || 'LUDLOW') ||
      Number(quantity || 0) !== Number(initialData.quantity || 0) ||
      n(itemName) !== n(initialData.item_name) ||
      n(internalNote) !== n(initialData.internal_note);
    if (formChanged) return true;
    const meta = initialData.sku_metadata;
    const metaChanged =
      num(lengthIn) !== num(meta?.length_in) ||
      num(widthIn) !== num(meta?.width_in) ||
      num(heightIn) !== num(meta?.height_in) ||
      num(weightLbs) !== num(meta?.weight_lbs);
    if (metaChanged) return true;
    const initDist = Array.isArray(initialData.distribution) ? initialData.distribution : [];
    if (JSON.stringify(distribution) !== JSON.stringify(initDist)) return true;
    // Photo change
    const initialPhoto = initialData.sku_metadata?.image_url || null;
    return photoPreview !== initialPhoto;
  }, [
    mode,
    initialData,
    sku,
    location,
    warehouse,
    quantity,
    itemName,
    internalNote,
    distribution,
    screenType,
    lengthIn,
    widthIn,
    heightIn,
    weightLbs,
    photoPreview,
  ]);

  // ─── Location Predictions & Suggestions ───
  const validLocationNames = useMemo(() => {
    if (!locations) return [];
    return Array.from(
      new Set(locations.filter((l) => l.warehouse === warehouse).map((l) => l.location))
    );
  }, [locations, warehouse]);

  const prediction = useMemo(
    () => predictLocation(location || '', validLocationNames),
    [location, validLocationNames]
  );

  const currentInventory = warehouse === 'ATS' ? atsData : ludlowData;

  const foundLocations = useMemo(() => {
    const currentSKU = (sku || '').trim();
    if (currentSKU.length < 2) return [] as string[];
    const existingEntries = currentInventory.filter((i) => (i.sku || '').trim() === currentSKU);
    return [...new Set(existingEntries.map((i) => i.location || 'Unknown').filter(Boolean))];
  }, [sku, currentInventory]);

  const skuSuggestions = useMemo(() => {
    const uniqueSKUs = new Map<string, { value: string; info: string }>();
    currentInventory.forEach((item) => {
      if (item.sku && !uniqueSKUs.has(item.sku)) {
        const tag = item.quantity === 0 ? ' [0u]' : '';
        uniqueSKUs.set(item.sku, {
          value: item.sku,
          info: `${item.quantity}u \u2022 ${item.location}${tag}`,
        });
      }
    });
    return Array.from(uniqueSKUs.values());
  }, [currentInventory]);

  const locationSuggestions = useMemo(() => {
    if (location && prediction.matches.length > 0) {
      return Array.from(new Set(prediction.matches)).map((l) => ({
        value: l,
        info: 'DB Location',
      }));
    }
    const counts = new Map<string, number>();
    currentInventory.forEach(
      (i) => i.location && counts.set(i.location, (counts.get(i.location) || 0) + 1)
    );
    return Array.from(counts.entries()).map(([loc, count]) => ({
      value: loc,
      info: `${count} items here`,
    }));
  }, [currentInventory, location, prediction.matches]);

  // ─── Total stock across locations (same SKU) ───
  const totalStock = useMemo(() => {
    const currentSKU = (sku || '').trim();
    if (!currentSKU) return null;
    const allItems = [...ludlowData, ...atsData];
    const matches = allItems.filter((i) => (i.sku || '').trim() === currentSKU);
    if (matches.length <= 1) return null;
    return {
      total: matches.reduce((sum, i) => sum + (i.quantity || 0), 0),
      locations: new Set(matches.map((i) => i.location)).size,
    };
  }, [sku, ludlowData, atsData]);

  // ─── Validation ───
  const [validationState, setValidationState] = useState<{
    status: 'idle' | 'checking' | 'error' | 'warning' | 'info';
    message?: string;
  }>({ status: 'idle' });

  const MIN_SKU_CHARS = 7;

  const isSkuChanged = useMemo(() => {
    if (mode !== 'edit' || !initialData) return false;
    return sku.trim() !== (initialData.sku || '').trim();
  }, [sku, initialData, mode]);

  useEffect(() => {
    const normalize = (str: string | number | null | undefined) => String(str || '').trim();
    const currentSKU = normalize(sku);
    const originalSKU = normalize(initialData?.sku);
    const currentLocation = normalize(location);
    const originalLocation = normalize(initialData?.location);
    const currentWh = normalize(warehouse);
    const originalWh = normalize(screenType || 'LUDLOW');

    const skuChanged = currentSKU !== originalSKU;
    const locationChanged = currentLocation !== originalLocation;
    const warehouseChanged = currentWh !== originalWh;
    const hasAnyChange = skuChanged || locationChanged || warehouseChanged;

    if (mode === 'edit' && !hasAnyChange) {
      setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
      return;
    }

    if (mode === 'edit' && isSkuChanged && currentSKU.length >= MIN_SKU_CHARS) {
      const globalConflict = currentInventory.find(
        (i) => normalize(i.sku) === currentSKU && String(i.id) !== String(initialData?.id)
      );
      if (globalConflict) {
        setValidationState({
          status: 'error',
          message: `SKU already exists in this warehouse (${globalConflict.location}). Cannot rename.`,
        });
        return;
      }
    }

    if (mode === 'add' || skuChanged) {
      if (currentSKU.length < MIN_SKU_CHARS) {
        setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
        return;
      }
    }

    const timer = setTimeout(async () => {
      if (!currentSKU || !currentLocation || !currentWh) {
        if (mode === 'edit' && isSkuChanged) {
          setValidationState({
            status: 'info',
            message: 'Renaming: History will be transferred to the new SKU.',
          });
        } else {
          setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
        }
        return;
      }

      setValidationState({ status: 'checking' });

      try {
        const excludeId = initialData?.id;
        const exists = await inventoryService.checkExistence(
          currentSKU,
          currentLocation,
          currentWh,
          excludeId
        );

        if (exists) {
          if (mode === 'add') {
            const localMatch = currentInventory.find(
              (i) => String(i.sku) === currentSKU && String(i.location) === currentLocation
            );
            const isZero = localMatch && localMatch.quantity === 0;
            setValidationState({
              status: 'warning',
              message: isZero
                ? 'A SKU was previously registered here (currently 0 units). Quantity will be added.'
                : 'Item already exists here. Quantity will be added and Description updated.',
            });
          } else if (mode === 'edit') {
            if (isSkuChanged) {
              setValidationState({
                status: 'error',
                message: 'SKU already exists. Cannot rename.',
              });
            } else {
              setValidationState({
                status: 'warning',
                message: 'Item exists in target location. Stock will be consolidated.',
              });
            }
          }
        } else {
          if (mode === 'edit' && isSkuChanged) {
            setValidationState({
              status: 'info',
              message: 'Renaming: History will be transferred to the new SKU.',
            });
          } else {
            setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
          }
        }
      } catch (err) {
        console.error('Validation check failed', err);
        setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [sku, location, warehouse, mode, initialData, screenType, currentInventory, isSkuChanged]);

  // ─── Photo handlers ───
  useEffect(() => {
    return () => {
      if (photoPreview && photoPreview.startsWith('blob:')) {
        URL.revokeObjectURL(photoPreview);
      }
    };
  }, [photoPreview]);

  const handlePhotoCapture = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const previewUrl = URL.createObjectURL(file);
      setPhotoPreview(previewUrl);

      const currentSku = watch('sku');
      if (!currentSku) {
        toast.error('Enter SKU before adding photo');
        setPhotoPreview(null);
        return;
      }

      setIsUploadingPhoto(true);
      try {
        // Optimistic: update both caches (item could be in either)
        const updateCache = (imageUrl: string) => {
          const updater = (old: InventoryItemWithMetadata[] | undefined) =>
            old?.map((item) =>
              item.sku === currentSku
                ? {
                    ...item,
                    sku_metadata: {
                      ...(item.sku_metadata ?? { sku: currentSku }),
                      image_url: imageUrl,
                    },
                  }
                : item
            );
          queryClient.setQueryData(INVENTORY_ROOT_KEY, updater);
          queryClient.setQueryData(PARTS_BINS_KEY, updater);
        };

        const url = await uploadPhoto(currentSku, file, (thumbBlobUrl) => {
          // Instant: show local thumbnail in card before network roundtrip
          updateCache(thumbBlobUrl);
        });

        // Final: swap local blob for real server URL with cache-buster
        const bustUrl = `${url}?v=${Date.now()}`;
        setPhotoPreview(bustUrl);
        updateCache(bustUrl);
        toast.success('Photo uploaded');
      } catch (err) {
        console.error('Photo upload failed:', err);
        toast.error('Photo upload failed');
        setPhotoPreview(initialData?.sku_metadata?.image_url || null);
      } finally {
        setIsUploadingPhoto(false);
      }
    },
    [watch, initialData, queryClient]
  );

  const handlePhotoRemove = useCallback(async () => {
    const currentSku = watch('sku');
    if (!currentSku) return;
    setIsUploadingPhoto(true);
    try {
      await deletePhoto(currentSku);
      setPhotoPreview(null);
      // Update both caches so the removal persists
      const remover = (old: InventoryItemWithMetadata[] | undefined) =>
        old?.map((item) =>
          item.sku === currentSku
            ? {
                ...item,
                sku_metadata: { ...(item.sku_metadata ?? { sku: currentSku }), image_url: null },
              }
            : item
        );
      queryClient.setQueryData(INVENTORY_ROOT_KEY, remover);
      queryClient.setQueryData(PARTS_BINS_KEY, remover);
      toast.success('Photo removed');
    } catch (err) {
      console.error('Photo removal failed:', err);
      toast.error('Failed to remove photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [watch, queryClient]);

  // ─── Location blur handler ───
  const handleLocationBlur = useCallback(
    (val: string) => {
      if (prediction.bestGuess && prediction.bestGuess !== val) {
        setValue('location', prediction.bestGuess);
        toast(`Auto-selected ${prediction.bestGuess}`, { icon: '\u2728' });
      }
    },
    [prediction.bestGuess, setValue]
  );

  // ─── Distribution helpers ───
  const addDistributionRow = useCallback(() => {
    const totalQty = quantity || 0;
    const currentTotal = distribution.reduce((sum, d) => sum + d.count * d.units_each, 0);
    const remaining = totalQty - currentTotal;
    const type =
      distribution.length > 0 ? distribution[distribution.length - 1].type : ('LINE' as const);
    const typeDefault = DEFAULT_UNITS[type] || 1;
    const unitsEach = remaining <= 0 ? 1 : Math.min(typeDefault, remaining);
    setDistribution((prev) => [...prev, { type, count: 1, units_each: unitsEach }]);
    setUserEditedDistribution(true);
  }, [quantity, distribution]);

  const removeDistributionRow = useCallback((index: number) => {
    setDistribution((prev) => prev.filter((_, i) => i !== index));
    setUserEditedDistribution(true);
  }, []);

  const updateDistributionRow = useCallback(
    (index: number, field: keyof DistributionItem, value: string | number) => {
      setDistribution((prev) =>
        prev.map((row, i) => {
          if (i !== index) return row;
          const updated = { ...row, [field]: value };
          if (field === 'type' && typeof value === 'string' && DEFAULT_UNITS[value]) {
            updated.units_each = DEFAULT_UNITS[value];
          }
          return updated;
        })
      );
      setUserEditedDistribution(true);
    },
    []
  );

  // ─── Save logic ───
  const executeSave = useCallback(
    async (data: InventoryFormValues) => {
      updateSKUMetadata({
        sku: data.sku,
        length_in: data.length_in,
        width_in: data.width_in,
        height_in: data.height_in,
        weight_lbs: data.weight_lbs,
      }).catch((e: unknown) => console.error('Metadata update failed:', e));

      const payload = {
        ...data,
        internal_note: data.internal_note || null,
        distribution: distribution.filter((d) => d.count > 0 && d.units_each > 0),
      };

      onSave(
        payload as InventoryItemInput & {
          length_in?: number;
          width_in?: number;
          height_in?: number;
        }
      );
      onClose();
    },
    [distribution, onSave, onClose, updateSKUMetadata]
  );

  const handleSave = useCallback(() => {
    // Close any active field first
    setActiveField(null);

    // Normalize location
    const data: InventoryFormValues = {
      sku: watch('sku'),
      location: watch('location'),
      quantity: watch('quantity'),
      item_name: watch('item_name'),
      warehouse: watch('warehouse'),
      length_in: watch('length_in'),
      width_in: watch('width_in'),
      height_in: watch('height_in'),
      weight_lbs: watch('weight_lbs'),
      internal_note: watch('internal_note'),
    };

    if (prediction.bestGuess && prediction.bestGuess !== data.location) {
      data.location = prediction.bestGuess;
      setValue('location', prediction.bestGuess);
    }

    // Rename confirmation
    if (mode === 'edit' && initialData && data.sku !== initialData.sku) {
      showConfirmation(
        'Identity Change (SKU)',
        `Rename "${initialData.sku}" to "${data.sku}"?\nThis will update or merge the product row.`,
        () => executeSave(data),
        undefined,
        'Rename',
        'Cancel'
      );
      return;
    }

    executeSave(data);
  }, [
    watch,
    prediction.bestGuess,
    setValue,
    mode,
    initialData,
    showConfirmation,
    executeSave,
    setActiveField,
  ]);

  // ─── Deactivate editing field (blur) ───
  const handleFieldBlur = useCallback(() => {
    setActiveField(null);
  }, [setActiveField]);

  // ─── Delete handler ───
  const handleDelete = useCallback(() => {
    if (!onDelete) return;
    showConfirmation('Delete Item', 'Are you sure you want to delete this item?', () => {
      onDelete();
      onClose();
    });
  }, [onDelete, showConfirmation, onClose]);

  // ─── Last update date ───
  const lastUpdate = useMemo(() => {
    if (!initialData?.created_at) return null;
    const allItems = [...ludlowData, ...atsData];
    const liveItem = allItems.find((i) => i.id === initialData.id);
    const date = liveItem?.created_at || initialData.created_at;
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }, [initialData, ludlowData, atsData]);

  // ─── Dimensions string ───
  const dimensionsString = useMemo(() => {
    const parts: string[] = [];
    if (lengthIn) parts.push(`${lengthIn}"L`);
    if (widthIn) parts.push(`${widthIn}"W`);
    if (heightIn) parts.push(`${heightIn}"H`);
    const dims = parts.join(' \u00d7 ');
    const weight = weightLbs ? `${weightLbs} lbs` : '';
    if (dims && weight) return `${dims}  \u00b7  ${weight}`;
    return dims || weight || '';
  }, [lengthIn, widthIn, heightIn, weightLbs]);

  // ─── Toolbar title ───
  const toolbarTitle = useMemo(() => {
    if (mode === 'add') return 'New Item';
    return itemName || sku || 'Item Details';
  }, [mode, itemName, sku]);

  const isAddMode = mode === 'add';

  if (!isOpen) return null;

  // Manual validation — zodResolver's isValid doesn't work reliably with
  // setValue/watch pattern (fields aren't registered). Full Zod validation
  // still runs in inventoryService.updateItem() before DB write.
  const canSave =
    sku?.trim() &&
    location?.trim() &&
    (quantity != null && quantity >= 0) &&
    validationState.status !== 'error' &&
    validationState.status !== 'checking' &&
    (isAddMode || hasChanges);

  return createPortal(
    <div
      className="fixed inset-0 z-[100020] bg-main overflow-y-auto animate-in fade-in slide-in-from-right duration-200 select-none"
      onClick={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        const isInteractive = ['INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'A'].includes(tag);
        const isInsideButton = (e.target as HTMLElement).closest('button');
        if (!isInteractive && !isInsideButton && activeField) {
          handleFieldBlur();
        }
      }}
    >
      {/* Toolbar */}
      <DetailToolbar
        title={toolbarTitle}
        mode={mode}
        onBack={onClose}
        onDelete={mode === 'edit' ? handleDelete : undefined}
      />

      {/* Photo Hero */}
      <PhotoHero
        photoUrl={photoPreview}
        isUploading={isUploadingPhoto}
        disabled={isAddMode && !sku?.trim()}
        onCapture={handlePhotoCapture}
        onRemove={handlePhotoRemove}
      />

      {/* Content */}
      <div className="pb-safe">
        {/* Section: Item */}
        <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
          {isAddMode ? (
            <>
              <div className="px-4 py-2">
                <span className="text-[11px] font-bold text-accent uppercase tracking-wider block mb-1.5">
                  SKU
                </span>
                <AutocompleteInput
                  id="detail_sku"
                  value={sku}
                  onChange={(v: string) => setValue('sku', v, { shouldValidate: true })}
                  suggestions={skuSuggestions}
                  placeholder="Enter SKU..."
                  minChars={2}
                  initialKeyboardMode="numeric"
                  onSelect={(s: { value: string; info?: string }) => {
                    const match = currentInventory.find((i) => i.sku === s.value) as
                      | InventoryItemWithMetadata
                      | undefined;
                    if (match) {
                      setValue('location', match.location || '', { shouldValidate: true });
                      setValue('item_name', match.item_name || '', { shouldValidate: true });
                      if (match.sku_metadata) {
                        setValue('length_in', match.sku_metadata.length_in ?? 54);
                        setValue('width_in', match.sku_metadata.width_in ?? 8);
                        setValue('height_in', match.sku_metadata.height_in ?? 30);
                        setValue('weight_lbs', match.sku_metadata.weight_lbs ?? null);
                      }
                      setPhotoPreview(match.sku_metadata?.image_url || null);
                    }
                  }}
                />
              </div>
              <TappableField
                label="Name"
                value={itemName || ''}
                isActive={false}
                onTap={() => {}}
                onBlur={() => {}}
                onChange={(v) => setValue('item_name', v, { shouldValidate: true })}
                placeholder="e.g. Desk Frame, Monitor Stand..."
                forceEdit
              />
            </>
          ) : (
            <>
              <TappableField
                label="SKU"
                value={sku}
                isActive={isActive('sku')}
                onTap={() => setActiveField('sku')}
                onBlur={() => handleFieldBlur('sku')}
                onChange={(v) => setValue('sku', v, { shouldValidate: true })}
                renderEditor={() => (
                  <AutocompleteInput
                    id="detail_sku"
                    value={sku}
                    onChange={(v: string) => setValue('sku', v, { shouldValidate: true })}
                    suggestions={skuSuggestions}
                    placeholder="Enter SKU..."
                    minChars={2}
                    initialKeyboardMode="numeric"
                  />
                )}
              />
              <TappableField
                label="Name"
                value={itemName || ''}
                isActive={isActive('item_name')}
                onTap={() => setActiveField('item_name')}
                onBlur={() => handleFieldBlur('item_name')}
                onChange={(v) => setValue('item_name', v, { shouldValidate: true })}
                placeholder="e.g. Desk Frame..."
              />
              {lastUpdate && (
                <SectionRow
                  label="Last update"
                  value={lastUpdate}
                  editable
                  onTap={() => setIsHistorySheetOpen(true)}
                />
              )}
            </>
          )}
        </div>

        {/* Validation feedback */}
        {validationState.status !== 'idle' && (
          <div
            className={`mx-4 mt-3 flex items-start gap-2 p-3 rounded-xl text-[10px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-top-1 ${
              validationState.status === 'error'
                ? 'bg-red-500/10 border border-red-500/20 text-red-500'
                : validationState.status === 'warning'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500'
                  : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
            }`}
          >
            {validationState.status === 'checking' ? (
              <>
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mt-0.5" />
                Checking availability...
              </>
            ) : (
              <>
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{validationState.message}</span>
              </>
            )}
          </div>
        )}

        {/* SKU presence info (add mode) */}
        {isAddMode && foundLocations.length > 0 && (
          <div className="mx-4 mt-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 p-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
            <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-blue-400" />
            <span>
              SKU detected in this warehouse at:{' '}
              <strong className="text-blue-200">{foundLocations.join(', ')}</strong>
            </span>
          </div>
        )}

        {/* Section: Stock */}
        <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
          <QuantityControl
            value={quantity || 0}
            onChange={(v) => {
              setValue('quantity', v, { shouldValidate: true });
            }}
            totalStock={totalStock}
          />
        </div>

        {/* Section: Location */}
        <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
          {isAddMode ? (
            <>
              <div className="px-4 py-2">
                <span className="text-[11px] font-bold text-accent uppercase tracking-wider block mb-1.5">
                  Location
                </span>
                <AutocompleteInput
                  id="detail_location"
                  value={location || ''}
                  onChange={(v: string) => setValue('location', v, { shouldValidate: true })}
                  onBlur={(v) => handleLocationBlur(v)}
                  suggestions={locationSuggestions}
                  placeholder="Row/Bin..."
                  minChars={1}
                  initialKeyboardMode="numeric"
                />
              </div>
              <TappableField
                label="Note"
                value={internalNote || ''}
                isActive={false}
                onTap={() => {}}
                onBlur={() => {}}
                onChange={(v) => setValue('internal_note', v)}
                placeholder="e.g. Behind the pole..."
                forceEdit
              />
            </>
          ) : (
            <>
              <TappableField
                label="Location"
                value={location || ''}
                isActive={isActive('location')}
                onTap={() => setActiveField('location')}
                onBlur={() => {
                  handleLocationBlur(location || '');
                  handleFieldBlur('location');
                }}
                onChange={(v) => setValue('location', v, { shouldValidate: true })}
                renderEditor={() => (
                  <AutocompleteInput
                    id="detail_location"
                    value={location || ''}
                    onChange={(v: string) => setValue('location', v, { shouldValidate: true })}
                    onBlur={(v) => handleLocationBlur(v)}
                    suggestions={locationSuggestions}
                    placeholder="Row/Bin..."
                    minChars={1}
                    initialKeyboardMode="numeric"
                  />
                )}
              />
              <TappableField
                label="Note"
                value={internalNote || ''}
                isActive={isActive('internal_note')}
                onTap={() => setActiveField('internal_note')}
                onBlur={() => handleFieldBlur('internal_note')}
                onChange={(v) => setValue('internal_note', v)}
                placeholder="e.g. Behind the pole..."
              />
            </>
          )}
        </div>

        {/* Section: Distribution */}
        <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
          <DistributionPreview
            distribution={distribution}
            quantity={quantity || 0}
            onTap={() => setIsDistributionSheetOpen(true)}
          />
        </div>

        {/* Section: Dimensions — always visible, editable only for admin */}
        <div className="bg-card border-b border-subtle mt-4 mx-4 rounded-2xl overflow-hidden">
          {isAddMode && isAdmin ? (
            <div className="px-4 py-3">
              <span className="text-[11px] font-bold text-accent uppercase tracking-wider block mb-2">
                Dimensions
              </span>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { field: 'length_in' as const, val: lengthIn, label: 'L' },
                  { field: 'width_in' as const, val: widthIn, label: 'W' },
                  { field: 'height_in' as const, val: heightIn, label: 'H' },
                  { field: 'weight_lbs' as const, val: weightLbs, label: 'LBS' },
                ].map(({ field, val, label }) => (
                  <div key={field} className="flex flex-col items-center gap-1">
                    <input
                      type="number"
                      value={val ?? ''}
                      onChange={(e) =>
                        setValue(field, e.target.value ? Number(e.target.value) : null)
                      }
                      placeholder="—"
                      step="0.1"
                      className="w-full bg-main border border-subtle rounded-lg px-2 py-2 text-content text-center text-xs font-mono focus:border-accent focus:outline-none"
                    />
                    <span className="text-[9px] font-black text-muted uppercase tracking-widest">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : isAdmin ? (
            <TappableField
              label="Dimensions"
              value={dimensionsString}
              isActive={isActive('dimensions')}
              onTap={() => setActiveField('dimensions')}
              onBlur={() => handleFieldBlur()}
              onChange={() => {}}
              renderEditor={() => (
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { field: 'length_in' as const, val: lengthIn, label: 'L' },
                    { field: 'width_in' as const, val: widthIn, label: 'W' },
                    { field: 'height_in' as const, val: heightIn, label: 'H' },
                    { field: 'weight_lbs' as const, val: weightLbs, label: 'LBS' },
                  ].map(({ field, val, label }) => (
                    <div key={field} className="flex flex-col items-center gap-1">
                      <input
                        type="number"
                        value={val ?? ''}
                        onChange={(e) =>
                          setValue(field, e.target.value ? Number(e.target.value) : null)
                        }
                        placeholder="—"
                        step="0.1"
                        className="w-full bg-main border border-subtle rounded-lg px-2 py-2 text-content text-center text-xs font-mono focus:border-accent focus:outline-none"
                      />
                      <span className="text-[9px] font-black text-muted uppercase tracking-widest">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            />
          ) : (
            /* Non-admin: read-only dimensions */
            <SectionRow label="Dimensions" value={dimensionsString || '—'} />
          )}
        </div>

        {/* Validation errors */}
        {(errors.sku || errors.quantity || errors.location) && (
          <div className="mx-4 mt-3 space-y-1">
            {errors.sku && (
              <p className="text-red-500 text-[10px] font-bold uppercase">
                {String(errors.sku.message)}
              </p>
            )}
            {errors.quantity && (
              <p className="text-red-500 text-[10px] font-bold uppercase">
                {String(errors.quantity.message)}
              </p>
            )}
            {errors.location && (
              <p className="text-red-500 text-[10px] font-bold uppercase">
                {String(errors.location.message)}
              </p>
            )}
          </div>
        )}

        {/* Save / Create button */}
        <div className="mx-4 mt-6 mb-8">
          <button
            disabled={!canSave}
            onClick={handleSave}
            className={`w-full font-black uppercase tracking-widest h-14 rounded-2xl flex items-center justify-center gap-2 transition-transform shadow-lg ${
              !canSave
                ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed opacity-50'
                : 'bg-accent hover:opacity-90 text-main active:scale-95 shadow-accent/20'
            }`}
          >
            <Save className="w-5 h-5" />
            {isAddMode ? 'Create' : 'Save'}
          </button>
        </div>
      </div>

      {/* Distribution Bottom Sheet */}
      <SectionEditorSheet
        isOpen={isDistributionSheetOpen}
        onClose={() => setIsDistributionSheetOpen(false)}
        distribution={distribution}
        quantity={quantity || 0}
        onAdd={addDistributionRow}
        onRemove={removeDistributionRow}
        onUpdate={updateDistributionRow}
      />

      {/* Item History Bottom Sheet */}
      <ItemHistorySheet
        isOpen={isHistorySheetOpen}
        onClose={() => setIsHistorySheetOpen(false)}
        sku={sku}
      />
    </div>,
    document.body
  );
};
