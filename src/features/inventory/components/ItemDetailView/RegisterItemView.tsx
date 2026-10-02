/**
 * Register a box: the screen is its carton label (docs/prds/item-detail-register.md, F1).
 *
 * Three questions — what is it, where is it, how many — and one button. The
 * label is shot here and read in place: green is read, amber offers the
 * label's readings as buttons, red is missing. Bike / Part lives on the label
 * with no default, so nothing is registered under a guessed type. Where is two
 * taps (a suggestion, then a square with the units already in it), how many is
 * a number. The writes are the old add form's, built by `utils/registerItem.ts`;
 * the pieces are shared with the edit card (`ItemCardParts`).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';

import { supabase } from '../../../../lib/supabase';
import { useInventory } from '../../hooks/useInventoryData.ts';
import { useConfirmation } from '../../../../context/ConfirmationContext.tsx';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { CameraCaptureSheet } from '../../../../components/ui/CameraCaptureSheet';
import { recognizeLabelClient } from '../../../../lib/recognition/recognizeLabelClient';
import { uploadPhoto } from '../../../../services/photoUpload.service';
import { skuDefaultsFor } from '../../../../utils/skuDefaults';
import { normalizeSkuOnRegister } from '../../../../utils/skuNormalize';
import { recordSkuSerial } from '../../api/skuSerials.service';
import { buildSkuLabelDraft } from '../../utils/labelToSkuDraft';
import { serialLooksReal } from '../../utils/serialIdentity';
import {
  buildRegisterWrite,
  fillFromCatalogue,
  identityFromDraft,
  identityFromPrefill,
  isRowLocation,
  readiness,
  settle,
  REGISTER_FIELDS,
  type RegisterField,
  type RegisterIdentity,
} from '../../utils/registerItem';
import type {
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../../schemas/inventory.schema.ts';
import { SdDetailsCard, type SdDetailsValues } from './SdDetailsCard.tsx';
import {
  CartonLabel,
  CartonLine,
  FieldSheet,
  HowManyTile,
  WherePicker,
  WhereTile,
} from './ItemCardParts.tsx';
import {
  FIELD_LABEL,
  HEADING,
  setSkuPhotoInCaches,
  useExistsAt,
  useScratchDentHolder,
  useWhereChoices,
} from './itemCardShared';

interface RegisterItemViewProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: InventoryItemInput) => void | Promise<void>;
  initialData?: InventoryItemWithMetadata | null;
  screenType?: string;
  /** A label photo taken before this screen opened: read it on open. */
  initialPhotoFile?: File | null;
  /** Opened from "photo": go straight to the camera. */
  startWithCamera?: boolean;
}

const EMPTY_SD: SdDetailsValues = {
  category: '',
  condition: '',
  conditionDescription: '',
  forSale: '',
  msrp: null,
  standardPrice: null,
  pdfLink: '',
};

export const RegisterItemView: React.FC<RegisterItemViewProps> = ({
  isOpen,
  onClose,
  onSave,
  initialData,
  screenType,
  initialPhotoFile,
  startWithCamera = false,
}) => {
  const queryClient = useQueryClient();
  const { updateSKUMetadata } = useInventory();
  const { showConfirmation } = useConfirmation();

  const warehouse = (initialData?.warehouse || screenType || 'LUDLOW').toUpperCase();
  const hasPrefill = !!initialData?.sku;

  const [identity, setIdentity] = useState<RegisterIdentity>(() =>
    identityFromPrefill(initialData)
  );
  const [started, setStarted] = useState(hasPrefill);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(startWithCamera);

  const [location, setLocation] = useState<string | null>(initialData?.location || null);
  const [square, setSquare] = useState<string | null>(null);
  const [quantity, setQuantity] = useState<number | null>(null);
  const [whereOpen, setWhereOpen] = useState(false);
  const [locQuery, setLocQuery] = useState('');

  const [editing, setEditing] = useState<RegisterField | 'qty' | null>(null);
  const [sd, setSd] = useState<SdDetailsValues>(EMPTY_SD);
  const [saving, setSaving] = useState(false);

  // ── Reading the label ────────────────────────────────────────────────────
  const readLabel = useCallback(async (file: File) => {
    setStarted(true);
    setPhoto(file);
    setPhotoUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setReading(true);
    setReadError(null);
    try {
      const result = await recognizeLabelClient(file, file.name);
      const draft = buildSkuLabelDraft(result);
      setIdentity((current) => identityFromDraft(draft, current));
    } catch (e) {
      setReadError(e instanceof Error ? e.message : 'Could not read the label.');
    } finally {
      setReading(false);
    }
  }, []);

  const initialPhotoReadRef = useRef<File | null>(null);
  useEffect(() => {
    if (!isOpen || !initialPhotoFile || initialPhotoReadRef.current === initialPhotoFile) return;
    initialPhotoReadRef.current = initialPhotoFile;
    void readLabel(initialPhotoFile);
  }, [isOpen, initialPhotoFile, readLabel]);

  useEffect(
    () => () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    },
    [photoUrl]
  );

  const sku = identity.fields.sku.value;
  const model = identity.fields.model.value;
  const skuStatus = identity.fields.sku.status;

  // A SKU typed or read that the catalogue already has: fill in what it knows.
  useEffect(() => {
    if (!isOpen || !sku || skuStatus === 'given' || skuStatus === 'choose') return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('sku_metadata')
        .select('is_bike, model, size, color, upc')
        .eq('sku', normalizeSkuOnRegister(sku))
        .maybeSingle();
      if (!cancelled && data) setIdentity((id) => fillFromCatalogue(id, data));
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, sku, skuStatus]);

  // ── Where ────────────────────────────────────────────────────────────────
  const choices = useWhereChoices({
    enabled: isOpen && started,
    warehouse,
    sku,
    model,
    location,
    query: locQuery,
  });
  const existsHere = useExistsAt(isOpen, sku, location, warehouse);
  const sdHolder = useScratchDentHolder(isOpen, sku);

  const chooseLocation = (loc: string) => {
    const resolved = choices.resolve(loc);
    setLocation(resolved);
    setSquare(null);
    setLocQuery('');
    // A ROW stays open for its square; anything else is answered.
    if (!isRowLocation(resolved)) setWhereOpen(false);
  };

  // ── Answers ──────────────────────────────────────────────────────────────
  const ready = readiness({ identity, location, quantity });
  // A serial is one carton's; with more than one unit it names none of them (an S/D is one unit and keeps it).
  const multiUnit = !identity.isScratchDent && (quantity ?? 0) > 1;
  const blocker = ready.blocker ?? (sdHolder ? 'Its own SKU' : null);
  const canRegister = blocker === null && !saving && !reading;
  const touched =
    started &&
    (!!photo ||
      quantity !== null ||
      (location ?? '') !== (initialData?.location ?? '') ||
      REGISTER_FIELDS.some((k) => identity.fields[k].status === 'typed'));

  const requestClose = useCallback(() => {
    if (!touched) return onClose();
    showConfirmation(
      'Discard this box?',
      'Nothing has been registered yet.',
      () => onClose(),
      undefined,
      'Discard',
      'Keep going',
      'warning'
    );
  }, [touched, onClose, showConfirmation]);

  useScrollLock(isOpen, requestClose);

  const toggleSd = () => {
    const next = !identity.isScratchDent;
    if (next && (quantity ?? 0) > 1) {
      showConfirmation(
        'Mark as S/D',
        `An S/D is one serialized unit, and this box says ${quantity}. Mark it S/D anyway?`,
        () => setIdentity((id) => ({ ...id, isScratchDent: true })),
        undefined,
        'Mark S/D',
        'Cancel',
        'warning'
      );
      return;
    }
    setIdentity((id) => ({ ...id, isScratchDent: next }));
  };

  // ── Register ─────────────────────────────────────────────────────────────
  const register = useCallback(async () => {
    if (!canRegister) return;
    const text = (v: string) => v.trim() || null;
    const sdFields = Object.fromEntries(
      Object.entries({
        category: text(sd.category),
        condition: text(sd.condition),
        condition_description: text(sd.conditionDescription),
        sd_for_sale: text(sd.forSale),
        msrp: sd.msrp,
        standard_price: sd.standardPrice,
        pdf_link: text(sd.pdfLink),
      }).filter(([, v]) => v !== null)
    );
    const write = buildRegisterWrite({
      identity,
      location,
      quantity,
      square,
      warehouse,
      itemName: initialData?.item_name,
      sdFields,
    });
    setSaving(true);
    // Inventory first, metadata second, and nothing until the row is in: a
    // catalogue row with no inventory reads as "registered" to every open
    // order (bug-020).
    try {
      await onSave(write.item);
    } catch {
      setSaving(false);
      return; // the mutation already toasted; the screen stays to fix it
    }
    await updateSKUMetadata(write.metadata).catch((e: unknown) =>
      console.error('Metadata update failed:', e)
    );
    const savedSku = write.item.sku;
    if (!multiUnit && write.cartonSerial && serialLooksReal(write.cartonSerial)) {
      void recordSkuSerial({
        sku: savedSku,
        serial: write.cartonSerial,
        warehouse,
        source: identity.fields.serial.status === 'read' ? 'label_scan' : 'manual',
        observed: {
          model: identity.fields.model.value || null,
          size: identity.fields.size.value || null,
          color: identity.fields.color.value || null,
          upc: identity.fields.upc.value || null,
          gw_lbs: identity.labelWeightLbs,
        },
      }).catch(() => {});
    }
    if (photo) {
      const updateCache = (imageUrl: string) =>
        setSkuPhotoInCaches(queryClient, savedSku, imageUrl);
      void uploadPhoto(savedSku, photo, updateCache)
        .then((url) => updateCache(url))
        .catch(() => toast.error('Photo upload failed'));
    }
    setSaving(false);
    onClose();
  }, [
    canRegister,
    sd,
    location,
    identity,
    quantity,
    multiUnit,
    square,
    warehouse,
    initialData?.item_name,
    onSave,
    updateSKUMetadata,
    photo,
    queryClient,
    onClose,
  ]);

  if (!isOpen) return null;

  const emptyText = (key: RegisterField) =>
    key === 'serial'
      ? identity.isScratchDent
        ? 'required for S/D'
        : 'not on label'
      : 'tap to add';

  const defaults = skuDefaultsFor(identity.isBike === true);
  const isRow = isRowLocation(location);

  const scanPrompt = (
    <section className="flex flex-col items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-[#2A2F36] px-4 py-8 text-center">
      <button
        type="button"
        onClick={() => setCameraOpen(true)}
        aria-label="Shoot the carton label"
        className="flex h-20 w-20 items-center justify-center rounded-full bg-white text-[#0F1115] shadow-[0_0_0_8px_rgba(255,255,255,0.06)] active:scale-95"
      >
        <Camera size={30} />
      </button>
      <h2 className="text-xl font-bold text-white" style={HEADING}>
        Shoot the carton label
      </h2>
      <p className="max-w-[30ch] text-sm text-white/45">
        Green is read, amber needs you to pick, red is missing.
      </p>
      <button
        type="button"
        onClick={() => {
          setStarted(true);
          setEditing('sku');
        }}
        className="text-sm text-white underline underline-offset-4"
      >
        No label — type the SKU
      </button>
    </section>
  );

  const steps: [string, boolean][] = [
    ['What', ready.what],
    ['Where', ready.where],
    ['How many', ready.howMany],
  ];

  return createPortal(
    <div className="fixed inset-0 z-[180] select-none overflow-y-auto bg-[#0F1115] text-white animate-in fade-in duration-200">
      <div className="sticky top-0 z-30 flex items-center gap-2 border-b border-[#2A2F36] bg-[#0F1115]/90 px-4 py-3 backdrop-blur-md">
        <button
          type="button"
          onClick={requestClose}
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white/60 hover:text-white"
        >
          <ArrowLeft size={18} />
        </button>
        <span className="flex-1 text-[13px] uppercase tracking-[0.1em] text-white/45">
          New item
        </span>
      </div>

      <div className="mx-auto flex max-w-[430px] flex-col gap-3.5 px-4 pb-48 pt-4">
        {!started ? (
          scanPrompt
        ) : (
          <>
            {reading && (
              <div className="flex items-center gap-2 font-mono text-xs text-amber-400">
                <Loader2 size={14} className="animate-spin" /> reading label…
              </div>
            )}
            {readError && (
              <p className="rounded-xl border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs font-bold text-red-400">
                {readError}
              </p>
            )}
            <CartonLabel
              fields={identity.fields}
              isBike={identity.isBike}
              isScratchDent={identity.isScratchDent}
              photoUrl={photoUrl}
              emptyText={emptyText}
              onField={setEditing}
              onChoose={(key, value) => setIdentity((id) => settle(id, key, value))}
              onType={(isBike) => setIdentity((id) => ({ ...id, isBike }))}
              onSd={toggleSd}
              onPhoto={() => setCameraOpen(true)}
              hideSerial={multiUnit}
            />
            <div className="grid grid-cols-2 gap-2.5">
              <WhereTile
                location={location}
                squares={square ? [square] : []}
                open={whereOpen}
                onToggle={() => setWhereOpen((v) => !v)}
                sub={
                  !location ? 'pick a place' : isRow && !square ? 'tap a square' : 'tap to change'
                }
              />
              <HowManyTile
                quantity={quantity}
                onChange={setQuantity}
                onTap={() => setEditing('qty')}
              />
            </div>
            {whereOpen && (
              <WherePicker
                choices={choices}
                location={location}
                selected={square ? [square] : []}
                query={locQuery}
                onQuery={setLocQuery}
                onLocation={chooseLocation}
                onSquare={(l) => {
                  const on = square === l;
                  setSquare(on ? null : l);
                  if (!on) setWhereOpen(false);
                }}
              />
            )}
            {sdHolder && (
              <p className="text-xs text-red-400">
                {sdHolder.sku} is already an S/D bike on the shelf —{' '}
                {[sdHolder.name, sdHolder.serial, sdHolder.location].filter(Boolean).join(' · ')}.
                One S/D, one SKU: give this box its own.
              </p>
            )}
            {existsHere && !sdHolder && (
              <p className="text-xs text-amber-400">
                Already in {location} — the units are added to that row.
              </p>
            )}
            {identity.isBike !== null && (
              <CartonLine
                isBike={identity.isBike}
                dims={{
                  length: defaults.length_in,
                  width: defaults.width_in,
                  height: defaults.height_in,
                }}
                weight={identity.labelWeightLbs ?? defaults.weight_lbs}
                dimsTruth="DEFAULT"
                weightTruth={identity.labelWeightLbs != null ? 'LABEL G.W.' : 'DEFAULT'}
              />
            )}
            {identity.isScratchDent && (
              <SdDetailsCard
                isEditing
                values={sd}
                onChange={(key, value) => setSd((v) => ({ ...v, [key]: value }))}
              />
            )}
          </>
        )}
      </div>

      {started && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-[#0F1115] from-70% to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-[430px] flex-col gap-2">
            <div className="flex gap-1.5">
              {steps.map(([name, done]) => (
                <span
                  key={name}
                  className={`flex-1 rounded-md border py-1 text-center text-[10.5px] uppercase tracking-[0.12em] ${
                    done
                      ? 'border-emerald-400/40 text-emerald-400'
                      : 'border-[#2A2F36] text-white/45'
                  }`}
                >
                  {name}
                </span>
              ))}
            </div>
            <button
              type="button"
              disabled={!canRegister}
              onClick={() => void register()}
              className="flex h-14 w-full items-baseline justify-center gap-2.5 rounded-2xl bg-emerald-400 pt-4 font-bold text-[#052e1f] active:scale-[0.99] disabled:border disabled:border-[#2A2F36] disabled:bg-[#161920] disabled:text-white/45"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin self-center" />
              ) : canRegister ? (
                <>
                  Register
                  <span className="font-mono text-xs font-bold opacity-75">
                    +{quantity} → {location}
                    {square ? ` · ${square}` : ''}
                  </span>
                </>
              ) : (
                <>
                  Register
                  {blocker && <span className="font-mono text-xs font-medium">· {blocker}?</span>}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <FieldSheet
          label={editing === 'qty' ? 'How many' : FIELD_LABEL[editing]}
          initial={
            editing === 'qty'
              ? quantity == null
                ? ''
                : String(quantity)
              : identity.fields[editing].value
          }
          numeric={editing === 'qty'}
          keepCase={editing === 'size'}
          hint={
            editing === 'serial'
              ? identity.isScratchDent
                ? 'An S/D keeps this serial in the catalogue.'
                : 'Filed for this carton only, not for every box of the SKU.'
              : undefined
          }
          onCancel={() => setEditing(null)}
          onDone={(value) => {
            if (editing === 'qty') {
              const n = parseInt(value, 10);
              if (!Number.isNaN(n) && n >= 0) setQuantity(n);
            } else {
              const key = editing;
              setIdentity((id) => settle(id, key, value));
            }
            setEditing(null);
          }}
        />
      )}

      {cameraOpen && (
        <CameraCaptureSheet
          onCapture={(file) => {
            setCameraOpen(false);
            void readLabel(file);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>,
    document.body
  );
};
