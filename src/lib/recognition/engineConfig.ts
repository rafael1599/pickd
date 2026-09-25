/**
 * Qué motor leyó una foto, en un número que se puede comparar.
 *
 * La sombra de Double Check y el banco histórico corren **el mismo motor con
 * la misma configuración** y guardan el mismo hash en cada corrida
 * (`docs/label-recognition/09-plan-de-evaluacion.md`, E4). Si algo del motor
 * cambia, cambia el hash, y dos ventanas de medición no se mezclan nunca.
 *
 * «Algo del motor» es más que sus opciones: la mayoría de lo que decide una
 * lectura (el tope de 4 MP del lienzo, el `maxSideLength` del detector, los
 * umbrales del segmentador) vive como código, no como parámetro. Por eso la
 * huella incluye las versiones de las librerías, el SHA-256 de cada modelo y
 * el **SHA-256 del código fuente del motor**. No hay que acordarse de subir
 * ninguna versión: `__tests__/engineConfig.test.ts` recalcula las tres
 * huellas y falla, diciendo el valor nuevo, en cuanto una deja de coincidir.
 */

/** Los archivos cuyo contenido ES el motor. Tocar uno es cambiar de motor. */
export const ENGINE_SOURCE_FILES = [
  'src/features/recognition/catalogCompare.ts',
  'src/lib/recognition/barcodeText.ts',
  'src/lib/recognition/barcodes.ts',
  'src/lib/recognition/barcodes.worker.ts',
  'src/lib/recognition/clientOcr.ts',
  'src/lib/recognition/imageFilters.ts',
  'src/lib/recognition/labelSegmenter.ts',
  'src/lib/recognition/multiBox.worker.ts',
  'src/lib/recognition/recognizeMultiBoxClient.ts',
  'src/lib/recognition/useBarcodeReader.ts',
] as const;

export const ENGINE_CONFIG = {
  engine: 'recognizeMultiBoxClient',
  /** Sin lookup de catálogo: «lo confirma el catálogo» se decide después, por `sku_key`. */
  catalog: false,
  minItemsPerBox: 1,
  /** Tope del lienzo del OCR (`runClientOcr`); el detector recorta después por su cuenta. */
  targetMaxPixels: 4_000_000,
  /** Hilos de WASM de onnxruntime dentro del Worker. */
  wasmThreads: 1,
  libraries: {
    'onnxruntime-web': '1.30.0',
    'ppu-paddle-ocr': '6.6.0',
    'zxing-wasm': '3.1.4',
  },
  models: {
    'PP-OCRv6_tiny_det.ort': '2816e82d26a09d6af722492f80f3059d458377c084eca88f34d84ddf9b385580',
    'PP-OCRv6_tiny_rec.ort': 'efc46adf1bde1e05b58748268abb0e71791bfa8616c435676bbca13d1ea47767',
    'ppocrv6_tiny_dict.txt': '2f3717bbd530b681b6db3be35cc485e8a41a932b9558b833986bf0894eb21f2d',
  },
  /** SHA-256 de `ENGINE_SOURCE_FILES` (ver `engineSourceDigestInput`). */
  sourceSha256: '6fd05bb6eeebd4a349e9fee1c39bad49f11cb02f164c6d5ea404278748ee8570',
} as const;

export type EngineConfig = typeof ENGINE_CONFIG;

/** JSON con las llaves ordenadas: el mismo objeto da el mismo texto siempre. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * Lo que se firma del código fuente: cada archivo como `ruta\ncontenido\n`, en
 * el orden de `ENGINE_SOURCE_FILES`, con los finales de línea en LF para que un
 * checkout en Windows dé la misma huella.
 */
export function engineSourceDigestInput(
  files: ReadonlyArray<{ path: string; text: string }>
): string {
  return files.map((f) => `${f.path}\n${f.text.replace(/\r\n/g, '\n')}\n`).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * El hash que va a `dcv_shadow_runs.engine_config_hash` y a cada corrida del
 * banco: los primeros 16 hex del SHA-256 de la configuración serializada.
 */
export async function engineConfigHash(config: EngineConfig = ENGINE_CONFIG): Promise<string> {
  return (await sha256Hex(stableStringify(config))).slice(0, 16);
}
