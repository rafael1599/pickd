/**
 * Leer una foto de pallet en segundo plano, **sin tocar nunca el hilo
 * principal**: la sombra de Double Check.
 *
 * El lote (`recognizeInWorker.ts`) cae al hilo principal si su Worker no
 * arranca, porque allí el operador está esperando la lectura. Aquí nadie la
 * espera: un picker está despachando y no debe notar nada. Así que:
 *
 * - **Sin Worker u `OffscreenCanvas`** → `unsupported`, sin intentar nada.
 * - **Se pasa de `timeoutMs`** → se termina el Worker (con él mueren el de
 *   barras y la memoria del OCR), `timeout`, y el siguiente trabajo arranca
 *   uno nuevo.
 * - **Falla** → `error` con el mensaje. No se reintenta.
 * - **Más de `queueMax` fotos esperando** → `dropped`.
 *
 * Un Worker propio, no el del lote: matarlo en un timeout no puede llevarse
 * por delante una lectura del lote, y a los 60 s sin trabajo se termina solo
 * para devolver los ~60–100 MB que ocupan los modelos y la imagen decodificada.
 * De a una foto: el servicio de OCR es un singleton dentro del Worker.
 *
 * `readPalletInBackground` **nunca rechaza**: todo desenlace es un estado.
 */
import type { MultiBoxClientResult } from './recognizeMultiBoxClient';

export type BackgroundReadOutcome =
  | {
      status: 'ok';
      result: MultiBoxClientResult;
      reduced: Blob | null;
      queueMs: number;
      readMs: number;
    }
  | {
      status: 'error' | 'timeout' | 'unsupported' | 'dropped';
      error?: string;
      queueMs: number;
      readMs: number;
    };

export interface BackgroundReadOptions {
  timeoutMs: number;
  queueMax: number;
  /** Lado largo de la copia reducida que devolver; sin él, no se hace. */
  reduceTo?: number;
}

/** Lo mínimo que el módulo necesita de un Worker; los tests inyectan uno falso. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((e: MessageEvent) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

interface Job {
  id: number;
  file: File;
  options: BackgroundReadOptions;
  enqueuedAt: number;
  resolve: (o: BackgroundReadOutcome) => void;
}

const IDLE_MS = 60_000;

let createWorker: () => WorkerLike = () =>
  new Worker(new URL('./multiBox.worker.ts', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
let supportsBackground = (): boolean =>
  typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined';

let worker: WorkerLike | null = null;
let current: { job: Job; startedAt: number; timer: ReturnType<typeof setTimeout> } | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const queue: Job[] = [];
let nextId = 0;

function killWorker() {
  worker?.terminate();
  worker = null;
}

function finish(job: Job, outcome: BackgroundReadOutcome) {
  if (current?.job !== job) return;
  clearTimeout(current.timer);
  current = null;
  job.resolve(outcome);
  pump();
}

function getWorker(): WorkerLike | null {
  if (worker) return worker;
  try {
    worker = createWorker();
  } catch {
    worker = null;
    return null;
  }
  worker.onmessage = (e: MessageEvent) => {
    const { id, success, result, reduced, error } = e.data as {
      id: number;
      success: boolean;
      result?: MultiBoxClientResult;
      reduced?: Blob | null;
      error?: string;
    };
    if (!current || current.job.id !== id) return;
    const { job, startedAt } = current;
    const times = { queueMs: startedAt - job.enqueuedAt, readMs: performance.now() - startedAt };
    if (success && result) {
      finish(job, { status: 'ok', result, reduced: reduced ?? null, ...times });
    } else {
      finish(job, { status: 'error', error: error || 'The pallet could not be read', ...times });
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    // Un Worker que revienta no se reutiliza: el siguiente trabajo abre otro.
    killWorker();
    if (!current) return;
    const { job, startedAt } = current;
    finish(job, {
      status: 'error',
      error: e.message || 'worker error',
      queueMs: startedAt - job.enqueuedAt,
      readMs: performance.now() - startedAt,
    });
  };
  return worker;
}

function scheduleIdle() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (!current && queue.length === 0) killWorker();
  }, IDLE_MS);
}

function pump() {
  if (current) return;
  const job = queue.shift();
  if (!job) {
    scheduleIdle();
    return;
  }
  const startedAt = performance.now();
  const w = getWorker();
  if (!w) {
    job.resolve({
      status: 'error',
      error: 'worker did not start',
      queueMs: startedAt - job.enqueuedAt,
      readMs: 0,
    });
    pump();
    return;
  }
  const timer = setTimeout(() => {
    if (current?.job !== job) return;
    killWorker();
    finish(job, {
      status: 'timeout',
      error: `no answer after ${job.options.timeoutMs} ms`,
      queueMs: startedAt - job.enqueuedAt,
      readMs: performance.now() - startedAt,
    });
  }, job.options.timeoutMs);
  current = { job, startedAt, timer };
  try {
    w.postMessage({ id: job.id, file: job.file, reduceTo: job.options.reduceTo });
  } catch (e) {
    killWorker();
    finish(job, {
      status: 'error',
      error: e instanceof Error ? e.message : String(e),
      queueMs: startedAt - job.enqueuedAt,
      readMs: 0,
    });
  }
}

/** Whether this device can read a pallet without touching the main thread. */
export function canReadPalletInBackground(): boolean {
  return supportsBackground();
}

/** Read one pallet photo off the main thread. Never rejects. */
export function readPalletInBackground(
  file: File,
  options: BackgroundReadOptions
): Promise<BackgroundReadOutcome> {
  if (!supportsBackground()) {
    return Promise.resolve({ status: 'unsupported', queueMs: 0, readMs: 0 });
  }
  // Las que esperan, sin contar la que se está leyendo.
  if (queue.length >= options.queueMax) {
    return Promise.resolve({
      status: 'dropped',
      error: `${queue.length} photos already waiting`,
      queueMs: 0,
      readMs: 0,
    });
  }
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  return new Promise((resolve) => {
    queue.push({ id: nextId++, file, options, enqueuedAt: performance.now(), resolve });
    pump();
  });
}

/** Sólo para tests: sustituir el Worker y la detección, y vaciar el estado. */
export function __setBackgroundReaderForTests(opts: {
  createWorker?: () => WorkerLike;
  supports?: () => boolean;
}) {
  killWorker();
  if (current) clearTimeout(current.timer);
  current = null;
  queue.length = 0;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  if (opts.createWorker) createWorker = opts.createWorker;
  if (opts.supports) supportsBackground = opts.supports;
}
