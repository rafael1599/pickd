import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const insert = vi.fn();
const update = vi.fn();
const eqUpdate = vi.fn();

vi.mock('../../../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle }) }),
      }),
      insert,
      update: (...args: unknown[]) => {
        update(...args);
        return { eq: eqUpdate };
      },
    }),
  },
}));

const { recordSkuSerial, normalizeSerial } = await import('../skuSerials.service');

describe('normalizeSerial', () => {
  it('normalises the same way on every read so a rescan matches', () => {
    expect(normalizeSerial('  m25h 000440 ')).toBe('M25H000440');
  });
});

describe('recordSkuSerial', () => {
  beforeEach(() => {
    maybeSingle.mockReset();
    insert.mockReset();
    update.mockReset();
    eqUpdate.mockReset();
    insert.mockResolvedValue({ error: null });
    eqUpdate.mockResolvedValue({ error: null });
  });

  it('records a carton the table has not seen', async () => {
    maybeSingle.mockResolvedValue({ data: null });

    await expect(
      recordSkuSerial({ sku: '07-3721RD', serial: 'M25H000440', warehouse: 'LUDLOW' })
    ).resolves.toBe('saved');

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ sku: '07-3721RD', serial: 'M25H000440', source: 'label_scan' })
    );
  });

  it('bumps the counter instead of inserting a twin when the box is rescanned', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'row-1', seen_count: 2 } });

    await expect(
      recordSkuSerial({ sku: '07-3721RD', serial: 'M25H000440' })
    ).resolves.toBe('saved');

    expect(insert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ seen_count: 3 }));
  });

  it('skips a reading too short to be a serial rather than storing noise', async () => {
    await expect(recordSkuSerial({ sku: '07-3721RD', serial: 'M2' })).resolves.toBe('skipped');
    expect(insert).not.toHaveBeenCalled();
  });

  it('skips when there is no SKU to attach the carton to', async () => {
    await expect(recordSkuSerial({ sku: '', serial: 'M25H000440' })).resolves.toBe('skipped');
    expect(insert).not.toHaveBeenCalled();
  });

  it('reports a failed save instead of throwing into the registration flow', async () => {
    maybeSingle.mockResolvedValue({ data: null });
    insert.mockResolvedValue({ error: { message: 'rls' } });

    await expect(
      recordSkuSerial({ sku: '07-3721RD', serial: 'M25H000440' })
    ).resolves.toBe('skipped');
  });
});
