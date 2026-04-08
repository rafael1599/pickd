import { useCallback, useEffect, useMemo, useState } from 'react';

import { createPortal } from 'react-dom';
import X from 'lucide-react/dist/esm/icons/x';
import ArrowRightLeft from 'lucide-react/dist/esm/icons/arrow-right-left';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Zap from 'lucide-react/dist/esm/icons/zap';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import { useInventory } from '../hooks/useInventoryData.ts';
import { useMovementForm } from '../hooks/useMovementForm.ts';
import {
  useLocationSuggestions,
  type LocationSuggestion,
} from '../hooks/useLocationSuggestions.ts';
import AutocompleteInput from '../../../components/ui/AutocompleteInput.tsx';
import { CapacityBar } from '../../../components/ui/CapacityBar.tsx';
import { useLocationManagement } from '../hooks/useLocationManagement.ts';
import { predictLocation } from '../../../utils/locationPredictor.ts';
import { useViewMode } from '../../../context/ViewModeContext.tsx';
import { useAutoSelect } from '../../../hooks/useAutoSelect.ts';
import toast from 'react-hot-toast';
import { InventoryItem, InventoryItemWithMetadata, STORAGE_TYPE_LABELS } from '../../../schemas/inventory.schema.ts';
import { calculateBikeDistribution } from '../../../utils/distributionCalculator.ts';
import { useScrollLock } from '../../../hooks/useScrollLock';

interface MovementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onMove: (data: {
    sourceItem: InventoryItem;
    targetWarehouse: string;
    targetLocation: string;
    quantity: number;
    internalNote?: string | null;
  }) => void;
  initialSourceItem?: InventoryItemWithMetadata | null;
}

type NoteChoice = 'source' | 'destination' | 'both' | 'clear';

export const MovementModal: React.FC<MovementModalProps> = ({
  isOpen,
  onClose,
  onMove,
  initialSourceItem,
}) => {
  useScrollLock(isOpen, onClose);
  const { formData, setField, validate } = useMovementForm(initialSourceItem);
  const { locations } = useLocationManagement();
  const { locationCapacities, inventoryData } = useInventory();
  const { setIsNavHidden } = useViewMode();
  const autoSelect = useAutoSelect();
  const [noteConflict, setNoteConflict] = useState<{
    sourceNote: string;
    destNote: string;
    pendingMove: {
      sourceItem: InventoryItem;
      targetWarehouse: string;
      targetLocation: string;
      quantity: number;
    };
  } | null>(null);
  const handleClose = useCallback(() => {
    setNoteConflict(null);
    onClose();
  }, [onClose]);

  const excludeLoc =
    initialSourceItem?.warehouse === formData.targetWarehouse ? initialSourceItem?.location : null;

  const {
    suggestions: strategySuggestions,
    skuVelocity,
    mergeOpportunity,
  } = useLocationSuggestions(
    formData.targetLocation ? null : (initialSourceItem?.sku ?? null),
    formData.targetWarehouse,
    excludeLoc
  );

  const validLocationNames = useMemo(() => {
    if (!locations || locations.length === 0) return [];
    const names = locations
      .filter(
        (l) => (l.warehouse || '').toUpperCase() === (formData.targetWarehouse || '').toUpperCase()
      )
      .map((l) => l.location);
    return Array.from(new Set(names));
  }, [locations, formData.targetWarehouse]);

  const prediction = useMemo(
    () => predictLocation(formData.targetLocation, validLocationNames),
    [formData.targetLocation, validLocationNames]
  );

  useEffect(() => {
    if (isOpen) {
      setIsNavHidden!(true);
    } else {
      setIsNavHidden!(false);
    }

    return () => setIsNavHidden!(false);
  }, [formData.targetLocation, isOpen, setIsNavHidden]);

  const displaySuggestions: LocationSuggestion[] = useMemo(() => {
    if (formData.targetLocation && formData.targetLocation.length > 0) {
      return prediction.matches.map((locName): LocationSuggestion => {
        const locObj = locations.find(
          (l) =>
            (l.warehouse || '').toUpperCase() === (formData.targetWarehouse || '').toUpperCase() &&
            l.location === locName
        );
        const cap = locationCapacities[`${formData.targetWarehouse}-${locName}`];

        return {
          value: locName,
          priorityLabel: 'Match',
          score: 100,
          current: cap?.current || 0,
          max: cap?.max || locObj?.max_capacity || 550,
          zone: (locObj?.zone || 'UNKNOWN') as LocationSuggestion['zone'],
        };
      });
    }
    return strategySuggestions;
  }, [
    formData.targetLocation,
    formData.targetWarehouse,
    prediction,
    strategySuggestions,
    locationCapacities,
    locations,
  ]);

  const handleBlur = (val: string) => {
    if (!val) return;

    if (prediction.bestGuess && prediction.bestGuess !== val) {
      setField('targetLocation', prediction.bestGuess);
      toast.success(
        <span className="flex flex-col">
          <span>
            Auto-selected <b>{prediction.bestGuess}</b>
          </span>
          <span className="text-xs opacity-80">Matched from "{val}"</span>
        </span>,
        { icon: '✨', duration: 3000 }
      );
    }
  };

  const isSameLocation = useMemo(() => {
    if (!formData.targetLocation || !initialSourceItem) return false;
    return (
      formData.targetLocation.trim().toUpperCase() ===
        (initialSourceItem.location || '').toUpperCase() &&
      formData.targetWarehouse === initialSourceItem.warehouse
    );
  }, [formData.targetLocation, formData.targetWarehouse, initialSourceItem]);

  const isValid = validate().isValid && !isSameLocation;

  const previewDistribution = useMemo(() => {
    if (!initialSourceItem || !initialSourceItem.sku_metadata?.is_bike) return null;
    if (!formData.targetLocation || isSameLocation) return null;

    const moveQty = parseInt(formData.quantity.toString()) || 0;
    if (moveQty <= 0) return null;

    const destItem = inventoryData.find(
      (i) =>
        i.sku === initialSourceItem.sku &&
        i.warehouse === formData.targetWarehouse &&
        (i.location || '').toUpperCase() === formData.targetLocation.toUpperCase()
    );

    const totalQty = destItem ? (destItem.quantity || 0) + moveQty : moveQty;
    return calculateBikeDistribution(totalQty);
  }, [
    initialSourceItem,
    formData.targetLocation,
    formData.targetWarehouse,
    formData.quantity,
    inventoryData,
    isSameLocation,
  ]);

  const resolveNoteAndMove = useCallback(
    (
      moveData: {
        sourceItem: InventoryItem;
        targetWarehouse: string;
        targetLocation: string;
        quantity: number;
      },
      noteOverride?: string | null
    ) => {
      onMove({ ...moveData, internalNote: noteOverride });
      handleClose();
    },
    [onMove, handleClose]
  );

  const handleSubmit = () => {
    if (!isValid) return;

    let finalLocation = formData.targetLocation;
    if (prediction.bestGuess && prediction.bestGuess !== finalLocation) {
      finalLocation = prediction.bestGuess;
      console.log(
        `[SUBMIT] Auto-corrected location from "${formData.targetLocation}" to "${finalLocation}"`
      );
    }

    const moveData = {
      sourceItem: initialSourceItem!,
      targetWarehouse: formData.targetWarehouse,
      targetLocation: finalLocation,
      quantity: parseInt(formData.quantity.toString()),
    };

    const sourceNote = initialSourceItem?.internal_note?.trim() || '';
    const destItem = inventoryData.find(
      (i) =>
        i.sku === initialSourceItem?.sku &&
        i.warehouse === moveData.targetWarehouse &&
        (i.location || '').toUpperCase() === finalLocation.toUpperCase()
    );
    const destNote = destItem?.internal_note?.trim() || '';

    // No merge or no conflict → auto-resolve
    if (!destItem || !sourceNote || !destNote || sourceNote === destNote) {
      // For no-merge: SQL will inherit source note via COALESCE(p_internal_note, v_src_internal_note)
      // So we don't need to pass anything — let SQL handle it
      resolveNoteAndMove(moveData);
      return;
    }

    // Both have different notes → show conflict dialog
    setNoteConflict({ sourceNote, destNote, pendingMove: moveData });
  };

  const handleNoteResolution = (choice: NoteChoice) => {
    if (!noteConflict) return;
    const { sourceNote, destNote, pendingMove } = noteConflict;

    let resolvedNote: string | null;
    switch (choice) {
      case 'source':
        resolvedNote = sourceNote;
        break;
      case 'destination':
        resolvedNote = destNote;
        break;
      case 'both':
        resolvedNote = `${destNote} | ${sourceNote}`;
        break;
      case 'clear':
        resolvedNote = '';
        break;
    }

    setNoteConflict(null);
    resolveNoteAndMove(pendingMove, resolvedNote);
  };

  if (!isOpen) return null;

  const getZoneColor = (zoneType?: string) => {
    if (zoneType === 'HOT') return 'text-red-500';
    if (zoneType === 'WARM') return 'text-orange-500';
    return 'text-blue-500';
  };

  // Note conflict resolution dialog
  if (noteConflict) {
    return createPortal(
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-200">
        <div className="bg-surface border border-subtle rounded-3xl w-full max-w-sm shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden scale-100 animate-in zoom-in-95 duration-200">
          <div className="px-6 py-4 border-b border-subtle bg-main/50 flex items-start justify-between">
            <div>
              <h2 className="text-lg font-black text-content flex items-center gap-2 uppercase tracking-tight">
                <MapPin className="text-accent" size={20} />
                Note Conflict
              </h2>
              <p className="text-[10px] text-muted mt-1">
                Both locations have different notes. Choose which to keep.
              </p>
            </div>
            <button
              onClick={() => setNoteConflict(null)}
              className="p-2 -mr-2 text-muted hover:text-content transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-5 space-y-3">
            <button
              onClick={() => handleNoteResolution('source')}
              className="w-full text-left bg-main hover:bg-accent/5 border border-subtle hover:border-accent/30 rounded-xl p-3 transition-colors group"
            >
              <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">
                Keep Source Note
              </p>
              <p className="text-sm text-content font-bold truncate">{noteConflict.sourceNote}</p>
            </button>

            <button
              onClick={() => handleNoteResolution('destination')}
              className="w-full text-left bg-main hover:bg-accent/5 border border-subtle hover:border-accent/30 rounded-xl p-3 transition-colors group"
            >
              <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">
                Keep Destination Note
              </p>
              <p className="text-sm text-content font-bold truncate">{noteConflict.destNote}</p>
            </button>

            <button
              onClick={() => handleNoteResolution('both')}
              className="w-full text-left bg-main hover:bg-accent/5 border border-subtle hover:border-accent/30 rounded-xl p-3 transition-colors group"
            >
              <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">
                Combine Both
              </p>
              <p className="text-sm text-content font-bold truncate">
                {noteConflict.destNote} | {noteConflict.sourceNote}
              </p>
            </button>

            <button
              onClick={() => handleNoteResolution('clear')}
              className="w-full text-left bg-main hover:bg-red-500/5 border border-subtle hover:border-red-500/20 rounded-xl p-3 transition-colors group"
            >
              <p className="text-[9px] font-black text-muted uppercase tracking-widest mb-1">
                Clear Note
              </p>
              <p className="text-sm text-muted italic">No note</p>
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-main/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-surface border border-subtle rounded-3xl w-full max-w-sm shadow-2xl relative flex flex-col max-h-[90vh] overflow-hidden scale-100 animate-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b border-subtle bg-main/50 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black text-content flex items-center gap-2 uppercase tracking-tight">
              <ArrowRightLeft className="text-accent" size={24} />
              Relocate Stock
            </h2>
            {skuVelocity !== null && skuVelocity !== undefined && (
              <div className="flex items-center gap-2 mt-2">
                <span className="bg-accent/10 text-accent border border-accent/20 text-[10px] uppercase font-black px-2 py-0.5 rounded flex items-center gap-1">
                  <Zap size={10} />
                  {Number(skuVelocity).toFixed(1)} picks/day
                </span>
              </div>
            )}
          </div>
          <button
            onClick={handleClose}
            className="p-2 -mr-2 text-muted hover:text-content transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          <div className="bg-main border border-subtle rounded-2xl p-4 flex justify-between items-center group relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-accent" />
            <div>
              <h3 className="text-lg font-black text-content flex gap-2">
                <span className="text-muted font-bold uppercase tracking-widest text-[9px] self-center">
                  Moving
                </span>
                {initialSourceItem?.sku}
              </h3>
              <p className="text-[10px] text-muted font-bold mt-0.5 uppercase tracking-tight">
                From: <span className="text-content">{initialSourceItem?.location}</span> •{' '}
                {initialSourceItem?.warehouse}
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-black text-content leading-none">
                {initialSourceItem?.quantity}
              </p>
              <p className="text-[9px] text-muted uppercase font-black tracking-widest mt-1">
                Available
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div>
              <label className="block text-[10px] font-black text-muted uppercase tracking-widest mb-2">
                Quantity to Move
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={formData.quantity}
                  onChange={(e) =>
                    setField(
                      'quantity',
                      Math.min(
                        Number(initialSourceItem?.quantity || 0),
                        parseInt(e.target.value) || 0
                      )
                    )
                  }
                  {...autoSelect}
                  className="w-full bg-main border border-subtle rounded-xl py-4 px-4 text-center text-3xl font-black text-accent focus:border-accent focus:ring-1 focus:ring-accent/20 outline-none transition-all placeholder:text-muted/50"
                />
                <button
                  onClick={() => setField('quantity', initialSourceItem?.quantity || 0)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase bg-surface border border-subtle text-muted px-2 py-1 rounded hover:opacity-80 transition-colors"
                >
                  Max
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 text-subtle">
              <div className="h-px flex-1 bg-current" />
              <ArrowRightLeft size={16} />
              <div className="h-px flex-1 bg-current" />
            </div>

            <div>
              <label className="block text-[10px] font-black text-muted uppercase tracking-widest mb-2">
                Target Warehouse
              </label>
              <div className="flex flex-wrap gap-2">
                {['LUDLOW'].map((wh) => (
                  <button
                    key={wh}
                    type="button"
                    onClick={() => {
                      setField('targetWarehouse', wh);
                      setField('targetLocation', '');
                    }}
                    className={`px-4 py-2 rounded-lg font-bold text-xs transition-all border ${
                      formData.targetWarehouse === wh
                        ? 'bg-accent text-main border-accent shadow-[0_0_15px_rgba(var(--accent-rgb),0.3)]'
                        : 'bg-surface text-muted border-subtle hover:border-muted'
                    }`}
                  >
                    {wh}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {mergeOpportunity && !formData.targetLocation && (
                <button
                  onClick={() => setField('targetLocation', mergeOpportunity)}
                  className="w-full text-left bg-accent/5 hover:bg-accent/10 border border-accent/20 rounded-xl p-3 flex items-start gap-3 transition-colors group"
                >
                  <div className="p-2 bg-accent/10 rounded-lg text-accent">
                    <AlertTriangle size={16} />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold text-accent group-hover:opacity-80 uppercase tracking-widest">
                      Merge Opportunity
                    </p>
                    <p className="text-[10px] text-muted leading-tight mt-0.5">
                      Item already exists at{' '}
                      <strong className="text-content">{mergeOpportunity}</strong> in{' '}
                      <strong className="text-content">{formData.targetWarehouse}</strong>. Click to
                      merge.
                    </p>
                  </div>
                </button>
              )}

              <AutocompleteInput<LocationSuggestion>
                id="inventory_location"
                label="Target Location"
                value={formData.targetLocation}
                onChange={(val: string) => setField('targetLocation', val)}
                onBlur={handleBlur}
                suggestions={displaySuggestions.filter(
                  (s) => s.value !== initialSourceItem?.location
                )}
                placeholder="Scan or type location (e.g. '9')"
                initialKeyboardMode="numeric"
                renderItem={(suggestion) => (
                  <div className="py-2.5 px-1">
                    <div className="flex justify-between items-center mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-black text-content">{suggestion.value}</span>
                        {suggestion.zone && (
                          <span
                            className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-surface border border-subtle ${getZoneColor(suggestion.zone)}`}
                          >
                            {suggestion.zone}
                          </span>
                        )}
                      </div>
                      <span
                        className={`text-[9px] font-black uppercase ${suggestion.score > 80 ? 'text-green-500' : suggestion.score > 50 ? 'text-yellow-500' : 'text-muted'}`}
                      >
                        {suggestion.priorityLabel}
                      </span>
                    </div>
                    <CapacityBar
                      current={suggestion.current}
                      max={suggestion.max}
                      showText={false}
                      size="sm"
                    />
                  </div>
                )}
              />

              {isSameLocation && (
                <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl animate-in fade-in slide-in-from-top-2">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={20} />
                    <div>
                      <p className="text-[10px] font-black uppercase text-red-500 tracking-widest">
                        Invalid Destination
                      </p>
                      <p className="text-[10px] text-muted leading-tight mt-0.5">
                        Target location is the same as source. Please choose a different location or
                        warehouse.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {previewDistribution && previewDistribution.length > 0 && (
                <div className="bg-accent/5 border border-accent/10 rounded-xl p-3 animate-in fade-in slide-in-from-top-2">
                  <p className="text-[9px] font-black text-accent uppercase tracking-widest mb-1.5">
                    Auto Distribution
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {previewDistribution.map((d, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-bold text-content bg-surface border border-subtle px-1.5 py-0.5 rounded"
                      >
                        {d.count}
                        {STORAGE_TYPE_LABELS[d.type].short}&times;{d.units_each}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-subtle bg-main/50">
          <button
            onClick={handleSubmit}
            disabled={!isValid}
            className={`w-full h-14 font-black uppercase tracking-widest rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-95 ${
              isValid
                ? 'bg-accent text-main shadow-lg shadow-accent/20 hover:opacity-90'
                : 'bg-neutral-800 text-muted opacity-60 cursor-not-allowed border border-subtle'
            }`}
          >
            <CheckCircle2 size={20} />
            Confirm Move
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
