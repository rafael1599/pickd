import { z } from 'zod';

export const galleryPhotoSchema = z.object({
  id: z.string().uuid(),
  filename: z.string(),
  url: z.string().url(),
  thumbnail_url: z.string().url(),
  caption: z.string().nullable().optional(),
  deleted_at: z.string().nullable().optional(),
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
});

export type GalleryPhoto = z.infer<typeof galleryPhotoSchema>;

export const taskPhotoSchema = z.object({
  id: z.string().uuid(),
  task_id: z.string().uuid(),
  photo_id: z.string().uuid(),
  assigned_by: z.string().uuid().nullable().optional(),
  assigned_at: z.string(),
});

export type TaskPhoto = z.infer<typeof taskPhotoSchema>;
