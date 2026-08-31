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

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useModal } from '../../../context/ModalContext';
import type { Cell, LayoutModel, ZoneId } from '../engine';
import { slotKey } from '../engine';
import type { StockRow, ZoneStock } from '../stock/rowStock';
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
import { distribute as distributeLines, type Leftover } from '../plan/distribute';
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
  leftovers: Leftover[];
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
  const [leftovers, setLeftovers] = useState<Leftover[]>([]);

  const planState = useMemo(() => plannedState(stock, plan.moves), [stock, plan.moves]);
  const liveState = useMemo(() => plannedState(stock, []), [stock]);
  const state = mode === 'plan' ? planState : liveState;
  const summary = useMemo(() => summarizeMoves(plan.moves), [plan.moves]);
  const editing = mode === 'plan' || mode === 'live';

  const heldKey = useMemo(() => {
    if (!held) return null;
    if (mode === 'plan') {
      const m = plan.moves.find(
        (x) => x.inventoryId === held.inventoryId && x.status === 'planned'
      );
      if (m) return `${m.toLocation.replace(/^ROW\s*/i, '')}-${m.toLetters[0]}`;
    }
    return held.liveKey;
  }, [held, plan.moves, mode]);

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
    setLeftovers([]);
  }, [plan]);

  const distribute = useCallback(() => {
    if (!stock || !model) return;
    const d = distributeLines(stock, model, planState);
    setLeftovers(d.leftovers);
    if (d.drafts.length === 0) {
      toast(
        d.leftovers.length
          ? `Nothing to spread — ${d.leftovers.length} line${d.leftovers.length === 1 ? '' : 's'} found no free buried square`
          : 'Everything already fits at 30 a square'
      );
      return;
    }
    plan.addMoves.mutate(d.drafts, {
      onSuccess: () => toast.success(`Planned ${d.drafts.length} moves — 30 a square`),
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
    leftovers,
    busy: plan.busy,
    heldKey,
  };
}
