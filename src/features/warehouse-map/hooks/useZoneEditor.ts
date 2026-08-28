// The editing tools of a zone, separate from the drawing: the mode (VIEW |
// PLAN), the line in hand, what a drop does, and the planned state the
// drawing paints. LIVE is P2. Only the signed-in screen mounts this — it
// needs the plan tables and the Modal Manager.

import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useModal } from '../../../context/ModalContext';
import type { Cell, ZoneId } from '../engine';
import { slotKey } from '../engine';
import type { StockEntry, StockRow, ZoneStock } from '../stock/rowStock';
import {
  holdEntry,
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
import { useSlotPlan } from './useSlotPlan';

export type EditMode = 'view' | 'plan';

export interface ZoneEditor {
  mode: EditMode;
  setMode: (mode: EditMode) => void;
  held: Held | null;
  pickEntry: (entry: StockEntry, cellKey: string) => void;
  pickRow: (row: StockRow) => void;
  pickOccupant: (o: Occupant) => void;
  cancel: () => void;
  /** Drops the held line on a drawn cell. Returns false when nothing was in hand. */
  drop: (cell: Cell) => boolean;
  state: PlannedState;
  moves: PlanMove[];
  summary: { count: number; units: number; rows: number };
  removeMove: (id: number) => void;
  discard: () => void;
  complete: () => void;
  busy: boolean;
  /** The drawn cell the held line sits in (live or ghost), for the drawing to mark. */
  heldKey: string | null;
}

export function useZoneEditor(zoneId: ZoneId, stock: ZoneStock | null): ZoneEditor {
  const [params, setParams] = useSearchParams();
  const mode: EditMode = params.get('mode') === 'plan' ? 'plan' : 'view';
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

  const state = useMemo(() => plannedState(stock, plan.moves), [stock, plan.moves]);
  const summary = useMemo(() => summarizeMoves(plan.moves), [plan.moves]);

  const heldKey = useMemo(() => {
    if (!held) return null;
    const m = plan.moves.find((x) => x.inventoryId === held.inventoryId && x.status === 'planned');
    return m ? `${m.toLocation.replace(/^ROW\s*/i, '')}-${m.toLetter}` : held.liveKey;
  }, [held, plan.moves]);

  const drop = useCallback(
    (cell: Cell): boolean => {
      if (!held) return false;
      const result = planDrop(
        held,
        { rowNum: cell.row.num, letter: cell.letter },
        state,
        plan.moves
      );
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
    [held, state, plan]
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

  return {
    mode,
    setMode,
    held,
    pickEntry: (entry, cellKey) => setHeld(holdEntry(entry, cellKey)),
    pickRow: (row) => setHeld(holdRow(row)),
    pickOccupant: (o) => setHeld(holdOccupant(o)),
    cancel: () => setHeld(null),
    drop,
    state,
    moves: plan.moves,
    summary,
    removeMove: (id) => plan.removeMove.mutate(id, { onError: (e) => toast.error(e.message) }),
    discard,
    complete,
    busy: plan.busy,
    heldKey,
  };
}
