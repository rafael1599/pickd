/**
 * `photo_reads` (migración 20261006130232): la lectura de cada foto de pallet
 * hasta que termine, para todo el personal. Todo cambio pasa por las funciones
 * de la base (`claim_photo_read`, `finish_photo_read`…); aquí sólo envoltorios
 * tipados, porque la tabla es más nueva que los tipos generados.
 */
import { supabase } from '../../../lib/supabase';
import type { ShadowGroupLine } from '../utils/dcvShadow';
import type { PalletUnit } from '../pallets/palletUnits';
import type { FrontSummary, PhotoAlert } from './postProcess';

export interface PhotoReadRow {
  photo_id: string;
  list_id: string;
  shipment_id: string | null;
  group_id: string | null;
  created_by: string;
  created_at: string;
  taken_at: string;
  pallet_hint: number | null;
  shot: number | null;
  group_members: string[];
  lines: ShadowGroupLine[];
  snapshot: PalletUnit[];
  photo_key: string | null;
  status: 'pending' | 'reading' | 'done' | 'failed';
  claimed_by: string | null;
  attempts: number;
  alerts: PhotoAlert[];
  front: FrontSummary | null;
  applied_at: string | null;
}

type Result<T> = { data: T | null; error: { message: string } | null };
const rpc = supabase.rpc.bind(supabase) as unknown as <T>(
  fn: string,
  args: Record<string, unknown>
) => Promise<Result<T>>;

const table = () =>
  (supabase.from.bind(supabase) as unknown as (t: string) => ReturnType<typeof supabase.from>)(
    'photo_reads'
  );

export async function insertPhotoRead(row: {
  photo_id: string;
  list_id: string;
  taken_at: string;
  pallet_hint: number | null;
  shot: number | null;
  group_members: string[];
  lines: ShadowGroupLine[];
  snapshot: PalletUnit[];
}): Promise<void> {
  const { error } = await table().insert(row as never);
  if (error) throw new Error(error.message);
}

export async function setPhotoReadKey(photoId: string, key: string): Promise<void> {
  const { error } = await rpc('set_photo_read_key', { p_photo_id: photoId, p_key: key });
  if (error) throw new Error(error.message);
}

export async function claimPhotoRead(mineOnly: boolean): Promise<PhotoReadRow | null> {
  const { data, error } = await rpc<PhotoReadRow[]>('claim_photo_read', {
    p_mine_only: mineOnly,
    p_stale_seconds: 180,
  });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function releasePhotoRead(photoId: string, reason: string): Promise<void> {
  await rpc('release_photo_read', { p_photo_id: photoId, p_error: reason });
}

export async function finishPhotoRead(
  photoId: string,
  alerts: PhotoAlert[],
  front: FrontSummary | null,
  error: string | null
): Promise<void> {
  const { error: e } = await rpc('finish_photo_read', {
    p_photo_id: photoId,
    p_alerts: alerts,
    p_front: front,
    p_error: error,
  });
  if (e) throw new Error(e.message);
}

export async function markPhotoReadApplied(photoId: string): Promise<void> {
  await rpc('mark_photo_read_applied', { p_photo_id: photoId });
}

/** Las lecturas de unas órdenes (Double Check: el grupo; Ship: el envío). */
export async function fetchPhotoReads(listIds: readonly string[]): Promise<PhotoReadRow[]> {
  if (listIds.length === 0) return [];
  const { data, error } = await table()
    .select(
      'photo_id, list_id, shipment_id, group_id, created_by, created_at, taken_at, pallet_hint, shot, photo_key, status, claimed_by, attempts, alerts, front, applied_at'
    )
    .in('list_id', listIds as string[])
    .order('taken_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PhotoReadRow[];
}

/** Cada cambio de una lectura de estas órdenes, al instante. Devuelve cómo dejar de escuchar. */
export function watchPhotoReads(listIds: readonly string[], onChange: () => void): () => void {
  if (listIds.length === 0) return () => {};
  const channel = supabase
    .channel(
      `photo-reads-${listIds.join('-').slice(0, 80)}-${Math.random().toString(36).slice(2, 8)}`
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'photo_reads',
        filter: `list_id=in.(${listIds.join(',')})`,
      },
      () => onChange()
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

/** El original de una foto que esta PickD tiene tomada, para leerla aquí. */
export async function downloadClaimedOriginal(key: string): Promise<File> {
  const { data, error } = await supabase.functions.invoke('dcv-original-url', {
    body: { action: 'get-claimed', key },
  });
  if (error) throw error;
  const url = (data as { url?: string } | null)?.url;
  if (!url) throw new Error('no signed url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${res.status}`);
  const blob = await res.blob();
  return new File([blob], key.split('/').pop() ?? 'photo.jpg', { type: 'image/jpeg' });
}

/** El id de una foto de pallet desde su URL pública (`photos/gallery/<id>.webp`). */
export function photoIdFromUrl(url: string): string | null {
  const m = /\/photos\/gallery\/(?:thumbs\/)?([0-9a-f-]{36})\.webp/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}
