import { useCallback, useState } from 'react';
import { readBarcodes, type BarcodeRead, type ReadBarcodesOptions } from './barcodes';

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<
  number,
  { resolve: (reads: BarcodeRead[]) => void; reject: (error: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    worker = new Worker(new URL('./barcodes.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (
      event: MessageEvent<{
        id: number;
        reads?: BarcodeRead[];
        diagnostics?: import('./barcodes').BarcodeCandidateDiagnostic[];
        laplacianVariance?: number;
        roiLaplacianVariance?: number;
        labelRoi?: { x: number; y: number; width: number; height: number };
        engineUsed?: 'native' | 'zxing' | 'both' | 'none';
        error?: string;
      }>
    ) => {
      const job = pending.get(event.data.id);
      if (!job) return;
      pending.delete(event.data.id);
      if (event.data.error) job.reject(new Error(event.data.error));
      else {
        const reads = (event.data.reads ?? []) as import('./barcodes').BarcodeReadArray;
        if (event.data.diagnostics) {
          reads.diagnostics = event.data.diagnostics;
        }
        if (event.data.laplacianVariance != null) {
          reads.laplacianVariance = event.data.laplacianVariance;
        }
        if (event.data.roiLaplacianVariance != null) {
          reads.roiLaplacianVariance = event.data.roiLaplacianVariance;
        }
        if (event.data.labelRoi) {
          reads.labelRoi = event.data.labelRoi;
        }
        if (event.data.engineUsed) {
          reads.engineUsed = event.data.engineUsed;
        }
        job.resolve(reads);
      }
    };
  }
  return worker;
}

/**
 * Every barcode in a photo, decoded in a Worker when the browser has one (the
 * screen stays responsive) and on the main thread otherwise.
 */
export function readBarcodesOffThread(
  image: Blob,
  options?: ReadBarcodesOptions
): Promise<BarcodeRead[]> {
  const w = getWorker();
  if (!w) return readBarcodes(image, options);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, image, options });
  });
}

/** React wrapper: `scan(file)` → the decoded texts, with a busy flag for the button. */
export function useBarcodeReader(options?: ReadBarcodesOptions) {
  const [isScanning, setIsScanning] = useState(false);

  const scan = useCallback(
    async (file: Blob) => {
      setIsScanning(true);
      try {
        const reads = await readBarcodesOffThread(file, options);
        return reads.map((r) => r.text);
      } finally {
        setIsScanning(false);
      }
    },
    // Formats and grids are fixed per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  return { scan, isScanning };
}
