// Why a block cannot be planned, phrased as what to do about it.
//
// The Plan tab used to disable Recalculate whenever the no-mover list was
// empty. On the floor that reads as a dead button: nothing renders, nothing
// happens, nothing says why. Every precondition is named here with its fix
// attached, because the causes look identical on screen and are not remotely
// the same problem: an empty list is data entry, a missing settings row is a
// seed, and a table PostgREST cannot see is an unapplied migration.
//
// The checks are built by a pure function so the button can re-derive them from
// freshly fetched data before reporting, instead of judging a stale render.

import { useMemo } from 'react';
import {
  APTITUDE_DEFAULTS,
  blockCapacity,
  splitIntoPallets,
  type AptitudeCriteria,
  type BlockConfig,
  type MinimumFit,
  type NoMoverCandidate,
} from '../../../utils/dsPalletPlanner';
import {
  useBlockSettings,
  useNoMovers,
  type BlockSettings,
  type NoMoverEntry,
} from './useNoMoverList';
import { buildAssignment, useAutoAssignment } from './useAutoAssignment';
import { useBikeCandidates } from './useBikeCandidates';

/** Stable identity so the assignment memo is not invalidated every render. */
const EMPTY_SKIPS: ReadonlySet<string> = new Set();

export type CheckStatus = 'ok' | 'warning' | 'blocked' | 'loading';

export interface ReadinessCheck {
  id: 'settings' | 'list' | 'stock' | 'capacity';
  status: CheckStatus;
  /** What is being checked. */
  label: string;
  /** Its current value, or what is wrong with it. */
  detail: string;
  /** The action that clears it. Only absent when there is nothing to do. */
  fix?: string;
  /** Whether the fix lives in the classification tab. */
  goToNoMovers?: boolean;
}

/** One query reduced to what a check needs to know about it. */
interface QueryState<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
}

interface CheckInput {
  block: BlockConfig;
  minUnits: number;
  settings: QueryState<Record<string, BlockSettings>>;
  noMovers: QueryState<NoMoverEntry[]>;
  candidates: QueryState<NoMoverCandidate[]>;
}

/**
 * A table or function the schema cache doesn't know about means the migration
 * was never applied to this database — merging a PR only deploys the frontend.
 * Worth distinguishing, since no amount of clicking in the UI will fix it.
 */
function isMissingSchema(message: string): boolean {
  return /does not exist|schema cache|PGRST(105|202|205)|Not Found/i.test(message);
}

function errorCheck(id: ReadinessCheck['id'], label: string, error: unknown): ReadinessCheck {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id,
    status: 'blocked',
    label,
    detail: message,
    fix: isMissingSchema(message)
      ? 'The migration is missing in this database. Run `npx supabase db push --linked` and reload.'
      : 'Query failed. Check the connection and retry.',
  };
}

export function buildChecks({
  block,
  minUnits,
  settings,
  noMovers,
  candidates,
}: CheckInput): ReadinessCheck[] {
  const checks: ReadinessCheck[] = [];

  // 1 — Settings. Missing is survivable: the planner has defaults.
  if (settings.error) {
    checks.push(errorCheck('settings', 'Block settings', settings.error));
  } else if (settings.isLoading || !settings.data) {
    checks.push({ id: 'settings', status: 'loading', label: 'Block settings', detail: 'Loading…' });
  } else if (!settings.data[block.id]) {
    checks.push({
      id: 'settings',
      status: 'warning',
      label: 'Block settings',
      detail: `No row for block ${block.id} in warehouse_block_settings`,
      fix: `Planning with defaults: ${block.positionsPerRow} positions/row, min ${minUnits}u. Seed the row to change them.`,
    });
  } else {
    checks.push({
      id: 'settings',
      status: 'ok',
      label: 'Block settings',
      detail: `${block.positionsPerRow} positions/row · min ${minUnits}u · last position ${
        block.reserveLastPosition ? 'reserved' : 'assignable'
      }`,
    });
  }

  // 2 — The curated list. This is the one that actually blocks, and the one the
  // old UI reported as nothing but a greyed-out button.
  const listed = (noMovers.data ?? []).filter((n) => n.block_id === block.id);

  if (noMovers.error) {
    checks.push(errorCheck('list', 'No-mover list', noMovers.error));
    return checks;
  }
  if (noMovers.isLoading || !noMovers.data) {
    checks.push({ id: 'list', status: 'loading', label: 'No-mover list', detail: 'Loading…' });
    return checks;
  }
  // Candidates are assigned automatically now, so an empty manual list is
  // normal rather than a blocker — it only means nothing was pinned by hand.
  checks.push({
    id: 'list',
    status: 'ok',
    label: 'Pinned by hand',
    detail:
      listed.length === 0
        ? `None — block ${block.id} fills automatically`
        : `${listed.length} SKU${listed.length === 1 ? '' : 's'} pinned to block ${block.id}`,
  });

  // 3 — Live stock for the listed SKUs. A list pointing at SKUs whose stock is
  // gone produces an empty grid and, before this, no explanation at all.
  if (candidates.error) {
    checks.push(errorCheck('stock', 'Stock', candidates.error));
    return checks;
  }
  if (!candidates.data) {
    checks.push({ id: 'stock', status: 'loading', label: 'Stock', detail: 'Loading…' });
    return checks;
  }

  const rows = candidates.data;
  const withStock = rows.filter((c) => c.totalQty > 0);
  const totalUnits = withStock.reduce((sum, c) => sum + c.totalQty, 0);
  const palletsNeeded = rows.reduce(
    (sum, c) => sum + splitIntoPallets(c.totalQty, minUnits).pallets.length,
    0
  );

  if (withStock.length === 0) {
    checks.push({
      id: 'stock',
      status: 'blocked',
      label: 'Candidates',
      detail: `No bike qualifies for block ${block.id}`,
      fix: 'Every bike is either a mover, excluded, or out of stock. Widen the recency window, or restore something from the excluded list.',
      goToNoMovers: true,
    });
    return checks;
  }

  if (palletsNeeded === 0) {
    checks.push({
      id: 'stock',
      status: 'warning',
      label: 'Stock',
      detail: `${withStock.length} SKUs · ${totalUnits}u, none reaches ${minUnits}u`,
      fix: `No DS-Pallet can be formed: the whole list goes to Pull First. Lower the minimum, or add SKUs with ${minUnits}u or more.`,
    });
    return checks;
  }

  checks.push({
    id: 'stock',
    status: 'ok',
    label: 'Candidates',
    detail: `${withStock.length} SKUs · ${totalUnits}u → ${palletsNeeded} pallet${
      palletsNeeded === 1 ? '' : 's'
    }`,
  });

  // Capacity is no longer a warning: assignment takes a SKU only when the
  // block can hold all of its pallets, so it can never be asked for more cells
  // than it has. What is left over is discarded before it reaches the plan.
  const assignable = blockCapacity(block).cells;
  checks.push({
    id: 'capacity',
    status: 'ok',
    label: 'Capacity',
    detail: `${palletsNeeded} of ${assignable} assignable cells`,
  });

  return checks;
}

export interface RevalidateResult {
  blocker: ReadinessCheck | null;
  candidates: NoMoverCandidate[];
  /** The fitted minimum for the fresh pool — what the plan should run at. */
  minUnits: number;
}

export interface BlockReadiness {
  checks: ReadinessCheck[];
  /** The first check that makes a recalculation impossible, if any. */
  blocker: ReadinessCheck | null;
  candidates: NoMoverCandidate[];
  /** The minimum that fills both blocks from the shared pool. */
  fit: MinimumFit;
  /** Re-reads every precondition and judges the fresh data, not this render. */
  revalidate: () => Promise<RevalidateResult>;
}

/**
 * Reads the three inputs a plan needs — settings, curated list, live stock —
 * and reports each one on its own.
 */
export function useBlockReadiness(
  block: BlockConfig,
  minUnits: number,
  recencyDays: number,
  criteria: AptitudeCriteria = APTITUDE_DEFAULTS,
  skipped: ReadonlySet<string> = EMPTY_SKIPS
): BlockReadiness {
  const settings = useBlockSettings();
  const noMovers = useNoMovers();
  const bikes = useBikeCandidates(recencyDays);
  const auto = useAutoAssignment(minUnits, recencyDays, criteria, skipped);

  // What this block was actually given, not what someone typed into a list.
  const candidates = {
    data: bikes.data ? (auto.byBlock.get(block.id) ?? []) : undefined,
    error: bikes.error,
    isLoading: bikes.isLoading,
    refetch: bikes.refetch,
  };

  const checks = useMemo(
    () =>
      buildChecks({
        block,
        minUnits,
        settings: {
          data: settings.data,
          error: settings.error,
          isLoading: settings.isLoading,
        },
        noMovers: {
          data: noMovers.data,
          error: noMovers.error,
          isLoading: noMovers.isLoading,
        },
        candidates: {
          data: candidates.data,
          error: candidates.error,
          isLoading: candidates.isLoading,
        },
      }),
    [
      block,
      minUnits,
      settings.data,
      settings.error,
      settings.isLoading,
      noMovers.data,
      noMovers.error,
      noMovers.isLoading,
      candidates.data,
      candidates.error,
      candidates.isLoading,
    ]
  );

  const revalidate = async (): Promise<RevalidateResult> => {
    const [freshSettings, freshNoMovers] = await Promise.all([
      settings.refetch(),
      noMovers.refetch(),
    ]);

    // Rebuilt from the fresh pool, not read off the last render: an exclusion
    // made seconds ago in the other tab has to count.
    const freshBikes = await bikes.refetch();
    const freshAssignment = buildAssignment(
      freshBikes.data,
      freshNoMovers.data,
      minUnits,
      criteria,
      skipped
    );
    const freshCandidates = {
      data: freshAssignment.byBlock.get(block.id) ?? [],
      error: freshBikes.error,
    };

    const fresh = buildChecks({
      block,
      minUnits,
      settings: {
        data: freshSettings.data,
        error: freshSettings.error,
        isLoading: false,
      },
      noMovers: {
        data: freshNoMovers.data,
        error: freshNoMovers.error,
        isLoading: false,
      },
      candidates: {
        data: freshCandidates.data,
        error: freshCandidates.error,
        isLoading: false,
      },
    });

    return {
      blocker: fresh.find((c) => c.status === 'blocked') ?? null,
      candidates: freshCandidates.data ?? [],
      minUnits: freshAssignment.fit.minUnits,
    };
  };

  return {
    checks,
    blocker: checks.find((c) => c.status === 'blocked') ?? null,
    candidates: candidates.data ?? [],
    fit: auto.fit,
    revalidate,
  };
}
