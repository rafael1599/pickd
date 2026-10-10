import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DistributionMenu } from '../DistributionJengaViz';
import * as recountService from '../../../../services/recount.service';
import * as openRecountsHook from '../../../../hooks/useOpenRecounts';
import * as authContext from '../../../../context/AuthContext';
import toast from 'react-hot-toast';
import type { RecountRequest } from '../../../../schemas/recount.schema';

vi.mock('../../../../services/recount.service', () => ({
  requestRecount: vi.fn(),
  cancelRecount: vi.fn(),
  unitsHeldByOtherOrders: vi.fn(),
}));

vi.mock('react-hot-toast', () => {
  const toastFn = vi.fn();
  (toastFn as any).success = vi.fn();
  (toastFn as any).error = vi.fn();
  return { default: toastFn };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('../../../../services/feedback.service', () => ({
  feedbackService: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../labels/hooks/usePrintSkuLabels', () => ({
  usePrintSkuLabels: () => ({
    print: vi.fn(),
    isGenerating: false,
  }),
  fetchSkuUpc: vi.fn().mockResolvedValue(null),
  printNeedsOptions: vi.fn().mockReturnValue(false),
}));

vi.mock('../hooks/useSkuPhotoCapture', () => ({
  useSkuPhotoCapture: () => ({
    openCamera: vi.fn(),
    openGallery: vi.fn(),
  }),
}));

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('Part C (Recount F2): Ask and cancel recount in ⋯ menu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const sampleSku = '03-4623BL';
  const sampleLocation = 'ROW 12';
  const sampleKey = `${sampleSku}|${sampleLocation}`;

  const openReq: RecountRequest = {
    id: 'req-456',
    sku: sampleSku,
    warehouse: 'LUDLOW',
    location: sampleLocation,
    reason: 'Asked by Rafael',
    requested_by: 'user-author-123',
    created_at: '2026-10-10T00:00:00Z',
    status: 'open',
    cancelled: false,
  };

  it('renders "Ask for recount" when no open request exists; handles toast with held order', async () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      user: { id: 'user-author-123', email: 'rafael@jamisbikes.com' } as any,
      role: 'staff',
      isAdmin: false,
      profile: { full_name: 'Rafael Staff', role: 'staff' },
      loading: false,
      signOut: vi.fn(),
      updateProfileName: vi.fn(),
    });

    vi.spyOn(openRecountsHook, 'useOpenRecounts').mockReturnValue({
      recounts: [],
      openRecountsBySkuLocation: new Map(),
      allOpenBySkuLocation: new Map(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    vi.mocked(recountService.unitsHeldByOtherOrders).mockResolvedValueOnce([
      { list_id: 'list-777', order_number: '881514', units: 2 },
    ]);

    renderWithClient(
      <DistributionMenu
        isEmpty={false}
        onAdjust={vi.fn()}
        sku={sampleSku}
        location={sampleLocation}
      />
    );

    const menuBtn = screen.getByRole('button', { name: /distribution options/i });
    fireEvent.click(menuBtn);

    const askBtn = screen.getByRole('menuitem', { name: /ask for recount/i });
    expect(askBtn).toBeTruthy();

    fireEvent.click(askBtn);

    await waitFor(() => {
      expect(recountService.requestRecount).toHaveBeenCalledWith(
        sampleSku,
        'LUDLOW',
        sampleLocation,
        'Asked by Rafael Staff'
      );
    });

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Recount requested · waiting for #881514 to ship');
    });
  });

  it('renders "Ask for recount" and shows simple success toast when no other orders hold units', async () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      user: { id: 'user-author-123', email: 'rafael@jamisbikes.com' } as any,
      role: 'staff',
      isAdmin: false,
      profile: { full_name: 'Rafael Staff', role: 'staff' },
      loading: false,
      signOut: vi.fn(),
      updateProfileName: vi.fn(),
    });

    vi.spyOn(openRecountsHook, 'useOpenRecounts').mockReturnValue({
      recounts: [],
      openRecountsBySkuLocation: new Map(),
      allOpenBySkuLocation: new Map(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    vi.mocked(recountService.unitsHeldByOtherOrders).mockResolvedValueOnce([]);

    renderWithClient(
      <DistributionMenu
        isEmpty={false}
        onAdjust={vi.fn()}
        sku={sampleSku}
        location={sampleLocation}
      />
    );

    const menuBtn = screen.getByRole('button', { name: /distribution options/i });
    fireEvent.click(menuBtn);

    const askBtn = screen.getByRole('menuitem', { name: /ask for recount/i });
    fireEvent.click(askBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Recount requested');
    });
  });

  it('renders "Cancel recount request" for author and calls cancelRecount RPC', async () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      user: { id: 'user-author-123' } as any,
      role: 'staff',
      isAdmin: false,
      profile: { full_name: 'Rafael Staff', role: 'staff' },
      loading: false,
      signOut: vi.fn(),
      updateProfileName: vi.fn(),
    });

    const map = new Map<string, RecountRequest>();
    map.set(sampleKey, openReq);

    vi.spyOn(openRecountsHook, 'useOpenRecounts').mockReturnValue({
      recounts: [openReq],
      openRecountsBySkuLocation: map,
      allOpenBySkuLocation: map,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    renderWithClient(
      <DistributionMenu
        isEmpty={false}
        onAdjust={vi.fn()}
        sku={sampleSku}
        location={sampleLocation}
      />
    );

    const menuBtn = screen.getByRole('button', { name: /distribution options/i });
    fireEvent.click(menuBtn);

    const cancelBtn = screen.getByRole('menuitem', { name: /cancel recount request/i });
    expect(cancelBtn).toBeTruthy();

    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(recountService.cancelRecount).toHaveBeenCalledWith('req-456');
    });
    expect(toast.success).toHaveBeenCalledWith('Recount request cancelled');
  });

  it('renders "Cancel recount request" for admin even if not author', async () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      user: { id: 'other-user-999' } as any,
      role: 'admin',
      isAdmin: true,
      profile: { full_name: 'Admin Boss', role: 'admin' },
      loading: false,
      signOut: vi.fn(),
      updateProfileName: vi.fn(),
    });

    const map = new Map<string, RecountRequest>();
    map.set(sampleKey, openReq);

    vi.spyOn(openRecountsHook, 'useOpenRecounts').mockReturnValue({
      recounts: [openReq],
      openRecountsBySkuLocation: map,
      allOpenBySkuLocation: map,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    renderWithClient(
      <DistributionMenu
        isEmpty={false}
        onAdjust={vi.fn()}
        sku={sampleSku}
        location={sampleLocation}
      />
    );

    const menuBtn = screen.getByRole('button', { name: /distribution options/i });
    fireEvent.click(menuBtn);

    const cancelBtn = screen.getByRole('menuitem', { name: /cancel recount request/i });
    expect(cancelBtn).toBeTruthy();

    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(recountService.cancelRecount).toHaveBeenCalledWith('req-456');
    });
  });

  it('renders "Recount requested" disabled when user is neither author nor admin', () => {
    vi.spyOn(authContext, 'useAuth').mockReturnValue({
      user: { id: 'other-user-999' } as any,
      role: 'staff',
      isAdmin: false,
      profile: { full_name: 'Other Staff', role: 'staff' },
      loading: false,
      signOut: vi.fn(),
      updateProfileName: vi.fn(),
    });

    const map = new Map<string, RecountRequest>();
    map.set(sampleKey, openReq);

    vi.spyOn(openRecountsHook, 'useOpenRecounts').mockReturnValue({
      recounts: [openReq],
      openRecountsBySkuLocation: map,
      allOpenBySkuLocation: map,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    } as any);

    renderWithClient(
      <DistributionMenu
        isEmpty={false}
        onAdjust={vi.fn()}
        sku={sampleSku}
        location={sampleLocation}
      />
    );

    const menuBtn = screen.getByRole('button', { name: /distribution options/i });
    fireEvent.click(menuBtn);

    const disabledBtn = screen.getByRole('menuitem', { name: /recount requested/i });
    expect(disabledBtn).toBeTruthy();
    expect((disabledBtn as HTMLButtonElement).disabled).toBe(true);

    expect(screen.queryByRole('menuitem', { name: /cancel recount request/i })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /ask for recount/i })).toBeNull();
  });

  it('location resolution: item?.location takes precedence over card location, falling back to card location', () => {
    const resolveLocation = (itemLocation?: string | null, cardLocation?: string | null) =>
      itemLocation || cardLocation || '';

    expect(resolveLocation('ROW 12', undefined)).toBe('ROW 12');
    expect(resolveLocation('ROW 12', 'BAY 2')).toBe('ROW 12');
    expect(resolveLocation(undefined, 'BAY 2')).toBe('BAY 2');
    expect(resolveLocation(null, 'BAY 2')).toBe('BAY 2');
  });
});
