import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PalletEventRow } from '../../utils/palletEvents';

const upsert = vi.fn();
vi.mock('../../../../lib/supabase', () => ({
  supabase: { from: () => ({ upsert }) },
}));

const row = (id: string): PalletEventRow => ({
  id,
  client_at: '2026-10-03T20:00:00.000Z',
  device: 'dev',
  list_id: 'l',
  kind: 'check',
  phase: 'pick',
  sku: 'A',
  location: 'ROW 1',
  cart_pallet: 1,
  pallet: null,
  payload: {},
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('recordPalletEvents', () => {
  beforeEach(() => {
    localStorage.clear();
    upsert.mockReset();
    vi.resetModules();
  });

  it('sin señal, los eventos esperan en el teléfono y salen al volver, en el mismo orden', async () => {
    const { recordPalletEvents } = await import('../palletEvents');
    upsert.mockResolvedValueOnce({ error: { message: 'Failed to fetch' } });
    recordPalletEvents([row('a'), row('b')]);
    await flush();
    expect(
      JSON.parse(localStorage.getItem('pickd.pallet_events_queue')!).map(
        (r: PalletEventRow) => r.id
      )
    ).toEqual(['a', 'b']);

    upsert.mockResolvedValue({ error: null });
    recordPalletEvents([row('c')]);
    await flush();
    await flush();
    expect(upsert).toHaveBeenLastCalledWith([row('a'), row('b'), row('c')], {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
    expect(localStorage.getItem('pickd.pallet_events_queue')).toBeNull();
  });

  it('nunca lanza aunque la red reviente', async () => {
    const { recordPalletEvents } = await import('../palletEvents');
    upsert.mockRejectedValueOnce(new Error('offline'));
    expect(() => recordPalletEvents([row('x')])).not.toThrow();
    await flush();
    expect(localStorage.getItem('pickd.pallet_events_queue')).toContain('"x"');
  });
});
