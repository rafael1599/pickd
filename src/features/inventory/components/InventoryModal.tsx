import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import Save from 'lucide-react/dist/esm/icons/save';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Minus from 'lucide-react/dist/esm/icons/minus';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';

import { useInventory } from '../hooks/useInventoryData';
import { useLocationManagement } from '../hooks/useLocationManagement';
import { useConfirmation } from '../../../context/ConfirmationContext';
import { useViewMode } from '../../../context/ViewModeContext';
import { useAutoSelect } from '../../../hooks/useAutoSelect';

import AutocompleteInput from '../../../components/ui/AutocompleteInput.tsx';
import { InventoryItemWithMetadata, InventoryItemInput, InventoryFormSchema, type InventoryFormValues, type DistributionItem, STORAGE_TYPE_LABELS } from '../../../schemas/inventory.schema';
import { predictLocation } from '../../../utils/locationPredictor';
import { inventoryService } from '../api/inventory.service';

interface InventoryModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSave: (data: InventoryItemInput & { length_in?: number; width_in?: number; height_in?: number }) => void;
    onDelete?: () => void;
    initialData?: InventoryItemWithMetadata | null;
    mode?: 'add' | 'edit';
    screenType?: string;
}

export const InventoryModal: React.FC<InventoryModalProps> = ({
    isOpen,
    onClose,
    onSave,
    onDelete,
    initialData,
    mode = 'add',
    screenType,
}) => {
    const { ludlowData, atsData, isAdmin, updateSKUMetadata } = useInventory();
    const { locations } = useLocationManagement();
    const { setIsNavHidden } = useViewMode();
    const { showConfirmation } = useConfirmation();
    const autoSelect = useAutoSelect();
    const [distribution, setDistribution] = useState<DistributionItem[]>([]);
    const [isDistributionOpen, setIsDistributionOpen] = useState(false);
    const [userEditedDistribution, setUserEditedDistribution] = useState(false);

    const {
        register,
        handleSubmit,
        setValue,
        watch,
        reset,
        formState: { errors, isValid }
    } = useForm<InventoryFormValues>({
        // Zod v3 z.coerce/z.preprocess produces `unknown` output types that don't align
        // with RHF's Resolver generics. This is a known compatibility issue. The runtime
        // validation is correct — only the TS inference needs the cast.
        resolver: zodResolver(InventoryFormSchema) as any,
        mode: 'onChange',
        defaultValues: {
            sku: '',
            location: '',
            quantity: 0,
            item_name: '',
            warehouse: 'LUDLOW',
            length_in: 54,
            width_in: 8,
            height_in: 30,
            weight_lbs: 45,
            internal_note: '',
        }
    });

    // Selective watches — only these fields trigger component re-renders
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

    // 2. Sync Initial Data
    useEffect(() => {
        if (isOpen) {
            setIsNavHidden?.(true);

            if (mode === 'edit' && initialData) {
                reset({
                    sku: initialData.sku || '',
                    location: initialData.location || '',
                    quantity: Number(initialData.quantity) || 0,
                    item_name: initialData.item_name || '',
                    warehouse: initialData.warehouse || (screenType as any) || 'LUDLOW',
                    length_in: initialData.sku_metadata?.length_in ?? 54,
                    width_in: initialData.sku_metadata?.width_in ?? 8,
                    height_in: initialData.sku_metadata?.height_in ?? 30,
                    weight_lbs: initialData.sku_metadata?.weight_lbs ?? null,
                    internal_note: (initialData as any).internal_note || '',
                });
                setDistribution(Array.isArray((initialData as any).distribution) ? (initialData as any).distribution : []);
                setIsDistributionOpen(Array.isArray((initialData as any).distribution) && (initialData as any).distribution.length > 0);
                setUserEditedDistribution(false);
            } else {
                reset({
                    sku: '',
                    location: '',
                    quantity: 0,
                    item_name: '',
                    warehouse: (screenType as any) || 'LUDLOW',
                    length_in: 54,
                    width_in: 8,
                    height_in: 30,
                    weight_lbs: 45,
                    internal_note: '',
                });
                setDistribution([]);
                setIsDistributionOpen(false);
                setUserEditedDistribution(false);
            }
        } else {
            setIsNavHidden?.(false);
        }
        return () => setIsNavHidden?.(false);
    }, [isOpen, initialData, mode, screenType, reset, setIsNavHidden]);

    // 2b. Sync distribution from realtime data (unless user has manually edited it)
    useEffect(() => {
        if (!isOpen || mode !== 'edit' || !initialData || userEditedDistribution) return;
        const allItems = [...ludlowData, ...atsData];
        const liveItem = allItems.find(i => i.id === (initialData as any).id);
        if (!liveItem) return;
        const liveDist = Array.isArray((liveItem as any).distribution) ? (liveItem as any).distribution : [];
        const currentJson = JSON.stringify(distribution);
        const liveJson = JSON.stringify(liveDist);
        if (currentJson !== liveJson) {
            setDistribution(liveDist);
        }
    }, [isOpen, mode, initialData, ludlowData, atsData, userEditedDistribution]);

    // 2b2. Sync sku_metadata from realtime data (dimensions + weight)
    useEffect(() => {
        if (!isOpen || mode !== 'edit' || !initialData) return;
        const allItems = [...ludlowData, ...atsData];
        const liveItem = allItems.find(i => i.id === (initialData as any).id) as any;
        if (!liveItem?.sku_metadata) return;
        const liveMeta = liveItem.sku_metadata;
        const initMeta = (initialData as any).sku_metadata;
        if (JSON.stringify(liveMeta) !== JSON.stringify(initMeta)) {
            if (liveMeta.length_in != null) setValue('length_in', liveMeta.length_in);
            if (liveMeta.width_in != null) setValue('width_in', liveMeta.width_in);
            if (liveMeta.height_in != null) setValue('height_in', liveMeta.height_in);
            if (liveMeta.weight_lbs != null) setValue('weight_lbs', liveMeta.weight_lbs);
        }
    }, [isOpen, mode, initialData, ludlowData, atsData, setValue]);

    // 2c. Dirty check — has any field changed from initial values?
    const hasChanges = useMemo(() => {
        if (mode !== 'edit' || !initialData) return true; // Always allow in add mode
        const n = (v: any) => String(v ?? '').trim();
        const num = (v: any) => Number(v ?? 0);
        const formChanged =
            n(sku) !== n(initialData.sku) ||
            n(location) !== n(initialData.location) ||
            n(warehouse) !== n(initialData.warehouse || screenType || 'LUDLOW') ||
            Number(quantity || 0) !== Number(initialData.quantity || 0) ||
            n(itemName) !== n(initialData.item_name) ||
            n(internalNote) !== n((initialData as any).internal_note);
        if (formChanged) return true;
        // Check metadata changes (dimensions + weight)
        const meta = initialData.sku_metadata;
        const metaChanged =
            num(lengthIn) !== num(meta?.length_in) ||
            num(widthIn) !== num(meta?.width_in) ||
            num(heightIn) !== num(meta?.height_in) ||
            num(weightLbs) !== num(meta?.weight_lbs);
        if (metaChanged) return true;
        const initDist = Array.isArray((initialData as any).distribution) ? (initialData as any).distribution : [];
        return JSON.stringify(distribution) !== JSON.stringify(initDist);
    }, [mode, initialData, sku, location, warehouse, quantity, itemName, internalNote, distribution, screenType, lengthIn, widthIn, heightIn, weightLbs]);

    // 3. Location Predictions & Suggestions
    const validLocationNames = useMemo(() => {
        if (!locations) return [];
        return Array.from(new Set(locations
            .filter((l) => l.warehouse === warehouse)
            .map((l) => l.location)));
    }, [locations, warehouse]);

    const prediction = useMemo(
        () => predictLocation(location || '', validLocationNames),
        [location, validLocationNames]
    );

    const currentInventory = warehouse === 'ATS' ? atsData : ludlowData;

    // TIER 1: Instant local SKU presence — pure computation, no side-effect
    const foundLocations = useMemo(() => {
        const currentSKU = (sku || '').trim();
        if (currentSKU.length < 2) return [] as string[];
        const existingEntries = currentInventory.filter(i => (i.sku || '').trim() === currentSKU);
        return [...new Set(existingEntries.map(i => i.location || 'Unknown').filter(Boolean))];
    }, [sku, currentInventory]);

    const skuSuggestions = useMemo(() => {
        const uniqueSKUs = new Map<string, { value: string; info: string }>();
        currentInventory.forEach((item) => {
            if (item.sku && !uniqueSKUs.has(item.sku)) {
                const tag = item.quantity === 0 ? ' [0u]' : '';
                uniqueSKUs.set(item.sku, {
                    value: item.sku,
                    info: `${item.quantity}u • ${item.location}${tag}`,
                });
            }
        });
        return Array.from(uniqueSKUs.values());
    }, [currentInventory]);

    const locationSuggestions = useMemo(() => {
        if (location && prediction.matches.length > 0) {
            return Array.from(new Set(prediction.matches)).map(l => ({ value: l, info: 'DB Location' }));
        }
        const counts = new Map<string, number>();
        currentInventory.forEach(i => i.location && counts.set(i.location, (counts.get(i.location) || 0) + 1));
        return Array.from(counts.entries()).map(([loc, count]) => ({
            value: loc,
            info: `${count} items here`
        }));
    }, [currentInventory, location, prediction.matches]);

    // 3.5 Dynamic Warehouse List
    const availableWarehouses = useMemo(() => {
        return ['LUDLOW'] as ('LUDLOW' | 'ATS')[];
    }, []);

    // 4. Real-time Validation & Presence Tracking
    const [validationState, setValidationState] = useState<{
        status: 'idle' | 'checking' | 'error' | 'warning' | 'info';
        message?: string;
    }>({ status: 'idle' });

    // Constants for Validation Rules
    const MIN_SKU_CHARS = 7;

    const isSkuChanged = useMemo(() => {
        if (mode !== 'edit' || !initialData) return false;
        return sku.trim() !== (initialData.sku || '').trim();
    }, [sku, initialData, mode]);

    // Use a custom debounce hook or simple timeout for now
    useEffect(() => {
        // LEVEL 1: DIRTY CHECK (Has anything changed?)
        const normalize = (str: any) => (String(str || '')).trim();

        const currentSKU = normalize(sku);
        const originalSKU = normalize(initialData?.sku);

        const currentLocation = normalize(location);
        const originalLocation = normalize(initialData?.location);

        const currentWh = normalize(warehouse);
        const originalWh = normalize((screenType as any) || 'LUDLOW');


        const skuChanged = currentSKU !== originalSKU;
        const locationChanged = currentLocation !== originalLocation;
        const warehouseChanged = currentWh !== originalWh;
        const hasAnyChange = skuChanged || locationChanged || warehouseChanged;

        // TIER 2: COORDINATED SERVER VALIDATION (Debounced)
        if (mode === 'edit' && !hasAnyChange) {
            setValidationState(prev => prev.status === 'idle' ? prev : { status: 'idle' });
            return;
        }

        // TIER 2.1: GLOBAL RENAME CONFLICT (Instant Check)
        if (mode === 'edit' && isSkuChanged && currentSKU.length >= MIN_SKU_CHARS) {
            const globalConflict = currentInventory.find(i =>
                normalize(i.sku) === currentSKU &&
                String(i.id) !== String(initialData?.id)
            );
            if (globalConflict) {
                setValidationState({
                    status: 'error',
                    message: `⛔ SKU already exists in this warehouse (${globalConflict.location}). Cannot rename.`
                });
                return;
            }
        }

        // Length guard for server validation
        if (mode === 'add' || skuChanged) {
            if (currentSKU.length < MIN_SKU_CHARS) {
                setValidationState(prev => prev.status === 'idle' ? prev : { status: 'idle' });
                return;
            }
        }

        const timer = setTimeout(async () => {
            // Guard: Must have coordinates (SKU + Location + Warehouse)
            if (!currentSKU || !currentLocation || !currentWh) {
                // If we match SKU but location is still empty, we still want to show identity info in edit mode
                if (mode === 'edit' && isSkuChanged) {
                    setValidationState({
                        status: 'info',
                        message: 'ℹ️ Renaming: History will be transferred to the new SKU.'
                    });
                } else {
                    setValidationState(prev => prev.status === 'idle' ? prev : { status: 'idle' });
                }
                return;
            }

            // LEVEL 3: EXECUTION (API Call)
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
                        const localMatch = currentInventory.find(i => String(i.sku) === currentSKU && String(i.location) === currentLocation);
                        const isZero = localMatch && localMatch.quantity === 0;

                        setValidationState({
                            status: 'warning',
                            message: isZero
                                ? '⚠️ A SKU was previously registered here (currently 0 units). Quantity will be added.'
                                : '⚠️ Item already exists here. Quantity will be added and Description updated.'
                        });
                    } else if (mode === 'edit') {
                        if (isSkuChanged) {
                            setValidationState({
                                status: 'error',
                                message: '⛔ SKU already exists. Cannot rename.'
                            });
                        } else {
                            setValidationState({
                                status: 'warning',
                                message: 'ℹ️ Item exists in target location. Stock will be consolidated.'
                            });
                        }
                    }
                } else {
                    if (mode === 'edit' && isSkuChanged) {
                        setValidationState({
                            status: 'info',
                            message: 'ℹ️ Renaming: History will be transferred to the new SKU.'
                        });
                    } else {
                        setValidationState(prev => prev.status === 'idle' ? prev : { status: 'idle' });
                    }
                }
            } catch (err) {
                console.error('Validation check failed', err);
                setValidationState(prev => prev.status === 'idle' ? prev : { status: 'idle' });
            }
        }, 800);

        return () => clearTimeout(timer);
    }, [sku, location, warehouse, mode, initialData, screenType, currentInventory, isSkuChanged]);

    // 4. Handlers
    const handleLocationBlur = (val: string) => {
        if (prediction.bestGuess && prediction.bestGuess !== val) {
            setValue('location', prediction.bestGuess);
            toast(`Auto-selected ${prediction.bestGuess}`, { icon: '✨' });
        }
    };

    const onFormSubmit = (data: any) => {
        // 🛡️ SUBMIT-TIME PREDICTION FIX:
        // Ensure location is normalized if user clicked save too fast for blur handler
        if (prediction.bestGuess && prediction.bestGuess !== data.location) {
            console.log(`[SUBMIT] Auto-corrected location from "${data.location}" to "${prediction.bestGuess}"`);
            data.location = prediction.bestGuess;
            setValue('location', prediction.bestGuess); // Sync back to form state
        }

        // Rename Confirmation
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
    };

    // Distribution helpers
    const DEFAULT_UNITS: Record<string, number> = { TOWER: 30, LINE: 5, PALLET: 10, OTHER: 1 };

    const distributionTotal = useMemo(() =>
        distribution.reduce((sum, d) => sum + (d.count * d.units_each), 0),
        [distribution]
    );

    const addDistributionRow = () => {
        const totalQty = quantity || 0;
        const currentTotal = distribution.reduce((sum, d) => sum + (d.count * d.units_each), 0);
        const remaining = totalQty - currentTotal;
        // Copy type from last row, or default to LINE
        const type = distribution.length > 0 ? distribution[distribution.length - 1].type : 'LINE' as const;
        const typeDefault = DEFAULT_UNITS[type] || 1;
        // units_each: type default unless remaining is smaller (but > 0)
        const unitsEach = remaining <= 0 ? 1 : Math.min(typeDefault, remaining);
        setDistribution(prev => [...prev, { type, count: 1, units_each: unitsEach }]);
        setIsDistributionOpen(true);
        setUserEditedDistribution(true);
    };

    const removeDistributionRow = (index: number) => {
        setDistribution(prev => prev.filter((_, i) => i !== index));
        setUserEditedDistribution(true);
    };

    const updateDistributionRow = (index: number, field: keyof DistributionItem, value: any) => {
        setDistribution(prev => prev.map((row, i) => {
            if (i !== index) return row;
            const updated = { ...row, [field]: value };
            // Auto-fill units_each when type changes
            if (field === 'type' && DEFAULT_UNITS[value]) {
                updated.units_each = DEFAULT_UNITS[value];
            }
            return updated;
        }));
        setUserEditedDistribution(true);
    };

    const executeSave = async (data: any) => {
        // 1. Update SKU Metadata (dimensions)
        updateSKUMetadata({ // Fire and forget
            sku: data.sku,
            length_in: data.length_in,
            width_in: data.width_in,
            height_in: data.height_in,
            weight_lbs: data.weight_lbs,
        }).catch(e => console.error('Metadata update failed:', e));

        // 2. Attach distribution and internal_note to save payload
        data.internal_note = data.internal_note || null;
        data.distribution = distribution.filter(d => d.count > 0 && d.units_each > 0);

        // 3. CREATE/UPDATE ITEM
        onSave(data); // Fire and forget
        onClose();
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[100020] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
            <div className="bg-surface border border-subtle rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden scale-100 animate-in zoom-in-95 duration-200">
                <div className="px-6 py-4 border-b border-subtle bg-main/50 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-black text-content uppercase tracking-tight">
                            {mode === 'edit' ? 'Edit Item' : 'Add New Item'}
                        </h2>
                        {initialData?.sku && mode === 'edit' && (
                            <p className="text-[10px] text-muted font-bold uppercase tracking-widest mt-0.5">
                                Original: <span className="text-accent">{initialData.sku}</span>
                            </p>
                        )}
                    </div>
                    <button onClick={onClose} className="p-2 -mr-2 text-muted hover:text-content transition-colors z-10">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="max-h-[70vh] overflow-y-auto">
                    <form onSubmit={handleSubmit(onFormSubmit)} className="p-6 space-y-6">
                        {/* Warehouse Selection */}
                        <div>
                            <label className="block text-[10px] font-black text-accent mb-3 uppercase tracking-widest">Select Warehouse</label>
                            <div className="flex gap-2">
                                {availableWarehouses.map((wh) => (
                                    <button
                                        key={wh}
                                        type="button"
                                        onClick={() => setValue('warehouse', wh as 'LUDLOW' | 'ATS')}
                                        className={`px-4 py-2 rounded-lg font-bold text-xs transition-all border ${warehouse === wh
                                            ? 'bg-accent text-main border-accent shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]'
                                            : 'bg-surface text-muted border-subtle hover:border-muted'
                                            }`}
                                    >
                                        {wh}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <AutocompleteInput
                            id="inventory_sku"
                            label="SKU"
                            value={sku}
                            onChange={(v: string) => setValue('sku', v, { shouldValidate: true })}
                            suggestions={skuSuggestions}
                            placeholder="Enter SKU..."
                            minChars={2}
                            initialKeyboardMode="numeric"
                            onSelect={(s: any) => {
                                const match = currentInventory.find(i => i.sku === s.value) as InventoryItemWithMetadata | undefined;
                                if (match && mode === 'add') {
                                    setValue('location', match.location || '', { shouldValidate: true });
                                    setValue('item_name', match.item_name || '', { shouldValidate: true });

                                    if (match.sku_metadata) {
                                        setValue('length_in', match.sku_metadata.length_in ?? 54);
                                        setValue('width_in', match.sku_metadata.width_in ?? 8);
                                        setValue('height_in', match.sku_metadata.height_in ?? 30);
                                        setValue('weight_lbs', match.sku_metadata.weight_lbs ?? null);
                                    }
                                }
                            }}
                        />

                        {/* SKU Presence Info (Independent of Location) - Only on Add Mode */}
                        {mode === 'add' && foundLocations.length > 0 && (
                            <div className="mt-1 bg-blue-500/10 border border-blue-500/20 text-blue-400 p-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-start gap-2 animate-in fade-in slide-in-from-top-1">
                                <CheckCircle2 size={14} className="shrink-0 mt-0.5 text-blue-400" />
                                <span>
                                    SKU detected in this warehouse at: <strong className="text-blue-200">{foundLocations.join(', ')}</strong>
                                </span>
                            </div>
                        )}

                        {/* Real-time Validation Feedback */}
                        {validationState.status !== 'idle' && (
                            <div className={`mt-2 flex items-start gap-2 p-3 rounded-xl text-[10px] font-black uppercase tracking-widest animate-in fade-in slide-in-from-top-1 ${validationState.status === 'error' ? 'bg-red-500/10 border border-red-500/20 text-red-500' :
                                validationState.status === 'warning' ? 'bg-amber-500/10 border border-amber-500/20 text-amber-500' :
                                    'bg-blue-500/10 border border-blue-500/20 text-blue-400'
                                }`}>
                                {validationState.status === 'checking' ? (
                                    <>
                                        <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mt-0.5" />
                                        Checking availability...
                                    </>
                                ) : (
                                    <>
                                        <AlertCircle size={14} className="shrink-0 mt-0.5" />
                                        <span className="leading-relaxed">
                                            {validationState.message}
                                        </span>
                                    </>
                                )}
                            </div>
                        )}

                        <div className="flex flex-col gap-2">
                            <AutocompleteInput
                                id="inventory_location"
                                label="Location"
                                value={location || ''}
                                onChange={(v: string) => setValue('location', v, { shouldValidate: true })}
                                onBlur={handleLocationBlur}
                                suggestions={locationSuggestions}
                                placeholder="Row/Bin..."
                                minChars={1}
                                initialKeyboardMode="numeric"
                            />

                        </div>


                        <AutocompleteInput
                            id="item_name"
                            label="Item Name"
                            value={itemName || ''}
                            onChange={(v: string) => setValue('item_name', v, { shouldValidate: true })}
                            suggestions={[]}
                            placeholder="e.g. Desk Frame, Monitor Stand..."
                        />

                        {/* Internal Note */}
                        <div>
                            <label htmlFor="inventory_internal_note" className="block text-[10px] font-black text-accent mb-2 uppercase tracking-widest">
                                <MapPin size={10} className="inline mr-1 -mt-0.5" />
                                Internal Note
                            </label>
                            <input
                                id="inventory_internal_note"
                                type="text"
                                {...register('internal_note')}
                                placeholder="e.g. Behind the pole, Bottom shelf..."
                                className="w-full bg-main border border-subtle rounded-xl px-4 py-3 text-content focus:border-accent focus:outline-none transition-colors text-sm placeholder:text-white/20"
                            />
                        </div>

                        <div>
                            <label htmlFor="inventory_quantity" className="block text-[10px] font-black text-accent mb-2 uppercase tracking-widest">Quantity</label>
                            <input
                                id="inventory_quantity"
                                type="number"
                                {...register('quantity', { valueAsNumber: true })}
                                {...autoSelect}
                                className="w-full bg-main border border-subtle rounded-xl px-4 py-4 text-content focus:border-accent focus:outline-none transition-colors font-mono text-center text-2xl font-black"
                                required
                            />
                        </div>

                        {/* Distribution Editor */}
                        <div className="border border-subtle rounded-2xl overflow-hidden">
                            <button
                                type="button"
                                onClick={() => setIsDistributionOpen(!isDistributionOpen)}
                                className="w-full flex items-center justify-between px-4 py-3 bg-surface hover:bg-white/5 transition-colors"
                            >
                                <span className="text-[10px] font-black text-accent uppercase tracking-widest flex items-center gap-1.5">
                                    📦 Physical Distribution
                                    {distribution.length > 0 && (
                                        <span className="text-[9px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-black">
                                            {distribution.length}
                                        </span>
                                    )}
                                </span>
                                <span className="text-muted text-xs">{isDistributionOpen ? '▲' : '▼'}</span>
                            </button>

                            {isDistributionOpen && (
                                <div className="p-4 space-y-3 border-t border-subtle bg-main/50 animate-in fade-in slide-in-from-top-1 duration-200">
                                    {distribution.map((row, idx) => (
                                        <div key={idx} className="flex items-center gap-2 animate-in fade-in slide-in-from-left-2 duration-150">
                                            <select
                                                value={row.type}
                                                onChange={(e) => updateDistributionRow(idx, 'type', e.target.value)}
                                                className="bg-surface border border-subtle rounded-lg px-2 py-2 text-content text-xs font-bold focus:border-accent focus:outline-none flex-shrink-0 w-24"
                                            >
                                                {Object.entries(STORAGE_TYPE_LABELS).map(([key, { icon }]) => (
                                                    <option key={key} value={key}>{icon} {key}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number"
                                                value={row.count === 0 ? '' : row.count}
                                                onChange={(e) => updateDistributionRow(idx, 'count', e.target.value === '' ? 0 : (parseInt(e.target.value) || 0))}
                                                onBlur={(e) => { if (e.target.value === '' || Number(e.target.value) < 1) updateDistributionRow(idx, 'count', 1); }}
                                                {...autoSelect}
                                                className="w-14 bg-surface border border-subtle rounded-lg px-2 py-2 text-content text-center text-xs font-mono font-bold focus:border-accent focus:outline-none"
                                                min={1}
                                                placeholder="#"
                                            />
                                            <span className="text-muted text-[10px] font-black">×</span>
                                            <input
                                                type="number"
                                                value={row.units_each === 0 ? '' : row.units_each}
                                                onChange={(e) => updateDistributionRow(idx, 'units_each', e.target.value === '' ? 0 : (parseInt(e.target.value) || 0))}
                                                onBlur={(e) => { if (e.target.value === '' || Number(e.target.value) < 1) updateDistributionRow(idx, 'units_each', 1); }}
                                                {...autoSelect}
                                                className="w-14 bg-surface border border-subtle rounded-lg px-2 py-2 text-content text-center text-xs font-mono font-bold focus:border-accent focus:outline-none"
                                                min={1}
                                                placeholder="u"
                                            />
                                            <span className="text-[10px] text-muted font-bold">= {row.count * row.units_each}u</span>
                                            <button
                                                type="button"
                                                onClick={() => removeDistributionRow(idx)}
                                                className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                            >
                                                <Minus size={14} />
                                            </button>
                                        </div>
                                    ))}

                                    <button
                                        type="button"
                                        onClick={addDistributionRow}
                                        className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-subtle hover:border-accent/40 rounded-xl text-muted hover:text-accent text-[10px] font-black uppercase tracking-widest transition-colors"
                                    >
                                        <Plus size={12} />
                                        Add Grouping
                                    </button>

                                    {/* Distribution Summary */}
                                    {distribution.length > 0 && (
                                        <div className={`flex items-center justify-between px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest ${distributionTotal > (quantity || 0)
                                            ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                                            : distributionTotal === (quantity || 0)
                                                ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                                                : 'bg-amber-500/10 border border-amber-500/20 text-amber-400'
                                            }`}>
                                            <span>
                                                Accounted: {distributionTotal} / {quantity || 0} units
                                            </span>
                                            <span>
                                                {distributionTotal > (quantity || 0)
                                                    ? `⚠ ${distributionTotal - (quantity || 0)} over`
                                                    : distributionTotal === (quantity || 0)
                                                        ? '✓ Perfect'
                                                        : `${(quantity || 0) - distributionTotal} loose`
                                                }
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {isAdmin && (
                            <div className="grid grid-cols-4 gap-3 p-4 bg-accent/5 rounded-2xl border border-accent/10">
                                <div>
                                    <label className="block text-[10px] font-black text-accent mb-2 uppercase tracking-widest">Length (in)</label>
                                    <input type="number" {...register('length_in', { valueAsNumber: true })} {...autoSelect} step="0.1" className="w-full bg-main border border-subtle rounded-lg px-2 py-2 text-content focus:border-accent focus:outline-none font-mono text-center text-xs" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-accent mb-2 uppercase tracking-widest">Width (in)</label>
                                    <input type="number" {...register('width_in', { valueAsNumber: true })} {...autoSelect} step="0.1" className="w-full bg-main border border-subtle rounded-lg px-2 py-2 text-content focus:border-accent focus:outline-none font-mono text-center text-xs" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-accent mb-2 uppercase tracking-widest">Height (in)</label>
                                    <input type="number" {...register('height_in', { valueAsNumber: true })} {...autoSelect} step="0.1" className="w-full bg-main border border-subtle rounded-lg px-2 py-2 text-content focus:border-accent focus:outline-none font-mono text-center text-xs" />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black text-accent mb-2 uppercase tracking-widest">Weight (lbs)</label>
                                    <input type="number" {...register('weight_lbs', { valueAsNumber: true })} {...autoSelect} step="0.1" className="w-full bg-main border border-subtle rounded-lg px-2 py-2 text-content focus:border-accent focus:outline-none font-mono text-center text-xs" />
                                </div>
                            </div>
                        )}

                        {/* Validation Error Display */}
                        {errors.sku && <p className="text-red-500 text-[10px] font-bold uppercase">{String(errors.sku.message)}</p>}
                        {errors.quantity && <p className="text-red-500 text-[10px] font-bold uppercase">{String(errors.quantity.message)}</p>}
                        {errors.location && <p className="text-red-500 text-[10px] font-bold uppercase">{String(errors.location.message)}</p>}
                    </form>
                </div>

                <div className="p-6 border-t border-subtle bg-main/50 flex gap-3">
                    {mode === 'edit' && onDelete && (
                        <button
                            type="button"
                            onClick={() => {
                                showConfirmation('Delete Item', 'Are you sure you want to delete this item?', () => {
                                    onDelete();
                                    onClose();
                                });
                            }}
                            className="w-14 h-14 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-500 rounded-2xl flex items-center justify-center transition-all active:scale-95 shrink-0"
                        >
                            <Trash2 className="w-6 h-6" />
                        </button>
                    )}
                    <button
                        disabled={!isValid || !sku?.trim() || !location?.trim() || validationState.status === 'error' || validationState.status === 'checking' || !hasChanges}
                        onClick={handleSubmit(onFormSubmit)}
                        className={`flex-1 font-black uppercase tracking-widest h-14 rounded-2xl flex items-center justify-center gap-2 transition-transform shadow-lg shadow-accent/20 ${(!isValid || !sku?.trim() || !location?.trim() || validationState.status === 'error' || validationState.status === 'checking' || !hasChanges)
                            ? 'bg-neutral-800 text-neutral-500 border border-neutral-700 cursor-not-allowed opacity-50'
                            : 'bg-accent hover:opacity-90 text-main active:scale-95'
                            }`}

                    >
                        <Save className="w-5 h-5" />
                        {mode === 'edit' ? 'Update' : 'Save'}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};
