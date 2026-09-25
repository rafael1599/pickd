import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../lib/supabase', () => ({ supabase: {} }));

import { runDcvShadow, type DcvShadowDeps, type DcvShadowJob } from '../dcvShadow';

const file = new File([new Uint8Array(10)], 'p.jpg', { type: 'image/jpeg' });
const job = (over: Partial<DcvShadowJob> = {}): DcvShadowJob => ({
  file,
  photoId: '11111111-1111-1111-1111-111111111111',
  listId: 'list-a',
  groupId: 'group-1',
  groupMembers: ['list-a', 'list-b'],
  lines: [{ list_id: 'list-a', sku: '03-3768BL', qty: 4 }],
  flag: {
    enabled: true,
    sampleRate: 0,
    timeoutMs: 60000,
    queueMax: 3,
    uploadR2000: true,
    onlyUsers: null,
  },
  ...over,
});

const okResult = {
  image: { width: 3840, height: 2160, rotationUsed: 0 },
  timingMs: { total: 4200, barcodes: 900, ocr: 3000, segmentation: 20, catalog: 0 },
  boxes: [],
};

function deps(over: Partial<DcvShadowDeps> = {}) {
  const rows: Record<string, unknown>[] = [];
  const calls: Record<string, unknown>[] = [];
  const d: DcvShadowDeps = {
    invoke: vi.fn(async (body) => {
      calls.push(body);
      if (body.action === 'put') {
        const v = (body.variants as string[])[0];
        return { urls: { [v]: { key: `${v}/2026/09/x.jpg`, url: `https://r2/${v}` } } };
      }
      return { key: 'sample/2026/09/x.jpg' };
    }),
    put: vi.fn(async () => true),
    read: vi.fn(async () => ({
      status: 'ok' as const,
      result: okResult as never,
      reduced: new Blob(['r']),
      queueMs: 5,
      readMs: 4300,
    })),
    insert: vi.fn(async (row) => {
      rows.push(row);
    }),
    device: async () => ({ label: 'SM-S938U', ua: 'ua', memory_gb: 8, cores: 8 }),
    random: () => 0.99,
    now: () => 0,
    newId: () => 'run-1',
    ...over,
  };
  return { d, rows, calls };
}

describe('runDcvShadow', () => {
  it('uploads the original, reads it, uploads r2000 with a fresh url, and records one row', async () => {
    const { d, rows, calls } = deps();
    await runDcvShadow(job(), d);
    expect(d.put).toHaveBeenCalledWith('https://r2/full', file);
    expect(calls.map((c) => (c.variants as string[] | undefined)?.[0] ?? c.action)).toEqual([
      'full',
      'r2000',
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'run-1',
      status: 'ok',
      upload_status: 'ok',
      photo_key: 'full/2026/09/x.jpg',
      photo_width: 3840,
      photo_height: 2160,
      group_members: ['list-a', 'list-b'],
      sampled: false,
      error: null,
      timing_ms: { queue: 5, read: 4300, total: 4200 },
    });
    expect(rows[0].engine_config_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('copies to sample/ only when the photo is drawn', async () => {
    const { d, rows, calls } = deps({ random: () => 0.1 });
    await runDcvShadow(job({ flag: { ...job().flag, sampleRate: 0.25 } }), d);
    expect(calls).toContainEqual({ action: 'sample', key: 'full/2026/09/x.jpg' });
    expect(rows[0]).toMatchObject({ sampled: true, sample_rate: 0.25 });
  });

  it('still records a row when the upload fails, and the read still runs', async () => {
    const { d, rows } = deps({ put: vi.fn(async () => false) });
    await runDcvShadow(job(), d);
    expect(d.read).toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: 'ok', upload_status: 'error', photo_key: null });
    expect(String(rows[0].error)).toContain('upload');
  });

  it('records timeout / unsupported / dropped with no boxes and no r2000', async () => {
    for (const status of ['timeout', 'unsupported', 'dropped'] as const) {
      const { d, rows, calls } = deps({
        read: vi.fn(async () => ({
          status,
          error: status === 'timeout' ? 'slow' : undefined,
          queueMs: 0,
          readMs: 0,
        })),
      });
      await runDcvShadow(job(), d);
      expect(rows[0]).toMatchObject({ status, boxes: [] });
      expect(calls.some((c) => (c.variants as string[] | undefined)?.[0] === 'r2000')).toBe(false);
    }
  });

  it('never throws, even when everything fails', async () => {
    const boom = async () => {
      throw new Error('boom');
    };
    const { d } = deps({ invoke: vi.fn(boom), read: vi.fn(boom), insert: vi.fn(boom) });
    await expect(runDcvShadow(job(), d)).resolves.toBeUndefined();
  });

  it('skips r2000 entirely when the flag says so', async () => {
    const { d } = deps();
    await runDcvShadow(job({ flag: { ...job().flag, uploadR2000: false } }), d);
    expect(vi.mocked(d.read).mock.calls[0][1].reduceTo).toBeUndefined();
  });
});
