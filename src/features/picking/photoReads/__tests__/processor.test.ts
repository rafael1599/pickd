import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  insertPhotoRead: vi.fn(async () => {}),
  setPhotoReadKey: vi.fn(async () => {}),
  releasePhotoRead: vi.fn(async () => {}),
  finishPhotoRead: vi.fn(async () => {}),
  downloadClaimedOriginal: vi.fn(async () => new File(['x'], 'a.jpg')),
}));
const shadow = vi.hoisted(() => ({ runDcvShadow: vi.fn() }));

vi.mock('../api', () => api);
vi.mock('../../api/dcvShadow', () => shadow);

import { photoReadsRunning, resumePhotoRead, startPhotoRead } from '../processor';
import { SHADOW_FLAG_OFF } from '../../utils/dcvShadow';

const flag = { ...SHADOW_FLAG_OFF, enabled: true };
const job = {
  file: new File(['x'], 'p.jpg'),
  photoId: 'p1',
  listId: 'l1',
  groupId: null,
  groupMembers: ['l1'],
  lines: [{ list_id: 'l1', sku: '03-4537GY', qty: 2 }],
  snapshot: [],
  flag,
  takenAt: 1_700_000_000_000,
  palletHint: 1,
  shot: 1,
};

beforeEach(() => vi.clearAllMocks());

describe('startPhotoRead', () => {
  it('deja su fila, corre la sombra y termina con las alertas para todos', async () => {
    shadow.runDcvShadow.mockImplementation(async (j: { onUploaded?: (k: string) => void }) => {
      j.onUploaded?.('full/2026/10/p1.jpg');
      return [{ sku: '03-4547MN' }, { sku: '03-4547MN' }];
    });
    await startPhotoRead(job);
    expect(api.insertPhotoRead).toHaveBeenCalledWith(
      expect.objectContaining({ photo_id: 'p1', list_id: 'l1', pallet_hint: 1, shot: 1 })
    );
    expect(api.setPhotoReadKey).toHaveBeenCalledWith('p1', 'full/2026/10/p1.jpg');
    expect(api.finishPhotoRead).toHaveBeenCalledWith(
      'p1',
      [expect.objectContaining({ kind: 'wrong_pick', sku: '03-4547MN', count: 2 })],
      null,
      null
    );
    expect(photoReadsRunning()).toBe(0);
  });

  it('sin lectura (cola llena) suelta la fila para otra PickD', async () => {
    shadow.runDcvShadow.mockImplementation(async (j: { onOutcome?: (s: string) => void }) => {
      j.onOutcome?.('dropped');
      return null;
    });
    await startPhotoRead(job);
    expect(api.releasePhotoRead).toHaveBeenCalledWith('p1', 'dropped');
    expect(api.finishPhotoRead).not.toHaveBeenCalled();
  });
});

describe('resumePhotoRead', () => {
  it('baja el original con su reclamo y no lo vuelve a subir', async () => {
    shadow.runDcvShadow.mockResolvedValue([]);
    await resumePhotoRead(
      {
        photo_id: 'p2',
        list_id: 'l1',
        group_id: null,
        group_members: ['l1'],
        lines: [],
        snapshot: [],
        photo_key: 'full/2026/10/p2.jpg',
      } as never,
      flag
    );
    expect(api.downloadClaimedOriginal).toHaveBeenCalledWith('full/2026/10/p2.jpg');
    expect(shadow.runDcvShadow).toHaveBeenCalledWith(
      expect.objectContaining({ existingKey: 'full/2026/10/p2.jpg', photoId: 'p2' })
    );
    expect(api.finishPhotoRead).toHaveBeenCalled();
  });
});
