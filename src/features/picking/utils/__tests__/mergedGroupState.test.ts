import { describe, it, expect } from 'vitest';
import {
  holdsMergedGroupItems,
  isCombinedOrderNumber,
  isUnsafeToWriteItems,
} from '../mergedGroupState';

const ANCHOR = 'da7851b5-46e5-4ced-9f14-25b1b0203f4b';
const SIBLING = '76764088-4622-40e9-bc29-1a634956b236';

describe('holdsMergedGroupItems', () => {
  it('accepts an array of the list’s own items', () => {
    const items = [{ source_list_id: ANCHOR }, { source_list_id: ANCHOR }];
    expect(holdsMergedGroupItems(items, ANCHOR)).toBe(false);
  });

  it('accepts untagged items — a lone order never carries the tag', () => {
    expect(holdsMergedGroupItems([{}, {}], ANCHOR)).toBe(false);
  });

  it('rejects an array carrying a sibling’s items', () => {
    const merged = [{ source_list_id: ANCHOR }, { source_list_id: SIBLING }];
    expect(holdsMergedGroupItems(merged, ANCHOR)).toBe(true);
  });

  it('rejects the same merged array from the sibling’s side', () => {
    const merged = [{ source_list_id: ANCHOR }, { source_list_id: SIBLING }];
    expect(holdsMergedGroupItems(merged, SIBLING)).toBe(true);
  });

  it('cannot judge without a target list, so it does not block the write', () => {
    expect(holdsMergedGroupItems([{ source_list_id: ANCHOR }], null)).toBe(false);
  });
});

describe('isCombinedOrderNumber', () => {
  it.each([
    ['880985 / 880977', true],
    ['879536 / 879539 / 879543', true],
    ['880985', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (orderNum, expected) => {
    expect(isCombinedOrderNumber(orderNum as string | null)).toBe(expected);
  });
});

describe('isUnsafeToWriteItems', () => {
  it('lets a plain single order through', () => {
    expect(isUnsafeToWriteItems([{ source_list_id: ANCHOR }], ANCHOR, '880985')).toBe(false);
  });

  // The regression that reached production: the merged array was saved into
  // 880985 because the order number in memory was a single one, so the old
  // ' / ' sniff never fired.
  it('blocks a merged array even when the order number looks single', () => {
    const merged = [{ source_list_id: ANCHOR }, { source_list_id: SIBLING }];
    expect(isUnsafeToWriteItems(merged, ANCHOR, '880985')).toBe(true);
  });

  // The older regression, still covered: a watchdog-combined row whose local
  // snapshot lags behind. Its items are all its own, so only the order number
  // gives it away.
  it('blocks a stale snapshot of a watchdog-combined row', () => {
    const own = [{ source_list_id: ANCHOR }];
    expect(isUnsafeToWriteItems(own, ANCHOR, '879484 / 879460')).toBe(true);
  });

  it('blocks when both signals fire', () => {
    const merged = [{ source_list_id: SIBLING }];
    expect(isUnsafeToWriteItems(merged, ANCHOR, '880985 / 880977')).toBe(true);
  });
});
