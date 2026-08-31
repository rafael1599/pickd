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
  planDrop,
  plannedState,
  summarizeMoves,
  type Held,
  type Occupant,
  type PlanMove,
  type PlannedState,
} from '../plan/slotPlan';
import { distribute as distributeLines } from '../plan/distribute';
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
        else openModal({ type: 'slot-live-move', zoneId, drafts: r.drafts, rule: r.rule });
        setHeld(null);
        return true;
      }
      const result = planDrop(held, target, planState, plan.moves);
      if (result.rule === 'noop') {
        toast(`${held.sku} — ${result.reason}`);
        setHeld(null);
        return true;
      }
      plan.applyDrop.mutate(result, {
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
    [held, editing, mode, liveState, planState, plan, openModal, zoneId]
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
  // se redistribuya automáticamente". In PLAN, any square the planned state
  // leaves over SQUARE_MAX gets its live lines spread on their own — as
  // ghosts in the draft: nothing moves until PLAN COMPLETED. The stamp stops
  // it retrying the same offenders when spreading cannot fix them (several
  // small lines summed in one square stay alarmed instead).
  const autoSpread = useRef('');
  useEffect(() => {
    if (mode !== 'plan' || !stock || !model || plan.busy || plan.isLoading) return;
    const offenders = new Set<number>();
    for (const [key, cell] of stock.cells) {
      let units = 0;
      const live: number[] = [];
      for (const e of cell.entries) {
        if (planState.gone(e.rowId, cell.letter)) continue;
        units += e.qtyHere;
        live.push(e.rowId);
      }
      for (const g of planState.ghosts.get(key) ?? []) units += g.qtyHere;
      if (units > SQUARE_MAX) for (const id of live) offenders.add(id);
    }
    if (offenders.size === 0) return;
    const stamp = [...offenders].sort((a, b) => a - b).join(',');
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
