/**
 * Una foto de pallet, en sombra: el original al bucket privado, el motor en un
 * Worker, y una fila en `dcv_shadow_runs` pase lo que pase.
 *
 * **Nada de esto lo ve el picker ni lo espera nadie.** `uploadPalletPhoto`
 * lanza `runDcvShadow` detrás del marcador optimista y se olvida: la función
 * nunca lanza, no bloquea subir la foto pública ni completar la orden, y no
 * reintenta en el hilo principal (`readPalletInBackground`). Si algo falla, se
 * anota en la fila y se sigue — una sombra que no deja registro de sus fallos
 * mide sólo sus éxitos.
 *
 * Orden:
 *   1. URL firmada para `full/` y PUT del archivo tal cual — en paralelo con 2.
 *   2. El motor en el Worker (y la copia de 2000 px, en el mismo Worker).
 *   3. Si la foto salió en la muestra, el servidor copia `full/` → `sample/`,
 *      que no expira (se borra a mano después de adjudicar).
 *   4. La copia `r2000/`: su URL se pide DESPUÉS de leer, porque una URL
 *      firmada dura 120 s y la lectura puede esperar en cola más que eso.
 *   5. La fila, idempotente por `id` (`ON CONFLICT DO NOTHING`).
 */
import { supabase } from '../../../lib/supabase';
import { ENGINE_CONFIG, engineConfigHash } from '../../../lib/recognition/engineConfig';
import {
  readPalletInBackground,
  type BackgroundReadOutcome,
  type BackgroundReadOptions,
} from '../../../lib/recognition/readPalletInBackground';
import {
  R2000_MAX_SIDE,
  decideSampled,
  describeDevice,
  toShadowBoxes,
  type ShadowDevice,
  type ShadowFlag,
  type ShadowGroupLine,
} from '../utils/dcvShadow';

export interface DcvShadowJob {
  file: File;
  /** El mismo id que la copia pública de 1200 px: enlaza las dos fotos. */
  photoId: string;
  listId: string | null;
  groupId: string | null;
  groupMembers: string[];
  lines: ShadowGroupLine[];
  flag: ShadowFlag;
}

type SignedUrls = Partial<Record<'full' | 'r2000', { key: string; url: string }>>;

export interface DcvShadowDeps {
  invoke: (body: Record<string, unknown>) => Promise<unknown>;
  put: (url: string, body: Blob) => Promise<boolean>;
  read: (file: File, options: BackgroundReadOptions) => Promise<BackgroundReadOutcome>;
  insert: (row: Record<string, unknown>) => Promise<void>;
  device: () => Promise<ShadowDevice>;
  random: () => number;
  now: () => number;
  newId: () => string;
}

// dcv_shadow_runs is newer than the generated Supabase types: a narrow, locally
// typed wrapper instead of `any`. Upsert with ignoreDuplicates is
// `ON CONFLICT (id) DO NOTHING` — a retried insert never makes a second row.
const fromShadowRuns = () =>
  (
    supabase.from.bind(supabase) as unknown as (t: 'dcv_shadow_runs') => {
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string; ignoreDuplicates: boolean }
      ) => Promise<{ error: { message: string } | null }>;
    }
  )('dcv_shadow_runs');

let devicePromise: Promise<ShadowDevice> | null = null;

const defaultDeps: DcvShadowDeps = {
  invoke: async (body) => {
    const { data, error } = await supabase.functions.invoke('dcv-original-url', { body });
    if (error) throw error;
    return data;
  },
  put: async (url, body) => {
    const res = await fetch(url, {
      method: 'PUT',
      body,
      headers: { 'Content-Type': 'image/jpeg' },
    });
    return res.ok;
  },
  read: readPalletInBackground,
  insert: async (row) => {
    const { error } = await fromShadowRuns().upsert(row, {
      onConflict: 'id',
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
  },
  device: () => (devicePromise ??= describeDevice(navigator as never)),
  random: Math.random,
  now: () => performance.now(),
  newId: () => crypto.randomUUID(),
};

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Lee una foto en sombra y deja su fila. Nunca lanza. */
export async function runDcvShadow(job: DcvShadowJob, deps: DcvShadowDeps = defaultDeps) {
  const runId = deps.newId();
  const sampled = decideSampled(job.flag.sampleRate, deps.random);
  const errors: string[] = [];

  // 1. El original, en paralelo con la lectura.
  const upload = (async () => {
    const t0 = deps.now();
    try {
      const res = (await deps.invoke({
        action: 'put',
        photoId: job.photoId,
        variants: ['full'],
      })) as { urls?: SignedUrls } | null;
      const full = res?.urls?.full;
      if (!full) throw new Error('no signed url');
      if (!(await deps.put(full.url, job.file))) throw new Error('PUT full failed');
      let sampleOk = true;
      if (sampled) {
        try {
          await deps.invoke({ action: 'sample', key: full.key });
        } catch (e) {
          sampleOk = false;
          errors.push(`sample: ${message(e)}`);
        }
      }
      return { key: full.key, ok: sampleOk, ms: deps.now() - t0 };
    } catch (e) {
      errors.push(`upload: ${message(e)}`);
      return { key: null, ok: false, ms: deps.now() - t0 };
    }
  })();

  // 2. El motor.
  const outcome = await deps
    .read(job.file, {
      timeoutMs: job.flag.timeoutMs,
      queueMax: job.flag.queueMax,
      reduceTo: job.flag.uploadR2000 ? R2000_MAX_SIDE : undefined,
    })
    .catch(
      (e): BackgroundReadOutcome => ({ status: 'error', error: message(e), queueMs: 0, readMs: 0 })
    );
  const uploaded = await upload;

  // 4. La copia reducida, con una URL recién firmada.
  if (outcome.status === 'ok' && outcome.reduced) {
    try {
      const res = (await deps.invoke({
        action: 'put',
        photoId: job.photoId,
        variants: ['r2000'],
      })) as { urls?: SignedUrls } | null;
      const r2000 = res?.urls?.r2000;
      if (!r2000 || !(await deps.put(r2000.url, outcome.reduced))) throw new Error('PUT failed');
    } catch (e) {
      errors.push(`r2000: ${message(e)}`);
    }
  }

  // 5. La fila.
  try {
    const result = outcome.status === 'ok' ? outcome.result : null;
    if (outcome.status !== 'ok' && outcome.error) errors.unshift(outcome.error);
    await deps.insert({
      id: runId,
      list_id: job.listId,
      group_id: job.groupId,
      group_members: job.groupMembers,
      group_lines: job.lines,
      photo_id: job.photoId,
      photo_key: uploaded.key,
      photo_width: result?.image.width ?? null,
      photo_height: result?.image.height ?? null,
      photo_bytes: job.file.size,
      upload_status: uploaded.key ? (uploaded.ok ? 'ok' : 'error') : 'error',
      sample_rate: job.flag.sampleRate,
      sampled,
      device: await deps.device().catch(() => ({})),
      app_commit: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : null,
      engine_config_hash: await engineConfigHash().catch(() => null),
      engine_config: ENGINE_CONFIG,
      status: outcome.status,
      error: errors.length ? errors.join(' · ').slice(0, 2000) : null,
      timing_ms: {
        queue: Math.round(outcome.queueMs),
        read: Math.round(outcome.readMs),
        upload: Math.round(uploaded.ms),
        ...(result
          ? {
              total: Math.round(result.timingMs.total),
              barcodes: Math.round(result.timingMs.barcodes),
              ocr: Math.round(result.timingMs.ocr),
              segmentation: Math.round(result.timingMs.segmentation),
            }
          : {}),
      },
      boxes: result ? toShadowBoxes(result) : [],
    });
  } catch (e) {
    console.warn('[dcvShadow] run not recorded:', message(e));
  }
}
