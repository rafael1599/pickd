import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useOpenRecounts, recountKey } from '../useOpenRecounts';
import * as recountService from '../../services/recount.service';
import type { RecountRequest } from '../../schemas/recount.schema';

vi.mock('../../services/recount.service', () => ({
  fetchOpenRecounts: vi.fn(),
  submitRecount: vi.fn(),
  requestRecount: vi.fn(),
  unitsHeldByOtherOrders: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useOpenRecounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('recountKey normalizes uppercase and whitespace for location', () => {
    expect(recountKey('03-4623BL', 'row 12')).toBe('03-4623BL|ROW 12');
    expect(recountKey('03-4623BL', '  ROW 12  ')).toBe('03-4623BL|ROW 12');
    expect(recountKey('03-4623BL', 'Row 12')).toBe('03-4623BL|ROW 12');
    expect(recountKey('03-4623BL', null)).toBe('03-4623BL|');
    expect(recountKey('03-4623BL', undefined)).toBe('03-4623BL|');
  });

  it('openRecountsBySkuLocation Map normalizes uppercase and spaces in locations', async () => {
    const mockRequests: RecountRequest[] = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        sku: '03-4623BL',
        warehouse: 'LUDLOW',
        location: '  row 12  ',
        reason: 'Written by AS400 sync',
        created_at: '2026-10-09T00:00:00Z',
        status: 'open',
      },
      {
        id: '22222222-2222-2222-2222-222222222222',
        sku: '03-4635MN',
        warehouse: 'LUDLOW',
        location: 'bay 2',
        reason: 'Written by AS400 sync',
        created_at: '2026-10-09T00:00:00Z',
        status: 'open',
      },
    ];

    vi.mocked(recountService.fetchOpenRecounts).mockResolvedValueOnce(mockRequests);

    const { result } = renderHook(() => useOpenRecounts(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.recounts.length).toBe(2);
    });

    const map = result.current.openRecountsBySkuLocation;

    // Both trimmed uppercase and original lookups should hit
    expect(map.get('03-4623BL|ROW 12')).toBeDefined();
    expect(map.get('03-4623BL|ROW 12')?.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(map.get(recountKey('03-4623BL', 'row 12'))?.id).toBe(
      '11111111-1111-1111-1111-111111111111'
    );
    expect(map.get(recountKey('03-4623BL', '  ROW 12  '))?.id).toBe(
      '11111111-1111-1111-1111-111111111111'
    );

    expect(map.get('03-4635MN|BAY 2')?.id).toBe('22222222-2222-2222-2222-222222222222');
    expect(map.get(recountKey('03-4635MN', 'bay 2'))?.id).toBe(
      '22222222-2222-2222-2222-222222222222'
    );
  });
});
