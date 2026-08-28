import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ShipAlertsButton,
  ShipAlertsPanel,
  shipAlertsLabel,
  type ShipAlert,
} from '../ShipAlertsButton';

const lithium: ShipAlert = {
  key: 'lithium',
  label: 'Lithium',
  tone: 'amber',
  content: <div>Mark the cartons before the carrier takes them</div>,
};
const pav: ShipAlert = {
  key: 'pav',
  label: 'PAV zone',
  tone: 'red',
  content: <div>Outside PAV delivery zones</div>,
};

/** The card's wiring: the pill toggles, the panel follows. */
const Card: React.FC<{ alerts: ShipAlert[] }> = ({ alerts }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ShipAlertsButton alerts={alerts} pulse open={open} onToggle={() => setOpen((v) => !v)} />
      {open && <ShipAlertsPanel alerts={alerts} />}
    </>
  );
};

describe('ShipAlertsButton — one pill, one or two words', () => {
  it('says the one alert, or how many there are', () => {
    expect(shipAlertsLabel([])).toBeNull();
    expect(shipAlertsLabel([lithium])).toBe('Lithium');
    expect(shipAlertsLabel([lithium, pav])).toBe('2 alerts');
  });

  it('renders nothing without alerts', () => {
    const { container } = render(<Card alerts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('keeps the banners folded until tapped, then shows every one', () => {
    render(<Card alerts={[lithium, pav]} />);
    expect(screen.queryByText('Outside PAV delivery zones')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /2 alerts/i }));
    expect(screen.getByText('Outside PAV delivery zones')).toBeTruthy();
    expect(screen.getByText('Mark the cartons before the carrier takes them')).toBeTruthy();
  });
});
