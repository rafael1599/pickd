import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { findZeroStockLines, type ZeroStockCandidate } from '../../utils/zeroStockPrompt';
import { ConfirmZeroStockModal } from '../ConfirmZeroStockModal';
import type { InventoryItemWithMetadata } from '../../../../schemas/inventory.schema';

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { quantity: 4 }, error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

describe('Part B (Recount F2): Confirm zero stock upon completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleInventory: InventoryItemWithMetadata[] = [
    {
      id: 1,
      sku: '01-0357',
      location: 'A-01-01',
      warehouse: 'LUDLOW',
      quantity: 5,
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00Z'),
      distribution: [],
    },
    {
      id: 2,
      sku: '02-0100',
      location: 'B-02-02',
      warehouse: 'LUDLOW',
      quantity: 2,
      is_active: true,
      created_at: new Date('2026-01-01T00:00:00Z'),
      distribution: [],
    },
  ];

  describe('findZeroStockLines detection', () => {
    it('detects insufficient_stock and sku_not_found lines and resolves their systemQty', async () => {
      const candidates: ZeroStockCandidate[] = [
        {
          sku: '01-0357',
          location: 'A-01-01',
          warehouse: 'LUDLOW',
          insufficient_stock: true,
        },
        {
          sku: '02-0100',
          location: 'B-02-02',
          warehouse: 'LUDLOW',
          sku_not_found: true,
        },
        {
          sku: '03-3848BK',
          location: 'C-03-03',
          warehouse: 'LUDLOW',
          // Normal item - not short
        },
      ];

      const lines = await findZeroStockLines(candidates, sampleInventory);

      expect(lines).toHaveLength(2);
      expect(lines[0]).toEqual({
        sku: '01-0357',
        location: 'A-01-01',
        systemQty: 5,
      });
      expect(lines[1]).toEqual({
        sku: '02-0100',
        location: 'B-02-02',
        systemQty: 2,
      });
    });

    it('returns empty array if no items have shortage flags', async () => {
      const candidates: ZeroStockCandidate[] = [
        {
          sku: '01-0357',
          location: 'A-01-01',
          warehouse: 'LUDLOW',
          insufficient_stock: false,
        },
      ];

      const lines = await findZeroStockLines(candidates, sampleInventory);
      expect(lines).toHaveLength(0);
    });

    it('deduplicates lines by SKU and location', async () => {
      const candidates: ZeroStockCandidate[] = [
        {
          sku: '01-0357',
          location: 'A-01-01',
          warehouse: 'LUDLOW',
          insufficient_stock: true,
        },
        {
          sku: '01-0357',
          location: 'A-01-01',
          warehouse: 'LUDLOW',
          insufficient_stock: true,
        },
      ];

      const lines = await findZeroStockLines(candidates, sampleInventory);
      expect(lines).toHaveLength(1);
    });
  });

  describe('ConfirmZeroStockModal component', () => {
    const mockLines = [
      {
        sku: '01-0357',
        location: 'A-01-01',
        systemQty: 5,
      },
      {
        sku: '02-0100',
        location: 'B-02-02',
        systemQty: 1,
      },
    ];

    it('renders the header and line items with system qty → will be set to 0', () => {
      render(
        <ConfirmZeroStockModal
          isOpen={true}
          lines={mockLines}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      );

      expect(screen.getByText('Missing Stock Confirmation')).toBeTruthy();
      expect(screen.getByText('01-0357 · A-01-01')).toBeTruthy();
      expect(screen.getByText('02-0100 · B-02-02')).toBeTruthy();
      expect(screen.getByText('system has 5 → will be set to 0')).toBeTruthy();
      expect(screen.getByText('system has 1 → will be set to 0')).toBeTruthy();
    });

    it('Back button calls onCancel', () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();

      render(
        <ConfirmZeroStockModal
          isOpen={true}
          lines={mockLines}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const backBtn = screen.getByRole('button', { name: /^back$/i });
      fireEvent.click(backBtn);

      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(onConfirm).not.toHaveBeenCalled();
    });

    it('Confirm button calls onConfirm', () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();

      render(
        <ConfirmZeroStockModal
          isOpen={true}
          lines={mockLines}
          onConfirm={onConfirm}
          onCancel={onCancel}
        />
      );

      const confirmBtn = screen.getByRole('button', { name: /^confirm$/i });
      fireEvent.click(confirmBtn);

      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onCancel).not.toHaveBeenCalled();
    });
  });

  describe('Completion flow interception', () => {
    it('Back halts completion without calling deduct/process', async () => {
      let completionExecuted = false;

      const runCompletionWithConfirmation = async (
        candidates: ZeroStockCandidate[],
        promptUser: () => Promise<boolean>
      ) => {
        const lines = await findZeroStockLines(candidates, sampleInventory);
        if (lines.length > 0) {
          const confirmed = await promptUser();
          if (!confirmed) return false;
        }
        completionExecuted = true;
        return true;
      };

      const candidates: ZeroStockCandidate[] = [
        {
          sku: '01-0357',
          location: 'A-01-01',
          warehouse: 'LUDLOW',
          insufficient_stock: true,
        },
      ];

      const res = await runCompletionWithConfirmation(candidates, async () => false);

      expect(res).toBe(false);
      expect(completionExecuted).toBe(false);
    });

    it('Confirm allows completion to proceed', async () => {
      let completionExecuted = false;

      const runCompletionWithConfirmation = async (
        candidates: ZeroStockCandidate[],
        promptUser: () => Promise<boolean>
      ) => {
        const lines = await findZeroStockLines(candidates, sampleInventory);
        if (lines.length > 0) {
          const confirmed = await promptUser();
          if (!confirmed) return false;
        }
        completionExecuted = true;
        return true;
      };

      const candidates: ZeroStockCandidate[] = [
        {
          sku: '01-0357',
          location: 'A-01-01',
          warehouse: 'LUDLOW',
          insufficient_stock: true,
        },
      ];

      const res = await runCompletionWithConfirmation(candidates, async () => true);

      expect(res).toBe(true);
      expect(completionExecuted).toBe(true);
    });
  });
});
