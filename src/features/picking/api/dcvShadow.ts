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
  buildOcrDump,
  toShadowBoxes,
  type ShadowDevice,
  type ShadowFlag,
  type ShadowBox,
  type ShadowGroupLine,
} from '../utils/dcvShadow';
import { resolveAgainstOrder } from '../utils/resolveAgainstOrder';

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
  /** Todas las claves del catálogo (`sku_key`): el resolvedor comprueba que la lectura no sea otra bici. */
  catalogKeys: () => Promise<Set<string>>;
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
      headers: { 'Content-Type': body.type || 'image/jpeg' },
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
  catalogKeys: () =>
    (catalogKeysPromise ??= loadCatalogKeys().catch((e) => {
      catalogKeysPromise = null;
      throw e;
    })),
};

/** Una vez por sesión: ~2.600 claves, paginadas (el tope de PostgREST cortaría en silencio). */
let catalogKeysPromise: Promise<Set<string>> | null = null;
async function loadCatalogKeys(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('sku_metadata')
      .select('sku_key')
      .order('sku_key')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { sku_key: string | null }[];
    for (const r of rows) if (r.sku_key) out.add(r.sku_key);
    if (rows.length < 1000) return out;
  }
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Cada caja con su lectura resuelta contra las líneas del grupo. Si el
 * catálogo no contesta, sólo se resuelve lo exacto: sin saber si la lectura es
 * otra bici real, aproximar sería arriesgar un verde falso.
 */
async function resolveBoxes(
  boxes: ShadowBox[],
  lines: ShadowGroupLine[],
  deps: DcvShadowDeps
): Promise<ShadowBox[]> {
  const orderSkus = lines.map((l) => l.sku);
  const reads = boxes.map((b) => b.sku).filter((s): s is string => !!s);
  if (reads.length === 0 || orderSkus.length === 0) return boxes;
  const known = await deps.catalogKeys().catch(() => null);
  return boxes.map((box) => {
    const hit = resolveAgainstOrder(box.sku, orderSkus, known ?? undefined);
    return hit ? { ...box, resolved_sku: hit.sku, resolved_how: hit.how } : box;
  });
}

/**
 * Lee una foto en sombra y deja su fila. Nunca lanza. Devuelve las cajas
 * resueltas (o `null` si no hubo lectura): Double Check las usa para la foto
 * del frente (idea-245, `pallets/frontRead.ts`) — la sombra sigue sin enseñarle
 * nada al picker por sí misma.
 */
export async function runDcvShadow(
  job: DcvShadowJob,
  deps: DcvShadowDeps = defaultDeps
): Promise<ShadowBox[] | null> {
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

  // 4b. Lo que vio el motor, en crudo, al lado del original (idea-238).
  if (outcome.status === 'ok' && uploaded.key) {
    try {
      const res = (await deps.invoke({ action: 'put-ocr', key: uploaded.key })) as {
        key?: string;
        url?: string;
      } | null;
      if (!res?.url || !res.key) throw new Error('no signed url');
      const dump = buildOcrDump(outcome.result, {
        photoId: job.photoId,
        runId,
        engineConfigHash: await engineConfigHash().catch(() => null),
      });
      const blob = new Blob([JSON.stringify(dump)], { type: 'application/json' });
      if (!(await deps.put(res.url, blob))) throw new Error('PUT failed');
      if (sampled) await deps.invoke({ action: 'sample', key: res.key });
    } catch (e) {
      errors.push(`ocr-dump: ${message(e)}`);
    }
  }

  // 5. La fila.
  let boxes: ShadowBox[] | null = null;
  try {
    const result = outcome.status === 'ok' ? outcome.result : null;
    if (outcome.status !== 'ok' && outcome.error) errors.unshift(outcome.error);
    // Una etapa que falló no es una lectura: sin el OCR no hay cajas que leer,
    // y guardarla `ok` con 0 cajas inflaba la cobertura (7 fotos del iPhone).
    const failed = result?.errors;
    if (failed?.barcodes) errors.unshift(`barcodes: ${failed.barcodes}`);
    if (failed?.ocr) errors.unshift(`ocr: ${failed.ocr}`);
    // Si el localizador de etiquetas falla la foto se lee entera igual, pero queda anotado.
    if (failed?.locator) errors.unshift(`locator: ${failed.locator}`);
    const status = outcome.status === 'ok' && failed?.ocr ? 'error' : outcome.status;
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
      status,
      error: errors.length ? errors.join(' · ').slice(0, 2000) : null,
      timing_ms: {
        queue: Math.round(outcome.queueMs),
        read: Math.round(outcome.readMs),
        upload: Math.round(uploaded.ms),
        ...(outcome.worker
          ? { workerJob: outcome.worker.job, workerAgeMs: outcome.worker.ageMs }
          : {}),
        ...(result
          ? {
              total: Math.round(result.timingMs.total),
              barcodes: Math.round(result.timingMs.barcodes),
              ocr: Math.round(result.timingMs.ocr),
              segmentation: Math.round(result.timingMs.segmentation),
            }
          : {}),
      },
      boxes:
        (boxes = result ? await resolveBoxes(toShadowBoxes(result), job.lines, deps) : null) ?? [],
    });
  } catch (e) {
    console.warn('[dcvShadow] run not recorded:', message(e));
  }
  return boxes;
}
