import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RecountSheet } from '../RecountSheet';
import * as recountService from '../../../services/recount.service';
import { feedbackService } from '../../../services/feedback.service';

vi.mock('../../../services/recount.service', () => ({
  submitRecount: vi.fn(),
  fetchOpenRecounts: vi.fn(),
  requestRecount: vi.fn(),
  unitsHeldByOtherOrders: vi.fn(),
}));

vi.mock('../../../services/feedback.service', () => ({
  feedbackService: {
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        }),
      }),
    }),
    rpc: vi.fn(),
  },
}));

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('RecountSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blind count: no muestra el número del sistema antes de guardar y muestra la pregunta', () => {
    renderWithClient(
      <RecountSheet
        sku="03-4623BL"
        warehouse="LUDLOW"
        location="ROW 12"
        reason="Written by AS400 sync"
        onClose={vi.fn()}
      />
    );

    // Displays SKU and location
    expect(screen.getByText('03-4623BL')).toBeTruthy();
    expect(screen.getByText('ROW 12')).toBeTruthy();
    expect(screen.getByText(/Written by AS400 sync/)).toBeTruthy();

    // Blind question when no listId
    expect(screen.getByText('How many are here?')).toBeTruthy();

    // Verify there is NO system count or "expected" or "system had" shown before save
    expect(screen.queryByText(/system/i)).toBeNull();
    expect(screen.queryByText(/expected/i)).toBeNull();
    expect(screen.queryByText(/matches/i)).toBeNull();
  });

  it('con listId (desde Double Check) la pregunta es «How many are left here?»', () => {
    renderWithClient(
      <RecountSheet
        sku="03-4623BL"
        warehouse="LUDLOW"
        location="ROW 12"
        listId="some-list-uuid"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText('How many are left here?')).toBeTruthy();
  });

  it('Skip no llama al RPC y cierra la hoja', () => {
    const handleClose = vi.fn();
    const handleSkip = vi.fn();

    renderWithClient(
      <RecountSheet
        sku="03-4623BL"
        warehouse="LUDLOW"
        location="ROW 12"
        onSkip={handleSkip}
        onClose={handleClose}
      />
    );

    const skipButton = screen.getByRole('button', { name: /^skip$/i });
    fireEvent.click(skipButton);

    expect(recountService.submitRecount).not.toHaveBeenCalled();
    expect(handleSkip).toHaveBeenCalledTimes(1);
    // onSkip ya cierra (lo hace el Modal Manager); cerrar dos veces mataría la hoja siguiente.
    expect(handleClose).not.toHaveBeenCalled();
  });

  it('ENTER guarda el conteo llamando al RPC', async () => {
    vi.mocked(recountService.submitRecount).mockResolvedValueOnce({
      result: 'matched',
      counted: 15,
      system: 15,
      delta: 0,
    });

    renderWithClient(
      <RecountSheet sku="03-4623BL" warehouse="LUDLOW" location="ROW 12" onClose={vi.fn()} />
    );

    const input = screen.getByRole('textbox', { name: /count/i });
    fireEvent.change(input, { target: { value: '15' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(recountService.submitRecount).toHaveBeenCalledWith(
        '03-4623BL',
        'LUDLOW',
        'ROW 12',
        15,
        null
      );
    });
  });

  it('ENTER sin número no guarda: vacío no es cero', () => {
    renderWithClient(
      <RecountSheet sku="03-4623BL" warehouse="LUDLOW" location="ROW 12" onClose={vi.fn()} />
    );
    const input = screen.getByRole('textbox', { name: /count/i });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(recountService.submitRecount).not.toHaveBeenCalled();
  });

  it('un código de barras escaneado con ENTER no se guarda como conteo', () => {
    renderWithClient(
      <RecountSheet sku="03-4623BL" warehouse="LUDLOW" location="ROW 12" onClose={vi.fn()} />
    );
    const input = screen.getByRole('textbox', { name: /count/i });
    fireEvent.change(input, { target: { value: '745461234567' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(recountService.submitRecount).not.toHaveBeenCalled();
    expect(screen.getByText(/looks like a barcode/i)).toBeTruthy();
  });

  it('enseña el resultado matched (Matches · 12)', async () => {
    vi.mocked(recountService.submitRecount).mockResolvedValueOnce({
      result: 'matched',
      counted: 12,
      system: 12,
      delta: 0,
    });

    renderWithClient(
      <RecountSheet sku="03-4623BL" warehouse="LUDLOW" location="ROW 12" onClose={vi.fn()} />
    );

    const input = screen.getByRole('textbox', { name: /count/i });
    fireEvent.change(input, { target: { value: '12' } });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Matches · 12')).toBeTruthy();
    });
    expect(feedbackService.success).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^done$/i })).toBeTruthy();
  });

  it('enseña el resultado applied (Was 12 · now 11 (−1))', async () => {
    vi.mocked(recountService.submitRecount).mockResolvedValueOnce({
      result: 'applied',
      counted: 11,
      system: 12,
      delta: -1,
    });

    renderWithClient(
      <RecountSheet sku="03-4623BL" warehouse="LUDLOW" location="ROW 12" onClose={vi.fn()} />
    );

    const input = screen.getByRole('textbox', { name: /count/i });
    fireEvent.change(input, { target: { value: '11' } });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Was 12 · now 11 (−1)')).toBeTruthy();
    });
    expect(feedbackService.success).toHaveBeenCalled();
  });

  it('enseña el resultado second_count (Off by 7 — another person will recount it)', async () => {
    vi.mocked(recountService.submitRecount).mockResolvedValueOnce({
      result: 'second_count',
      counted: 5,
      system: 12,
      delta: -7,
    });

    renderWithClient(
      <RecountSheet sku="03-4623BL" warehouse="LUDLOW" location="ROW 12" onClose={vi.fn()} />
    );

    const input = screen.getByRole('textbox', { name: /count/i });
    fireEvent.change(input, { target: { value: '5' } });

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(screen.getByText('Off by 7 — another person will recount it')).toBeTruthy();
    });
    expect(feedbackService.warning).toHaveBeenCalled();
  });
});
