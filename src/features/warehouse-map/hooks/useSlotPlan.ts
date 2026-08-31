// The zone's draft plan, in the database so everyone sees the same ghosts.
// Reads and writes slot_plans / slot_plan_moves; the rules live in
// plan/slotPlan.ts and the execution in SlotPlanExecuteSheet.

import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import type { ZoneId } from '../engine';
import type { DropResult, MoveDraft, MoveStatus, PlanMove } from '../plan/slotPlan';

export const slotPlanKey = (zoneId: ZoneId) => ['slot-plan', zoneId] as const;

export interface SlotPlan {
  id: string;
  zoneId: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface PlanData {
  plan: SlotPlan | null;
  moves: PlanMove[];
}

type MoveRow = {
  id: number;
  plan_id: string;
  position: number;
  inventory_id: number;
  sku: string;
  qty: number;
  item_name: string | null;
  warehouse: string;
  from_location: string;
  from_sublocation: string[] | null;
  to_location: string;
  to_sublocation: string[];
  kind: string;
  origin: string | null;
  status: string;
  error: string | null;
};

const toMove = (r: MoveRow): PlanMove => ({
  id: r.id,
  planId: r.plan_id,
  position: r.position,
  inventoryId: r.inventory_id,
  sku: r.sku,
  qty: r.qty,
  itemName: r.item_name,
  warehouse: r.warehouse,
  fromLocation: r.from_location,
  fromSublocation: r.from_sublocation,
  toLocation: r.to_location,
  toLetters: r.to_sublocation,
  kind: r.kind === 'move' ? 'move' : 'relabel',
  // Rows written before the column existed are the operator's: they are what
  // he is already looking at, and nothing may rewrite them behind his back.
  origin: r.origin === 'auto' ? 'auto' : 'hand',
  status: (['planned', 'done', 'skipped', 'failed'] as const).includes(r.status as MoveStatus)
    ? (r.status as MoveStatus)
    : 'planned',
  error: r.error,
});

export async function fetchPlanMoves(planId: string): Promise<PlanMove[]> {
  const { data, error } = await supabase
    .from('slot_plan_moves')
    .select('*')
    .eq('plan_id', planId)
    .order('position');
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => toMove(r as MoveRow));
}

export function useSlotPlan(zoneId: ZoneId, enabled = true) {
  const queryClient = useQueryClient();
  const key = slotPlanKey(zoneId);

  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PlanData> => {
      const { data: plan, error } = await supabase
        .from('slot_plans')
        .select('id, zone_id, status, created_at, updated_at')
        .eq('zone_id', zoneId)
        .eq('status', 'draft')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!plan) return { plan: null, moves: [] };
      return {
        plan: {
          id: plan.id,
          zoneId: plan.zone_id,
          status: plan.status,
          createdAt: plan.created_at,
          updatedAt: plan.updated_at,
        },
        moves: await fetchPlanMoves(plan.id),
      };
    },
  });

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: key }),
    [queryClient, key]
  );

  const ensurePlan = useCallback(async (): Promise<string> => {
    const current = queryClient.getQueryData<PlanData>(key)?.plan;
    if (current) return current.id;
    const { data, error } = await supabase
      .from('slot_plans')
      .insert({ zone_id: zoneId })
      .select('id')
      .single();
    if (error) {
      // Somebody else just opened the zone's draft: take theirs.
      const { data: theirs } = await supabase
        .from('slot_plans')
        .select('id')
        .eq('zone_id', zoneId)
        .eq('status', 'draft')
        .maybeSingle();
      if (theirs) return theirs.id;
      throw new Error(error.message);
    }
    return data.id;
  }, [queryClient, key, zoneId]);

  /** Writes what a drop decided: new moves, and moves undone. A line may hold
      several moves (one per picked square); redirecting one arrives as a
      removal plus a fresh draft, never as an update by inventory id — that
      was the bug where a second pick of the same SKU redirected the first
      move (31 Aug 2026). */
  const applyDrop = useMutation({
    mutationFn: async (result: Exclude<DropResult, { rule: 'noop' }>) => {
      const planId = await ensurePlan();
      const existing = queryClient.getQueryData<PlanData>(key)?.moves ?? [];
      if (result.removals.length > 0) {
        const { error } = await supabase.from('slot_plan_moves').delete().in('id', result.removals);
        if (error) throw new Error(error.message);
      }
      let position = existing.reduce((m, x) => Math.max(m, x.position), 0);
      for (const d of result.drafts) {
        position += 1;
        const { error } = await supabase
          .from('slot_plan_moves')
          .insert({ ...draftToRow(d), plan_id: planId, position, status: 'planned', error: null });
        if (error) throw new Error(error.message);
      }
    },
    onSettled: invalidate,
  });

  /** DISTRIBUTE's moves, all at once; a line may get more than one. */
  const addMoves = useMutation({
    mutationFn: async (drafts: MoveDraft[]) => {
      if (drafts.length === 0) return;
      const planId = await ensurePlan();
      const existing = queryClient.getQueryData<PlanData>(key)?.moves ?? [];
      let position = existing.reduce((m, x) => Math.max(m, x.position), 0);
      const rows = drafts.map((d) => ({
        ...draftToRow(d),
        plan_id: planId,
        position: ++position,
        status: 'planned',
        error: null,
      }));
      const { error } = await supabase.from('slot_plan_moves').insert(rows);
      if (error) throw new Error(error.message);
    },
    onSettled: invalidate,
  });

  const removeMove = useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('slot_plan_moves').delete().eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSettled: invalidate,
  });

  const discard = useMutation({
    mutationFn: async (planId: string) => {
      const { error } = await supabase
        .from('slot_plans')
        .update({ status: 'discarded' })
        .eq('id', planId);
      if (error) throw new Error(error.message);
    },
    onSettled: invalidate,
  });

  return {
    plan: query.data?.plan ?? null,
    moves: query.data?.moves ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    applyDrop,
    addMoves,
    removeMove,
    discard,
    invalidate,
    busy: applyDrop.isPending || addMoves.isPending || removeMove.isPending || discard.isPending,
  };
}

function draftToRow(d: MoveDraft) {
  return {
    inventory_id: d.inventoryId,
    sku: d.sku,
    qty: d.qty,
    item_name: d.itemName,
    warehouse: d.warehouse,
    from_location: d.fromLocation,
    from_sublocation: d.fromSublocation,
    to_location: d.toLocation,
    to_sublocation: d.toLetters,
    kind: d.kind,
    origin: d.origin,
  };
}

/** What PLAN COMPLETED writes as it goes. */
export async function markMove(id: number, status: MoveStatus, error: string | null = null) {
  const { error: err } = await supabase
    .from('slot_plan_moves')
    .update({ status, error, executed_at: status === 'planned' ? null : new Date().toISOString() })
    .eq('id', id);
  if (err) throw new Error(err.message);
}

export async function finishPlan(planId: string, executedBy: string | null) {
  const { error } = await supabase
    .from('slot_plans')
    .update({ status: 'executed', executed_at: new Date().toISOString(), executed_by: executedBy })
    .eq('id', planId);
  if (error) throw new Error(error.message);
}
