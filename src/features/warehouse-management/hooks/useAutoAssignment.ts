// Turns the warehouse-wide bike pool into "what goes in block A, what goes in
// block B", so the blocks fill themselves.
//
// The manual list is no longer the source of the plan, only its override: a SKU
// on it is pinned to that block, everything else is assigned automatically. It
// stays deterministic — both blocks are assigned from one pool in one pass — so
// recalculating A cannot quietly change what B was going to get.

import { useMemo } from 'react';
import {
  APTITUDE_DEFAULTS,
  BLOCKS,
  assignToFill,
  fitMinimum,
  type AptitudeCriteria,
  type MinimumFit,
  type NoMoverCandidate,
  type PoolCandidate,
} from '../../../utils/dsPalletPlanner';
import { useBikeCandidates, type BikeCandidate } from './useBikeCandidates';
import { useNoMovers } from './useNoMoverList';

/** Stable identity, so the memo below is not invalidated on every render. */
const EMPTY_SKIPS: ReadonlySet<string> = new Set();

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
  minUnits: number,
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS,
  /** Set aside for this plan only — held in React state, so it reverts on the next recalculation. */
  skipped: ReadonlySet<string> = new Set()
): AutoAssignment {
  const pinned = new Map((listed ?? []).map((n) => [n.sku, n.block_id]));

  const pool: PoolCandidate[] = (candidates ?? [])
    // Excluded bikes and 0-qty bikes never enter a block.
    // Ranked by inactivity so slowest movers fill the block first.
    .filter((c) => !c.excludedReason && c.totalQty > 0 && !skipped.has(c.sku))
    .map((c) => ({
      sku: c.sku,
      totalQty: c.totalQty,
      ordersCompleted: c.ordersCompleted,
      currentPlacements: placementOf(c),
      pinnedBlockId: pinned.get(c.sku),
      daysInactive: c.lastShipped
        ? Math.max(
            0,
            Math.floor((Date.now() - new Date(c.lastShipped).getTime()) / (1000 * 60 * 60 * 24))
          )
        : 9999,
    }));

  // fitMinimum only proves the pallets exist; assignToFill proves they pack.
  const filled = assignToFill(pool, BLOCKS, minUnits, criteria);
  const fit = fitMinimum(pool, BLOCKS, filled.minUnits);

  return {
    byBlock: filled.byBlock,
    fit: { ...fit, minUnits: filled.minUnits, fills: filled.fills },
    poolSize: pool.length,
  };
}

export function useAutoAssignment(
  minUnits: number,
  recencyDays: number,
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS,
  skipped: ReadonlySet<string> = EMPTY_SKIPS
): AutoAssignment {
  const { data: candidates } = useBikeCandidates(recencyDays);
  const { data: listed } = useNoMovers();

  return useMemo(
    () => buildAssignment(candidates, listed, minUnits, criteria, skipped),
    [candidates, listed, minUnits, criteria, skipped]
  );
}
