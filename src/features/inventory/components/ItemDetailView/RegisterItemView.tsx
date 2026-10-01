/**
 * Register a box: the screen is its carton label (docs/prds/item-detail-register.md, F1).
 *
 * Three questions — what is it, where is it, how many — and one button. The
 * label is shot here and read in place: green is read, amber offers the
 * label's readings as buttons, red is missing. Bike / Part lives on the label
 * with no default, so nothing is registered under a guessed type. Where is two
 * taps (a suggestion, then a square with the units already in it), how many is
 * a number. The writes are the old add form's (`ItemDetailView.executeSave`),
 * built by `utils/registerItem.ts`.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Camera from 'lucide-react/dist/esm/icons/camera';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Minus from 'lucide-react/dist/esm/icons/minus';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';

import { supabase } from '../../../../lib/supabase';
import { useInventory } from '../../hooks/useInventoryData.ts';
import { INVENTORY_ROOT_KEY, PARTS_BINS_KEY } from '../../hooks/useInventoryRealtime';
import { useLocationManagement } from '../../hooks/useLocationManagement.ts';
import { useConfirmation } from '../../../../context/ConfirmationContext.tsx';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { CameraCaptureSheet } from '../../../../components/ui/CameraCaptureSheet';
import { recognizeLabelClient } from '../../../../lib/recognition/recognizeLabelClient';
import { uploadPhoto } from '../../../../services/photoUpload.service';
import { predictLocation } from '../../../../utils/locationPredictor.ts';
import { skuDefaultsFor } from '../../../../utils/skuDefaults';
import { normalizeSkuOnRegister } from '../../../../utils/skuNormalize';
import { inventoryService } from '../../api/inventory.service.ts';
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
  squaresForRow,
  unitsBySquare,
  REGISTER_FIELDS,
  type RegisterField,
  type RegisterIdentity,
  type RegisterStatus,
} from '../../utils/registerItem';
import type {
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../../schemas/inventory.schema.ts';
import { SdDetailsCard, type SdDetailsValues } from './SdDetailsCard.tsx';

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

const FIELD_LABEL: Record<RegisterField, string> = {
  sku: 'SKU',
  model: 'MODEL',
  size: 'SIZE',
  color: 'COLOR',
  serial: 'SERIAL',
  upc: 'UPC',
};

/** The label's own ink: this is the one light surface on a dark screen (ui-rules 10). */
const PAPER = 'bg-[#F7F5EF] text-[#111214]';
const HEADING = { fontFamily: 'var(--font-heading)' } as const;

const DOT: Partial<Record<RegisterStatus, string>> = {
  read: 'bg-emerald-600',
  choose: 'bg-amber-600',
  missing: 'bg-red-600',
};

const FIXED_SUGGESTIONS = ['RETURN TO STOCK', 'UNKNOWN'];

const EMPTY_SD: SdDetailsValues = {
  category: '',
  condition: '',
  conditionDescription: '',
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
  const { locations } = useLocationManagement();
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
  const [draftValue, setDraftValue] = useState('');
  const [sd, setSd] = useState<SdDetailsValues>(EMPTY_SD);
  const [saving, setSaving] = useState(false);
  const [existsHere, setExistsHere] = useState(false);

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

  // ── Where ────────────────────────────────────────────────────────────────
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

  const locationNames = useMemo(
    () =>
      Array.from(
        new Set((locations ?? []).filter((l) => l.warehouse === warehouse).map((l) => l.location))
      ),
    [locations, warehouse]
  );

  // Where this SKU already is, and where the same model sits: the two places a
  // box of it most likely goes.
  const { data: suggested = [] } = useQuery({
    queryKey: ['register-item', 'suggest', warehouse, sku, model],
    enabled: isOpen && started && (!!sku || !!model),
    staleTime: 60_000,
    queryFn: async () => {
      const out: { location: string; why: string }[] = [];
      const seen = new Set<string>();
      const add = (location: string, why: string) => {
        if (!location || seen.has(location)) return;
        seen.add(location);
        out.push({ location, why });
      };
      if (sku) {
        const { data } = await supabase
          .from('inventory')
          .select('location, quantity')
          .eq('warehouse', warehouse)
          .eq('sku', normalizeSkuOnRegister(sku))
          .gt('quantity', 0)
          .order('quantity', { ascending: false })
          .limit(3);
        for (const r of data ?? []) add(r.location ?? '', 'this SKU');
      }
      if (model) {
        const { data } = await supabase
          .from('inventory')
          .select('location, quantity')
          .eq('warehouse', warehouse)
          .ilike('item_name', `${model}%`)
          .gt('quantity', 0)
          .limit(60);
        const byLoc = new Map<string, number>();
        for (const r of data ?? []) {
          if (!r.location) continue;
          byLoc.set(r.location, (byLoc.get(r.location) ?? 0) + Number(r.quantity ?? 0));
        }
        [...byLoc.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 2)
          .forEach(([l]) => add(l, 'same model'));
      }
      return out;
    },
  });

  const chips = useMemo(() => {
    const list = [...suggested];
    for (const l of FIXED_SUGGESTIONS) {
      if (!list.some((s) => s.location === l)) list.push({ location: l, why: '' });
    }
    return list;
  }, [suggested]);

  const searchResults = useMemo(() => {
    const q = locQuery.trim().toUpperCase();
    if (!q) return [];
    const guess = predictLocation(q, locationNames).bestGuess;
    const hits = locationNames.filter((l) => l.toUpperCase().includes(q)).slice(0, 8);
    return guess && !hits.includes(guess) ? [guess, ...hits.slice(0, 7)] : hits;
  }, [locQuery, locationNames]);

  const isRow = isRowLocation(location);
  const { data: rowLines = [] } = useQuery({
    queryKey: ['register-item', 'row', warehouse, location],
    enabled: isOpen && isRow,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from('inventory')
        .select('sublocation, quantity')
        .eq('warehouse', warehouse)
        .eq('location', location as string)
        .gt('quantity', 0);
      return (data ?? []) as { sublocation: string[] | null; quantity: number | null }[];
    },
  });
  const squareUnits = useMemo(() => unitsBySquare(rowLines), [rowLines]);
  const squares = useMemo(() => squaresForRow(squareUnits.keys()), [squareUnits]);

  const chooseLocation = useCallback((loc: string) => {
    setLocation(loc);
    setSquare(null);
    setLocQuery('');
    // A ROW stays open for its square; anything else is answered.
    if (!isRowLocation(loc)) setWhereOpen(false);
  }, []);

  // Registering where the SKU already is adds to that row — say so before.
  useEffect(() => {
    setExistsHere(false);
    if (!isOpen || !sku || !location) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const exists = await inventoryService.checkExistence(
          normalizeSkuOnRegister(sku),
          location,
          warehouse
        );
        if (!cancelled) setExistsHere(!!exists);
      } catch {
        /* the save still works; the hint is a courtesy */
      }
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isOpen, sku, location, warehouse]);

  // ── Answers ──────────────────────────────────────────────────────────────
  const ready = readiness({ identity, location, quantity });
  const canRegister = ready.blocker === null && !saving && !reading;
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

  const openEditor = (key: RegisterField | 'qty') => {
    setEditing(key);
    setDraftValue(
      key === 'qty' ? (quantity == null ? '' : String(quantity)) : identity.fields[key].value
    );
  };
  const commitEditor = () => {
    if (editing === 'qty') {
      const n = parseInt(draftValue, 10);
      if (!Number.isNaN(n) && n >= 0) setQuantity(n);
    } else if (editing) {
      const key = editing;
      // A size keeps its unit's case (54cm); the trigger canonicalises it.
      const v = key === 'size' ? draftValue : draftValue.toUpperCase();
      setIdentity((id) => settle(id, key, v));
    }
    setEditing(null);
  };

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
        msrp: sd.msrp,
        standard_price: sd.standardPrice,
        pdf_link: text(sd.pdfLink),
      }).filter(([, v]) => v !== null)
    );
    const exact = locationNames.find((l) => l.toUpperCase() === (location ?? '').toUpperCase());
    const write = buildRegisterWrite({
      identity,
      location: exact ?? (location ?? '').toUpperCase(),
      quantity,
      square,
      warehouse,
      itemName: initialData?.item_name,
      sdFields,
    });
    setSaving(true);
    // Inventory first, metadata second, and nothing until the row is in: a
    // catalogue row with no inventory reads as "registered" to every open
    // order (see executeSave in ItemDetailView).
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
    if (write.cartonSerial && serialLooksReal(write.cartonSerial)) {
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
      const updateCache = (imageUrl: string) => {
        const updater = (old: InventoryItemWithMetadata[] | undefined) =>
          old?.map((item) =>
            item.sku === savedSku
              ? {
                  ...item,
                  sku_metadata: {
                    ...(item.sku_metadata ?? { sku: savedSku }),
                    image_url: imageUrl,
                  },
                }
              : item
          );
        queryClient.setQueryData(INVENTORY_ROOT_KEY, updater);
        queryClient.setQueryData(PARTS_BINS_KEY, updater);
      };
      void uploadPhoto(savedSku, photo, updateCache)
        .then((url) => updateCache(`${url}?v=${Date.now()}`))
        .catch(() => toast.error('Photo upload failed'));
    }
    setSaving(false);
    onClose();
  }, [
    canRegister,
    sd,
    locationNames,
    location,
    identity,
    quantity,
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

  // ── Pieces ───────────────────────────────────────────────────────────────
  const field = (key: RegisterField) => {
    const f = identity.fields[key];
    const dot = DOT[f.status];
    const empty = !f.value;
    const big = key === 'sku' ? 'text-2xl tracking-tight' : key === 'model' ? 'text-xl' : 'text-sm';
    return (
      <div key={key}>
        <button
          type="button"
          onClick={() => openEditor(key)}
          className="relative -mx-1 flex w-[calc(100%+0.5rem)] items-baseline gap-2 rounded px-1 py-0.5 text-left active:bg-black/5"
        >
          <span className="w-14 shrink-0 font-mono text-[9.5px] tracking-wider text-[#6B6E73]">
            {FIELD_LABEL[key]}
          </span>
          <span
            className={`min-w-0 break-all ${
              empty
                ? `text-[13px] font-medium ${f.status === 'choose' ? 'text-amber-700' : 'text-red-700'}`
                : `font-bold uppercase text-[#111214] ${big} ${key === 'model' ? '' : 'font-mono'}`
            }`}
            style={key === 'model' && !empty ? HEADING : undefined}
          >
            {empty
              ? f.status === 'choose'
                ? 'pick one'
                : key === 'serial'
                  ? identity.isScratchDent
                    ? 'required for S/D'
                    : 'not on label'
                  : 'tap to add'
              : f.value}
          </span>
          {dot && (
            <span
              className={`absolute right-1 top-1/2 h-[7px] w-[7px] -translate-y-1/2 rounded-full ${dot}`}
            />
          )}
        </button>
        {f.status === 'choose' && f.options && (
          <div className="flex flex-wrap gap-1.5 pb-1.5 pl-16">
            {f.options.map((o) => (
              <button
                key={o}
                type="button"
                onClick={() => setIdentity((id) => settle(id, key, o))}
                className="rounded border-[1.5px] border-dashed border-amber-600 bg-amber-200/40 px-2 py-0.5 font-mono text-[11px] font-bold text-amber-900"
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  const typeButton = (value: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={identity.isBike === value}
      onClick={() => setIdentity((id) => ({ ...id, isBike: value }))}
      className={`px-2.5 py-1 font-mono text-[11px] font-bold ${
        identity.isBike === value
          ? 'bg-[#111214] text-[#F7F5EF]'
          : identity.isBike === null
            ? 'animate-pulse bg-amber-300/50 text-[#111214]'
            : 'text-[#111214]'
      }`}
    >
      {label}
    </button>
  );

  const label = (
    <section
      aria-label="Carton label"
      className={`${PAPER} relative rounded-md p-3.5 shadow-[0_12px_30px_rgba(0,0,0,0.35)]`}
    >
      <div className="pointer-events-none absolute inset-1.5 rounded-sm border-[1.5px] border-[#111214]/85" />
      <div className="relative flex items-start justify-between gap-2">
        <span className="text-[11px] font-extrabold tracking-[0.22em]" style={HEADING}>
          JAMIS BIKES
        </span>
        <div
          role="group"
          aria-label="Bike or part"
          className="flex overflow-hidden rounded border-[1.5px] border-[#111214]"
        >
          {typeButton(true, 'BIKE')}
          {typeButton(false, 'PART')}
        </div>
      </div>
      <div className="relative mt-2.5 flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {REGISTER_FIELDS.map((k) => field(k))}
        </div>
        <button
          type="button"
          onClick={() => setCameraOpen(true)}
          aria-label={photo ? 'Shoot the label again' : 'Shoot the label'}
          className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm border-[1.5px] border-[#111214] bg-black/5"
        >
          {photoUrl ? (
            <img src={photoUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Camera size={20} className="text-[#6B6E73]" />
          )}
        </button>
      </div>
      <div className="relative mt-2 flex items-end justify-between">
        <div
          aria-hidden
          className="h-6 max-w-[180px] flex-1"
          style={{
            background:
              'repeating-linear-gradient(90deg,#111214 0 2px,transparent 2px 3px,#111214 3px 4px,transparent 4px 7px,#111214 7px 10px,transparent 10px 11px)',
          }}
        />
        <button
          type="button"
          onClick={toggleSd}
          aria-pressed={identity.isScratchDent}
          className={`rounded border-[1.5px] border-[#111214] px-2 py-0.5 font-mono text-[11px] font-bold ${
            identity.isScratchDent ? 'bg-[#111214] text-[#F7F5EF]' : 'text-[#111214]'
          }`}
        >
          {identity.isScratchDent ? 'S/D' : 'NEW'}
        </button>
      </div>
    </section>
  );

  const whereText = location ? `${location}${square ? ` · ${square}` : ''}` : 'Where?';
  const tiles = (
    <div className="grid grid-cols-2 gap-2.5">
      <button
        type="button"
        onClick={() => setWhereOpen((v) => !v)}
        className={`flex min-w-0 flex-col gap-1.5 rounded-2xl border bg-[#161920] px-3.5 py-3 text-left ${
          whereOpen
            ? 'border-white'
            : location
              ? 'border-[#2A2F36]'
              : 'border-dashed border-[#2A2F36]'
        }`}
      >
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">Where</span>
        <span
          className={`break-words font-extrabold leading-none tracking-tight ${
            location ? 'text-white' : 'text-white/40'
          } ${whereText.length > 10 ? 'text-2xl' : 'text-3xl'}`}
          style={HEADING}
        >
          {whereText}
        </span>
        <span className="text-xs text-white/45">
          {!location ? 'pick a place' : isRow && !square ? 'tap a square' : 'tap to change'}
        </span>
      </button>
      <div
        className={`flex min-w-0 flex-col gap-1.5 rounded-2xl border bg-[#161920] px-3.5 py-3 ${
          quantity == null ? 'border-dashed border-[#2A2F36]' : 'border-[#2A2F36]'
        }`}
      >
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">How many</span>
        <div className="flex items-center justify-between gap-1">
          <button
            type="button"
            aria-label="One less"
            onClick={() => setQuantity((q) => Math.max(0, (q ?? 1) - 1))}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#2A2F36] bg-[#0F1115] text-white/80 active:scale-95"
          >
            <Minus size={18} />
          </button>
          <button
            type="button"
            onClick={() => openEditor('qty')}
            className={`min-w-0 text-center text-5xl font-extrabold leading-none tabular-nums ${
              quantity == null ? 'text-white/40' : 'text-violet-300'
            }`}
            style={HEADING}
          >
            {quantity ?? '?'}
          </button>
          <button
            type="button"
            aria-label="One more"
            onClick={() => setQuantity((q) => (q ?? 0) + 1)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#2A2F36] bg-[#0F1115] text-white/80 active:scale-95"
          >
            <Plus size={18} />
          </button>
        </div>
      </div>
    </div>
  );

  const picker = whereOpen && (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-white bg-[#161920] p-3">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <button
            key={c.location}
            type="button"
            aria-pressed={location === c.location}
            onClick={() => chooseLocation(c.location)}
            className={`rounded-full border px-3 py-1.5 font-mono text-xs font-bold ${
              location === c.location
                ? 'border-white bg-white text-[#0F1115]'
                : 'border-[#2A2F36] bg-[#0F1115] text-white'
            }`}
          >
            {c.location}
            {c.why && (
              <span
                className={`ml-1 font-medium ${location === c.location ? 'text-black/60' : 'text-white/45'}`}
              >
                {c.why}
              </span>
            )}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 rounded-xl border border-[#2A2F36] bg-[#0F1115] px-3 py-2">
        <Search size={14} className="text-white/40" />
        <input
          value={locQuery}
          onChange={(e) => setLocQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && locQuery.trim()) {
              chooseLocation(searchResults[0] ?? locQuery.trim().toUpperCase());
            }
          }}
          placeholder="Other location…"
          aria-label="Search location"
          className="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase text-white placeholder:normal-case placeholder:text-white/30 focus:outline-none"
        />
      </label>
      {searchResults.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {searchResults.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => chooseLocation(l)}
              className="rounded-full border border-[#2A2F36] bg-[#0F1115] px-3 py-1.5 font-mono text-xs font-bold text-white"
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {isRow && (
        <>
          <span className="text-xs text-white/45">
            {location} — tap a square. The number is what is there now.
          </span>
          <div
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${squares.length}, minmax(0, 1fr))` }}
          >
            {squares.map((l) => {
              const n = squareUnits.get(l) ?? 0;
              const on = square === l;
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setSquare(on ? null : l);
                    if (!on) setWhereOpen(false);
                  }}
                  className={`flex aspect-[1/1.25] min-w-0 flex-col items-center justify-center rounded-md border font-mono ${
                    on
                      ? 'border-violet-300 bg-violet-300 text-[#0F1115]'
                      : 'border-[#2A2F36] bg-[#0F1115] text-white'
                  }`}
                >
                  <b className="text-xs">{l}</b>
                  <span
                    className={`text-[9px] ${
                      on ? 'text-black/70' : n >= 30 ? 'text-amber-400' : 'text-white/45'
                    }`}
                  >
                    {n || '·'}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  const defaults = skuDefaultsFor(identity.isBike === true);
  const weight = identity.labelWeightLbs ?? defaults.weight_lbs;
  const carton = identity.isBike !== null && (
    <div className="flex items-center gap-3 rounded-2xl border border-[#2A2F36] bg-[#161920] px-3.5 py-3">
      <span className="min-w-0 flex-1 font-mono text-sm font-bold text-white">
        {identity.isBike ? (
          <>
            {defaults.length_in} × {defaults.width_in} × {defaults.height_in}{' '}
            <span className="font-medium text-white/45">in</span> · {weight} lb
          </>
        ) : (
          <>
            {weight} lb <span className="font-medium text-white/45">· no box size</span>
          </>
        )}
      </span>
      <span
        className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider ${
          identity.labelWeightLbs != null
            ? 'border border-emerald-400/40 text-emerald-400'
            : 'border border-dashed border-[#2A2F36] text-white/45'
        }`}
      >
        {identity.labelWeightLbs != null ? 'LABEL G.W.' : 'DEFAULT'}
      </span>
    </div>
  );

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
          openEditor('sku');
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
            {label}
            {tiles}
            {picker}
            {existsHere && (
              <p className="text-xs text-amber-400">
                Already in {location} — the units are added to that row.
              </p>
            )}
            {carton}
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
                  {ready.blocker && (
                    <span className="font-mono text-xs font-medium">· {ready.blocker}?</span>
                  )}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {editing && (
        <div
          className="fixed inset-0 z-[190] flex items-end justify-center bg-black/55"
          onClick={() => setEditing(null)}
        >
          <form
            className="flex w-full max-w-[430px] flex-col gap-3 rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              commitEditor();
            }}
          >
            <label
              htmlFor="register-field"
              className="text-[10.5px] uppercase tracking-[0.14em] text-white/45"
            >
              {editing === 'qty' ? 'How many' : FIELD_LABEL[editing]}
            </label>
            <input
              id="register-field"
              autoFocus
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              inputMode={editing === 'qty' ? 'numeric' : 'text'}
              autoComplete="off"
              autoCapitalize="characters"
              className="w-full rounded-xl border border-white bg-[#0F1115] p-3.5 font-mono text-xl font-bold uppercase text-white focus:outline-none"
            />
            {editing === 'serial' && (
              <span className="text-xs text-white/45">
                {identity.isScratchDent
                  ? 'An S/D keeps this serial in the catalogue.'
                  : 'Filed for this carton only, not for every box of the SKU.'}
              </span>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="flex-1 rounded-xl border border-[#2A2F36] py-3 font-semibold text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 rounded-xl bg-white py-3 font-semibold text-[#0F1115]"
              >
                Done
              </button>
            </div>
          </form>
        </div>
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
