import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useCombinedOrderFilter } from '../useCombinedOrderFilter';

describe('useCombinedOrderFilter', () => {
  it('parses combinedNumbers and isCombined from a joined order_number', () => {
    const { result } = renderHook(() => useCombinedOrderFilter('880848 / 880787'));
    expect(result.current.combinedNumbers).toEqual(['880848', '880787']);
    expect(result.current.isCombined).toBe(true);
    expect(result.current.activeOrderFilter).toBeNull();
  });

  it('is not combined for a single order number', () => {
    const { result } = renderHook(() => useCombinedOrderFilter('880848'));
    expect(result.current.isCombined).toBe(false);
  });

  it('toggleOrderFilter sets then clears the same number', () => {
    const { result } = renderHook(() => useCombinedOrderFilter('880848 / 880787'));

    act(() => result.current.toggleOrderFilter('880848'));
    expect(result.current.activeOrderFilter).toBe('880848');

    act(() => result.current.toggleOrderFilter('880848'));
    expect(result.current.activeOrderFilter).toBeNull();
  });

  it('toggleOrderFilter switches to a different number without needing to clear first', () => {
    const { result } = renderHook(() => useCombinedOrderFilter('880848 / 880787'));

    act(() => result.current.toggleOrderFilter('880848'));
    act(() => result.current.toggleOrderFilter('880787'));
    expect(result.current.activeOrderFilter).toBe('880787');
  });

  it('clearOrderFilter resets to null', () => {
    const { result } = renderHook(() => useCombinedOrderFilter('880848 / 880787'));
    act(() => result.current.toggleOrderFilter('880848'));
    act(() => result.current.clearOrderFilter());
    expect(result.current.activeOrderFilter).toBeNull();
  });

  it('resets the active filter when orderNumber changes', () => {
    const { result, rerender } = renderHook(
      ({ orderNumber }) => useCombinedOrderFilter(orderNumber),
      { initialProps: { orderNumber: '880848 / 880787' } }
    );

    act(() => result.current.toggleOrderFilter('880848'));
    expect(result.current.activeOrderFilter).toBe('880848');

    rerender({ orderNumber: '990001 / 990002' });
    expect(result.current.activeOrderFilter).toBeNull();
    expect(result.current.combinedNumbers).toEqual(['990002', '990001']);
  });

  it('presetFilterForNextOrder applies the filter exactly when the armed order_number arrives', () => {
    const { result, rerender } = renderHook(
      ({ orderNumber }) => useCombinedOrderFilter(orderNumber),
      { initialProps: { orderNumber: '880848 / 880787' } }
    );

    act(() => result.current.presetFilterForNextOrder('990001 / 990002', '990002'));
    rerender({ orderNumber: '990001 / 990002' });
    expect(result.current.activeOrderFilter).toBe('990002');
  });

  it('presetFilterForNextOrder is ignored if a different order_number arrives instead', () => {
    const { result, rerender } = renderHook(
      ({ orderNumber }) => useCombinedOrderFilter(orderNumber),
      { initialProps: { orderNumber: '880848 / 880787' } }
    );

    act(() => result.current.presetFilterForNextOrder('990001 / 990002', '990002'));
    rerender({ orderNumber: '770001' });
    expect(result.current.activeOrderFilter).toBeNull();
  });

  it('presetFilterForNextOrder is consumed once — a later unrelated order change still resets', () => {
    const { result, rerender } = renderHook(
      ({ orderNumber }) => useCombinedOrderFilter(orderNumber),
      { initialProps: { orderNumber: '880848 / 880787' } }
    );

    act(() => result.current.presetFilterForNextOrder('990001 / 990002', '990002'));
    rerender({ orderNumber: '990001 / 990002' });
    expect(result.current.activeOrderFilter).toBe('990002');

    rerender({ orderNumber: '770001' });
    expect(result.current.activeOrderFilter).toBeNull();
  });
});
