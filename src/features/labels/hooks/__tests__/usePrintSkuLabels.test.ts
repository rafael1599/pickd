import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const meta: { current: Record<string, unknown> | null } = { current: null };

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () =>
          table === 'inventory'
            ? Promise.resolve({ data: [{ item_name: 'X', location: 'FDX RETURNS', quantity: 1 }] })
            : chain,
        maybeSingle: () => Promise.resolve({ data: meta.current }),
      };
      return chain;
    },
  },
}));

const generate = vi.fn();
vi.mock('../useGenerateLabels', () => ({
  useGenerateLabels: () => ({ generate, isGenerating: false }),
}));

const printReturnLabel = vi.fn();
vi.mock('../../utils/generateReturnLabel', () => ({
  printReturnLabel: (...args: unknown[]) => printReturnLabel(...args),
}));

import { usePrintSkuLabels } from '../usePrintSkuLabels';

const req = { sku: '792270157942', location: 'FDX RETURNS', stock: 1, quantity: 1, withUpc: false };

describe('usePrintSkuLabels', () => {
  beforeEach(() => {
    generate.mockReset().mockResolvedValue({ count: 1, sdNumbers: new Map() });
    printReturnLabel.mockReset().mockResolvedValue(undefined);
  });

  it('a FedEx return prints its return label, never the SKU label', async () => {
    meta.current = {
      unit_kind: 'return',
      rma: 'WC#: 8241',
      created_at: '2026-05-05T12:00:00Z',
      is_bike: true,
    };
    const { result } = renderHook(() => usePrintSkuLabels());
    const out = await result.current.print(req);
    expect(printReturnLabel).toHaveBeenCalledWith({
      trackingNumber: '792270157942',
      receivedAt: '2026-05-05T12:00:00Z',
      receivedByName: null,
      rma: 'WC#: 8241',
    });
    expect(generate).not.toHaveBeenCalled();
    expect(out.count).toBe(1);
  });

  it('any other unit prints the SKU label', async () => {
    meta.current = { unit_kind: 'new', is_bike: true };
    const { result } = renderHook(() => usePrintSkuLabels());
    await result.current.print({ ...req, sku: '03-4229BL' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(printReturnLabel).not.toHaveBeenCalled();
  });
});
