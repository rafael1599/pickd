import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModalProvider, useModal } from '../../../context/ModalContext';
import * as recountService from '../../../services/recount.service';

vi.mock('../../../services/recount.service', () => ({
  submitRecount: vi.fn(),
  fetchOpenRecounts: vi.fn().mockResolvedValue([]),
  requestRecount: vi.fn(),
  unitsHeldByOtherOrders: vi.fn(),
}));

vi.mock('../../../services/feedback.service', () => ({
  feedbackService: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/supabase', () => ({
  supabase: {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
      }),
    }),
    rpc: vi.fn(),
  },
}));

/** Stock Count opens one sheet per location, the next from the previous one's Done. */
function Chain({ onAllDone }: { onAllDone: () => void }) {
  const { open } = useModal();
  const start = () =>
    open({
      type: 'recount',
      sku: '06-4284TL',
      warehouse: 'LUDLOW',
      location: 'ROW 42',
      onDone: () =>
        open({
          type: 'recount',
          sku: '06-4284TL',
          warehouse: 'LUDLOW',
          location: 'ROW 17',
          onDone: onAllDone,
        }),
    });
  return <button onClick={start}>start</button>;
}

describe('recount en varias ubicaciones', () => {
  it('el Done de la primera abre la segunda, limpia, y no la cierra', async () => {
    vi.mocked(recountService.submitRecount).mockResolvedValue({
      result: 'matched',
      counted: 3,
      system: 3,
      delta: 0,
    });
    const onAllDone = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ModalProvider>
          <Chain onAllDone={onAllDone} />
        </ModalProvider>
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByText('start'));
    const first = await screen.findByRole('textbox', { name: /count/i });
    expect(screen.getByText('ROW 42')).toBeTruthy();
    fireEvent.change(first, { target: { value: '3' } });
    fireEvent.keyDown(first, { key: 'Enter' });
    await screen.findByText(/matches/i);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));

    await waitFor(() => expect(screen.getByText('ROW 17')).toBeTruthy());
    const second = screen.getByRole('textbox', { name: /count/i }) as HTMLInputElement;
    expect(second.value).toBe('');
    expect(onAllDone).not.toHaveBeenCalled();
  });
});
