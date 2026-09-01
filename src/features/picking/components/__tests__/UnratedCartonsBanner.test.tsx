import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { mockSupabase } from '../../../../test/mocks/supabase';
import { UnratedCartonsBanner, type UnratedCarton } from '../UnratedCartonsBanner';

/**
 * Renders the real component. The unit tests around it cover the arithmetic;
 * this covers the thing none of them touch -- that it mounts at all, that the
 * two states render differently, and that a save sends the sides to the columns
 * they belong in rather than the boxes they were typed in.
 */
function renderBanner(cartons: UnratedCarton[], onMeasured = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <UnratedCartonsBanner cartons={cartons} onMeasured={onMeasured} />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { ...result, onMeasured };
}

const unmeasured: UnratedCarton = {
  sku: '03-3848BK',
  model: 'SEQUEL S3',
  size: '17',
  state: 'unmeasured',
  gap: 'unverified',
  stored: { length: 54, width: 8, height: 30 },
};

const pending: UnratedCarton = {
  sku: '03-3847BK',
  model: 'SEQUEL S3',
  size: '15',
  state: 'pending_export',
  gap: null,
  stored: { length: 56, width: 8, height: 28.5 },
};

const sides = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];

const typeSides = (a: string, b: string, c: string) => {
  const [one, two, three] = sides();
  fireEvent.change(one, { target: { value: a } });
  fireEvent.change(two, { target: { value: b } });
  fireEvent.change(three, { target: { value: c } });
};

describe('UnratedCartonsBanner', () => {
  beforeEach(() => {
    mockSupabase.from.mockReturnThis();
    mockSupabase.update.mockReturnThis();
    mockSupabase.eq.mockResolvedValue({ error: null });
  });

  it('renders nothing when there is nothing to warn about', () => {
    const { container } = renderBanner([]);
    expect(container).toBeEmptyDOMElement();
  });

  it('names the carton and shows what is stored today', () => {
    renderBanner([unmeasured]);
    expect(screen.getByText('03-3848BK')).toBeInTheDocument();
    expect(screen.getByText('SEQUEL S3 17')).toBeInTheDocument();
    // Longest × middle × edge, the order a person reads a box in.
    expect(screen.getByText('now 54 × 30 × 8')).toBeInTheDocument();
  });

  it('keeps Update disabled until all three sides are numbers', () => {
    renderBanner([unmeasured]);
    const update = screen.getByRole('button', { name: /update/i });
    expect(update).toBeDisabled();

    typeSides('56', '8', '');
    expect(update).toBeDisabled();

    typeSides('56', '8', '28.5');
    expect(update).toBeEnabled();
  });

  it('echoes what it will save, whatever order the sides were typed in', () => {
    renderBanner([unmeasured]);
    typeSides('8', '28.5', '56');
    const echo = screen.getByText(/Saves as/i);
    expect(echo).toHaveTextContent('56');
    expect(echo).toHaveTextContent('28.5');
    expect(echo).toHaveTextContent('8');
    expect(echo.textContent?.indexOf('56')).toBeLessThan(echo.textContent!.indexOf('28.5'));
  });

  it('makes a lost decimal visible instead of silently sorting it away', () => {
    renderBanner([unmeasured]);
    typeSides('54', '875', '30');
    // 875 for 8.75 no longer breaks the side ordering, so the echo is what
    // shows it: "875 long" is not a bike box.
    expect(screen.getByText(/Saves as/i)).toHaveTextContent('875');
  });

  it('saves the sides into the columns they belong in, not the boxes they were typed in', async () => {
    const { onMeasured } = renderBanner([unmeasured]);
    typeSides('28.5', '56', '8');
    fireEvent.click(screen.getByRole('button', { name: /update/i }));

    await waitFor(() => expect(mockSupabase.update).toHaveBeenCalled());
    // dimensions_verified goes with them. The trigger used to deduce "somebody
    // measured this" from a value changing, so a box that turned out to be
    // exactly the default saved nothing and stayed unmeasured forever. This
    // form only ever runs when a tape was involved, so it says so.
    expect(mockSupabase.update).toHaveBeenCalledWith({
      length_in: 56,
      width_in: 8,
      height_in: 28.5,
      dimensions_verified: true,
    });
    expect(mockSupabase.eq).toHaveBeenCalledWith('sku', '03-3848BK');
    // With the sides, not just the SKU: the parent renders the measurement back
    // on the "waiting for the export" line, and without them it would show the
    // numbers the save just replaced.
    await waitFor(() =>
      expect(onMeasured).toHaveBeenCalledWith('03-3848BK', {
        length: 56,
        width: 8,
        height: 28.5,
      })
    );
  });

  it('leaves the row editable when the save fails, so the numbers are not lost', async () => {
    mockSupabase.eq.mockResolvedValue({ error: new Error('offline') });
    const { onMeasured } = renderBanner([unmeasured]);
    typeSides('56', '8', '28.5');
    fireEvent.click(screen.getByRole('button', { name: /update/i }));

    await waitFor(() => expect(mockSupabase.update).toHaveBeenCalled());
    expect(onMeasured).not.toHaveBeenCalled();
    expect(sides()[0]).toHaveValue(56);
  });

  it('shows a measured carton as waiting on the export, with no form', () => {
    renderBanner([pending]);
    expect(screen.getByText('03-3847BK')).toBeInTheDocument();
    expect(screen.getByText(/no dimensions export has run since/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /update/i })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('offers the import procedure only once both states are on screen', () => {
    renderBanner([unmeasured, pending]);
    expect(screen.getByRole('button', { name: /how to send these to fedex/i })).toBeInTheDocument();
    // The form is still there for the one that needs measuring.
    expect(screen.getByRole('button', { name: /update/i })).toBeInTheDocument();
  });

  it('does not offer the procedure when nothing is waiting on it', () => {
    renderBanner([unmeasured]);
    expect(
      screen.queryByRole('button', { name: /how to send these to fedex/i })
    ).not.toBeInTheDocument();
  });
});
