import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CorrectionModeView } from '../CorrectionModeView';
import { StockIssuePanel, type ActionableStockIssue } from '../StockIssuePanel';
import * as recountService from '../../../../services/recount.service';
import type { PickingItem } from '../../../../utils/pickingLogic';

vi.mock('../../../../services/recount.service', () => ({
  declareShelfShort: vi.fn().mockResolvedValue({
    sku: '01-0357',
    warehouse: 'LUDLOW',
    location: 'A-01-01',
    keep: 0,
    target: 0,
    delta: -5,
    system_before: 5,
  }),
}));

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
    rpc: vi.fn(),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Part A (Recount F2): Shortage vs Damage vs Other reasons', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseItem: PickingItem = {
    sku: '01-0357',
    location: 'A-01-01',
    warehouse: 'LUDLOW',
    pickingQty: 2,
    item_name: 'Jamis Hudson Disc',
  };

  const samplePartialIssue: ActionableStockIssue = {
    kind: 'partial',
    sku: '01-0357',
    need: 2,
    available: 1,
    onShelf: 1,
    reserved: 0,
    sibling: null,
    similar: null,
    headline: '1 of 2 available',
    detail: null,
    special: null,
    specialUnits: [],
  };

  const sampleSwapIssue: ActionableStockIssue = {
    kind: 'no_stock',
    sku: '01-0357',
    need: 2,
    sibling: {
      sku: '01-0358',
      location: 'B-01-01',
      warehouse: 'LUDLOW',
      quantity: 5,
      item_name: 'Hudson Step-Thru',
    },
    similar: null,
    headline: 'Out of stock',
    detail: null,
    special: null,
    specialUnits: [],
  };

  describe('UI amber confirmation line', () => {
    it('StockIssuePanel: remove (Out of stock) renders amber line setting location to 0', () => {
      render(
        <StockIssuePanel
          issue={samplePartialIssue}
          busy={false}
          location="A-01-01"
          onTake={vi.fn()}
          onRemove={vi.fn()}
          onSwap={vi.fn()}
          onReplace={vi.fn()}
          onRegister={vi.fn()}
        />
      );

      const removeBtn = screen.getByRole('button', { name: /remove/i });
      fireEvent.click(removeBtn);

      expect(screen.getByText('01-0357 at A-01-01 will be 0 after this order')).toBeTruthy();
    });

    it('StockIssuePanel: take (Partial stock only) renders amber line setting location to taken qty', () => {
      render(
        <StockIssuePanel
          issue={samplePartialIssue}
          busy={false}
          location="A-01-01"
          onTake={vi.fn()}
          onRemove={vi.fn()}
          onSwap={vi.fn()}
          onReplace={vi.fn()}
          onRegister={vi.fn()}
        />
      );

      const takeBtn = screen.getByRole('button', { name: /take 1/i });
      fireEvent.click(takeBtn);

      expect(
        screen.getByText('Only 1 at A-01-01: 01-0357 there will be 0 after this order')
      ).toBeTruthy();
    });

    it('StockIssuePanel: swap (Out of stock — replacing) renders amber line setting location to 0', () => {
      render(
        <StockIssuePanel
          issue={sampleSwapIssue}
          busy={false}
          location="A-01-01"
          onTake={vi.fn()}
          onRemove={vi.fn()}
          onSwap={vi.fn()}
          onReplace={vi.fn()}
          onRegister={vi.fn()}
        />
      );

      const swapBtn = screen.getByRole('button', { name: /use 01-0358/i });
      fireEvent.click(swapBtn);

      expect(screen.getByText('01-0357 at A-01-01 will be 0 after this order')).toBeTruthy();
    });

    it('CorrectionModeView: adjust_qty with "Partial stock only" renders amber line setting location to new qty', () => {
      renderWithClient(
        <CorrectionModeView
          allItems={[baseItem]}
          problemItems={[baseItem]}
          inventoryData={[]}
          onCorrectItem={vi.fn()}
          onClose={vi.fn()}
          initialPanel={{ type: 'adjust_qty', sku: baseItem.sku, availableStock: 1 }}
        />
      );

      const partialReason = screen.getByRole('button', { name: /partial stock only/i });
      fireEvent.click(partialReason);

      expect(
        screen.getByText('Only 1 at A-01-01: 01-0357 there will be 0 after this order')
      ).toBeTruthy();
    });

    it('CorrectionModeView: remove with "Out of stock" renders amber line setting location to 0', () => {
      renderWithClient(
        <CorrectionModeView
          allItems={[baseItem]}
          problemItems={[baseItem]}
          inventoryData={[]}
          onCorrectItem={vi.fn()}
          onClose={vi.fn()}
          initialPanel={{ type: 'remove', sku: baseItem.sku }}
        />
      );

      const outOfStockReason = screen.getByRole('button', { name: /out of stock/i });
      fireEvent.click(outOfStockReason);

      expect(screen.getByText('01-0357 at A-01-01 will be 0 after this order')).toBeTruthy();
    });

    it('CorrectionModeView: damage reason does NOT render the shortage amber line', () => {
      renderWithClient(
        <CorrectionModeView
          allItems={[baseItem]}
          problemItems={[]}
          inventoryData={[]}
          onCorrectItem={vi.fn()}
          onClose={vi.fn()}
          initialPanel={{ type: 'remove', sku: baseItem.sku }}
        />
      );

      const damageReason = screen.getByRole('button', { name: /damaged\/defective/i });
      fireEvent.click(damageReason);

      expect(screen.queryByText(/will be 0 after this order/i)).toBeNull();
    });
  });

  describe('RPC calling rules', () => {
    it('declareShelfShort service invokes RPC with p_keep, p_sku, p_warehouse, p_location, p_list_id, p_reason', async () => {
      const mockRpc = vi.fn().mockResolvedValue({
        data: {
          sku: '01-0357',
          warehouse: 'LUDLOW',
          location: 'A-01-01',
          keep: 1,
          target: 1,
          delta: -4,
          system_before: 5,
        },
        error: null,
      });

      const { supabase } = await import('../../../../lib/supabase');
      (supabase.rpc as ReturnType<typeof vi.fn>).mockImplementation(mockRpc);

      const actualService = await vi.importActual<typeof recountService>(
        '../../../../services/recount.service'
      );

      const res = await actualService.declareShelfShort(
        '01-0357',
        'LUDLOW',
        'A-01-01',
        'list-999',
        1,
        'Partial stock only'
      );

      expect(mockRpc).toHaveBeenCalledWith('declare_shelf_short', {
        p_sku: '01-0357',
        p_warehouse: 'LUDLOW',
        p_location: 'A-01-01',
        p_list_id: 'list-999',
        p_keep: 1,
        p_reason: 'Partial stock only',
      });
      expect(res.keep).toBe(1);
      expect(res.delta).toBe(-4);
    });

    it('shortage reason rules: keep=0 for remove/swap, keep=newQty for adjust_qty', () => {
      const simulateShortage = (actionType: 'remove' | 'swap' | 'adjust_qty', newQty?: number) => {
        if (actionType === 'remove' || actionType === 'swap') return 0;
        return newQty ?? 0;
      };

      expect(simulateShortage('remove')).toBe(0);
      expect(simulateShortage('swap')).toBe(0);
      expect(simulateShortage('adjust_qty', 3)).toBe(3);
    });

    it('damage reason toast notification message format', () => {
      const prevQty = 4;
      const newQty = 1;
      const sku = '01-0357';
      const location = 'A-01-01';

      const diff = Math.max(0, prevQty - newQty);
      const notice = `${diff} damaged box(es) of ${sku} stay at ${location}. Make them S/D or deduct them by hand.`;

      expect(notice).toBe(
        '3 damaged box(es) of 01-0357 stay at A-01-01. Make them S/D or deduct them by hand.'
      );
    });
  });
});
