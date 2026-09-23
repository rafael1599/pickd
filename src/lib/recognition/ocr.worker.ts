import { recognizeLabelClient } from './recognizeLabelClient';
import * as ort from 'onnxruntime-web';

// Restringir el número de hilos a 1 para no congelar el visor de cámara
ort.env.wasm.numThreads = 1;

self.onmessage = async (e: MessageEvent) => {
  const { id, file } = e.data;
  try {
    const result = await recognizeLabelClient(file, file.name);
    self.postMessage({ id, success: true, result });
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : 'Error en OCR';
    self.postMessage({ id, success: false, error });
  }
};
