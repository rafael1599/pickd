import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CombinedOrderNumbers, ActiveFilterPill } from '../CombinedOrderNumbers';

describe('CombinedOrderNumbers', () => {
  it('renders nothing for fewer than 2 numbers', () => {
    const { container } = render(
      <CombinedOrderNumbers
        numbers={['880848']}
        activeOrderFilter={null}
        onToggle={vi.fn()}
        variant="header"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls onToggle with the clicked order number (header variant)', () => {
    const onToggle = vi.fn();
    render(
      <CombinedOrderNumbers
        numbers={['880848', '880787']}
        activeOrderFilter={null}
        onToggle={onToggle}
        variant="header"
      />
    );
    fireEvent.click(screen.getByText('848'));
    expect(onToggle).toHaveBeenCalledWith('880848');
  });

  it('stops propagation so a click inside a parent onClick does not also fire it (inline variant)', () => {
    const onToggle = vi.fn();
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <CombinedOrderNumbers
          numbers={['880848', '880787']}
          activeOrderFilter={null}
          onToggle={onToggle}
          variant="inline"
        />
      </div>
    );
    fireEvent.click(screen.getByText('848'));
    expect(onToggle).toHaveBeenCalledWith('880848');
    expect(parentClick).not.toHaveBeenCalled();
  });
});

describe('ActiveFilterPill', () => {
  it('renders nothing when no filter is active', () => {
    const { container } = render(
      <ActiveFilterPill
        activeOrderFilter={null}
        combinedNumbers={['880848', '880787']}
        onClear={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the active order number and calls onClear when clicked', () => {
    const onClear = vi.fn();
    render(
      <ActiveFilterPill
        activeOrderFilter="880848"
        combinedNumbers={['880848', '880787']}
        onClear={onClear}
      />
    );
    expect(screen.getByRole('button').textContent).toContain('880848');
    fireEvent.click(screen.getByRole('button'));
    expect(onClear).toHaveBeenCalled();
  });
});
