import { describe, it, expect, vi } from 'vitest';
import {
  buildVerifiedItemKeys,
  markOrderVerified,
  markOrderGroupVerified,
} from '../orderCompleter';
import { initSessionFromOrders, setCandidateProposal, confirmActiveBox } from '../liveSessionState';

describe('orderCompleter', () => {
  const rawOrders = [
    {
      id: 'order-uuid-1',
      order_number: '881555',
      status: 'ready_to_double_check',
      items: [
        {
          sku: '03-3989GY',
          qty: 2,
          name: 'Renegade S1 56cm',
          sku_metadata: { is_bike: true },
        },
      ],
    },
  ];

  it('buildVerifiedItemKeys generates canonical keys for verified quantities', () => {
    let state = initSessionFromOrders(rawOrders);
    // Confirm 1 box
    state = setCandidateProposal(state, {
      sku: '03-3989GY',
      rawBarcode: '03-3989GY',
      format: 'code_39',
      consecutiveFrames: 2,
      confidence: 0.9,
      firstDetectedAt: 1000,
      lastDetectedAt: 1050,
    });
    state = confirmActiveBox(state).state;

    const keys = buildVerifiedItemKeys(state.items, state.confirmedBoxes);
    expect(keys).toEqual(['1-03-3989GY-0']);
  });

  it('supports dryRun without querying Supabase', async () => {
    const dummyClient = {} as any;
    let state = initSessionFromOrders(rawOrders);
    state = setCandidateProposal(state, {
      sku: '03-3989GY',
      rawBarcode: '03-3989GY',
      format: 'code_39',
      consecutiveFrames: 2,
      confidence: 0.9,
      firstDetectedAt: 1000,
      lastDetectedAt: 1050,
    });
    state = confirmActiveBox(state).state;

    const result = await markOrderVerified(dummyClient, 'order-uuid-1', 'user-123', state, {
      dryRun: true,
    });

    expect(result.success).toBe(true);
    expect(result.orderNumber).toBe('881555');
    expect(result.verifiedItemKeys).toEqual(['1-03-3989GY-0']);
  });

  it('updates database using Supabase client on live call, without touching status', async () => {
    const updateMock = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const mockSupabase = {
      from: vi.fn().mockReturnValue({
        update: updateMock,
      }),
    } as any;

    let state = initSessionFromOrders(rawOrders);
    state = setCandidateProposal(state, {
      sku: '03-3989GY',
      rawBarcode: '03-3989GY',
      format: 'code_39',
      consecutiveFrames: 2,
      confidence: 0.9,
      firstDetectedAt: 1000,
      lastDetectedAt: 1050,
    });
    state = confirmActiveBox(state).state;

    const result = await markOrderVerified(mockSupabase, 'order-uuid-1', 'user-123', state);

    expect(result.success).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith('picking_lists');
    const payload = updateMock.mock.calls[0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        checked_by: 'user-123',
        verified_item_keys: ['1-03-3989GY-0'],
      })
    );
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('is_waiting_inventory');
  });

  it('marks all orders in the group as verified with markOrderGroupVerified, without completing them', async () => {
    const dummyClient = {} as any;
    const state = initSessionFromOrders(rawOrders, 'group-test');
    const groupResult = await markOrderGroupVerified(dummyClient, 'user-123', state, {
      dryRun: true,
    });

    expect(groupResult.groupId).toBe('group-test');
    expect(groupResult.allSucceeded).toBe(true);
    expect(groupResult.orders).toHaveLength(1);
  });
});
