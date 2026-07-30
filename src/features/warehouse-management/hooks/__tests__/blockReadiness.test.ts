// The Plan tab reported every one of these situations the same way — an empty
// grid and a disabled button. What matters here is that they stay told apart,
// and that only the ones that truly prevent a plan report as blocked.

import { describe, it, expect } from 'vitest';
import { buildChecks, type ReadinessCheck } from '../useBlockReadiness';
import { BLOCK_A, type NoMoverCandidate } from '../../../../utils/dsPalletPlanner';
import type { BlockSettings, NoMoverEntry } from '../useNoMoverList';

const settingsRow: BlockSettings = {
  block_id: 'A',
  recency_days: 30,
  min_units: 20,
  max_orders: 0,
  min_stock: 21,
  positions_per_row: 10,
  reserve_last_position: true,
  updated_at: '2026-07-29T00:00:00Z',
  updated_by: null,
};

const listedSku = (sku: string, block = 'A'): NoMoverEntry => ({
  sku,
  block_id: block,
  last_shipped_at: null,
  qty_at_decision: null,
  updated_at: '2026-07-29T00:00:00Z',
  updated_by: null,
});

const candidate = (sku: string, totalQty: number): NoMoverCandidate => ({
  sku,
  totalQty,
  blockId: 'A',
  currentPlacements: [],
});

/** Mirrors what buildChecks reads off a react-query result. */
interface State<T> {
  data: T | undefined;
  error: unknown;
  isLoading: boolean;
}

function loaded<T>(data: T): State<T> {
  return { data, error: undefined, isLoading: false };
}

function run({
  settings = loaded<Record<string, BlockSettings>>({ A: settingsRow }),
  noMovers = loaded<NoMoverEntry[]>([]),
  candidates = loaded<NoMoverCandidate[]>([]),
  minUnits = 20,
}: {
  settings?: State<Record<string, BlockSettings>>;
  noMovers?: State<NoMoverEntry[]>;
  candidates?: State<NoMoverCandidate[]>;
  minUnits?: number;
} = {}) {
  const checks = buildChecks({ block: BLOCK_A, minUnits, settings, noMovers, candidates });
  const by = (id: ReadinessCheck['id']) => checks.find((c) => c.id === id);
  return {
    checks,
    by,
    blocker: checks.find((c) => c.status === 'blocked') ?? null,
  };
}

describe('buildChecks', () => {
  it('does not block on an empty manual list — the block fills itself', () => {
    // Curating a list by hand stopped being a precondition when assignment
    // became automatic; only an empty candidate pool blocks now.
    const { by } = run({ candidates: loaded([candidate('01-1000', 40)]) });

    expect(by('list')?.status).toBe('ok');
    expect(by('list')?.detail).toContain('fills automatically');
  });

  it('blocks when no bike qualifies at all', () => {
    const { blocker } = run({ candidates: loaded<NoMoverCandidate[]>([]) });

    expect(blocker?.id).toBe('stock');
    expect(blocker?.detail).toContain('No bike qualifies');
    expect(blocker?.goToNoMovers).toBe(true);
  });

  it('counts only the SKUs assigned to this block', () => {
    const { by, blocker } = run({
      noMovers: loaded([listedSku('01-1000'), listedSku('02-2000', 'B')]),
      candidates: loaded([candidate('01-1000', 40)]),
    });

    expect(blocker).toBeNull();
    expect(by('list')?.detail).toBe('1 SKU pinned to block A');
  });

  it('names an unapplied migration instead of a generic failure', () => {
    const { blocker } = run({
      noMovers: {
        data: undefined,
        error: new Error(
          'Failed to load no-mover list: relation "public.warehouse_no_movers" does not exist'
        ),
        isLoading: false,
      },
    });

    expect(blocker?.id).toBe('list');
    expect(blocker?.fix).toContain('supabase db push');
  });

  it('blocks when every candidate is out of stock', () => {
    const { blocker } = run({
      noMovers: loaded([listedSku('01-1000')]),
      candidates: loaded([candidate('01-1000', 0)]),
    });

    expect(blocker?.id).toBe('stock');
    expect(blocker?.detail).toContain('No bike qualifies');
    expect(blocker?.goToNoMovers).toBe(true);
  });

  it('warns rather than blocks when nothing reaches the minimum', () => {
    // A plan is still calculable — it is just all Pull First, which is a
    // legitimate outcome the operator has to be able to print.
    const { blocker, by } = run({
      noMovers: loaded([listedSku('01-1000'), listedSku('01-1001')]),
      candidates: loaded([candidate('01-1000', 4), candidate('01-1001', 19)]),
    });

    expect(blocker).toBeNull();
    expect(by('stock')?.status).toBe('warning');
    expect(by('stock')?.detail).toContain('none reaches 20u');
  });

  it('reports the pallet count a healthy list produces', () => {
    const { blocker, by } = run({
      noMovers: loaded([listedSku('01-1000')]),
      candidates: loaded([candidate('01-1000', 60)]),
    });

    expect(blocker).toBeNull();
    expect(by('stock')?.status).toBe('ok');
    // 60u = two full pallets of 25 plus a 10u remainder below the minimum.
    expect(by('stock')?.detail).toContain('2 pallets');
    expect(by('capacity')?.detail).toBe('2 of 27 assignable cells');
  });

  it('never warns about capacity — the surplus is discarded before it gets here', () => {
    // The block cannot be asked for more cells than it has: assignment takes a
    // SKU only when all of its pallets fit. The old "N pallets will land in
    // Pull First as no space" warning described a state that cannot occur.
    const entries = Array.from({ length: 30 }, (_, i) => listedSku(`01-${1000 + i}`));
    const rows = entries.map((e) => candidate(e.sku, 25));

    const { blocker, by, checks } = run({ noMovers: loaded(entries), candidates: loaded(rows) });

    expect(blocker).toBeNull();
    expect(by('capacity')?.status).toBe('ok');
    expect(checks.some((c) => c.status === 'warning' && c.id === 'capacity')).toBe(false);
  });

  it('treats a missing settings row as a warning, naming the defaults in use', () => {
    const { blocker, by } = run({
      settings: loaded({}),
      noMovers: loaded([listedSku('01-1000')]),
      candidates: loaded([candidate('01-1000', 40)]),
    });

    expect(blocker).toBeNull();
    expect(by('settings')?.status).toBe('warning');
    expect(by('settings')?.fix).toContain('10 positions/row');
  });

  it('does not judge the stock while it is still loading', () => {
    const { blocker, by } = run({
      noMovers: loaded([listedSku('01-1000')]),
      candidates: { data: undefined, error: undefined, isLoading: true },
    });

    expect(blocker).toBeNull();
    expect(by('stock')?.status).toBe('loading');
    expect(by('capacity')).toBeUndefined();
  });
});
