import { describe, it, beforeEach, afterEach, vi, expect } from 'vitest';
import { generateShoppingListPdf } from '../generateShoppingListPdf';
import type { ShoppingItem } from '../hooks/useShoppingList';
import {
  createRecorder,
  expectGrayscaleOnly,
  expectNoTextOverlap,
  expectOrderedText,
  expectContains,
  type PdfRecorder,
} from '../../../test/pdfRecorder';

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>();
  const { wrapJsPDFConstructor } = await import('../../../test/pdfRecorder');
  const Wrapped = wrapJsPDFConstructor(actual.default);
  return { ...actual, default: Wrapped, jsPDF: Wrapped };
});

const item = (over: Partial<ShoppingItem>): ShoppingItem =>
  ({
    id: Math.random().toString(),
    item_name: 'Item',
    quantity: 1,
    status: 'pending',
    urgent: false,
    created_at: '2026-06-01T00:00:00Z',
    ...over,
  }) as unknown as ShoppingItem;

describe('generateShoppingListPdf', () => {
  let rec: PdfRecorder;
  beforeEach(() => {
    rec = createRecorder();
    vi.spyOn(window, 'open').mockReturnValue(null);
  });
  afterEach(() => {
    rec.restore();
    vi.restoreAllMocks();
  });

  const items = [
    item({
      item_name: 'Brake Pads',
      quantity: 4,
      urgent: true,
      created_at: '2026-06-02T00:00:00Z',
    }),
    item({ item_name: 'Chain Lube', quantity: 2, created_at: '2026-06-03T00:00:00Z' }),
    item({ item_name: 'Done item', status: 'received' }),
  ];

  it('is black & white, ordered, nothing overlapping, and complete', async () => {
    await generateShoppingListPdf(items);

    expectGrayscaleOnly(rec);
    expectNoTextOverlap(rec);
    // Header + table headings + both pending items present (received one excluded).
    expectContains(rec, ['SHOPPING LIST', '2 items', 'Item', 'Qty', 'Brake Pads', 'Chain Lube']);
    expect(rec.allText()).not.toContain('Done item');
    // Title above count above the table heading above the first row.
    expectOrderedText(rec, ['SHOPPING LIST', '2 items', 'Item', 'Brake Pads']);
  });

  it('renders an empty PDF for no pending items (no draws)', async () => {
    await generateShoppingListPdf([item({ status: 'received' })]);
    expect(rec.texts()).toHaveLength(0);
  });
});
