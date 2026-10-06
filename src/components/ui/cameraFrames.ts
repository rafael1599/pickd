/**
 * Lo que la cámara hace con los cuadros del vídeo (`CameraCaptureSheet`): elegir
 * el más nítido después del toque y codificarlo fuera del hilo principal. Las
 * cuentas puras viven en `cameraCapture.ts`.
 */
import { SHARPNESS_CROP, STEADY_WINDOW_MS, sharpness } from './cameraCapture';

type Frame = ImageBitmap | HTMLCanvasElement;

const closeFrame = (f: Frame | null | undefined) => {
  if (f && 'close' in f) f.close();
};

/** Una copia del cuadro de ahora: `ImageBitmap` si se puede, si no un lienzo. */
async function snapshot(video: HTMLVideoElement): Promise<Frame> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(video);
    } catch {
      // Safari viejo: no acepta un <video> como fuente.
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')?.drawImage(video, 0, 0);
  return canvas;
}

/** El próximo cuadro del vídeo, o 100 ms si no llega ninguno. */
function nextFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 100);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: () => void) => number;
    };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(done);
    else requestAnimationFrame(done);
  });
}

/**
 * El cuadro más nítido entre el del toque y los de los
 * {@link STEADY_WINDOW_MS} siguientes. La nitidez se mide en un recorte del
 * centro **a resolución real** —achicar el cuadro escondería lo movido—, y sólo
 * se copia entero el cuadro que gana.
 */
export async function steadiestFrame(
  video: HTMLVideoElement
): Promise<{ frame: Frame; score: number } | null> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;
  const side = Math.min(SHARPNESS_CROP, w, h);
  const crop = document.createElement('canvas');
  crop.width = side;
  crop.height = side;
  const ctx = crop.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { frame: await snapshot(video), score: 0 };

  let best: { frame: Frame; score: number } | null = null;
  const end = performance.now() + STEADY_WINDOW_MS;
  for (;;) {
    ctx.drawImage(video, (w - side) / 2, (h - side) / 2, side, side, 0, 0, side, side);
    const score = sharpness(ctx.getImageData(0, 0, side, side).data, side, side);
    if (!best || score > best.score) {
      const frame = await snapshot(video);
      closeFrame(best?.frame);
      best = { frame, score };
    }
    if (performance.now() >= end) break;
    await nextFrame(video);
  }
  return best;
}

let worker: Worker | null = null;
let seq = 0;
const waiting = new Map<number, (r: { blob: Blob | null; bitmap?: ImageBitmap }) => void>();

const workerReady = (): Worker | null => {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  if (!('convertToBlob' in OffscreenCanvas.prototype)) return null;
  try {
    worker = new Worker(new URL('./cameraEncode.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      e: MessageEvent<{ id: number; blob: Blob | null; bitmap?: ImageBitmap }>
    ) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    };
    return worker;
  } catch {
    return null;
  }
};

/** En el hilo principal: lo de siempre, para cuando no hay worker. */
function encodeHere(frame: Frame, rotateDeg: number, quality: number): Promise<Blob | null> {
  const turned = rotateDeg % 180 !== 0;
  const canvas = document.createElement('canvas');
  canvas.width = turned ? frame.height : frame.width;
  canvas.height = turned ? frame.width : frame.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotateDeg * Math.PI) / 180);
  ctx.drawImage(frame, -frame.width / 2, -frame.height / 2);
  closeFrame(frame);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', quality));
}

/** El JPEG del cuadro, girado `rotateDeg` (horario), sin trabar la pantalla. */
export async function encodeFrame(
  frame: Frame,
  rotateDeg: number,
  quality = 0.92
): Promise<Blob | null> {
  const isBitmap = typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap;
  const w = isBitmap ? workerReady() : null;
  if (!w || !isBitmap) return encodeHere(frame, rotateDeg, quality);
  const id = (seq += 1);
  const reply = await new Promise<{ blob: Blob | null; bitmap?: ImageBitmap }>((resolve) => {
    waiting.set(id, resolve);
    w.postMessage({ id, bitmap: frame, rotateDeg, quality }, [frame]);
  });
  if (reply.blob) return reply.blob;
  return reply.bitmap ? encodeHere(reply.bitmap, rotateDeg, quality) : null;
}
