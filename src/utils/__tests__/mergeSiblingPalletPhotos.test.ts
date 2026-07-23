import { describe, expect, it } from 'vitest';

import { mergeSiblingPalletPhotos } from '../mergeSiblingPalletPhotos';

describe('mergeSiblingPalletPhotos', () => {
  it('merges photos from all rows, preserving row order', () => {
    const { photos, ownerByUrl } = mergeSiblingPalletPhotos([
      { id: 'a', pallet_photos: ['a1.webp', 'a2.webp'] },
      { id: 'b', pallet_photos: ['b1.webp'] },
    ]);
    expect(photos).toEqual(['a1.webp', 'a2.webp', 'b1.webp']);
    expect(ownerByUrl.get('a1.webp')).toBe('a');
    expect(ownerByUrl.get('a2.webp')).toBe('a');
    expect(ownerByUrl.get('b1.webp')).toBe('b');
  });

  it('treats null pallet_photos as empty', () => {
    const { photos, ownerByUrl } = mergeSiblingPalletPhotos([
      { id: 'a', pallet_photos: null },
      { id: 'b', pallet_photos: ['b1.webp'] },
    ]);
    expect(photos).toEqual(['b1.webp']);
    expect(ownerByUrl.size).toBe(1);
  });

  it('dedupes a URL that appears on more than one row, keeping the first owner', () => {
    const { photos, ownerByUrl } = mergeSiblingPalletPhotos([
      { id: 'a', pallet_photos: ['shared.webp'] },
      { id: 'b', pallet_photos: ['shared.webp', 'b1.webp'] },
    ]);
    expect(photos).toEqual(['shared.webp', 'b1.webp']);
    expect(ownerByUrl.get('shared.webp')).toBe('a');
  });

  it('returns empty results for an empty input', () => {
    const { photos, ownerByUrl } = mergeSiblingPalletPhotos([]);
    expect(photos).toEqual([]);
    expect(ownerByUrl.size).toBe(0);
  });
});
