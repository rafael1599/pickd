import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SdDetailsCard, type SdDetailsValues } from '../SdDetailsCard';

const empty: SdDetailsValues = {
  category: '',
  condition: '',
  conditionDescription: '',
  forSale: '',
  msrp: null,
  standardPrice: null,
  pdfLink: '',
};

describe('SdDetailsCard', () => {
  it('offers every S/D field to fill when they are empty', () => {
    render(<SdDetailsCard values={empty} isEditing={false} onChange={() => {}} />);
    expect(screen.getByLabelText('Condition description')).toBeTruthy();
    expect(document.getElementById('sd-category')).toBeTruthy();
    expect(document.getElementById('sd-msrp')).toBeTruthy();
    expect(document.getElementById('sd-standardPrice')).toBeTruthy();
    expect(document.getElementById('sd-pdf-link')).toBeTruthy();
    expect(screen.getByText('Ridden / demo')).toBeTruthy();
  });

  it('reports each change under its own key', () => {
    const onChange = vi.fn();
    render(<SdDetailsCard values={empty} isEditing onChange={onChange} />);
    fireEvent.change(document.getElementById('sd-category')!, { target: { value: 'gravel' } });
    fireEvent.click(screen.getByText('New · built'));
    fireEvent.change(document.getElementById('sd-msrp')!, { target: { value: '899.95' } });
    fireEvent.change(document.getElementById('sd-standardPrice')!, { target: { value: '428.95' } });
    expect(onChange).toHaveBeenCalledWith('category', 'gravel');
    expect(onChange).toHaveBeenCalledWith('condition', 'new_built');
    expect(onChange).toHaveBeenCalledWith('msrp', 899.95);
    expect(onChange).toHaveBeenCalledWith('standardPrice', 428.95);
  });

  it('shows a bike being registered as Not yet, and reports For sale by its code', () => {
    const onChange = vi.fn();
    render(<SdDetailsCard values={empty} isEditing onChange={onChange} />);
    expect(screen.getByText('Not yet').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('No'));
    fireEvent.click(screen.getByText('Yes'));
    expect(onChange).toHaveBeenCalledWith('forSale', 'no');
    expect(onChange).toHaveBeenCalledWith('forSale', 'yes');
  });

  it('keeps a stored condition the list does not know', () => {
    render(
      <SdDetailsCard values={{ ...empty, condition: 'used' }} isEditing onChange={() => {}} />
    );
    expect(screen.getByText('used')).toBeTruthy();
  });
});

it('clears a price to null, not 0', () => {
  const onChange = vi.fn();
  render(<SdDetailsCard values={{ ...empty, msrp: 649.95 }} isEditing onChange={onChange} />);
  fireEvent.change(document.getElementById('sd-msrp')!, { target: { value: '' } });
  expect(onChange).toHaveBeenCalledWith('msrp', null);
});
