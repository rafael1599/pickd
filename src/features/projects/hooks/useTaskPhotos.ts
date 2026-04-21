import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../../lib/supabase';
import { GALLERY_KEY, ARCHIVED_KEY } from './useGalleryPhotos';
import type { GalleryPhoto } from '../../../schemas/galleryPhoto';

const TASK_PHOTOS_KEY = ['task-photo-counts'] as const;
const TASK_PHOTO_DETAILS_KEY = (taskId: string) => ['task-photo-details', taskId] as const;

export function useTaskPhotoCounts() {
  return useQuery({
    queryKey: TASK_PHOTOS_KEY,
    queryFn: async (): Promise<Map<string, number>> => {
      const { data, error } = await supabase.from('task_photos').select('task_id');
      if (error) throw error;
      const counts = new Map<string, number>();
      for (const row of data ?? []) {
        counts.set(row.task_id, (counts.get(row.task_id) ?? 0) + 1);
      }
      return counts;
    },
  });
}

export function useAssignPhotosToTask() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { photoIds: string[]; taskId: string }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const rows = vars.photoIds.map((photoId) => ({
        task_id: vars.taskId,
        photo_id: photoId,
        assigned_by: user?.id ?? null,
      }));
      const { error } = await supabase
        .from('task_photos')
        .upsert(rows, { onConflict: 'task_id,photo_id', ignoreDuplicates: true });
      if (error) throw error;
    },
    // No optimistic update — count comes from server to avoid inflation
    // when some photos are already assigned (ignoreDuplicates skips them)
    onSettled: (_d, _e, vars) => {
      qc.invalidateQueries({ queryKey: TASK_PHOTOS_KEY });
      qc.invalidateQueries({ queryKey: TASK_PHOTO_DETAILS_KEY(vars.taskId) });
      // Gallery filters out assigned photos, so it must refresh when we
      // create new assignments. Same for the archived view.
      qc.invalidateQueries({ queryKey: GALLERY_KEY });
      qc.invalidateQueries({ queryKey: ARCHIVED_KEY });
    },
  });
}

// ─── Query: fetch full photo details for a task ────────────────────────────

export function useTaskPhotoDetails(taskId: string) {
  return useQuery({
    queryKey: TASK_PHOTO_DETAILS_KEY(taskId),
    queryFn: async (): Promise<GalleryPhoto[]> => {
      const { data, error } = await supabase
        .from('task_photos')
        .select('photo_id, gallery_photos(*)')
        .eq('task_id', taskId)
        .order('assigned_at', { ascending: false });
      if (error) throw error;
      return (data ?? [])
        .map((row: { gallery_photos: GalleryPhoto | null }) => row.gallery_photos)
        .filter(Boolean) as GalleryPhoto[];
    },
    enabled: !!taskId,
  });
}

// ─── Mutation: unassign a photo from a task ────────────────────────────────

export function useUnassignPhoto() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (vars: { taskId: string; photoId: string }) => {
      const { error } = await supabase
        .from('task_photos')
        .delete()
        .eq('task_id', vars.taskId)
        .eq('photo_id', vars.photoId);
      if (error) throw error;
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: TASK_PHOTO_DETAILS_KEY(vars.taskId) });
      qc.invalidateQueries({ queryKey: TASK_PHOTOS_KEY });
      // Unassigning makes the photo re-appear in the main gallery and
      // disappear from the archive.
      qc.invalidateQueries({ queryKey: GALLERY_KEY });
      qc.invalidateQueries({ queryKey: ARCHIVED_KEY });
    },
  });
}
