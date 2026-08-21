import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { ElectricBikeWarning } from '../ElectricBikeWarning';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const renderBanner = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('ElectricBikeWarning', () => {
  const defcon = { sku: '03-4606BL', name: 'DEFCON E1 15 2026 GALACTIC', units: 2 };
  const hudson = { sku: '03-4869MN', name: 'Hudson E1 Step-Over 18 Vanilla Mint', units: 5 };

  it('renders nothing when the order has no electric bikes', () => {
    const { container } = render(
      <MemoryRouter>
        <ElectricBikeWarning lines={[]} onDismiss={vi.fn()} />
      </MemoryRouter>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('counts units, not SKUs, in the headline', () => {
    renderBanner(<ElectricBikeWarning lines={[defcon, hudson]} onDismiss={vi.fn()} />);
    expect(screen.getByText(/7 e-bikes/i)).toBeTruthy();
  });

  it('says "e-bike" singular for one unit', () => {
    renderBanner(<ElectricBikeWarning lines={[{ ...defcon, units: 1 }]} onDismiss={vi.fn()} />);
    expect(screen.getByText(/1 e-bike$/i)).toBeTruthy();
  });

  it('names every SKU, because the label goes on by SKU', () => {
    renderBanner(<ElectricBikeWarning lines={[defcon, hudson]} onDismiss={vi.fn()} />);
    expect(screen.getByText('03-4606BL')).toBeTruthy();
    expect(screen.getByText('03-4869MN')).toBeTruthy();
  });

  it('still lists a SKU whose item carried no name', () => {
    // 12 real order items for these bikes have no item_name at all.
    render(
      <ElectricBikeWarning
        lines={[{ sku: '03-4608BL', name: null, units: 1 }]}
        onDismiss={vi.fn()}
      />
    );
    expect(screen.getByText('03-4608BL')).toBeTruthy();
  });

  it('announces itself to screen readers as an alert', () => {
    renderBanner(<ElectricBikeWarning lines={[defcon]} onDismiss={vi.fn()} />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('sends the operator to the e-bike procedure', () => {
    navigate.mockClear();
    renderBanner(<ElectricBikeWarning lines={[defcon]} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /how to ship e-bikes/i }));
    // The slug is typed, so this route can't drift without failing to build.
    expect(navigate).toHaveBeenCalledWith('/manuals/fedex-hazmat-ebikes');
  });

  it('dismisses on the close button', () => {
    const onDismiss = vi.fn();
    renderBanner(<ElectricBikeWarning lines={[defcon]} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText('Close warning'));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
