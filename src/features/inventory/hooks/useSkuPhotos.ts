/**
 * The photos of a SKU after its cover (`sku_photos`, 20261006011325), seen
 * only on the item card. The cover stays `sku_metadata.image_url`; these go to
 * R2 through the gallery mode of `upload-photo`, like the pallet photos.
 *
 * A shot shows at once from its local thumbnail and stays marked `pending`
 * until the file and its row are saved, so a burst of shots never waits.
 */
import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../context/AuthContext';
import { deleteGalleryPhoto, uploadGalleryPhoto } from '../../../services/photoUpload.service';

export interface SkuPhoto {
  id: string;
  url: string;
  thumbnailUrl: string;
  pending?: boolean;
}

export const skuPhotosKey = (sku: string) => ['sku-photos', sku];

export function useSkuPhotos(sku: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [pending, setPending] = useState<SkuPhoto[]>([]);

  const { data: saved = [] } = useQuery({
    queryKey: skuPhotosKey(sku),
    enabled: enabled && !!sku,
    staleTime: 30_000,
    queryFn: async (): Promise<SkuPhoto[]> => {
      const { data, error } = await supabase
        .from('sku_photos')
        .select('id, url, thumbnail_url')
        .eq('sku', sku)
        // A photo of an archived S/D stays with that unit (idea-257).
        .is('sd_unit_id', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p) => ({ id: p.id, url: p.url, thumbnailUrl: p.thumbnail_url }));
    },
  });

  const add = useCallback(
    async (file: File) => {
      const id = crypto.randomUUID();
      const local = URL.createObjectURL(file);
      setPending((prev) => [...prev, { id, url: local, thumbnailUrl: local, pending: true }]);
      try {
        const { url, thumbnailUrl } = await uploadGalleryPhoto(id, file);
        const { error } = await supabase.from('sku_photos').insert({
          id,
          sku,
          url,
          thumbnail_url: thumbnailUrl,
          created_by: user?.id ?? null,
        });
        if (error) throw error;
        await queryClient.invalidateQueries({ queryKey: skuPhotosKey(sku) });
      } catch {
        toast.error('Photo upload failed');
      } finally {
        setPending((prev) => prev.filter((p) => p.id !== id));
        URL.revokeObjectURL(local);
      }
    },
    [sku, user?.id, queryClient]
  );

  const remove = useCallback(
    async (id: string) => {
      queryClient.setQueryData<SkuPhoto[]>(skuPhotosKey(sku), (old) =>
        (old ?? []).filter((p) => p.id !== id)
      );
      const { error } = await supabase.from('sku_photos').delete().eq('id', id);
      if (error) {
        toast.error('Failed to remove photo');
        await queryClient.invalidateQueries({ queryKey: skuPhotosKey(sku) });
        return;
      }
      // The row is what the card shows; a file left behind in R2 hides nothing.
      await deleteGalleryPhoto(id).catch(() => {});
      toast.success('Photo removed');
    },
    [sku, queryClient]
  );

  return { photos: [...saved, ...pending], add, remove };
}
