/**
 * Merges `pallet_photos` across a group of `picking_lists` rows (a
 * `group_id`-linked combined order, where each sibling row has its own
 * photos array). Structurally the anchor row's photos are just one of N
 * arrays here — merging is what makes "sometimes images don't appear"
 * (only the anchor's photos were ever surfaced) go away.
 *
 * `ownerByUrl` retains which row a photo came from so a delete action can
 * still target the correct row's `pallet_photos` column.
 */

export interface PhotoOwnerRow {
  id: string;
  pallet_photos: string[] | null;
}

export interface MergedPalletPhotos {
  photos: string[];
  ownerByUrl: Map<string, string>;
}

export function mergeSiblingPalletPhotos(rows: PhotoOwnerRow[]): MergedPalletPhotos {
  const photos: string[] = [];
  const ownerByUrl = new Map<string, string>();
  for (const row of rows) {
    for (const url of row.pallet_photos ?? []) {
      if (!ownerByUrl.has(url)) {
        photos.push(url);
        ownerByUrl.set(url, row.id);
      }
    }
  }
  return { photos, ownerByUrl };
}
