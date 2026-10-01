/**
 * An existing item, on the same carton label it was registered on
 * (docs/prds/item-detail-register.md, F2).
 *
 * No Edit / View switch: tapping a value edits it, every change waits with an
 * amber dot and says what it was, and the bar appears only when something
 * changed — `SAVE · n changes`, or undo them all. The rest of the item is facts
 * under «Also»: where else the SKU is, who has it reserved, what moved it last.
 * The occasional lives in ⋯. The row is saved through `updateItem` (move,
 * consolidate, rename — unchanged) and the catalogue with only what changed
 * (`utils/itemCardEdit.ts`). A tape or a scale saves on its own, through the
 * same mutation Measure and Double Check use, because a measurement is a fact
 * the moment it is read, not a pending edit.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import MoreHorizontal from 'lucide-react/dist/esm/icons/more-horizontal';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';

import { supabase } from '../../../../lib/supabase';
import { useInventory } from '../../hooks/useInventoryData.ts';
import { INVENTORY_ROOT_KEY, PARTS_BINS_KEY } from '../../hooks/useInventoryRealtime';
import { useConfirmation } from '../../../../context/ConfirmationContext.tsx';
import { useScrollLock } from '../../../../hooks/useScrollLock';
import { CameraCaptureSheet } from '../../../../components/ui/CameraCaptureSheet';
import { uploadPhoto, deletePhoto } from '../../../../services/photoUpload.service';
import { normalizeSkuOnRegister } from '../../../../utils/skuNormalize';
import { skuDefaultsFor } from '../../../../utils/skuDefaults';
import { useUpdateCartonDimensions } from '../../../picking/hooks/useUpdateCartonDimensions';
import {
  useStockReservations,
  buildReservationKey,
} from '../../../picking/hooks/useStockReservations';
import {
  fetchSkuUpc,
  printNeedsOptions,
  usePrintSkuLabels,
} from '../../../labels/hooks/usePrintSkuLabels';
import {
  LabelPrintOptionsModal,
  type LabelPrintResult,
} from '../../../labels/components/LabelPrintOptionsModal';
import type {
  DistributionItem,
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../../schemas/inventory.schema.ts';
import type { InventoryLog } from '../../../../schemas/log.schema';
import {
  buildItemCardWrite,
  itemCardBaseline,
  itemCardChanges,
  type ItemCardMeta,
  type ItemCardState,
} from '../../utils/itemCardEdit';
import { isRowLocation, REGISTER_FIELDS, type RegisterField } from '../../utils/registerItem';
import { SdDetailsCard } from './SdDetailsCard.tsx';
import { SectionEditorSheet } from './SectionEditorSheet.tsx';
import { ItemHistorySheet, getActionInfo, getDisplayQty } from './ItemHistorySheet.tsx';
import {
  CartonLabel,
  CartonLine,
  FieldSheet,
  HowManyTile,
  WherePicker,
  WhereTile,
  type LabelFieldView,
} from './ItemCardParts.tsx';
import { FIELD_LABEL, useExistsAt, useWhereChoices, whereText } from './itemCardShared';

interface ItemCardViewProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: InventoryItemInput) => void | Promise<void>;
  onDelete?: () => void;
  item: InventoryItemWithMetadata;
}

const META_COLUMNS =
  'is_bike, is_scratch_dent, model, size, color, serial_number, upc, category, condition, condition_description, msrp, standard_price, pdf_link, sd_number, image_url, length_in, width_in, height_in, weight_lbs, dimensions_verified, weight_verified';

const DEFAULT_UNITS: Record<string, number> = { TOWER: 30, LINE: 5, PALLET: 10, OTHER: 1 };
const RECENT_PICK_MS = 24 * 60 * 60 * 1000;

type Sheet =
  | { kind: 'field'; key: RegisterField }
  | { kind: 'qty' }
  | { kind: 'note' }
  | { kind: 'carton' }
  | null;

const relative = (iso: string | Date) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
};

export const ItemCardView: React.FC<ItemCardViewProps> = ({
  isOpen,
  onClose,
  onSave,
  onDelete,
  item,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { ludlowData, atsData, updateSKUMetadata } = useInventory();
  const { showConfirmation } = useConfirmation();
  const measure = useUpdateCartonDimensions();
  const warehouse = item.warehouse || 'LUDLOW';

  // The Stock list does not carry every catalogue column; saving one the card
  // never loaded would write over a real value, so the card reads its own.
  const { data: meta, refetch: refetchMeta } = useQuery({
    queryKey: ['item-card', 'meta', item.sku],
    enabled: isOpen && !!item.sku,
    staleTime: 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('sku_metadata')
        .select(META_COLUMNS)
        .eq('sku', item.sku)
        .maybeSingle();
      return (data ?? null) as
        | (ItemCardMeta & { sd_number?: number | null; image_url?: string | null })
        | null;
    },
  });

  const [base, setBase] = useState<ItemCardState>(() => itemCardBaseline(item, null));
  const [cur, setCur] = useState<ItemCardState>(base);
  const [metaReady, setMetaReady] = useState(false);
  const initialDistribution = useMemo(
    () => (Array.isArray(item.distribution) ? item.distribution : []),
    [item.distribution]
  );
  const [distribution, setDistribution] = useState<DistributionItem[]>(initialDistribution);

  // The catalogue arrives after the first paint; until anything is touched the
  // card follows it, so the baseline is what the database says.
  useEffect(() => {
    if (meta === undefined || metaReady) return;
    const b = itemCardBaseline(item, meta);
    setBase(b);
    setCur(b);
    setMetaReady(true);
  }, [meta, metaReady, item]);

  const [photoUrl, setPhotoUrl] = useState<string | null>(item.sku_metadata?.image_url ?? null);
  useEffect(() => {
    if (meta?.image_url !== undefined) setPhotoUrl(meta.image_url ?? null);
  }, [meta?.image_url]);
  const [uploading, setUploading] = useState(false);

  const [whereOpen, setWhereOpen] = useState(false);
  const [locQuery, setLocQuery] = useState('');
  const [sheet, setSheet] = useState<Sheet>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [distOpen, setDistOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const changes = useMemo(() => itemCardChanges(base, cur), [base, cur]);
  const distChanged = JSON.stringify(distribution) !== JSON.stringify(initialDistribution);
  const changeCount = changes.length + (distChanged ? 1 : 0);
  const renamed = normalizeSkuOnRegister(cur.fields.sku) !== item.sku;

  // ── Where ────────────────────────────────────────────────────────────────
  const choices = useWhereChoices({
    enabled: isOpen,
    warehouse,
    sku: item.sku,
    model: cur.fields.model,
    location: cur.location,
    query: locQuery,
  });
  const whereChanged = changes.includes('where');
  const sameLocation = cur.location.toUpperCase() === base.location.toUpperCase();
  const consolidates = useExistsAt(
    isOpen && whereChanged && !sameLocation,
    cur.fields.sku,
    cur.location,
    warehouse,
    item.id
  );

  // ── Facts ────────────────────────────────────────────────────────────────
  const elsewhere = useMemo(() => {
    const sku = (item.sku || '').trim();
    return [...ludlowData, ...atsData]
      .filter((i) => (i.sku || '').trim() === sku && i.id !== item.id && (i.quantity || 0) > 0)
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0));
  }, [item.sku, item.id, ludlowData, atsData]);
  const totalUnits =
    elsewhere.reduce((sum, i) => sum + (i.quantity || 0), 0) + Number(item.quantity || 0);

  const reservationKey = buildReservationKey(item.sku, warehouse, item.location ?? '');
  const { data: reservations } = useStockReservations(
    isOpen && item.location ? [reservationKey] : [],
    null
  );
  const holds = useMemo(() => {
    const info = reservations?.get(reservationKey);
    if (!info) return [];
    return info.reservingOrders
      .filter(
        (o) => !o.picked || (o.pickedAt && Date.now() - Date.parse(o.pickedAt) < RECENT_PICK_MS)
      )
      .sort((a, b) => (b.qty || 0) - (a.qty || 0));
  }, [reservations, reservationKey]);

  const { data: logs = [] } = useQuery({
    queryKey: ['inventory_logs', 'item-card', item.sku],
    enabled: isOpen && !!item.sku,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_inventory_logs_for_sku', {
        p_sku: item.sku,
        p_limit: 4,
      });
      if (error) throw error;
      return (data || []) as unknown as InventoryLog[];
    },
  });

  // ── Closing ──────────────────────────────────────────────────────────────
  const requestClose = useCallback(() => {
    if (changeCount === 0) return onClose();
    showConfirmation(
      'Unsaved changes',
      `${changeCount} change${changeCount > 1 ? 's' : ''} not saved. Discard and close?`,
      () => onClose(),
      undefined,
      'Discard',
      'Keep editing',
      'warning'
    );
  }, [changeCount, onClose, showConfirmation]);
  useScrollLock(isOpen, requestClose);

  // ── Edits ────────────────────────────────────────────────────────────────
  const patch = (fn: (c: ItemCardState) => ItemCardState) => setCur((c) => fn(c));
  const setField = (key: RegisterField, value: string) =>
    patch((c) => ({ ...c, fields: { ...c.fields, [key]: value.trim() } }));

  const toggleSd = () => {
    const next = !cur.isScratchDent;
    if (next && totalUnits > 1) {
      showConfirmation(
        'Mark as S/D',
        `This SKU holds ${totalUnits} units. An S/D unit is one serialized unit with its own unique SKU. Mark it S/D anyway?`,
        () => patch((c) => ({ ...c, isScratchDent: true })),
        undefined,
        'Mark S/D',
        'Cancel',
        'warning'
      );
      return;
    }
    patch((c) => ({ ...c, isScratchDent: next }));
  };

  const chooseLocation = (loc: string) => {
    const resolved = choices.resolve(loc);
    patch((c) => ({
      ...c,
      location: resolved,
      // Back to its own row: keep its squares; anywhere else starts unsquared.
      squares: resolved.toUpperCase() === base.location.toUpperCase() ? base.squares : [],
    }));
    setLocQuery('');
    if (!isRowLocation(resolved)) setWhereOpen(false);
  };

  // ── Distribution (⋯) ─────────────────────────────────────────────────────
  const addDistributionRow = () => {
    const placed = distribution.reduce((sum, d) => sum + d.count * d.units_each, 0);
    const remaining = cur.quantity - placed;
    const type = distribution.length ? distribution[distribution.length - 1].type : 'LINE';
    const unitsEach = remaining <= 0 ? 1 : Math.min(DEFAULT_UNITS[type] || 1, remaining);
    setDistribution((prev) => [...prev, { type, count: 1, units_each: unitsEach }]);
  };
  const updateDistributionRow = (
    index: number,
    field: keyof DistributionItem,
    value: string | number
  ) =>
    setDistribution((prev) =>
      prev.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [field]: value } as DistributionItem;
        if (field === 'type' && typeof value === 'string' && DEFAULT_UNITS[value]) {
          next.units_each = DEFAULT_UNITS[value];
        }
        return next;
      })
    );

  // ── Photo (saves on its own, as before) ──────────────────────────────────
  const updatePhotoCache = useCallback(
    (imageUrl: string | null) => {
      const updater = (old: InventoryItemWithMetadata[] | undefined) =>
        old?.map((row) =>
          row.sku === item.sku
            ? {
                ...row,
                sku_metadata: { ...(row.sku_metadata ?? { sku: item.sku }), image_url: imageUrl },
              }
            : row
        );
      queryClient.setQueryData(INVENTORY_ROOT_KEY, updater);
      queryClient.setQueryData(PARTS_BINS_KEY, updater);
    },
    [item.sku, queryClient]
  );

  const takePhoto = async (file: File) => {
    const previous = photoUrl;
    setPhotoUrl(URL.createObjectURL(file));
    setUploading(true);
    try {
      const url = await uploadPhoto(item.sku, file, (thumb) => updatePhotoCache(thumb));
      const bust = `${url}?v=${Date.now()}`;
      setPhotoUrl(bust);
      updatePhotoCache(bust);
      toast.success('Photo uploaded');
    } catch {
      setPhotoUrl(previous);
      toast.error('Photo upload failed');
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = async () => {
    setUploading(true);
    try {
      await deletePhoto(item.sku);
      setPhotoUrl(null);
      updatePhotoCache(null);
      toast.success('Photo removed');
    } catch {
      toast.error('Failed to remove photo');
    } finally {
      setUploading(false);
    }
  };

  // ── Print ────────────────────────────────────────────────────────────────
  const [printOpen, setPrintOpen] = useState(false);
  const [printHasUpc, setPrintHasUpc] = useState(false);
  const [sdNumber, setSdNumber] = useState<number | null>(null);
  useEffect(() => {
    if (meta?.sd_number !== undefined) setSdNumber(meta.sd_number ?? null);
  }, [meta?.sd_number]);
  const { print: printSkuLabels, isGenerating } = usePrintSkuLabels();

  const printLabels = useCallback(
    async (opts: LabelPrintResult) => {
      if (opts.quantity < 1) return;
      const printed = await printSkuLabels({
        sku: item.sku,
        location: item.location ?? null,
        stock: item.quantity ?? 0,
        quantity: opts.quantity,
        withUpc: opts.withUpc,
        overrides: {
          itemName: item.item_name ?? '',
          model: cur.fields.model,
          size: cur.fields.size,
          color: cur.fields.color,
          serialNumber: cur.fields.serial,
        },
      });
      const own = printed.sdNumbers.get(item.sku);
      if (own != null) setSdNumber(own);
      if (printed.count > 0) setPrintOpen(false);
    },
    [item, cur.fields, printSkuLabels]
  );

  const openPrint = async () => {
    const upc = await fetchSkuUpc(item.sku);
    if (!printNeedsOptions(upc !== null, item.quantity ?? 0)) {
      await printLabels({ withUpc: false, quantity: 1 });
      return;
    }
    setPrintHasUpc(upc !== null);
    setPrintOpen(true);
  };

  // ── Save ─────────────────────────────────────────────────────────────────
  const renameConflict =
    renamed &&
    ludlowData.some(
      (i) => i.sku === normalizeSkuOnRegister(cur.fields.sku) && String(i.id) !== String(item.id)
    );
  const blocker = !cur.fields.sku
    ? 'SKU'
    : renameConflict
      ? 'SKU already exists'
      : !cur.location
        ? 'Where'
        : cur.isScratchDent && !cur.fields.serial
          ? 'Serial (S/D)'
          : null;

  const executeSave = useCallback(async () => {
    const write = buildItemCardWrite({
      original: item,
      meta: meta ?? null,
      base,
      cur,
      distribution,
    });
    setSaving(true);
    try {
      if (write.metadata) {
        await updateSKUMetadata(write.metadata).catch((e: unknown) =>
          console.error('Metadata update failed:', e)
        );
      }
      await onSave(write.item);
    } catch {
      setSaving(false);
      return; // the mutation toasted; the card stays to fix it
    }
    setSaving(false);
    onClose();
  }, [item, meta, base, cur, distribution, updateSKUMetadata, onSave, onClose]);

  const save = () => {
    if (blocker || saving) return;
    if (renamed) {
      showConfirmation(
        'Identity Change (SKU)',
        `Rename "${item.sku}" to "${normalizeSkuOnRegister(cur.fields.sku)}"?\nThis will update or merge the product row.`,
        () => void executeSave(),
        undefined,
        'Rename',
        'Cancel'
      );
      return;
    }
    void executeSave();
  };

  const undoAll = () => {
    setCur(base);
    setDistribution(initialDistribution);
    setWhereOpen(false);
  };

  if (!isOpen) return null;

  // ── Pieces ───────────────────────────────────────────────────────────────
  const fields = Object.fromEntries(
    REGISTER_FIELDS.map((k) => [
      k,
      { value: cur.fields[k], status: 'given', changed: changes.includes(k) } as LabelFieldView,
    ])
  ) as Record<RegisterField, LabelFieldView>;

  const m = meta ?? null;
  const defaults = skuDefaultsFor(cur.isBike);
  const delta = cur.quantity - base.quantity;

  const facts: React.ReactNode[] = [];
  for (const row of elsewhere) {
    facts.push(
      <div
        key={`loc-${row.id}`}
        className="flex items-center gap-3 border-b border-[#2A2F36] py-2.5"
      >
        <span
          className="w-12 shrink-0 text-right text-xl font-extrabold tabular-nums"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {row.quantity}
        </span>
        <span className="min-w-0 flex-1">
          <b className="font-mono text-[13px] text-white">
            {whereText(row.location ?? '—', Array.isArray(row.sublocation) ? row.sublocation : [])}
          </b>
          <span className="block truncate text-xs text-white/45">
            {row.warehouse !== warehouse ? `${row.warehouse} · ` : ''}
            {row.internal_note || 'same SKU, another place'}
          </span>
        </span>
      </div>
    );
  }
  for (const o of holds) {
    facts.push(
      <button
        key={`hold-${o.listId}`}
        type="button"
        onClick={() => {
          onClose();
          navigate(`/ship?o=${encodeURIComponent(o.orderNumber)}`);
        }}
        className="flex w-full items-center gap-3 border-b border-[#2A2F36] py-2.5 text-left"
      >
        <span
          className={`w-12 shrink-0 text-right text-xl font-extrabold tabular-nums ${o.picked ? 'text-red-400' : 'text-amber-400'}`}
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {o.qty}
        </span>
        <span className="min-w-0 flex-1">
          <b className="font-mono text-[13px] text-white">#{o.orderNumber}</b>
          <span className="block truncate text-xs text-white/45">
            {o.picked
              ? 'picked today'
              : o.isWaiting
                ? 'reserved · waiting'
                : 'reserved by an open order'}
            {o.customerName ? ` · ${o.customerName}` : ''}
          </span>
        </span>
        <ChevronRight size={16} className="text-white/30" />
      </button>
    );
  }
  for (const log of logs) {
    const info = getActionInfo(log.action_type, log);
    const qty = getDisplayQty(log);
    const sign = log.action_type === 'DEDUCT' ? '−' : log.action_type === 'ADD' ? '+' : '';
    facts.push(
      <button
        key={`log-${log.id}`}
        type="button"
        onClick={() => setHistoryOpen(true)}
        className={`flex w-full items-center gap-3 border-b border-[#2A2F36] py-2.5 text-left ${log.is_reversed ? 'opacity-40' : ''}`}
      >
        <span
          className="w-12 shrink-0 text-right text-xl font-extrabold tabular-nums text-white/80"
          style={{ fontFamily: 'var(--font-heading)' }}
        >
          {sign}
          {qty}
        </span>
        <span className="min-w-0 flex-1">
          <b className="font-mono text-[13px] text-white">
            {info.label}
            {log.order_number && !info.label.includes(log.order_number)
              ? ` · #${log.order_number}`
              : ''}
            {log.action_type === 'MOVE' ? ` → ${log.to_location ?? '—'}` : ''}
          </b>
          <span className="block truncate text-xs text-white/45">
            {relative(log.created_at)}
            {log.performed_by ? ` · ${log.performed_by}` : ''}
          </span>
        </span>
        <ChevronRight size={16} className="text-white/30" />
      </button>
    );
  }

  const menuItem = (label: string, action: () => void, danger = false) => (
    <button
      type="button"
      onClick={() => {
        setMenuOpen(false);
        action();
      }}
      className={`w-full px-4 py-3 text-left text-sm hover:bg-white/5 ${danger ? 'text-red-400' : 'text-white/85'}`}
    >
      {label}
    </button>
  );

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
        <span className="flex-1 text-[13px] uppercase tracking-[0.1em] text-white/45">Item</span>
        {uploading && <Loader2 size={16} className="animate-spin text-white/45" />}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="More"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#2A2F36] text-white/80"
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[200px] overflow-hidden rounded-xl border border-[#2A2F36] bg-[#161920] shadow-xl">
                {menuItem('Print label', () => void openPrint())}
                {menuItem(photoUrl ? 'Change photo' : 'Add photo', () => setCameraOpen(true))}
                {photoUrl && menuItem('Remove photo', () => void removePhoto())}
                {menuItem('Shelf note', () => setSheet({ kind: 'note' }))}
                {cur.isBike && menuItem('Distribution', () => setDistOpen(true))}
                {menuItem('Rename SKU', () => setSheet({ kind: 'field', key: 'sku' }))}
                {menuItem(cur.isScratchDent ? 'Back to NEW' : 'Mark as S/D', toggleSd)}
                {menuItem('Full history', () => setHistoryOpen(true))}
                {onDelete &&
                  menuItem(
                    'Delete',
                    () =>
                      showConfirmation(
                        'Delete Item',
                        'Are you sure you want to delete this item?',
                        () => {
                          onDelete();
                          onClose();
                        }
                      ),
                    true
                  )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mx-auto flex max-w-[430px] flex-col gap-3.5 px-4 pb-48 pt-4">
        <CartonLabel
          fields={fields}
          isBike={cur.isBike}
          isScratchDent={cur.isScratchDent}
          sdNumber={cur.isScratchDent && base.isScratchDent ? sdNumber : null}
          photoUrl={photoUrl}
          emptyText={(k) =>
            k === 'serial' && cur.isScratchDent ? 'required for S/D' : 'tap to add'
          }
          onField={(key) => setSheet({ kind: 'field', key })}
          onChoose={setField}
          onType={(isBike) => patch((c) => ({ ...c, isBike }))}
          onSd={toggleSd}
          onPhoto={() => setCameraOpen(true)}
          typeChanged={changes.includes('type')}
          sdChanged={changes.includes('sd')}
          hideSerial={!cur.isScratchDent && cur.quantity > 1}
        />

        <div className="grid grid-cols-2 gap-2.5">
          <WhereTile
            location={cur.location || null}
            squares={cur.squares}
            open={whereOpen}
            onToggle={() => setWhereOpen((v) => !v)}
            changed={whereChanged}
            sub={
              whereChanged
                ? `was ${whereText(base.location, base.squares)}`
                : isRowLocation(cur.location) && cur.squares.length === 0
                  ? 'tap a square'
                  : 'tap to move'
            }
          />
          <HowManyTile
            quantity={cur.quantity}
            onChange={(n) => patch((c) => ({ ...c, quantity: n }))}
            onTap={() => setSheet({ kind: 'qty' })}
            delta={delta}
          />
        </div>

        {whereOpen && (
          <WherePicker
            choices={choices}
            location={cur.location}
            selected={cur.squares}
            current={sameLocation ? base.squares : []}
            query={locQuery}
            onQuery={setLocQuery}
            onLocation={chooseLocation}
            onSquare={(l) => {
              const on = cur.squares.length === 1 && cur.squares[0] === l;
              patch((c) => ({ ...c, squares: on ? [] : [l] }));
              if (!on) setWhereOpen(false);
            }}
          />
        )}
        {consolidates && (
          <p className="text-xs text-amber-400">
            Already in {cur.location} — the stock is consolidated into that row.
          </p>
        )}
        {renameConflict && (
          <p className="text-xs text-red-400">
            {normalizeSkuOnRegister(cur.fields.sku)} already exists in this warehouse. Cannot
            rename.
          </p>
        )}

        <CartonLine
          isBike={cur.isBike}
          dims={{
            length: m?.length_in ?? defaults.length_in,
            width: m?.width_in ?? defaults.width_in,
            height: m?.height_in ?? defaults.height_in,
          }}
          weight={m?.weight_lbs ?? defaults.weight_lbs}
          dimsTruth={m?.dimensions_verified ? 'MEASURED' : 'DEFAULT'}
          weightTruth={m?.weight_verified ? 'WEIGHED' : 'DEFAULT'}
          onTap={() => setSheet({ kind: 'carton' })}
        />

        {cur.isScratchDent && (
          <SdDetailsCard
            isEditing
            values={cur.sd}
            onChange={(key, value) => patch((c) => ({ ...c, sd: { ...c.sd, [key]: value } }))}
          />
        )}

        {cur.note && (
          <button
            type="button"
            onClick={() => setSheet({ kind: 'note' })}
            className={`border-l-2 pl-2.5 text-left text-xs ${changes.includes('note') ? 'border-amber-400 text-amber-200' : 'border-[#2A2F36] text-white/55'}`}
          >
            Shelf note · {cur.note}
          </button>
        )}

        {facts.length > 0 && (
          <section className="flex flex-col">
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">Also</span>
            <div className="mt-1 flex flex-col border-t border-[#2A2F36]">{facts}</div>
          </section>
        )}
      </div>

      {changeCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 bg-gradient-to-t from-[#0F1115] from-70% to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <div className="mx-auto flex max-w-[430px] flex-col gap-2">
            <button
              type="button"
              disabled={!!blocker || saving}
              onClick={save}
              className="flex h-14 w-full items-baseline justify-center gap-2.5 rounded-2xl bg-amber-400 pt-4 font-bold text-[#3b2400] active:scale-[0.99] disabled:border disabled:border-[#2A2F36] disabled:bg-[#161920] disabled:text-white/45"
            >
              {saving ? (
                <Loader2 size={18} className="animate-spin self-center" />
              ) : (
                <>
                  Save
                  <span className="font-mono text-xs font-bold opacity-75">
                    {blocker
                      ? `· ${blocker}?`
                      : `${changeCount} change${changeCount > 1 ? 's' : ''}`}
                  </span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={undoAll}
              className="self-center text-sm text-white/45 underline underline-offset-4"
            >
              Undo all
            </button>
          </div>
        </div>
      )}

      {sheet?.kind === 'field' && (
        <FieldSheet
          label={sheet.key === 'sku' ? 'Rename SKU' : FIELD_LABEL[sheet.key]}
          initial={cur.fields[sheet.key]}
          keepCase={sheet.key === 'size'}
          hint={
            sheet.key === 'sku'
              ? 'Renaming moves this row and its history to the new name. You confirm on Save.'
              : sheet.key === 'serial'
                ? 'The catalogue keeps one serial per SKU: it is for an S/D unit.'
                : undefined
          }
          onCancel={() => setSheet(null)}
          onDone={(value) => {
            setField(sheet.key, value);
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'qty' && (
        <FieldSheet
          label="How many"
          initial={String(cur.quantity)}
          numeric
          onCancel={() => setSheet(null)}
          onDone={(value) => {
            const n = parseInt(value, 10);
            if (!Number.isNaN(n) && n >= 0) patch((c) => ({ ...c, quantity: n }));
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'note' && (
        <FieldSheet
          label="Shelf note"
          initial={cur.note}
          multiline
          hint="Where on the shelf, what is in front of it."
          onCancel={() => setSheet(null)}
          onDone={(value) => {
            patch((c) => ({ ...c, note: value.trim() }));
            setSheet(null);
          }}
        />
      )}
      {sheet?.kind === 'carton' && (
        <CartonSheet
          isBike={cur.isBike}
          busy={measure.isPending}
          onCancel={() => setSheet(null)}
          onSave={async (sides, weightLbs) => {
            await measure.mutateAsync({ sku: item.sku, sides, weightLbs });
            await refetchMeta();
            toast.success('Measurement saved');
            setSheet(null);
          }}
        />
      )}

      <SectionEditorSheet
        isOpen={distOpen}
        onClose={() => setDistOpen(false)}
        distribution={distribution}
        quantity={cur.quantity}
        onAdd={addDistributionRow}
        onRemove={(index) => setDistribution((prev) => prev.filter((_, i) => i !== index))}
        onUpdate={updateDistributionRow}
      />
      <ItemHistorySheet isOpen={historyOpen} onClose={() => setHistoryOpen(false)} sku={item.sku} />
      {printOpen && (
        <LabelPrintOptionsModal
          title={`Print labels — ${item.sku}`}
          showQuantity
          initialQuantity={1}
          allQuantity={item.quantity ?? undefined}
          hasUpc={printHasUpc}
          isBusy={isGenerating}
          onClose={() => setPrintOpen(false)}
          onConfirm={printLabels}
        />
      )}
      {cameraOpen && (
        <CameraCaptureSheet
          onCapture={(file) => {
            setCameraOpen(false);
            void takePhoto(file);
          }}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </div>,
    document.body
  );
};

/**
 * The tape and the scale. Either half saves alone (a scale without a tape is a
 * trip worth the same); a half-typed set of sides is refused.
 */
const CartonSheet: React.FC<{
  isBike: boolean;
  busy: boolean;
  onCancel: () => void;
  onSave: (
    sides: [number, number, number] | undefined,
    weightLbs: number | undefined
  ) => Promise<void>;
}> = ({ isBike, busy, onCancel, onSave }) => {
  const [sides, setSides] = useState(['', '', '']);
  const [weight, setWeight] = useState('');
  const nums = sides.map((v) => parseFloat(v));
  const sidesTyped = sides.filter((v) => v.trim()).length;
  const sidesOk = sidesTyped === 3 && nums.every((n) => n > 0);
  const w = parseFloat(weight);
  const weightOk = weight.trim() !== '' && w > 0;
  const valid = (sidesTyped === 0 || sidesOk) && (sidesOk || weightOk);
  const input =
    'w-full min-w-0 rounded-xl border border-[#2A2F36] bg-[#0F1115] p-3 text-center font-mono text-lg font-bold text-white focus:border-white focus:outline-none';
  return (
    <div
      className="fixed inset-0 z-[190] flex items-end justify-center bg-black/55"
      onClick={onCancel}
    >
      <form
        className="flex w-full max-w-[430px] flex-col gap-3 rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || busy) return;
          void onSave(
            sidesOk ? (nums as [number, number, number]) : undefined,
            weightOk ? w : undefined
          ).catch(() => {});
        }}
      >
        {isBike && (
          <>
            <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">
              Box sides, inches, any order
            </span>
            <div className="grid grid-cols-3 gap-2">
              {sides.map((v, i) => (
                <input
                  key={i}
                  aria-label={`Side ${i + 1}`}
                  inputMode="decimal"
                  value={v}
                  onChange={(e) => setSides((s) => s.map((x, j) => (j === i ? e.target.value : x)))}
                  className={input}
                />
              ))}
            </div>
          </>
        )}
        <span className="text-[10.5px] uppercase tracking-[0.14em] text-white/45">Scale, lbs</span>
        <input
          aria-label="Weight in pounds"
          inputMode="decimal"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
          className={input}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-[#2A2F36] py-3 font-semibold text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!valid || busy}
            className="flex-1 rounded-xl bg-white py-3 font-semibold text-[#0F1115] disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save measurement'}
          </button>
        </div>
      </form>
    </div>
  );
};
