// Turns the warehouse-wide bike pool into "what goes in block A, what goes in
// block B", so the blocks fill themselves.
//
// The manual list is no longer the source of the plan, only its override: a SKU
// on it is pinned to that block, everything else is assigned automatically. It
// stays deterministic — both blocks are assigned from one pool in one pass — so
// recalculating A cannot quietly change what B was going to get.

import { useMemo } from 'react';
import {
  BLOCKS,
  assignCandidates,
  fitMinimum,
  type MinimumFit,
  type NoMoverCandidate,
  type PoolCandidate,
} from '../../../utils/dsPalletPlanner';
import { useBikeCandidates, type BikeCandidate } from './useBikeCandidates';
import { useNoMovers } from './useNoMoverList';

export interface AutoAssignment {
  /** Candidates per block id, already fitted to the minimum below. */
  byBlock: Map<string, NoMoverCandidate[]>;
  /** The minimum the plan should run at, and whether it fills both blocks. */
  fit: MinimumFit;
  /** Everything eligible, before it was split between the blocks. */
  poolSize: number;
}

/** Where a bike stands today, when that place is a shelf row worth anchoring to. */
function placementOf(c: BikeCandidate) {
  const row = (c.location ?? '').replace(/^ROW\s+/i, '');
  const letter = c.sublocation?.[0];
  // Bins (`H28`, `4256N`) never anchor: only a block's own rows do.
  if (!row || !letter || row === c.location) return undefined;
  return [{ row, letter, units: c.totalQty }];
}

/**
 * Pure so the same assignment can be rebuilt from freshly refetched data,
 * rather than judging a render that may already be stale.
 */
export function buildAssignment(
  candidates: BikeCandidate[] | undefined,
  listed: { sku: string; block_id: string }[] | undefined,
  minUnits: number
): AutoAssignment {
  const pinned = new Map((listed ?? []).map((n) => [n.sku, n.block_id]));

  const pool: PoolCandidate[] = (candidates ?? [])
    // A mover is never a candidate, and an excluded bike never enters a block
    // whatever its stock says.
    .filter((c) => !c.isMover && !c.excludedReason && c.totalQty > 0)
    .map((c) => ({
      sku: c.sku,
      totalQty: c.totalQty,
      currentPlacements: placementOf(c),
      pinnedBlockId: pinned.get(c.sku),
    }));

  const fit = fitMinimum(pool, BLOCKS, minUnits);
  return { byBlock: assignCandidates(pool, BLOCKS, fit.minUnits), fit, poolSize: pool.length };
}

export function useAutoAssignment(minUnits: number, recencyDays: number): AutoAssignment {
  const { data: candidates } = useBikeCandidates(recencyDays);
  const { data: listed } = useNoMovers();

  return useMemo(
    () => buildAssignment(candidates, listed, minUnits),
    [candidates, listed, minUnits]
  );
}
