import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import {
  compressImage,
  base64ToBlobUrl,
  uploadGalleryPhoto,
  deleteGalleryPhoto,
} from '../../../services/photoUpload.service';
import type { GalleryPhoto } from '../../../schemas/galleryPhoto';

export const GALLERY_KEY = ['gallery-photos'] as const;
export const ARCHIVED_KEY = ['gallery-photos-archived'] as const;

// ─── Query: fetch UNASSIGNED gallery photos (not linked to any task) ───────

export function useGalleryPhotos() {
  return useQuery({
    queryKey: GALLERY_KEY,
    queryFn: async (): Promise<GalleryPhoto[]> => {
      // Two queries because PostgREST can't do `NOT IN (subquery)` cleanly.
      // Fetch all active photos + all task_photos mappings, then subtract.
      const [photosRes, assignedRes] = await Promise.all([
        supabase
          .from('gallery_photos')
          .select('*')
          .is('deleted_at', null)
          .order('created_at', { ascending: false }),
        supabase.from('task_photos').select('photo_id'),
      ]);
      if (photosRes.error) throw photosRes.error;
      if (assignedRes.error) throw assignedRes.error;
      const assignedIds = new Set(
        (assignedRes.data ?? []).map((r: { photo_id: string }) => r.photo_id)
      );
      return ((photosRes.data as GalleryPhoto[]) ?? []).filter((p) => !assignedIds.has(p.id));
    },
  });
}

// ─── Query: fetch ARCHIVED photos (assigned to a task) + task titles ────────

export interface ArchivedPhoto extends GalleryPhoto {
  task_id: string;
  task_title: string;
  task_status: 'future' | 'in_progress' | 'done';
  assigned_at: string;
}

export function useArchivedPhotos() {
  return useQuery({
    queryKey: ARCHIVED_KEY,
    queryFn: async (): Promise<ArchivedPhoto[]> => {
      // Join task_photos → gallery_photos + project_tasks in a single request.
      const { data, error } = await supabase
        .from('task_photos')
        .select(
          'photo_id, task_id, assigned_at, gallery_photos(*), project_tasks(id, title, status)'
        )
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        photo_id: string;
        task_id: string;
        assigned_at: string;
        gallery_photos: GalleryPhoto | null;
        project_tasks: { id: string; title: string; status: ArchivedPhoto['task_status'] } | null;
      }>;
      return rows
        .filter((r) => r.gallery_photos && !r.gallery_photos.deleted_at && r.project_tasks)
        .map((r) => ({
          ...(r.gallery_photos as GalleryPhoto),
          task_id: r.task_id,
          task_title: r.project_tasks!.title,
          task_status: r.project_tasks!.status,
          assigned_at: r.assigned_at,
        }));
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

      const isLocal = window.location.hostname === 'localhost';

      try {
        // Upload to R2 via edge function
        const result = await uploadGalleryPhoto(photoId, vars.file);
        url = result.url;
        thumbnailUrl = result.thumbnailUrl;
      } catch (err) {
        if (!isLocal) {
          // In production, don't fallback to blob URLs — they won't work on other devices
          throw err;
        }
        // Local dev only: use blob URLs as fallback
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
