import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useForm, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import Save from 'lucide-react/dist/esm/icons/save';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Edit3 from 'lucide-react/dist/esm/icons/edit-3';
import Eye from 'lucide-react/dist/esm/icons/eye';
import MoreVertical from 'lucide-react/dist/esm/icons/more-vertical';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Printer from 'lucide-react/dist/esm/icons/printer';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Check from 'lucide-react/dist/esm/icons/check';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Layers from 'lucide-react/dist/esm/icons/layers';
import History from 'lucide-react/dist/esm/icons/history';

import { useInventory } from '../../hooks/useInventoryData.ts';
import { INVENTORY_ROOT_KEY, PARTS_BINS_KEY } from '../../hooks/useInventoryRealtime';
import { useLocationManagement } from '../../hooks/useLocationManagement.ts';
import { useConfirmation } from '../../../../context/ConfirmationContext.tsx';
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
import { skuDefaultsFor } from '../../../../utils/skuDefaults';
import { inventoryService } from '../../api/inventory.service.ts';
import { uploadPhoto, deletePhoto } from '../../../../services/photoUpload.service';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { supabase } from '../../../../lib/supabase';
import { useAuth } from '../../../../context/AuthContext';
import { generateBikeLabels } from '../../utils/generateBikeLabel';
import {
  LabelPrintOptionsModal,
  type LabelPrintResult,
} from '../../../labels/components/LabelPrintOptionsModal';

import { PhotoHero } from './PhotoHero.tsx';
import { StockReservationBreakdown } from './StockReservationBreakdown.tsx';
import { SectionEditorSheet } from './SectionEditorSheet.tsx';
import { ItemHistorySheet } from './ItemHistorySheet.tsx';
import { InlineItemHistory } from './InlineItemHistory.tsx';
import { OtherLocationsCard } from './OtherLocationsCard.tsx';

type WarehouseType = 'LUDLOW' | 'ATS' | 'DELETED ITEMS';

const DEFAULT_UNITS: Record<string, number> = { TOWER: 30, LINE: 5, PALLET: 10, OTHER: 1 };

function dimensionDefaults(isBike?: boolean | null) {
  return skuDefaultsFor(isBike);
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
  const queryClient = useQueryClient();
  const { ludlowData, atsData, updateSKUMetadata } = useInventory();
  const { locations } = useLocationManagement();
  const { showConfirmation } = useConfirmation();
  const { user } = useAuth();

  // Mode state: Default to view mode for existing items, edit mode for new items
  const [isEditing, setIsEditing] = useState(mode === 'add');
  const [menuOpen, setMenuOpen] = useState(false);

  // Distribution & Photo state
  const [distribution, setDistribution] = useState<DistributionItem[]>([]);
  const [isDistributionSheetOpen, setIsDistributionSheetOpen] = useState(false);
  const [isHistorySheetOpen, setIsHistorySheetOpen] = useState(false);
  const [userEditedDistribution, setUserEditedDistribution] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [typeIsBike, setTypeIsBike] = useState(true);

  // Direct Quantity Edit State
  const [isEditingQtyDirect, setIsEditingQtyDirect] = useState(false);
  const [directQtyVal, setDirectQtyVal] = useState('');
  const qtyInputRef = useRef<HTMLInputElement>(null);

  // Validation State
  const [validationState, setValidationState] = useState<{
    status: 'idle' | 'checking' | 'error' | 'warning' | 'info';
    message?: string;
  }>({ status: 'idle' });

  // Form setup
  const { setValue, watch, reset } = useForm<InventoryFormValues>({
    resolver: zodResolver(InventoryFormSchema) as unknown as Resolver<InventoryFormValues>,
    mode: 'onChange',
    defaultValues: {
      sku: '',
      location: '',
      quantity: 0,
      item_name: '',
      warehouse: 'LUDLOW',
      ...dimensionDefaults(null),
      internal_note: '',
      sublocation: null,
      model: '',
      size: '',
      serial_number: '',
      color: '',
      price: null,
      condition: '',
      condition_description: '',
      pdf_link: '',
    },
  });

  // Watches
  const sku = watch('sku');
  const location = watch('location');
  const warehouse = watch('warehouse');
  const quantity = watch('quantity');
  const itemName = watch('item_name');
  const internalNote = watch('internal_note');
  const sublocation = watch('sublocation');
  const lengthIn = watch('length_in');
  const widthIn = watch('width_in');
  const heightIn = watch('height_in');
  const weightLbs = watch('weight_lbs');
  const modelField = watch('model');
  const sizeField = watch('size');
  const serialNumber = watch('serial_number');
  const colorField = watch('color');
  const priceField = watch('price');

  const colorBaselineRef = useRef('');
  const modelBaselineRef = useRef('');
  const sizeBaselineRef = useRef('');

  // Sync Initial Data
  useEffect(() => {
    if (isOpen) {
      setIsEditing(mode === 'add');
      if (mode === 'edit' && initialData) {
        reset({
          sku: initialData.sku || '',
          location: initialData.location || '',
          quantity: Number(initialData.quantity) || 0,
          item_name: initialData.item_name || '',
          warehouse: initialData.warehouse || (screenType as WarehouseType) || 'LUDLOW',
          length_in:
            initialData.sku_metadata?.length_in ??
            dimensionDefaults(initialData.sku_metadata?.is_bike).length_in,
          width_in:
            initialData.sku_metadata?.width_in ??
            dimensionDefaults(initialData.sku_metadata?.is_bike).width_in,
          height_in:
            initialData.sku_metadata?.height_in ??
            dimensionDefaults(initialData.sku_metadata?.is_bike).height_in,
          weight_lbs: initialData.sku_metadata?.weight_lbs ?? null,
          internal_note: initialData.internal_note || '',
          sublocation: initialData.sublocation || null,
          model: initialData.sku_metadata?.model || '',
          size: initialData.sku_metadata?.size || '',
          serial_number: initialData.sku_metadata?.serial_number || '',
          color: '',
          price: initialData.sku_metadata?.sd_price ?? null,
          condition: initialData.sku_metadata?.condition || '',
          condition_description: initialData.sku_metadata?.condition_description || '',
          pdf_link: initialData.sku_metadata?.pdf_link || '',
        });
        setDistribution(Array.isArray(initialData.distribution) ? initialData.distribution : []);
        setUserEditedDistribution(false);
        setPhotoPreview(initialData?.sku_metadata?.image_url || null);
        setTypeIsBike(initialData.sku_metadata?.is_bike !== false);
      } else {
        reset({
          sku: initialData?.sku || '',
          location: initialData?.location || '',
          quantity: initialData?.quantity ? Number(initialData.quantity) : 0,
          item_name: initialData?.item_name || '',
          warehouse: initialData?.warehouse || (screenType as WarehouseType) || 'LUDLOW',
          ...dimensionDefaults(null),
          internal_note: '',
          sublocation: null,
          model: initialData?.sku_metadata?.model || '',
          size: initialData?.sku_metadata?.size || '',
          serial_number: initialData?.sku_metadata?.serial_number || '',
          color: '',
        });
        setDistribution([]);
        setUserEditedDistribution(false);
        setPhotoPreview(initialData?.sku_metadata?.image_url || null);
        setTypeIsBike(initialData?.sku_metadata?.is_bike !== false);
      }
    }
  }, [isOpen, initialData, mode, screenType, reset]);

  // Load color/model/size from DB on open
  useEffect(() => {
    if (!isOpen || mode !== 'edit' || !initialData?.sku) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('sku_metadata')
        .select('model, size, color')
        .eq('sku', initialData.sku)
        .maybeSingle();
      if (cancelled) return;
      const c = (data?.color as string | null) ?? '';
      const m = (data?.model as string | null) ?? '';
      const s = (data?.size as string | null) ?? '';
      colorBaselineRef.current = c;
      modelBaselineRef.current = m;
      sizeBaselineRef.current = s;
      setValue('color', c);
      setValue('model', m);
      setValue('size', s);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, mode, initialData?.sku, setValue]);

  // Auto-distribution for bike SKUs in Add mode
  useEffect(() => {
    if (!isOpen || mode !== 'add' || userEditedDistribution) return;
    if (!sku || !quantity || quantity <= 0) return;
    const isBike = initialData?.sku_metadata?.is_bike ?? true;
    if (isBike) {
      setDistribution(calculateBikeDistribution(quantity));
    }
  }, [isOpen, mode, sku, quantity, userEditedDistribution, initialData]);

  // Dirty check
  const hasChanges = useMemo(() => {
    if (mode !== 'edit' || !initialData) return true;
    const n = (v: string | number | string[] | null | undefined) => String(v ?? '').trim();
    const num = (v: string | number | null | undefined) => Number(v ?? 0);

    const formChanged =
      n(sku) !== n(initialData.sku) ||
      n(location) !== n(initialData.location) ||
      n(warehouse) !== n(initialData.warehouse || screenType || 'LUDLOW') ||
      Number(quantity || 0) !== Number(initialData.quantity || 0) ||
      n(itemName) !== n(initialData.item_name) ||
      n(internalNote) !== n(initialData.internal_note) ||
      n(sublocation) !== n(initialData.sublocation);
    if (formChanged) return true;

    const meta = initialData.sku_metadata;
    const metaChanged =
      num(lengthIn) !== num(meta?.length_in) ||
      num(widthIn) !== num(meta?.width_in) ||
      num(heightIn) !== num(meta?.height_in) ||
      num(weightLbs) !== num(meta?.weight_lbs);
    if (metaChanged) return true;

    const detailsChanged =
      n(modelField) !== n(modelBaselineRef.current) ||
      n(sizeField) !== n(sizeBaselineRef.current) ||
      n(serialNumber) !== n(meta?.serial_number) ||
      n(colorField) !== n(colorBaselineRef.current) ||
      num(priceField) !== num(meta?.sd_price);
    if (detailsChanged) return true;

    const initDist = Array.isArray(initialData.distribution) ? initialData.distribution : [];
    if (JSON.stringify(distribution) !== JSON.stringify(initDist)) return true;

    return photoPreview !== (initialData.sku_metadata?.image_url || null);
  }, [
    mode,
    initialData,
    sku,
    location,
    warehouse,
    quantity,
    itemName,
    internalNote,
    sublocation,
    distribution,
    screenType,
    lengthIn,
    widthIn,
    heightIn,
    weightLbs,
    photoPreview,
    modelField,
    sizeField,
    serialNumber,
    colorField,
    priceField,
  ]);

  const hasChangesRef = useRef(hasChanges);
  hasChangesRef.current = hasChanges;

  const requestClose = useCallback(() => {
    if (hasChangesRef.current && isEditing) {
      showConfirmation(
        'Unsaved changes',
        'You have unsaved changes. Discard and close?',
        () => onClose(),
        undefined,
        'Discard',
        'Keep editing',
        'warning'
      );
    } else {
      onClose();
    }
  }, [onClose, showConfirmation, isEditing]);

  useScrollLock(isOpen, requestClose);

  // Predictions & suggestions
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

  // Validation Check Effect
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

    const timer = setTimeout(async () => {
      if (!currentSKU || !currentLocation || !currentWh) {
        setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
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
                : 'Item already exists here. Quantity will be added.',
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
          setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
        }
      } catch (err) {
        console.error('Validation check failed', err);
        setValidationState((prev) => (prev.status === 'idle' ? prev : { status: 'idle' }));
      }
    }, 800);

    return () => clearTimeout(timer);
  }, [sku, location, warehouse, mode, initialData, screenType, currentInventory, isSkuChanged]);

  // Distribution helpers
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

  // Photo handlers
  const handlePhotoCapture = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const previewUrl = URL.createObjectURL(file);
      setPhotoPreview(previewUrl);
      const currentSku = watch('sku');
      if (!currentSku) return;
      setIsUploadingPhoto(true);
      try {
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
        const url = await uploadPhoto(currentSku, file, (thumbBlobUrl) =>
          updateCache(thumbBlobUrl)
        );
        const bustUrl = `${url}?v=${Date.now()}`;
        setPhotoPreview(bustUrl);
        updateCache(bustUrl);
        toast.success('Photo uploaded');
      } catch {
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
    } catch {
      toast.error('Failed to remove photo');
    } finally {
      setIsUploadingPhoto(false);
    }
  }, [watch, queryClient]);

  // Save logic
  const executeSave = useCallback(
    async (data: InventoryFormValues) => {
      const derivedName =
        [data.model, data.size, data.color]
          .map((v) => (v ?? '').trim())
          .filter(Boolean)
          .join(' ') || null;
      const finalName = derivedName || data.item_name || null;
      updateSKUMetadata({
        sku: data.sku,
        is_bike: typeIsBike,
        length_in: data.length_in,
        width_in: data.width_in,
        height_in: data.height_in,
        weight_lbs: data.weight_lbs,
        model: data.model || null,
        size: data.size || null,
        serial_number: data.serial_number || null,
        color: data.color || null,
        sd_price: data.price ?? null,
      }).catch((e: unknown) => console.error('Metadata update failed:', e));
      colorBaselineRef.current = data.color || '';
      modelBaselineRef.current = data.model || '';
      sizeBaselineRef.current = data.size || '';
      const payload = {
        ...data,
        item_name: finalName,
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
      setIsEditing(false);
      onClose();
    },
    [distribution, onSave, onClose, updateSKUMetadata, typeIsBike]
  );

  const handleSave = useCallback(() => {
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
      sublocation: watch('sublocation') || null,
      distribution: [],
      model: watch('model') || null,
      size: watch('size') || null,
      serial_number: watch('serial_number') || null,
      color: watch('color') || null,
      price: watch('price') ?? null,
      condition: watch('condition') || null,
      condition_description: watch('condition_description') || null,
      pdf_link: watch('pdf_link') || null,
    };
    if (prediction.bestGuess && prediction.bestGuess !== data.location) {
      data.location = prediction.bestGuess;
      setValue('location', prediction.bestGuess);
    }
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
  }, [watch, prediction.bestGuess, setValue, mode, initialData, showConfirmation, executeSave]);

  const handleDelete = useCallback(() => {
    if (!onDelete) return;
    showConfirmation('Delete Item', 'Are you sure you want to delete this item?', () => {
      onDelete();
      onClose();
    });
  }, [onDelete, showConfirmation, onClose]);

  // Labels printing
  const [printOpen, setPrintOpen] = useState(false);
  const [isPrintingLabels, setIsPrintingLabels] = useState(false);

  const handleGenerateLabels = useCallback(
    async (opts: LabelPrintResult) => {
      if (!sku || !user || opts.quantity < 1) return;
      setIsPrintingLabels(true);
      try {
        const inserts = Array.from({ length: opts.quantity }, () => ({
          sku,
          warehouse: 'LUDLOW' as const,
          location: initialData?.location ?? 'UNKNOWN',
          created_by: user.id,
          printed_at: new Date().toISOString(),
          status: (initialData?.quantity ?? 0) > 0 ? 'in_stock' : 'printed',
        }));
        const { data: tags, error } = await supabase
          .from('asset_tags')
          .insert(inserts)
          .select('short_code, sku, public_token');
        if (error || !tags?.length) throw error || new Error('No tags returned');
        const labelColor = (watch('color') || '').trim() || null;
        const labelSerial = (watch('serial_number') || '').trim() || null;
        const meta = initialData?.sku_metadata;
        const blobUrl = await generateBikeLabels(
          tags.map((t) => ({
            sku,
            item_name: itemName ?? null,
            short_code: t.short_code,
            public_token: t.public_token,
            layout: opts.orientation,
            withQr: opts.withQr,
            withBarcode: opts.withBarcode,
            color: labelColor,
            model: meta?.model ?? null,
            size: meta?.size ?? null,
            serial_number: labelSerial ?? meta?.serial_number ?? null,
          }))
        );
        window.open(blobUrl, '_blank');
        toast.success(`${tags.length} label${tags.length !== 1 ? 's' : ''} created`);
        setPrintOpen(false);
      } catch {
        toast.error('Failed to print labels');
      } finally {
        setIsPrintingLabels(false);
      }
    },
    [
      sku,
      itemName,
      user,
      initialData?.location,
      initialData?.quantity,
      initialData?.sku_metadata,
      watch,
    ]
  );

  if (!isOpen) return null;

  const isAddMode = mode === 'add';
  const displayTitle = modelField || itemName || (isAddMode ? '' : sku) || 'Explorer A2';
  const displayColor = colorField || 'Deep Blue';
  const displaySku = sku || (isAddMode ? '' : '03-4069BL');
  const displayLocation = location || 'Row 6 / A';
  const displaySublocations = sublocation || [];
  const displayNote = internalNote || '';
  const displayLastUpdate = initialData?.created_at
    ? new Date(initialData.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : 'Jul 8, 2026';

  const canSave =
    sku?.trim() &&
    location?.trim() &&
    quantity != null &&
    quantity >= 0 &&
    validationState.status !== 'error' &&
    validationState.status !== 'checking' &&
    (isAddMode || hasChanges);

  return createPortal(
    <div className="fixed inset-0 z-[180] bg-[#0F1115] text-white overflow-y-auto select-none animate-in fade-in duration-200">
      {/* ── HEADER STICKY ── */}
      <div className="sticky top-0 z-30 bg-[#0F1115]/90 backdrop-blur-md border-b border-[#2A2F36] px-4 py-3 flex items-center justify-between">
        <button
          onClick={requestClose}
          className="flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white transition-colors"
        >
          <ArrowLeft size={18} />
          <span>Inventory</span>
        </button>

        <div className="flex-1 text-center mx-4 min-w-0">
          <div className="text-sm font-semibold text-white truncate">{displayTitle}</div>
          <div className="text-xs text-white/40 font-mono truncate">SKU {displaySku}</div>
        </div>

        <div className="flex items-center gap-2">
          {mode === 'edit' && (
            <button
              onClick={() => setIsEditing(!isEditing)}
              className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-1.5 transition-all ${
                isEditing
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                  : 'bg-[#161920] border-[#2A2F36] text-white/70 hover:text-white'
              }`}
              title={isEditing ? 'View Sheet' : 'Edit Information'}
            >
              {isEditing ? <Eye size={16} /> : <Edit3 size={16} />}
              <span className="hidden sm:inline">{isEditing ? 'View' : 'Edit'}</span>
            </button>
          )}

          {mode === 'edit' && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 text-white/70 hover:text-white transition-colors"
              >
                <MoreVertical size={20} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-30 bg-[#161920] border border-[#2A2F36] rounded-xl shadow-xl overflow-hidden min-w-[180px]">
                    <button
                      onClick={() => {
                        setMenuOpen(false);
                        setPrintOpen(true);
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 text-sm text-white/80 hover:bg-white/5 transition-colors"
                    >
                      <Printer size={16} /> Print Label
                    </button>
                    {onDelete && (
                      <button
                        onClick={() => {
                          setMenuOpen(false);
                          handleDelete();
                        }}
                        className="w-full flex items-center gap-3 px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <Trash2 size={16} /> Delete Item
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {hasChanges && (
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-xs rounded-xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-40"
            >
              Save
            </button>
          )}
        </div>
      </div>

      {/* Print modal */}
      {printOpen && (
        <LabelPrintOptionsModal
          title={`Print labels — ${sku}`}
          showOrientation
          showQuantity
          initialQuantity={1}
          allQuantity={initialData?.quantity ?? undefined}
          isBusy={isPrintingLabels}
          onClose={() => setPrintOpen(false)}
          onConfirm={handleGenerateLabels}
        />
      )}

      {/* ── MAIN CONTENT ── */}
      <div className="max-w-5xl mx-auto p-4 sm:p-6 pb-28 space-y-6">
        {/* ── SECTION 1: HERO (PRODUCT SHEET / EDIT) ── */}
        <div className="bg-[#161920] border border-[#2A2F36] rounded-2xl p-4 sm:p-6 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Photo Column (Max 320px) */}
            <div className="md:col-span-5 flex justify-center">
              <div className="w-full max-w-[280px] sm:max-w-[320px] aspect-square relative bg-[#0F1115] border border-[#2A2F36] rounded-2xl overflow-hidden flex items-center justify-center p-3">
                <PhotoHero
                  photoUrl={photoPreview}
                  isUploading={isUploadingPhoto}
                  disabled={isAddMode && !sku?.trim()}
                  onCapture={handlePhotoCapture}
                  onRemove={handlePhotoRemove}
                />
              </div>
            </div>

            {/* Primary Info + Metrics */}
            <div className="md:col-span-7 flex flex-col justify-between space-y-4">
              <div>
                {/* Category / Badges */}
                <div className="flex items-center gap-2 mb-2">
                  <span
                    onClick={() => isEditing && setTypeIsBike(!typeIsBike)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider ${
                      typeIsBike
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                    } ${isEditing ? 'cursor-pointer hover:opacity-80' : ''}`}
                  >
                    {typeIsBike ? 'Bike' : 'Part'}
                  </span>
                  <span className="px-2.5 py-1 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-lg text-xs font-semibold uppercase tracking-wider">
                    New
                  </span>
                </div>

                {/* Model & Color */}
                {isEditing ? (
                  <div className="space-y-2 mb-3">
                    <div>
                      <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider block mb-1">
                        Model / Name
                      </label>
                      <input
                        type="text"
                        value={modelField || ''}
                        onChange={(e) => setValue('model', e.target.value)}
                        placeholder="e.g. Explorer A2"
                        className="w-full bg-[#0F1115] border border-[#2A2F36] rounded-xl px-3 py-2 text-sm text-white font-semibold focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-white/40 uppercase tracking-wider block mb-1">
                        Color
                      </label>
                      <input
                        type="text"
                        value={colorField || ''}
                        onChange={(e) => setValue('color', e.target.value)}
                        placeholder="e.g. Deep Blue"
                        className="w-full bg-[#0F1115] border border-[#2A2F36] rounded-xl px-3 py-2 text-sm text-white font-semibold focus:outline-none focus:border-emerald-500/50"
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mb-3">
                    <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight">
                      {displayTitle}
                    </h1>
                    <p className="text-base text-white/60 font-medium">{displayColor}</p>
                  </div>
                )}

                {/* SKU Badge */}
                <div className="inline-flex items-center gap-2 bg-[#0F1115] border border-[#2A2F36] px-3.5 py-2 rounded-xl mb-4">
                  <span className="text-xs font-medium text-white/40 uppercase tracking-widest">
                    SKU
                  </span>
                  {isEditing ? (
                    <input
                      type="text"
                      value={sku}
                      onChange={(e) => setValue('sku', e.target.value)}
                      placeholder="03-4069BL"
                      className="bg-transparent text-sm sm:text-base font-mono font-medium text-emerald-400 focus:outline-none w-36"
                    />
                  ) : (
                    <span className="text-sm sm:text-base font-mono font-medium text-emerald-400">
                      {displaySku}
                    </span>
                  )}
                </div>
              </div>

              {/* ── QUANTITY HERO METRIC (40-48px) ── */}
              <div className="bg-[#0F1115] border border-[#2A2F36] rounded-2xl p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium text-white/40 uppercase tracking-wider block">
                    Quantity
                  </span>
                  {totalStock && totalStock.locations > 1 && (
                    <span className="text-[11px] text-emerald-400/80 font-medium">
                      {totalStock.total}u across {totalStock.locations} locs.
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setValue('quantity', Math.max(0, quantity - 1))}
                    className="w-11 h-11 rounded-xl bg-[#161920] border border-[#2A2F36] flex items-center justify-center text-white/80 hover:text-white hover:border-emerald-500/50 active:scale-95 transition-all"
                  >
                    <Minus size={18} />
                  </button>

                  {isEditingQtyDirect ? (
                    <input
                      ref={qtyInputRef}
                      type="number"
                      value={directQtyVal}
                      onChange={(e) => setDirectQtyVal(e.target.value)}
                      onBlur={() => {
                        const parsed = parseInt(directQtyVal, 10);
                        if (!isNaN(parsed) && parsed >= 0) setValue('quantity', parsed);
                        setIsEditingQtyDirect(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const parsed = parseInt(directQtyVal, 10);
                          if (!isNaN(parsed) && parsed >= 0) setValue('quantity', parsed);
                          setIsEditingQtyDirect(false);
                        }
                      }}
                      className="w-20 text-center text-3xl sm:text-4xl font-bold font-mono text-emerald-400 bg-[#161920] border border-emerald-500/40 rounded-xl py-1 focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <span
                      onClick={() => {
                        setDirectQtyVal(String(quantity));
                        setIsEditingQtyDirect(true);
                      }}
                      className="text-3xl sm:text-4xl font-bold font-mono text-emerald-400 min-w-[60px] text-center cursor-pointer hover:opacity-80 transition-opacity"
                    >
                      {quantity}
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setValue('quantity', quantity + 1)}
                    className="w-11 h-11 rounded-xl bg-[#161920] border border-[#2A2F36] flex items-center justify-center text-white/80 hover:text-white hover:border-emerald-500/50 active:scale-95 transition-all"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stock Reservations */}
        {sku && warehouse && location && (
          <StockReservationBreakdown sku={sku} warehouse={warehouse} location={location} />
        )}

        {/* Validation feedback */}
        {validationState.status !== 'idle' && (
          <div
            className={`flex items-start gap-2 p-3 rounded-xl text-xs font-medium animate-in fade-in ${
              validationState.status === 'error'
                ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                : validationState.status === 'warning'
                  ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                  : 'bg-blue-500/10 border border-blue-500/20 text-blue-400'
            }`}
          >
            {validationState.status === 'checking' ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin mt-0.5" />
                Validating availability...
              </>
            ) : (
              <>
                <AlertCircle size={15} className="shrink-0 mt-0.5" />
                <span className="leading-relaxed">{validationState.message}</span>
              </>
            )}
          </div>
        )}

        {/* ── SECTION 2: INFORMATION & LOCATION (GRID 2 COLUMNS) ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* UNIFIED INFORMATION CARD */}
          <div className="bg-[#161920] border border-[#2A2F36] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A2F36] pb-3">
              <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">
                Product Information
              </h2>
              {isEditing && <span className="text-xs text-amber-400 font-medium">Edit Mode</span>}
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between py-1">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                  Model
                </span>
                {isEditing || !modelField?.trim() ? (
                  <input
                    type="text"
                    value={modelField || ''}
                    onChange={(e) => setValue('model', e.target.value)}
                    placeholder="e.g. Explorer A2"
                    className="bg-[#0F1115] border border-[#2A2F36] rounded-lg px-2.5 py-1 text-white text-xs text-right w-44 font-medium focus:outline-none focus:border-emerald-500/40"
                  />
                ) : (
                  <span className="text-white font-medium">{displayTitle}</span>
                )}
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[#2A2F36]/50">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                  Color
                </span>
                {isEditing || !colorField?.trim() ? (
                  <input
                    type="text"
                    value={colorField || ''}
                    onChange={(e) => setValue('color', e.target.value)}
                    placeholder="e.g. Deep Blue"
                    className="bg-[#0F1115] border border-[#2A2F36] rounded-lg px-2.5 py-1 text-white text-xs text-right w-44 font-medium focus:outline-none focus:border-emerald-500/40"
                  />
                ) : (
                  <span className="text-white font-medium">{displayColor}</span>
                )}
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[#2A2F36]/50">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                  Size
                </span>
                {isEditing || !sizeField?.trim() ? (
                  <input
                    type="text"
                    value={sizeField || ''}
                    onChange={(e) => setValue('size', e.target.value)}
                    placeholder="e.g. 19"
                    className="bg-[#0F1115] border border-[#2A2F36] rounded-lg px-2.5 py-1 text-white text-xs text-right w-32 font-medium focus:outline-none focus:border-emerald-500/40"
                  />
                ) : (
                  <span className="text-white font-medium">{sizeField}</span>
                )}
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[#2A2F36]/50">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                  Price
                </span>
                {isEditing || priceField == null ? (
                  <input
                    type="number"
                    value={priceField ?? ''}
                    onChange={(e) =>
                      setValue('price', e.target.value ? Number(e.target.value) : null)
                    }
                    placeholder="0.00"
                    className="bg-[#0F1115] border border-[#2A2F36] rounded-lg px-2.5 py-1 text-white text-xs text-right w-32 font-medium focus:outline-none focus:border-emerald-500/40"
                  />
                ) : (
                  <span className="text-white font-medium font-mono">${priceField.toFixed(2)}</span>
                )}
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[#2A2F36]/50">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                  Serial
                </span>
                {isEditing || !serialNumber?.trim() ? (
                  <input
                    type="text"
                    value={serialNumber || ''}
                    onChange={(e) => setValue('serial_number', e.target.value)}
                    placeholder="S/N..."
                    className="bg-[#0F1115] border border-[#2A2F36] rounded-lg px-2.5 py-1 text-white text-xs text-right w-44 font-mono font-medium focus:outline-none focus:border-emerald-500/40"
                  />
                ) : (
                  <span className="text-white font-mono font-medium">{serialNumber}</span>
                )}
              </div>

              <div className="flex items-center justify-between py-1 border-t border-[#2A2F36]/50">
                <span className="text-white/40 text-xs font-medium uppercase tracking-wider">
                  Last update
                </span>
                <span className="text-white/70 text-xs font-medium">{displayLastUpdate}</span>
              </div>
            </div>
          </div>

          {/* UNIFIED LOCATION CARD (< 180PX) */}
          <div className="bg-[#161920] border border-[#2A2F36] rounded-2xl p-5 flex flex-col justify-between space-y-4">
            <div>
              <div className="flex items-center justify-between border-b border-[#2A2F36] pb-3 mb-3">
                <div className="flex items-center gap-2">
                  <MapPin size={18} className="text-emerald-400" />
                  <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">
                    Location
                  </h2>
                </div>
                <span className="text-xs text-white/40 font-mono font-medium uppercase">
                  {warehouse}
                </span>
              </div>

              {/* Metric Hero Row */}
              <div className="flex items-center justify-between bg-[#0F1115] border border-[#2A2F36] rounded-xl p-3 mb-3">
                <span className="text-xs text-white/40 font-medium uppercase tracking-wider">
                  Row / Bin
                </span>
                {isEditing ? (
                  <AutocompleteInput
                    id="location_input"
                    value={location}
                    onChange={(v: string) => setValue('location', v)}
                    suggestions={validLocationNames.map((l) => ({ value: l }))}
                    placeholder="e.g. Row 6"
                  />
                ) : (
                  <span className="text-lg font-semibold font-mono text-emerald-400">
                    {displayLocation}
                  </span>
                )}
              </div>

              {/* Sub-locations [A][B][C][D][E][F] */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider block">
                  Sub-location
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {['A', 'B', 'C', 'D', 'E', 'F'].map((letter) => {
                    const isSelected = displaySublocations.includes(letter);
                    return (
                      <button
                        key={letter}
                        type="button"
                        onClick={() => {
                          const current: string[] = sublocation || [];
                          const updated = isSelected
                            ? current.filter((l) => l !== letter)
                            : [...current, letter].sort();
                          setValue('sublocation', updated.length > 0 ? updated : null);
                        }}
                        className={`w-8 h-8 rounded-lg text-xs font-semibold font-mono transition-all ${
                          isSelected
                            ? 'bg-emerald-500 text-black shadow-md shadow-emerald-500/20'
                            : 'bg-[#0F1115] text-white/60 border border-[#2A2F36] hover:border-emerald-500/40'
                        }`}
                      >
                        {letter}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Note row */}
            <div className="pt-2 border-t border-[#2A2F36]/50">
              <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider block mb-1">
                Location note
              </span>
              {isEditing || !internalNote?.trim() ? (
                <input
                  type="text"
                  value={internalNote || ''}
                  onChange={(e) => setValue('internal_note', e.target.value)}
                  placeholder="Details about shelf or position..."
                  className="w-full bg-[#0F1115] border border-[#2A2F36] rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-emerald-500/40"
                />
              ) : (
                <p className="text-xs text-white/70 italic truncate">{displayNote}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── SECTION 3: DISTRIBUTION & DIMENSIONS ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* DISTRIBUTION CARD */}
          <div className="bg-[#161920] border border-[#2A2F36] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A2F36] pb-3">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-emerald-400" />
                <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">
                  Distribution
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsDistributionSheetOpen(true)}
                className="text-xs font-semibold text-emerald-400 hover:underline"
              >
                Edit
              </button>
            </div>

            {distribution.length > 0 ? (
              <div className="space-y-2">
                {distribution.map((d, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-[#0F1115] border border-[#2A2F36] rounded-xl px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-white/80">
                      {d.type} {d.units_each}u
                    </span>
                    <span className="font-semibold text-emerald-400">× {d.count}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium pt-2">
                  <Check size={14} />
                  <span>All units accounted for</span>
                </div>
              </div>
            ) : (
              <div className="bg-[#0F1115] border border-[#2A2F36] rounded-xl p-4 text-center">
                <p className="text-xs text-white/40">No distribution structure configured.</p>
              </div>
            )}
          </div>

          {/* DIMENSIONS CARD (3 ALIGNED INPUTS) */}
          <div className="bg-[#161920] border border-[#2A2F36] rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#2A2F36] pb-3">
              <h2 className="text-sm font-semibold text-white/90 uppercase tracking-wider">
                Dimensions & Weight
              </h2>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#0F1115] border border-[#2A2F36] rounded-xl p-3 text-center">
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider block mb-1">
                  Length
                </span>
                {isEditing || !lengthIn ? (
                  <input
                    type="number"
                    value={lengthIn ?? ''}
                    onChange={(e) =>
                      setValue('length_in', e.target.value ? Number(e.target.value) : undefined)
                    }
                    placeholder="—"
                    className="w-full bg-[#161920] text-center text-sm font-semibold text-emerald-400 rounded px-1 focus:outline-none"
                  />
                ) : (
                  <span className="text-base font-semibold font-mono text-white">{lengthIn}"</span>
                )}
              </div>

              <div className="bg-[#0F1115] border border-[#2A2F36] rounded-xl p-3 text-center">
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider block mb-1">
                  Width
                </span>
                {isEditing || !widthIn ? (
                  <input
                    type="number"
                    value={widthIn ?? ''}
                    onChange={(e) =>
                      setValue('width_in', e.target.value ? Number(e.target.value) : undefined)
                    }
                    placeholder="—"
                    className="w-full bg-[#161920] text-center text-sm font-semibold text-emerald-400 rounded px-1 focus:outline-none"
                  />
                ) : (
                  <span className="text-base font-semibold font-mono text-white">{widthIn}"</span>
                )}
              </div>

              <div className="bg-[#0F1115] border border-[#2A2F36] rounded-xl p-3 text-center">
                <span className="text-[11px] font-medium text-white/40 uppercase tracking-wider block mb-1">
                  Height
                </span>
                {isEditing || !heightIn ? (
                  <input
                    type="number"
                    value={heightIn ?? ''}
                    onChange={(e) =>
                      setValue('height_in', e.target.value ? Number(e.target.value) : undefined)
                    }
                    placeholder="—"
                    className="w-full bg-[#161920] text-center text-sm font-semibold text-emerald-400 rounded px-1 focus:outline-none"
                  />
                ) : (
                  <span className="text-base font-semibold font-mono text-white">{heightIn}"</span>
                )}
              </div>
            </div>

            {weightLbs && (
              <div className="text-right text-xs text-white/40 font-mono">
                Approx weight: <span className="text-white/80 font-semibold">{weightLbs} lbs</span>
              </div>
            )}
          </div>
        </div>

        {/* Other Locations Card */}
        {mode === 'edit' && initialData?.sku && quantity === 0 && (
          <OtherLocationsCard
            sku={initialData.sku}
            currentItemId={initialData.id}
            ludlowData={ludlowData}
            atsData={atsData}
          />
        )}

        {/* ── HISTORY ── */}
        {mode === 'edit' && initialData?.sku && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white/80 uppercase tracking-wider flex items-center gap-2">
                <History size={16} /> Recent Activity
              </h3>
              <button
                type="button"
                onClick={() => setIsHistorySheetOpen(true)}
                className="text-xs text-emerald-400 font-semibold hover:underline"
              >
                View full history
              </button>
            </div>
            <InlineItemHistory
              sku={initialData.sku}
              limit={3}
              onSeeAll={() => setIsHistorySheetOpen(true)}
            />
          </div>
        )}
      </div>

      {/* ── STICKY BOTTOM FOOTER FOR SAVE BUTTON ── */}
      {(isEditing || hasChanges) && (
        <div className="fixed bottom-0 inset-x-0 z-40 bg-[#0F1115]/95 backdrop-blur-md border-t border-[#2A2F36] p-4 flex justify-center shadow-2xl">
          <button
            disabled={!canSave}
            onClick={handleSave}
            className="w-full max-w-md bg-emerald-500 hover:bg-emerald-400 text-black font-bold uppercase tracking-wider h-13 rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-emerald-500/20 disabled:opacity-40"
          >
            <Save size={18} />
            <span>{isAddMode ? 'Create Item' : 'Save Changes'}</span>
          </button>
        </div>
      )}

      {/* Bottom Sheets */}
      <SectionEditorSheet
        isOpen={isDistributionSheetOpen}
        onClose={() => setIsDistributionSheetOpen(false)}
        distribution={distribution}
        quantity={quantity || 0}
        onAdd={addDistributionRow}
        onRemove={removeDistributionRow}
        onUpdate={updateDistributionRow}
      />

      <ItemHistorySheet
        isOpen={isHistorySheetOpen}
        onClose={() => setIsHistorySheetOpen(false)}
        sku={sku}
      />
    </div>,
    document.body
  );
};
