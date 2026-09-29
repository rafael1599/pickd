import { describe, it, expect } from 'vitest';
import { combinedCardKey, countDistinctOrders } from '../mergeGroupOrders';

const order = (group_id: string | null, group_type: string | null) => ({
  group_id,
  order_group: group_type ? { id: group_id ?? '', group_type } : null,
});

describe('combinedCardKey / countDistinctOrders', () => {
  it('a deliberate combine is one card and one count', () => {
    const orders = [order('g1', 'general'), order('g1', 'general'), order('g2', 'pickup')];
    expect(orders.map((o) => combinedCardKey(o as never))).toEqual(['g1', 'g1', 'g2']);
    expect(countDistinctOrders(orders as never)).toBe(2);
  });

  it('a FedEx batch never shares a card: each member is its own order', () => {
    const orders = [order('f1', 'fedex'), order('f1', 'fedex'), order(null, null)];
    expect(orders.map((o) => combinedCardKey(o as never))).toEqual([null, null, null]);
    expect(countDistinctOrders(orders as never)).toBe(3);
  });
});
