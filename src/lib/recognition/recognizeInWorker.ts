/**
 * `recognizeLabelClient`, off the main thread.
 *
 * On the main thread a label read holds the page for about 1.8 s on a phone —
 * the viewfinder froze for over a second after every shot (measured in headless
 * Chrome, 23 sep 2026: one 1,050 ms frame gap per read, none from the worker,
 * identical reading). The batch intake reads here so the operator can keep
 * shooting while the pile fills in (`useLabelBatch`).
 *
 * One worker for the whole app, one read at a time: the OCR service inside it is
 * a module-level singleton, not safe to run twice at once (`clientOcr.ts`).
 *
 * **Falling back to the main thread is for an environment that cannot run the
 * worker, not for a label that cannot be read.** Before the worker has read one
 * label, any failure — it does not start, it crashes, it errors — is taken as
 * the environment (iOS < 16.4, no OffscreenCanvas) and the read is redone on the
 * main thread, and background reading is switched off. Once it has read one, a
 * failure is that photo's, and it is rejected: redoing it on the main thread
 * would freeze the camera to fail the same way.
 */
import { recognizeLabelClient, type ClientRecognitionResult } from './recognizeLabelClient';

interface Job {
  id: number;
  file: File;
  resolve: (r: ClientRecognitionResult) => void;
  reject: (e: Error) => void;
}

let worker: Worker | null = null;
let supported: boolean | null = null;
/** The worker has read at least one label: from here on a failure is the photo's. */
let proven = false;
let nextId = 0;
const queue: Job[] = [];
/** The job the worker (or the fallback) is on right now. Only ever one. */
let current: Job | null = null;

/** Whether labels can be read without touching the main thread. */
export function canReadInBackground(): boolean {
  if (supported === null) {
    supported =
      typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      typeof OffscreenCanvas !== 'undefined';
  }
  return supported;
}

function disableBackground(reason: unknown) {
  console.warn('[recognizeInWorker] reading on the main thread from now on:', reason);
  supported = false;
  worker?.terminate();
  worker = null;
}

/** Finish the current job, then start the next. The one place a job ends. */
function settle(job: Job, outcome: { result: ClientRecognitionResult } | { error: Error }) {
  if (current !== job) return;
  current = null;
  if ('result' in outcome) job.resolve(outcome.result);
  else job.reject(outcome.error);
  pump();
}

function onMainThread(job: Job) {
  recognizeLabelClient(job.file, job.file.name).then(
    (result) => settle(job, { result }),
    (e: unknown) => settle(job, { error: e instanceof Error ? e : new Error(String(e)) })
  );
}

function getWorker(): Worker | null {
  if (!canReadInBackground()) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./ocr.worker.ts', import.meta.url), { type: 'module' });
  } catch (e) {
    disableBackground(e);
    return null;
  }
  worker.onmessage = (e: MessageEvent) => {
    const { id, success, result, error } = e.data as {
      id: number;
      success: boolean;
      result?: ClientRecognitionResult;
      error?: string;
    };
    const job = current;
    if (!job || job.id !== id) return;
    if (success && result) {
      proven = true;
      settle(job, { result });
    } else if (!proven) {
      disableBackground(error);
      onMainThread(job);
    } else {
      settle(job, { error: new Error(error || 'The label could not be read') });
    }
  };
  worker.onerror = (e) => {
    const job = current;
    disableBackground(e.message || e);
    // The job it was on is redone on the main thread; nothing else starts until it ends.
    if (job) onMainThread(job);
  };
  return worker;
}

function pump() {
  if (current || queue.length === 0) return;
  const job = queue.shift() as Job;
  current = job;
  const w = getWorker();
  if (!w) {
    onMainThread(job);
    return;
  }
  try {
    w.postMessage({ id: job.id, file: job.file });
  } catch (e) {
    disableBackground(e);
    onMainThread(job);
  }
}

/** Read one label, in the worker when the device can, on the main thread when not. */
export function recognizeLabelInWorker(file: File): Promise<ClientRecognitionResult> {
  return new Promise((resolve, reject) => {
    queue.push({ id: nextId++, file, resolve, reject });
    pump();
  });
}
