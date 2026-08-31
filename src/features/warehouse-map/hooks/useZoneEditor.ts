// The editing tools of a zone, separate from the drawing: the mode, the line
// in hand, what a drop does, and the planned state the drawing paints.
//
//   VIEW    — the resting state, no button: the stock, no measures, tap a SKU
//             for its detail.
//   PLAN    — draw moves as ghosts; PLAN COMPLETED executes them; DISTRIBUTE
//             spreads every line at a pallet (30) per square.
//   LIVE    — tap a SKU, tap where it goes, confirm: moved now.
//   LAYOUT  — the measures. No button since 31 Aug 2026 ("compactar a 2
//             solamente"): only `?mode=layout` reaches it.
//
// Only the signed-in screen mounts this — it needs the plan tables and the
// Modal Manager.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useModal } from '../../../context/ModalContext';
import type { Cell, LayoutModel, ZoneId } from '../engine';
import { slotKey } from '../engine';
import { SQUARE_MAX, type StockRow, type ZoneStock } from '../stock/rowStock';
import {
  holdOccupant,
  holdRow,
  OVERFLOW_LOCATION,
  planDrop,
  plannedState,
  sameLocation,
  summarizeMoves,
  type Held,
  type MoveDraft,
  type Occupant,
  type PlanMove,
  type PlannedState,
} from '../plan/slotPlan';
import { distribute as distributeLines, repairOverCap, spreadDrop } from '../plan/distribute';
import { useSlotPlan } from './useSlotPlan';

export type EditMode = 'view' | 'plan' | 'live' | 'layout';
const MODES: EditMode[] = ['view', 'plan', 'live', 'layout'];

export interface ZoneEditor {
  mode: EditMode;
  setMode: (mode: EditMode) => void;
  /** PLAN or LIVE: a tap picks up, a tap puts down. */
  editing: boolean;
  held: Held | null;
  pickOccupant: (o: Occupant) => void;
  pickRow: (row: StockRow) => void;
  cancel: () => void;
  /** Drops the held line on a drawn cell. Returns false when nothing was in hand. */
  drop: (cell: Cell) => boolean;
  /** Parks the held line on the hall floor (MAS), beside whatever is there. */
  dropInHall: () => boolean;
  /** The moves parked in MAS, for the drawing to lay out along the hall. */
  masMoves: PlanMove[];
  /** The planned state in PLAN, the live state elsewhere. */
  state: PlannedState;
  moves: PlanMove[];
  summary: { count: number; units: number; rows: number };
  removeMove: (id: number) => void;
  discard: () => void;
  complete: () => void;
  distribute: () => void;
  busy: boolean;
  /** The drawn cell the held line sits in (live or ghost), for the drawing to mark. */
  heldKey: string | null;
}

export function useZoneEditor(
  zoneId: ZoneId,
  stock: ZoneStock | null,
  model: LayoutModel | null
): ZoneEditor {
  const [params, setParams] = useSearchParams();
  const raw = params.get('mode');
  const mode: EditMode = MODES.includes(raw as EditMode) ? (raw as EditMode) : 'view';
  const setMode = useCallback(
    (m: EditMode) => {
      const next = new URLSearchParams(params);
      if (m === 'view') next.delete('mode');
      else next.set('mode', m);
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const plan = useSlotPlan(zoneId);
  const { open: openModal } = useModal();
  const [held, setHeld] = useState<Held | null>(null);

  const planState = useMemo(() => plannedState(stock, plan.moves), [stock, plan.moves]);
  const liveState = useMemo(() => plannedState(stock, []), [stock]);
  const state = mode === 'plan' ? planState : liveState;
  const summary = useMemo(() => summarizeMoves(plan.moves), [plan.moves]);
  const editing = mode === 'plan' || mode === 'live';

  // The square the hand picked from — live or ghost — for the drawing to mark.
  const heldKey = held?.fromKey ?? null;

  const drop = useCallback(
    (cell: Cell): boolean => {
      if (!held || !editing) return false;
      const target = { rowNum: cell.row.num, letter: cell.letter };
      if (mode === 'live') {
        const r = planDrop(held, target, liveState, []);
        if (r.rule === 'noop') toast(`${held.sku} — ${r.reason}`);
        else {
          const drafts = model ? spreadDrop(model, liveState, r.drafts) : r.drafts;
          openModal({ type: 'slot-live-move', zoneId, drafts, rule: r.rule });
        }
        setHeld(null);
        return true;
      }
      const result = planDrop(held, target, planState, plan.moves);
      if (result.rule === 'noop') {
        toast(`${held.sku} — ${result.reason}`);
        setHeld(null);
        return true;
      }
      // The gesture settles here and now: a pallet too big for one square
      // fans out at the drop, and after that the plan never re-computes it.
      const settled = model
        ? { ...result, drafts: spreadDrop(model, planState, result.drafts) }
        : result;
      plan.applyDrop.mutate(settled, {
        onError: (e) => toast.error(e.message),
        onSuccess: () => {
          const what =
            result.rule === 'swap'
              ? `${held.sku} ↔ ${slotKey(cell)}`
              : `${held.sku} → ${slotKey(cell)}${result.rule === 'join' ? ' (joins)' : ''}`;
          toast.success(`Planned: ${what}`);
        },
      });
      setHeld(null);
      return true;
    },
    [held, editing, mode, liveState, planState, plan, openModal, zoneId, model]
  );

  // The hall is a place: parking a line there is the same gesture as any
  // other drop, and it lands beside what is already on the floor, never on
  // top of it (Rafael, 31 Aug 2026: "sin que se mezclen").
  const dropInHall = useCallback((): boolean => {
    if (!held || !editing) return false;
    const draft: MoveDraft = {
      origin: 'hand',
      inventoryId: held.inventoryId,
      sku: held.sku,
      qty: held.qty,
      itemName: held.itemName,
      warehouse: held.warehouse,
      fromLocation: held.location,
      fromSublocation: held.sublocation,
      toLocation: OVERFLOW_LOCATION,
      toLetters: [],
      kind: 'move',
    };
    if (sameLocation(held.location, OVERFLOW_LOCATION)) {
      toast(`${held.sku} — already on the hall floor`);
      setHeld(null);
      return true;
    }
    if (mode === 'live') {
      openModal({ type: 'slot-live-move', zoneId, drafts: [draft], rule: 'move' });
      setHeld(null);
      return true;
    }
    plan.applyDrop.mutate(
      { rule: 'move', drafts: [draft], removals: held.ghostId === null ? [] : [held.ghostId] },
      {
        onError: (e) => toast.error(e.message),
        onSuccess: () => toast.success(`Parked: ${held.sku} → ${OVERFLOW_LOCATION}`),
      }
    );
    setHeld(null);
    return true;
  }, [held, editing, mode, plan, openModal, zoneId]);

  const masMoves = useMemo(
    () =>
      plan.moves.filter(
        (m) =>
          m.status === 'planned' &&
          m.toLetters.length === 0 &&
          sameLocation(m.toLocation, OVERFLOW_LOCATION)
      ),
    [plan.moves]
  );

  const complete = useCallback(() => {
    if (!plan.plan || summary.count === 0) return;
    openModal({ type: 'slot-plan-execute', zoneId, planId: plan.plan.id });
  }, [openModal, plan.plan, summary.count, zoneId]);

  const discard = useCallback(() => {
    if (!plan.plan) return;
    plan.discard.mutate(plan.plan.id, {
      onSuccess: () => toast('Plan discarded'),
      onError: (e) => toast.error(e.message),
    });
    setHeld(null);
  }, [plan]);

  // Rafael, 31 Aug 2026: "no puede haber un cuadro con 46 o más… quiero que
  // se redistribuya automáticamente". In PLAN two things can put too much in
  // one square, and both are repaired here as ghosts in the draft — nothing
  // moves until PLAN COMPLETED: a landing that carries a whole pallet into
  // one square (a hand drop) and a live line that never fitted. The stamp
  // stops it retrying what spreading cannot fix (several small lines summed
  // in one square stay alarmed instead).
  const autoSpread = useRef('');
  useEffect(() => {
    if (mode !== 'plan' || !stock || !model || plan.busy || plan.isLoading) return;

    // 1. The plan's own landings: re-plan a move over the squares it needs.
    const repair = repairOverCap(model, planState, plan.moves);
    if (repair.drafts.length > 0) {
      // The repair itself is the stamp: proposing the same one twice means it
      // did not stick, and the loop stops instead of spinning.
      const stamp = `repair:${repair.removals.join(',')}|${repair.drafts
        .map((d) => `${d.inventoryId}>${d.toLocation}${d.toLetters.join('')}:${d.qty}`)
        .join(',')}`;
      if (autoSpread.current === stamp) return;
      autoSpread.current = stamp;
      plan.applyDrop.mutate(
        { rule: 'move', drafts: repair.drafts, removals: repair.removals },
        {
          onSuccess: () =>
            toast(
              `Over ${SQUARE_MAX} in a square — spread over ${repair.drafts.length} square${repair.drafts.length === 1 ? '' : 's'}`
            ),
          onError: (e) => toast.error(e.message),
        }
      );
      return;
    }

    // 2. Live lines that never fitted in the squares they hold.
    const offenders = new Set<number>();
    for (const cell of model.validCells) {
      const key = slotKey(cell);
      if (planState.unitsAt(key) <= SQUARE_MAX) continue;
      // Whoever still has units here gets spread — a planned move of its own
      // does not excuse it.
      for (const e of stock.cells.get(key)?.entries ?? []) {
        if (planState.remainingAt(key, e.rowId) > 0) offenders.add(e.rowId);
      }
    }
    if (offenders.size === 0) return;
    const stamp = `lines:${[...offenders].sort((a, b) => a - b).join(',')}`;
    if (autoSpread.current === stamp) return;
    autoSpread.current = stamp;
    const d = distributeLines(stock, model, planState, (l) => offenders.has(l.inventoryId));
    if (d.drafts.length === 0) return;
    plan.addMoves.mutate(d.drafts, {
      onSuccess: () =>
        toast(
          `Over ${SQUARE_MAX} in a square — spread in the plan (${d.drafts.length} move${d.drafts.length === 1 ? '' : 's'})`
        ),
      onError: (e) => toast.error(e.message),
    });
  }, [mode, stock, model, plan, planState]);

  const distribute = useCallback(() => {
    if (!stock || !model) return;
    const d = distributeLines(stock, model, planState);
    if (d.drafts.length === 0) {
      toast('Everything already fits at 30 a square');
      return;
    }
    plan.addMoves.mutate(d.drafts, {
      onSuccess: () =>
        toast.success(
          `Planned ${d.drafts.length} moves — 30 a square` +
            (d.toHall > 0 ? ` · ${d.toHall} to the MAIN HALL` : '')
        ),
      onError: (e) => toast.error(e.message),
    });
  }, [stock, model, planState, plan]);

  return {
    mode,
    setMode,
    editing,
    held,
    pickOccupant: (o) => setHeld(holdOccupant(o)),
    pickRow: (row) => setHeld(holdRow(row)),
    cancel: () => setHeld(null),
    drop,
    dropInHall,
    masMoves,
    state,
    moves: plan.moves,
    summary,
    removeMove: (id) => plan.removeMove.mutate(id, { onError: (e) => toast.error(e.message) }),
    discard,
    complete,
    distribute,
    busy: plan.busy,
    heldKey,
  };
}
