import { describe, it, expect } from 'vitest';
import type { PickingItem, CorrectionAction } from '../DoubleCheckView';

/**
 * Pure logic extracted from handleCorrectItem in PickingCartDrawer.
 * Tests the item transformation for each correction action type.
 */
function applyCorrection(cartItems: PickingItem[], action: CorrectionAction): { items: PickingItem[]; log: string } {
  let newItems: PickingItem[];
  let logMessage: string;

  switch (action.type) {
    case 'swap': {
      newItems = cartItems.map((item) =>
        item.sku === action.originalSku
          ? {
              ...item,
              sku: action.replacement.sku,
              location: action.replacement.location,
              item_name: action.replacement.item_name,
              warehouse: action.replacement.warehouse,
              sku_not_found: false,
              insufficient_stock: false,
            }
          : item,
      );
      logMessage = `Swapped SKU ${action.originalSku} → ${action.replacement.sku}`;
      break;
    }
    case 'adjust_qty': {
      newItems = cartItems.map((item) =>
        item.sku === action.sku ? { ...item, pickingQty: action.newQty, insufficient_stock: false } : item,
      );
      logMessage = `Adjusted qty for ${action.sku} to ${action.newQty}`;
      break;
    }
    case 'remove': {
      newItems = cartItems.filter((item) => item.sku !== action.sku);
      logMessage = `Removed SKU ${action.sku} from order`;
      break;
    }
    case 'add': {
      const existing = cartItems.find((item) => item.sku === action.item.sku);
      if (existing) {
        newItems = cartItems.map((item) =>
          item.sku === action.item.sku
            ? { ...item, pickingQty: item.pickingQty + action.item.pickingQty }
            : item,
        );
        logMessage = `Extra item: ${action.item.sku}, qty ${action.item.pickingQty} (total ${existing.pickingQty + action.item.pickingQty})`;
      } else {
        newItems = [
          ...cartItems,
          {
            sku: action.item.sku,
            location: action.item.location,
            warehouse: action.item.warehouse,
            item_name: action.item.item_name,
            pickingQty: action.item.pickingQty,
            sku_not_found: false,
            insufficient_stock: false,
          },
        ];
        logMessage = `Extra item: ${action.item.sku}, qty ${action.item.pickingQty}`;
      }
      break;
    }
  }

  return { items: newItems, log: logMessage };
}

// ── Test fixtures ──

function makeItem(overrides: Partial<PickingItem> = {}): PickingItem {
  return {
    sku: '03-4614BK',
    location: 'ROW 43',
    pickingQty: 1,
    warehouse: 'LUDLOW',
    item_name: 'FAULTLINE A1 V2 15 2026 GLOSS BLACK',
    sku_not_found: false,
    insufficient_stock: false,
    ...overrides,
  };
}

const BASE_CART: PickingItem[] = [
  makeItem({ sku: '03-4614BK', pickingQty: 2, location: 'ROW 43' }),
  makeItem({ sku: '03-4614ZZ', pickingQty: 1, location: null, sku_not_found: true, item_name: 'PHANTOM PURPLE' }),
  makeItem({ sku: '03-3764BK', pickingQty: 50, location: 'ROW 9', insufficient_stock: true, item_name: 'HELIX A2' }),
];

// ── Tests ──

describe('Correction Actions', () => {
  describe('swap', () => {
    it('replaces SKU, location, warehouse, name and clears error flags', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'swap',
        originalSku: '03-4614ZZ',
        replacement: { sku: '03-4614RD', location: 'ROW 10', warehouse: 'LUDLOW', item_name: 'GARNET' },
      });

      const swapped = items.find((i) => i.sku === '03-4614RD');
      expect(swapped).toBeDefined();
      expect(swapped!.location).toBe('ROW 10');
      expect(swapped!.item_name).toBe('GARNET');
      expect(swapped!.sku_not_found).toBe(false);
      expect(swapped!.insufficient_stock).toBe(false);

      // Original SKU should no longer exist
      expect(items.find((i) => i.sku === '03-4614ZZ')).toBeUndefined();
    });

    it('preserves pickingQty from original item', () => {
      const cart = [makeItem({ sku: '03-9999XX', pickingQty: 5, sku_not_found: true })];
      const { items } = applyCorrection(cart, {
        type: 'swap',
        originalSku: '03-9999XX',
        replacement: { sku: '03-4614BK', location: 'ROW 43', warehouse: 'LUDLOW', item_name: 'BLACK' },
      });

      expect(items[0].pickingQty).toBe(5);
    });

    it('does not affect other items in the cart', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'swap',
        originalSku: '03-4614ZZ',
        replacement: { sku: '03-4614RD', location: 'ROW 10', warehouse: 'LUDLOW', item_name: 'GARNET' },
      });

      expect(items).toHaveLength(3);
      expect(items.find((i) => i.sku === '03-4614BK')).toBeDefined();
      expect(items.find((i) => i.sku === '03-3764BK')).toBeDefined();
    });

    it('generates correct log message', () => {
      const { log } = applyCorrection(BASE_CART, {
        type: 'swap',
        originalSku: '03-4614ZZ',
        replacement: { sku: '03-4614RD', location: 'ROW 10', warehouse: 'LUDLOW', item_name: 'GARNET' },
      });

      expect(log).toBe('Swapped SKU 03-4614ZZ → 03-4614RD');
    });
  });

  describe('adjust_qty', () => {
    it('updates quantity for the target SKU', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'adjust_qty',
        sku: '03-3764BK',
        newQty: 2,
      });

      expect(items.find((i) => i.sku === '03-3764BK')!.pickingQty).toBe(2);
    });

    it('clears insufficient_stock flag', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'adjust_qty',
        sku: '03-3764BK',
        newQty: 2,
      });

      expect(items.find((i) => i.sku === '03-3764BK')!.insufficient_stock).toBe(false);
    });

    it('does not affect other items', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'adjust_qty',
        sku: '03-3764BK',
        newQty: 2,
      });

      expect(items).toHaveLength(3);
      expect(items.find((i) => i.sku === '03-4614BK')!.pickingQty).toBe(2);
    });

    it('generates correct log message', () => {
      const { log } = applyCorrection(BASE_CART, {
        type: 'adjust_qty',
        sku: '03-3764BK',
        newQty: 2,
      });

      expect(log).toBe('Adjusted qty for 03-3764BK to 2');
    });
  });

  describe('remove', () => {
    it('removes the target SKU from the cart', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'remove',
        sku: '03-4614ZZ',
      });

      expect(items).toHaveLength(2);
      expect(items.find((i) => i.sku === '03-4614ZZ')).toBeUndefined();
    });

    it('preserves other items untouched', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'remove',
        sku: '03-4614ZZ',
      });

      expect(items[0].sku).toBe('03-4614BK');
      expect(items[1].sku).toBe('03-3764BK');
    });

    it('generates correct log message', () => {
      const { log } = applyCorrection(BASE_CART, {
        type: 'remove',
        sku: '03-4614ZZ',
      });

      expect(log).toBe('Removed SKU 03-4614ZZ from order');
    });

    it('returns empty array when removing the only item', () => {
      const cart = [makeItem()];
      const { items } = applyCorrection(cart, { type: 'remove', sku: '03-4614BK' });

      expect(items).toHaveLength(0);
    });
  });

  describe('add', () => {
    it('adds a new item to the cart with clean flags', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'add',
        item: { sku: '06-4572GY', location: 'ROW 2', warehouse: 'LUDLOW', item_name: 'EC1 18', pickingQty: 3 },
      });

      expect(items).toHaveLength(4);
      const added = items.find((i) => i.sku === '06-4572GY');
      expect(added).toBeDefined();
      expect(added!.pickingQty).toBe(3);
      expect(added!.location).toBe('ROW 2');
      expect(added!.sku_not_found).toBe(false);
      expect(added!.insufficient_stock).toBe(false);
    });

    it('merges quantity when SKU already exists in cart', () => {
      const { items, log } = applyCorrection(BASE_CART, {
        type: 'add',
        item: { sku: '03-4614BK', location: 'ROW 43', warehouse: 'LUDLOW', item_name: 'BLACK', pickingQty: 3 },
      });

      // Should NOT add a new entry
      expect(items).toHaveLength(3);
      // Should sum quantities: 2 + 3 = 5
      expect(items.find((i) => i.sku === '03-4614BK')!.pickingQty).toBe(5);
      expect(log).toContain('total 5');
    });

    it('generates "Extra item" log for new SKU', () => {
      const { log } = applyCorrection(BASE_CART, {
        type: 'add',
        item: { sku: '06-4572GY', location: 'ROW 2', warehouse: 'LUDLOW', item_name: 'EC1', pickingQty: 2 },
      });

      expect(log).toBe('Extra item: 06-4572GY, qty 2');
    });

    it('generates "Extra item" log with total for existing SKU', () => {
      const { log } = applyCorrection(BASE_CART, {
        type: 'add',
        item: { sku: '03-4614BK', location: 'ROW 43', warehouse: 'LUDLOW', item_name: 'BLACK', pickingQty: 1 },
      });

      expect(log).toBe('Extra item: 03-4614BK, qty 1 (total 3)');
    });
  });

  describe('immutability', () => {
    it('does not mutate the original cart array', () => {
      const original = [...BASE_CART];
      applyCorrection(BASE_CART, { type: 'remove', sku: '03-4614ZZ' });

      expect(BASE_CART).toEqual(original);
      expect(BASE_CART).toHaveLength(3);
    });

    it('does not mutate original items on swap', () => {
      const originalItem = { ...BASE_CART[1] };
      applyCorrection(BASE_CART, {
        type: 'swap',
        originalSku: '03-4614ZZ',
        replacement: { sku: '03-4614RD', location: 'ROW 10', warehouse: 'LUDLOW', item_name: 'GARNET' },
      });

      expect(BASE_CART[1]).toEqual(originalItem);
    });
  });

  describe('edge cases', () => {
    it('swap on non-existent SKU returns cart unchanged', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'swap',
        originalSku: 'NONEXISTENT',
        replacement: { sku: '03-4614RD', location: 'ROW 10', warehouse: 'LUDLOW', item_name: 'GARNET' },
      });

      expect(items).toHaveLength(3);
      expect(items.map((i) => i.sku)).toEqual(BASE_CART.map((i) => i.sku));
    });

    it('remove on non-existent SKU returns cart unchanged', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'remove',
        sku: 'NONEXISTENT',
      });

      expect(items).toHaveLength(3);
    });

    it('adjust_qty on non-existent SKU returns cart unchanged', () => {
      const { items } = applyCorrection(BASE_CART, {
        type: 'adjust_qty',
        sku: 'NONEXISTENT',
        newQty: 10,
      });

      expect(items).toHaveLength(3);
      // All quantities unchanged
      expect(items[0].pickingQty).toBe(2);
      expect(items[1].pickingQty).toBe(1);
      expect(items[2].pickingQty).toBe(50);
    });

    it('handles empty cart gracefully', () => {
      const { items: removed } = applyCorrection([], { type: 'remove', sku: 'ANY' });
      expect(removed).toHaveLength(0);

      const { items: added } = applyCorrection([], {
        type: 'add',
        item: { sku: 'NEW', location: null, warehouse: 'LUDLOW', item_name: null, pickingQty: 1 },
      });
      expect(added).toHaveLength(1);
      expect(added[0].sku).toBe('NEW');
    });
  });
});
