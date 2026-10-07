/**
 * Edit squares — one mode for the boxes and the figure of each square
 * (idea-258, docs/prds/square-edit-mode.md, mock docs/design/square-edit-mode.html).
 * Rafael, 7 Oct 2026: «los números están muy chiquitos… un modo edit con una
 * vista específica… un solo modal y lógica que se reutilice en ambos casos».
 *
 * One row. Each square of this SKU is a block: its letter, its figure (what
 * stands on the floor, 56 px) and its pallets. A square that is not built by
 * the rule shows what the rule would build, dashed, with a ✓. Everything waits
 * in amber until SAVE, which confirms, reads the row again and writes one EDIT
 * — or nothing, if someone changed the row first. Correcting is not moving:
 * moving stays the green Move sheet.
 *
 * Opened from the Stock card (its boxes or its quantity), item detail
 * (⋯ → Boxes) and the Move sheet (hold a pallet); `returnTo` goes back there.
 */
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { supabase } from '../../../lib/supabase';
import { useModal, type ModalState } from '../../../context/ModalContext';
import { useInventory } from '../hooks/InventoryProvider';
import { useRowSquares } from '../hooks/useRowSquares';
import { flashSyncStatus } from '../../../components/layout/SyncStatusIndicator';
import { isSmallBikeSku } from '../../../utils/bikeDetection';
import { DS_UNITS } from '../../../utils/distributionCalculator';
import type {
  DistributionItem,
  InventoryItemInput,
  InventoryItemWithMetadata,
} from '../../../schemas/inventory.schema';
import { DistributionGlyph } from './DistributionJengaViz';
import { HEADING } from './ItemDetailView/itemCardShared';
import { cardThumbUrl } from '../utils/stockCard';
import { isRowLocation } from '../utils/registerItem';
import { rowOccupancy } from '../utils/moveLoad';
import {
  acceptRule,
  acceptSplit,
  addPallet,
  deletePallet,
  draftChanges,
  draftQuantity,
  draftToSave,
  looseOf,
  movePallet,
  moveSquare,
  overflowTo,
  proposalFor,
  proposeSplit,
  rebaseDraft,
  rowDraft,
  setPalletNumber,
  setPalletType,
  setSquareUnits,
  type DraftSquare,
  type RowDraft,
} from '../utils/squareEdit';

export interface SquareEditProps {
  item: InventoryItemWithMetadata;
  /** The square to open on. */
  square?: string | null;
  /** A pallet of that square to open lifted (Move: hold a pallet). */
  pallet?: number | null;
  /** «Bring forward · B → A»: the move already staged. */
  staged?: { from: string; to: string } | null;
  /** Where ✕ and a save go back to. */
  returnTo?: ModalState;
  onClose: () => void;
}

interface Fresh {
  quantity: number;
  location: string | null;
  sublocation: string[] | null;
  distribution: DistributionItem[];
  /** The distribution as the database has it: what the write compares against. */
  raw: string;
}

const TYPE_WORD: Record<DistributionItem['type'], string> = {
  TOWER: 'tower',
  LINE: 'line',
  BASE: 'base',
  TOP: 'top',
  LINE_PALLET: 'line pallet',
};

/** `base 18 + top 11`, `2× base 18 + 2× top 12`, `—` for none. */
const describe = (pallets: readonly DistributionItem[]) =>
  pallets.length
    ? pallets
        .map((p) => `${p.count > 1 ? `${p.count}× ` : ''}${TYPE_WORD[p.type]} ${p.units_each}`)
        .join(' + ')
    : 'loose';

const asGroups = (d: unknown): DistributionItem[] =>
  Array.isArray(d) ? (d as DistributionItem[]) : [];

function minutesAgo(iso: string | null): string {
  if (!iso) return '';
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
}

const keyOf = (f: Fresh) => `${f.quantity}|${f.location}|${f.sublocation?.join('')}|${f.raw}`;

async function readRow(id: number | string): Promise<Fresh> {
  const { data, error } = await supabase
    .from('inventory')
    .select('quantity, location, sublocation, distribution')
    .eq('id', Number(id))
    .single();
  if (error) throw error;
  return {
    quantity: data.quantity ?? 0,
    location: data.location,
    sublocation: data.sublocation,
    distribution: asGroups(data.distribution),
    raw: JSON.stringify(data.distribution ?? []),
  };
}

export function SquareEditMode({
  item,
  square = null,
  pallet = null,
  staged = null,
  returnTo = null,
  onClose,
}: SquareEditProps) {
  const queryClient = useQueryClient();
  const { open } = useModal();
  const { updateItem } = useInventory();
  const warehouse = item.warehouse ?? 'LUDLOW';
  const isBike = item.sku_metadata?.is_bike !== false;
  const isKid = isSmallBikeSku(item.sku, item.sku_metadata);

  const rowQuery = useQuery({
    queryKey: ['square-edit', 'row', item.id],
    staleTime: 0,
    queryFn: () => readRow(item.id),
  });
  const fresh: Fresh = rowQuery.data ?? {
    quantity: item.quantity ?? 0,
    location: item.location ?? null,
    sublocation: item.sublocation ?? null,
    distribution: asGroups(item.distribution),
    raw: JSON.stringify(item.distribution ?? []),
  };
  const loc = fresh.location ?? '';
  const isRow = isBike && isRowLocation(loc);
  const freshKey = keyOf(fresh);

  const base = useMemo<RowDraft>(
    () =>
      rowDraft({
        quantity: fresh.quantity,
        location: isRow ? fresh.location : null,
        sublocation: fresh.sublocation,
        distribution: isBike ? fresh.distribution : [],
      }),
    [fresh.quantity, fresh.location, fresh.sublocation, fresh.distribution, isRow, isBike]
  );

  // The draft: edits on top of the row as loaded (keyed, so a reload rebuilds it).
  const [edit, setEdit] = useState<{ key: string; draft: RowDraft } | null>(null);
  const initial = useMemo(
    () => (staged && !base.needsSplit ? moveSquare(base, staged.from, staged.to) : base),
    [base, staged]
  );
  const cur = edit && edit.key === freshKey ? edit.draft : initial;
  const put = (draft: RowDraft) => setEdit({ key: freshKey, draft });

  const [lifted, setLifted] = useState<{ letter: string | null; index: number } | null>(
    pallet != null ? { letter: square, index: pallet } : null
  );
  const [typing, setTyping] = useState<
    | { kind: 'square'; letter: string | null }
    | { kind: 'pallet'; field: 'units_each' | 'count' }
    | { kind: 'split'; letter: string }
    | null
  >(null);
  const [sureDelete, setSureDelete] = useState(false);
  const [kept, setKept] = useState<Set<string>>(new Set());
  const [splitVals, setSplitVals] = useState<Record<string, number> | null>(null);
  const [panel, setPanel] = useState<'confirm' | 'discard' | null>(null);
  const [saving, setSaving] = useState(false);
  const [clash, setClash] = useState<{ by: string | null; at: string | null } | null>(null);

  // ── What the row looks like ──
  const changes = useMemo(() => draftChanges(base, cur), [base, cur]);
  const n = changes.length;
  const qtyAfter = cur.needsSplit ? fresh.quantity : draftQuantity(cur);
  const counted = qtyAfter !== fresh.quantity;
  const proposals = cur.squares.map((s) => proposalFor(s, isKid));
  const anyProposal = !cur.needsSplit && proposals.some(Boolean);
  // A square over 30 not kept: tapping a letter sends the rest there.
  const overflowing =
    cur.squares.find(
      (s, i) => proposals[i]?.kind === 'overflow' && s.letter && !kept.has(s.letter)
    ) ?? null;

  const split = cur.needsSplit ? (splitVals ?? proposeSplit(cur.needsSplit, fresh.quantity)) : null;
  const splitLetters = cur.needsSplit ?? [];
  const splitWithRest = (vals: Record<string, number>) => {
    const out = { ...vals };
    const last = splitLetters[splitLetters.length - 1];
    const others = splitLetters.slice(0, -1).reduce((a, l) => a + (out[l] ?? 0), 0);
    if (last) out[last] = Math.max(0, fresh.quantity - others);
    return out;
  };

  // ── The row's letters: this SKU's, the other SKUs', the empty ones ──
  const { data: rowLines = [] } = useQuery({
    queryKey: ['square-edit', 'row-lines', warehouse, loc],
    enabled: isRow,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('inventory')
        .select('sku, quantity, location, sublocation, distribution')
        .eq('warehouse', warehouse)
        .eq('location', loc)
        .eq('is_active', true)
        .gt('quantity', 0);
      if (error) throw error;
      return (data ?? []).map((l) => ({ ...l, distribution: asGroups(l.distribution) }));
    },
  });
  const others = useMemo(() => {
    const occ = rowOccupancy(
      rowLines.filter((l) => l.sku !== item.sku).map((l) => ({ ...l, quantity: l.quantity ?? 0 })),
      item.sku
    );
    return new Map([...occ].map(([l, f]) => [l, f.units]));
  }, [rowLines, item.sku]);
  const mineKey = cur.squares
    .map((s) => s.letter)
    .filter(Boolean)
    .join('');
  const used = useMemo(
    () => [...new Set([...(mineKey ? mineKey.split('') : []), ...others.keys()])],
    [mineKey, others]
  );
  const strip = useRowSquares(isRow ? loc : null, used);

  // ── Gestures ──
  const tapLetter = (l: string) => {
    if (cur.needsSplit) return;
    if (lifted?.letter) {
      put(movePallet(cur, lifted.letter, lifted.index, l));
      setLifted(null);
      return;
    }
    if (overflowing?.letter) {
      put(overflowTo(cur, overflowing.letter, l, isKid));
      return;
    }
    if (cur.squares.length === 0 || (cur.squares.length === 1 && !cur.squares[0].letter)) return;
    document.getElementById(`square-edit-${l}`)?.scrollIntoView({ behavior: 'smooth' });
  };

  const commitTyped = (text: string) => {
    const v = Number(text.replace(/\D/g, ''));
    const t = typing;
    setTyping(null);
    if (!t || text.trim() === '' || !Number.isFinite(v)) return;
    if (t.kind === 'square') put(setSquareUnits(cur, t.letter, v, isKid));
    if (t.kind === 'pallet' && lifted) {
      put(setPalletNumber(cur, lifted.letter, lifted.index, t.field, v));
      if (v === 0) setLifted(null);
    }
    if (t.kind === 'split' && split) setSplitVals(splitWithRest({ ...split, [t.letter]: v }));
  };

  const close = () => {
    if (n > 0 && panel !== 'discard') {
      setPanel('discard');
      return;
    }
    if (returnTo) open(returnTo);
    else onClose();
  };

  const reload = async () => {
    setClash(null);
    const res = await rowQuery.refetch();
    if (!res.data) return;
    const f = res.data;
    const next = rowDraft({
      quantity: f.quantity,
      location: isRow ? f.location : null,
      sublocation: f.sublocation,
      distribution: isBike ? f.distribution : [],
    });
    setLifted(null);
    setEdit({ key: keyOf(f), draft: rebaseDraft(base, cur, next) });
  };

  const write = async () => {
    setSaving(true);
    try {
      const now = await readRow(item.id);
      if (keyOf(now) !== freshKey) {
        // Someone else changed it: write nothing, say who.
        const { data: log } = await supabase
          .from('inventory_logs')
          .select('performed_by, created_at')
          .eq('item_id', Number(item.id))
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setClash({ by: log?.performed_by ?? null, at: log?.created_at ?? null });
        setPanel(null);
        return;
      }
      const save = draftToSave(cur);
      await updateItem(
        {
          ...item,
          quantity: now.quantity,
          location: now.location,
          sublocation: now.sublocation,
          distribution: now.distribution,
        } as InventoryItemWithMetadata,
        {
          sku: item.sku,
          location: now.location ?? '',
          quantity: save.quantity,
          item_name: item.item_name,
          warehouse,
          internal_note: item.internal_note ?? null,
          sublocation: isRow ? save.sublocation : now.sublocation,
          distribution: isRow ? save.distribution : now.distribution,
        } as InventoryItemInput
      );
      flashSyncStatus('Boxes saved', 1500);
      void queryClient.invalidateQueries({ queryKey: ['stock', 'bring-forward'] });
      void queryClient.invalidateQueries({ queryKey: ['square-edit'] });
      void queryClient.invalidateQueries({ queryKey: ['move-sheet'] });
      if (returnTo) {
        // The screen behind gets the row as it is now, not the one it opened with.
        const back =
          'item' in returnTo && returnTo.item && String(returnTo.item.id) === String(item.id)
            ? ({
                ...returnTo,
                item: {
                  ...returnTo.item,
                  quantity: save.quantity,
                  distribution: isRow ? save.distribution : now.distribution,
                  sublocation: isRow ? save.sublocation : now.sublocation,
                },
              } as ModalState)
            : returnTo;
        if (back) open(back);
        else onClose();
      } else onClose();
    } catch (e) {
      toast.error(`Could not save: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const thumb = cardThumbUrl(item.sku_metadata?.image_url);
  const name = item.item_name ?? item.sku_metadata?.model ?? '';
  const summary = changes
    .map(
      (c) =>
        `${c.square ? `${c.square} ` : ''}${c.before} → ${c.after}${isRow ? ` · ${describe(c.palletsAfter)}` : ''}`
    )
    .join('   ');

  return (
    <div
      className="fixed inset-0 z-[190] flex justify-center bg-black/60"
      data-testid="square-edit"
      onClick={close}
    >
      <div
        className="relative flex h-full w-full max-w-[480px] flex-col bg-[#0c0d12] text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* The Move sheet's header */}
        <div className="flex items-center gap-2.5 px-3 pb-2.5 pt-[max(0.875rem,env(safe-area-inset-top))]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#2A2F36] bg-[#161920]">
            {thumb ? (
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xl">{isBike ? '🚲' : '⚙︎'}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-extrabold leading-none tracking-tight" style={HEADING}>
              {item.sku}
            </div>
            <div className="mt-1 truncate text-[11.5px] font-bold uppercase text-white/45">
              {name}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#2A2F36] text-white/50"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3">
          {clash && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 font-mono text-[13px] font-extrabold text-amber-300">
              Changed by {clash.by ?? 'someone'}
              {clash.at ? ` · ${minutesAgo(clash.at)}` : ''}
              <button
                type="button"
                onClick={() => void reload()}
                className="ml-auto h-11 rounded-lg bg-amber-400 px-4 text-[#3b2400]"
              >
                Reload
              </button>
            </div>
          )}

          {/* The row */}
          <div className="flex items-end justify-between gap-3 pt-1">
            <span className="text-4xl font-extrabold leading-none tracking-tight" style={HEADING}>
              {loc || '—'}
            </span>
            <span
              className="font-mono text-[40px] font-extrabold leading-none tabular-nums"
              data-testid="square-edit-qty"
            >
              {counted ? (
                <>
                  <span className="text-2xl text-white/40 line-through">{fresh.quantity}</span>{' '}
                  <span className="text-amber-300">{qtyAfter}</span>
                </>
              ) : (
                fresh.quantity
              )}
            </span>
          </div>
          {counted && (
            <span className="-mt-2 self-end font-mono text-xs font-bold text-amber-300">
              Qty {fresh.quantity} → {qtyAfter} · a count
            </span>
          )}

          {isRow && strip.letters.length > 0 && (
            <Strip letters={strip.letters}>
              {(l) => {
                const mine = cur.squares.find((s) => s.letter === l);
                const other = others.get(l) ?? 0;
                const total = (mine?.units ?? 0) + other;
                const target = !!lifted || !!overflowing;
                return (
                  <button
                    key={l}
                    type="button"
                    onClick={() => tapLetter(l)}
                    data-testid={`square-edit-letter-${l}`}
                    className={`flex h-12 min-w-0 flex-col items-center justify-center rounded-lg font-mono ${
                      mine && mine.units > 0
                        ? 'border border-amber-500/50 bg-amber-500/15 text-amber-300'
                        : other
                          ? 'border border-[#2A2F36] bg-[repeating-linear-gradient(135deg,#181b22_0_5px,#20242c_5px_10px)] text-white/50'
                          : 'border border-dashed border-[#3a404a] bg-[#0F1115] text-white/45'
                    } ${target ? 'ring-1 ring-amber-400/60' : ''}`}
                  >
                    <b className="text-[13px] font-extrabold">{l}</b>
                    <i
                      className={`text-[11px] font-bold not-italic ${total > DS_UNITS ? 'text-red-400' : ''}`}
                    >
                      {cur.needsSplit && mine ? '?' : mine?.units || other || '·'}
                    </i>
                  </button>
                );
              }}
            </Strip>
          )}

          {(lifted?.letter || overflowing) && (
            <span className="font-mono text-xs font-bold text-amber-300">
              {lifted?.letter
                ? 'Tap a letter to move this pallet there'
                : 'Tap a letter for the rest'}
            </span>
          )}

          {/* A ? row: the split first */}
          {split && (
            <section className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-amber-400/70 bg-amber-500/5 p-3">
              <span className="text-xl font-extrabold leading-tight" style={HEADING}>
                How many in each square?
              </span>
              <div className="flex flex-wrap items-center gap-2">
                {splitLetters.map((l, i) => {
                  const last = i === splitLetters.length - 1;
                  const editing = typing?.kind === 'split' && typing.letter === l;
                  return (
                    <div key={l} className="flex items-center gap-1.5">
                      <span className="flex h-12 w-12 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/15 font-mono text-xl font-black text-amber-300">
                        {l}
                      </span>
                      {editing ? (
                        <BigInput
                          size="text-[44px] w-24"
                          value={split[l] ?? 0}
                          onDone={commitTyped}
                          label={`Units in ${l}`}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={last}
                          onClick={() => setTyping({ kind: 'split', letter: l })}
                          className={`h-14 min-w-14 rounded-lg px-2 font-mono text-[44px] font-extrabold leading-none tabular-nums ${
                            (split[l] ?? 0) > DS_UNITS ? 'text-red-400' : 'text-white'
                          } ${last ? '' : 'underline decoration-amber-400/50 decoration-dashed underline-offset-8'}`}
                        >
                          {split[l] ?? 0}
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  type="button"
                  aria-label="Accept the split"
                  data-testid="square-edit-accept-split"
                  onClick={() => {
                    put(
                      acceptSplit(
                        {
                          quantity: fresh.quantity,
                          location: fresh.location,
                          sublocation: fresh.sublocation,
                          distribution: fresh.distribution,
                        },
                        splitWithRest(split),
                        isKid
                      )
                    );
                    setSplitVals(null);
                  }}
                  className="ml-auto flex h-12 w-12 items-center justify-center rounded-xl bg-amber-400 text-[#3b2400]"
                >
                  <Check size={24} strokeWidth={3} />
                </button>
              </div>
              <span className="font-mono text-xs text-white/45">
                {fresh.quantity} in all · the last square is the rest
                {isKid ? '' : ' · each built by the rule'}
              </span>
            </section>
          )}

          {/* One block per square */}
          {!cur.needsSplit &&
            cur.squares.map((s, i) => (
              <SquareBlock
                key={s.letter ?? '-'}
                sq={s}
                isBike={isBike}
                isRow={isRow}
                isKid={isKid}
                proposal={proposals[i]}
                kept={!!s.letter && kept.has(s.letter)}
                changed={changes.some((c) => c.square === (s.letter ?? ''))}
                typing={typing?.kind === 'square' && typing.letter === s.letter}
                lifted={lifted?.letter === s.letter ? lifted.index : null}
                typingPallet={typing?.kind === 'pallet' ? typing.field : null}
                sureDelete={sureDelete}
                onFigure={() => setTyping({ kind: 'square', letter: s.letter })}
                onTyped={commitTyped}
                onLift={(index) => {
                  setSureDelete(false);
                  setLifted(
                    lifted?.letter === s.letter && lifted.index === index
                      ? null
                      : { letter: s.letter, index }
                  );
                }}
                onType={(t) => lifted && put(setPalletType(cur, s.letter, lifted.index, t))}
                onPalletNumber={(field) => setTyping({ kind: 'pallet', field })}
                onDelete={() => {
                  if (!lifted) return;
                  if (!sureDelete) return setSureDelete(true);
                  put(deletePallet(cur, s.letter, lifted.index));
                  setLifted(null);
                  setSureDelete(false);
                }}
                onAccept={() => put(acceptRule(cur, s.letter))}
                onKeep={() => s.letter && setKept(new Set([...kept, s.letter]))}
                onLooseLine={() =>
                  put(addPallet(cur, s.letter, { type: 'LINE', count: 1, units_each: looseOf(s) }))
                }
              />
            ))}
        </div>

        {/* SAVE */}
        <div className="flex flex-col gap-1.5 border-t border-[#2A2F36] bg-[#0c0d12] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
          <span
            className="truncate font-mono text-xs font-bold text-amber-300"
            data-testid="square-edit-summary"
          >
            {n > 0 ? (
              summary
            ) : !cur.needsSplit && !anyProposal && isBike && isRow && !isKid ? (
              <span className="text-emerald-400">By the rule ✓</span>
            ) : (
              <span className="text-white/35">Nothing changed</span>
            )}
          </span>
          <button
            type="button"
            disabled={n === 0 || saving}
            onClick={() => setPanel('confirm')}
            data-testid="square-edit-save"
            className="flex h-14 items-center justify-center gap-2 rounded-2xl bg-amber-400 text-lg font-extrabold text-[#3b2400] active:scale-[0.99] disabled:bg-[#1c1f26] disabled:text-white/35"
          >
            {saving ? <Loader2 size={20} className="animate-spin" /> : `SAVE${n ? ` · ${n}` : ''}`}
          </button>
        </div>

        {/* The confirmation and the discard ask, inside the mode */}
        {panel && (
          <div
            className="absolute inset-0 z-10 flex items-end bg-black/55"
            onClick={() => !saving && setPanel(null)}
          >
            <div
              className="flex w-full flex-col gap-3 rounded-t-2xl border border-b-0 border-[#2A2F36] bg-[#161920] px-4 pb-[max(1.1rem,env(safe-area-inset-bottom))] pt-4"
              onClick={(e) => e.stopPropagation()}
            >
              {panel === 'discard' ? (
                <>
                  <span className="text-2xl font-extrabold" style={HEADING}>
                    Discard {n} change{n === 1 ? '' : 's'}?
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPanel(null)}
                      className="h-14 flex-[1.4] rounded-xl bg-amber-400 font-bold text-[#3b2400]"
                    >
                      Keep editing
                    </button>
                    <button
                      type="button"
                      data-testid="square-edit-discard"
                      onClick={() => {
                        setPanel(null);
                        if (returnTo) open(returnTo);
                        else onClose();
                      }}
                      className="h-14 flex-1 rounded-xl border border-red-500/40 bg-red-500/10 font-bold text-red-300"
                    >
                      Discard
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/45">
                    {item.sku} · {loc}
                  </span>
                  <div className="flex flex-col divide-y divide-[#2A2F36] rounded-xl border border-[#2A2F36] bg-[#0F1115]">
                    {changes.map((c) => (
                      <div key={c.square} className="flex flex-col gap-0.5 px-3 py-2 font-mono">
                        <span className="flex items-baseline gap-2 text-lg font-black">
                          {c.square && <span className="text-amber-400">{c.square}</span>}
                          <span className="text-white/45">{c.before}</span>
                          <span className="text-white/45">→</span>
                          <span
                            className={
                              c.after > DS_UNITS && c.square ? 'text-red-400' : 'text-white'
                            }
                          >
                            {c.after}
                          </span>
                          {c.after > DS_UNITS && c.square && (
                            <span className="text-xs text-red-400">&gt; {DS_UNITS}</span>
                          )}
                        </span>
                        {isRow && (
                          <span className="text-xs text-white/55">
                            {describe(c.palletsBefore)} →{' '}
                            <b className="text-amber-300">{describe(c.palletsAfter)}</b>
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div
                    className={`flex items-center justify-between px-1 font-mono text-sm font-bold ${counted ? 'text-amber-300' : 'text-white/80'}`}
                  >
                    <span>
                      Qty {fresh.quantity} → {qtyAfter}
                    </span>
                    {!counted && <Check size={16} className="text-emerald-400" />}
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPanel(null)}
                      className="h-14 flex-1 rounded-xl border border-[#2A2F36] bg-[#0F1115] font-bold text-white/70"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving}
                      data-testid="square-edit-confirm"
                      onClick={() => void write()}
                      className="flex h-14 flex-[1.6] items-center justify-center rounded-xl bg-amber-400 font-bold text-[#3b2400] disabled:opacity-60"
                    >
                      {saving ? <Loader2 size={18} className="animate-spin" /> : 'Confirm'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** A row's squares in one line (two when there are 12 or more). */
function Strip({
  letters,
  children,
}: {
  letters: string[];
  children: (l: string) => React.ReactNode;
}) {
  const cols = letters.length >= 12 ? Math.ceil(letters.length / 2) : letters.length;
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {letters.map((l) => children(l))}
    </div>
  );
}

/** The number keypad over the figure itself. */
function BigInput({
  value,
  size,
  label,
  onDone,
}: {
  value: number;
  size: string;
  label: string;
  onDone: (text: string) => void;
}) {
  return (
    <input
      autoFocus
      inputMode="numeric"
      pattern="[0-9]*"
      aria-label={label}
      defaultValue={value || ''}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
      onBlur={(e) => onDone(e.target.value)}
      className={`${size} rounded-xl bg-transparent text-center font-mono font-extrabold tabular-nums text-amber-300 outline-none ring-2 ring-amber-400`}
    />
  );
}

const KINDS_ADULT: DistributionItem['type'][] = ['BASE', 'TOP', 'LINE_PALLET'];
const KINDS_KID: DistributionItem['type'][] = ['TOWER', 'LINE', 'BASE', 'TOP', 'LINE_PALLET'];

function SquareBlock({
  sq,
  isBike,
  isRow,
  isKid,
  proposal,
  kept,
  changed,
  typing,
  lifted,
  typingPallet,
  sureDelete,
  onFigure,
  onTyped,
  onLift,
  onType,
  onPalletNumber,
  onDelete,
  onAccept,
  onKeep,
  onLooseLine,
}: {
  sq: DraftSquare;
  isBike: boolean;
  isRow: boolean;
  isKid: boolean;
  proposal: ReturnType<typeof proposalFor>;
  kept: boolean;
  changed: boolean;
  typing: boolean;
  lifted: number | null;
  typingPallet: 'units_each' | 'count' | null;
  sureDelete: boolean;
  onFigure: () => void;
  onTyped: (text: string) => void;
  onLift: (index: number) => void;
  onType: (t: DistributionItem['type']) => void;
  onPalletNumber: (field: 'units_each' | 'count') => void;
  onDelete: () => void;
  onAccept: () => void;
  onKeep: () => void;
  onLooseLine: () => void;
}) {
  const over = !!sq.letter && sq.units > DS_UNITS;
  const loose = looseOf(sq);
  const lp = lifted != null ? sq.pallets[lifted] : null;
  const showPallets = isBike && isRow && sq.units > 1 + 0 * loose;
  return (
    <section
      id={sq.letter ? `square-edit-${sq.letter}` : undefined}
      data-testid={`square-edit-block-${sq.letter ?? 'row'}`}
      className={`flex flex-col gap-3 rounded-2xl border bg-[#161920] p-3 ${
        changed ? 'border-amber-400/70' : 'border-[#2A2F36]'
      } ${sq.units === 0 ? 'border-dashed opacity-60' : ''}`}
    >
      <div className="flex items-center gap-3">
        {sq.letter && (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/15 font-mono text-2xl font-black text-amber-300">
            {sq.letter}
          </span>
        )}
        {typing ? (
          <BigInput
            value={sq.units}
            size={isRow ? 'text-[56px] w-36' : 'text-[72px] w-56'}
            label={`Units in ${sq.letter ?? 'the row'}`}
            onDone={onTyped}
          />
        ) : (
          <button
            type="button"
            onClick={onFigure}
            data-testid={`square-edit-figure-${sq.letter ?? 'row'}`}
            className={`min-h-14 rounded-xl px-1 font-mono font-extrabold leading-none tabular-nums underline decoration-white/15 decoration-dashed underline-offset-8 ${
              isRow ? 'text-[56px]' : 'text-[72px]'
            } ${over ? 'text-red-400' : changed ? 'text-amber-300' : 'text-white'}`}
          >
            {sq.units.toLocaleString('en-US')}
          </button>
        )}
      </div>

      {showPallets && (sq.pallets.length > 0 || loose !== 0) && (
        <div className="flex flex-wrap items-end gap-2">
          {sq.pallets.map((p, i) => {
            const up = lifted === i;
            const top = p.type === 'TOP';
            return (
              <button
                key={`${p.type}-${p.units_each}-${i}`}
                type="button"
                onClick={() => onLift(i)}
                data-testid="square-edit-pallet"
                className={`flex min-h-12 min-w-12 select-none flex-col items-center gap-1 rounded-xl border-2 px-2 pb-1.5 pt-2 ${
                  up
                    ? '-translate-y-1 border-amber-400 bg-amber-400/10'
                    : top
                      ? 'border-pink-400/30'
                      : 'border-transparent'
                }`}
              >
                <span className="flex h-16 items-end justify-center [&_svg]:h-16 [&_svg]:w-auto">
                  <DistributionGlyph type={p.type} unitsEach={p.units_each} showNumber={false} />
                </span>
                <span
                  className={`font-mono text-[28px] font-extrabold leading-none tabular-nums ${top ? 'text-pink-300' : 'text-white'}`}
                >
                  {p.count > 1 ? `${p.count}×` : ''}
                  {p.units_each}
                </span>
                <em className="text-[11px] font-bold not-italic text-white/45">
                  {TYPE_WORD[p.type]}
                  {top ? ' 🪜' : ''}
                </em>
              </button>
            );
          })}
          {loose !== 0 && (
            <button
              type="button"
              disabled={!isKid || loose < 0}
              onClick={onLooseLine}
              data-testid="square-edit-loose"
              className="flex min-h-12 flex-col items-center gap-1 px-2 pb-1.5 pt-2"
            >
              <span
                className={`flex h-16 w-14 items-center justify-center rounded-lg border-[1.5px] border-dashed font-mono text-[28px] font-extrabold ${
                  loose > 0 ? 'border-amber-400 text-amber-400' : 'border-red-400 text-red-400'
                }`}
              >
                {loose > 0 ? `+${loose}` : loose}
              </span>
              <em className="text-[11px] font-bold not-italic text-white/45">
                {loose > 0 ? (isKid ? 'loose · tap: line' : 'loose') : 'extra'}
              </em>
            </button>
          )}
        </div>
      )}

      {/* The lifted pallet's bar */}
      {lp && (
        <div className="flex flex-col gap-2 rounded-xl border border-amber-400/60 bg-amber-500/5 p-2">
          <div className="flex flex-wrap gap-1.5">
            {(isKid ? KINDS_KID : KINDS_ADULT).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onType(t)}
                className={`h-12 min-w-[88px] flex-1 rounded-xl border px-2 text-sm font-bold capitalize ${
                  t === lp.type
                    ? 'border-amber-400 bg-amber-400 text-[#3b2400]'
                    : t === 'TOP'
                      ? 'border-pink-400/50 bg-pink-400/10 text-pink-300'
                      : 'border-[#2A2F36] bg-[#0F1115] text-white/85'
                }`}
              >
                {TYPE_WORD[t]}
                {t === 'TOP' ? ' 🪜' : ''}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {lp.count > 1 &&
              (typingPallet === 'count' ? (
                <BigInput
                  value={lp.count}
                  size="text-[28px] w-20"
                  label="How many pallets"
                  onDone={onTyped}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => onPalletNumber('count')}
                  className="h-12 rounded-xl border border-[#2A2F36] px-3 font-mono text-[28px] font-extrabold leading-none"
                >
                  {lp.count}×
                </button>
              ))}
            {typingPallet === 'units_each' ? (
              <BigInput
                value={lp.units_each}
                size="text-[28px] w-24"
                label="Bikes on this pallet"
                onDone={onTyped}
              />
            ) : (
              <button
                type="button"
                onClick={() => onPalletNumber('units_each')}
                data-testid="square-edit-pallet-number"
                className="h-12 min-w-16 rounded-xl border border-[#2A2F36] px-3 font-mono text-[28px] font-extrabold leading-none"
              >
                {lp.units_each}
              </button>
            )}
            <span className="text-xs text-white/45">bikes</span>
            <button
              type="button"
              onClick={onDelete}
              data-testid="square-edit-delete"
              className={`ml-auto h-12 rounded-xl border px-4 text-sm font-bold ${
                sureDelete
                  ? 'border-red-500 bg-red-500 text-white'
                  : 'border-red-500/40 bg-red-500/10 text-red-300'
              }`}
            >
              {sureDelete ? `Delete · ${lp.count * lp.units_each} stay loose` : 'Delete'}
            </button>
          </div>
        </div>
      )}

      {/* What the rule would build */}
      {proposal?.kind === 'rule' && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-white/25 px-2 py-1.5">
          <span className="flex items-end gap-1 opacity-60 [&_svg]:h-9 [&_svg]:w-auto">
            {proposal.pallets.map((p, i) => (
              <DistributionGlyph
                key={i}
                type={p.type}
                unitsEach={p.units_each}
                showNumber={false}
              />
            ))}
          </span>
          <span className="min-w-0 flex-1 font-mono text-sm font-bold text-white/75">
            <span className="text-white/40">Rule </span>
            {describe(proposal.pallets)}
          </span>
          <button
            type="button"
            aria-label="Accept the rule"
            data-testid={`square-edit-accept-${sq.letter}`}
            onClick={onAccept}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-[#3b2400]"
          >
            <Check size={24} strokeWidth={3} />
          </button>
        </div>
      )}
      {proposal?.kind === 'overflow' && !kept && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-red-400/50 px-2 py-1.5">
          <span className="min-w-0 flex-1 font-mono text-sm font-bold text-red-300">
            {sq.letter} {proposal.keep} · {proposal.rest} → tap{' '}
            {proposal.rest > DS_UNITS ? 'squares' : 'a square'}
          </span>
          <button
            type="button"
            onClick={onKeep}
            className="h-12 shrink-0 rounded-xl border border-[#2A2F36] px-4 text-sm font-bold text-white/70"
          >
            Keep
          </button>
        </div>
      )}
    </section>
  );
}
