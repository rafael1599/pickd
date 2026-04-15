import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  compressImage,
  base64ToBlobUrl,
  uploadGalleryPhoto,
  deleteGalleryPhoto,
} from '../../../services/photoUpload.service';
import type { GalleryPhoto } from '../../../schemas/galleryPhoto';

const GALLERY_KEY = ['gallery-photos'] as const;

// ─── Query: fetch active (non-deleted) gallery photos ───────────────────────

export function useGalleryPhotos() {
  return useQuery({
    queryKey: GALLERY_KEY,
    queryFn: async (): Promise<GalleryPhoto[]> => {
      const { data, error } = await supabase
        .from('gallery_photos')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as GalleryPhoto[]) ?? [];
    },
  });
}

// ─── Mutation: upload a new gallery photo ───────────────────────────────────

export function useUploadGalleryPhoto() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { file: File }) => {
      const photoId = crypto.randomUUID();

      let url: string;
      let thumbnailUrl: string;

      try {
        // Try R2 upload via edge function (production)
        const result = await uploadGalleryPhoto(photoId, vars.file);
        url = result.url;
        thumbnailUrl = result.thumbnailUrl;
      } catch {
        // Fallback: compress client-side and use blob URLs (local dev)
        const { image, thumbnail } = await compressImage(vars.file);
        url = base64ToBlobUrl(image);
        thumbnailUrl = base64ToBlobUrl(thumbnail);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from('gallery_photos')
        .insert({
          id: photoId,
          filename: vars.file.name,
          url,
          thumbnail_url: thumbnailUrl,
          created_by: user?.id ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as GalleryPhoto;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GALLERY_KEY });
    },
  });
}

const TRASH_KEY = ['gallery-photos-trash'] as const;

// ─── Mutation: soft delete (move to trash) ──────────────────────────────────

export function useSoftDeletePhotos() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (photoIds: string[]) => {
      const { error } = await supabase
        .from('gallery_photos')
        .update({ deleted_at: new Date().toISOString() })
        .in('id', photoIds);
      if (error) throw error;
    },
    onMutate: async (photoIds) => {
      await qc.cancelQueries({ queryKey: GALLERY_KEY });
      const previous = qc.getQueryData<GalleryPhoto[]>(GALLERY_KEY);
      qc.setQueryData<GalleryPhoto[]>(GALLERY_KEY, (old) =>
        (old ?? []).filter((p) => !photoIds.includes(p.id))
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(GALLERY_KEY, ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GALLERY_KEY });
      qc.invalidateQueries({ queryKey: TRASH_KEY });
    },
  });
}

// ─── Query: fetch trashed photos (within 14-day window) ────────────────────

export function useTrashPhotos() {
  return useQuery({
    queryKey: TRASH_KEY,
    queryFn: async (): Promise<GalleryPhoto[]> => {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('gallery_photos')
        .select('*')
        .not('deleted_at', 'is', null)
        .gte('deleted_at', fourteenDaysAgo)
        .order('deleted_at', { ascending: false });
      if (error) throw error;
      return (data as GalleryPhoto[]) ?? [];
    },
  });
}

// ─── Mutation: restore photos from trash ───────────────────────────────────

export function useRestorePhotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photoIds: string[]) => {
      const { error } = await supabase
        .from('gallery_photos')
        .update({ deleted_at: null })
        .in('id', photoIds);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: GALLERY_KEY });
      qc.invalidateQueries({ queryKey: TRASH_KEY });
    },
  });
}

// ─── Mutation: permanently delete photos ───────────────────────────────────

export function usePermanentDeletePhotos() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (photoIds: string[]) => {
      // 1. Delete from R2 first (best effort — ignore failures for local dev)
      await Promise.allSettled(photoIds.map((id) => deleteGalleryPhoto(id)));

      // 2. Then hard delete from DB (CASCADE removes task_photos)
      const { error } = await supabase.from('gallery_photos').delete().in('id', photoIds);
      if (error) throw error;
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: TRASH_KEY });
    },
  });
}
