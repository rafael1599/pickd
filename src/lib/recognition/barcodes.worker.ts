/// <reference lib="webworker" />
/**
 * Runs `readBarcodes` off the main thread: a 12 MP photo decoded in 14 passes
 * would otherwise freeze the screen that asked for it.
 */
import { readBarcodes, type ReadBarcodesOptions } from './barcodes';

interface Request {
  id: number;
  image: Blob;
  options?: ReadBarcodesOptions;
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, image, options } = event.data;
  try {
    const reads = await readBarcodes(image, options);
    self.postMessage({
      id,
      reads,
      diagnostics: reads.diagnostics,
      laplacianVariance: reads.laplacianVariance,
      engineUsed: reads.engineUsed,
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
