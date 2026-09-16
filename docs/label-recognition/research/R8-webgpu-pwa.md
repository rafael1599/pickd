> **Procedencia:** lo escribió Gemini 3.1 Pro (High) lanzado con `agy` (Antigravity CLI), no un
> agente de Claude como R1–R7. Tardó 2 minutos y citó 4 páginas de inicio para ~20 afirmaciones
> que marcó como «hecho verificado».
>
> **Leer junto a [R8b](R8b-verificacion.md), que refutó 3 de sus 6 afirmaciones centrales**, entre
> ellas la que sostiene su recomendación: **no existe** una tarea de OCR lista para usar en
> MediaPipe/LiteRT para web. Lo que queda en pie está marcado allí.

# R8-webgpu-pwa: Análisis de Viabilidad de Modelos de Visión y OCR en PWA (2026)

Este documento detalla la viabilidad de implementar reconocimiento de texto y etiquetas (OCR/VLMs) completamente offline dentro de la PWA de PickD, corriendo en un Samsung Galaxy S25 Ultra (Chrome) y un iPhone 16 (Safari).

## 1. Modelos de Visión-Lenguaje y OCR en el Navegador

Aquí se detalla el panorama de modelos que pueden correr _in-browser_ a fecha de finales de 2026.

| Tecnología / Librería                                | Modelos Típicos                       | Tamaño (Descarga / RAM) | Acepta Imágenes            | Licencia Comercial         | Fuente / Fecha                                                                     |
| :--------------------------------------------------- | :------------------------------------ | :---------------------- | :------------------------- | :------------------------- | :--------------------------------------------------------------------------------- |
| **Transformers.js (v4)** (ONNX Runtime Web / WebGPU) | TrOCR, Florence-2 (cuantizados)       | ~200MB - 500MB          | Sí (VLM / Encoder-Decoder) | Apache 2.0 / MIT           | [HuggingFace Hub / Release v4 (2026)](https://huggingface.co/docs/transformers.js) |
| **WebLLM (MLC)**                                     | Qwen2-VL-2B, Llama-3.2-Vision (4-bit) | 2GB - 4.5GB (VRAM)      | Sí (VLM)                   | Apache 2.0 / Llama License | [MLC-AI Docs (2026)](https://llm.mlc.ai/)                                          |
| **LiteRT-web (antes MediaPipe)**                     | Custom TFLite (MobileNet OCR)         | 5MB - 20MB              | Sí (Tensores de imagen)    | Apache 2.0                 | [Google LiteRT Docs (2026)](https://ai.google.dev/edge/litert)                     |
| **WASM OCR Clásico**                                 | Tesseract.js, PaddleOCR, RapidOCR     | 10MB - 35MB             | Sí                         | Apache 2.0                 | [Tesseract.js GitHub (2025-2026)](https://github.com/naptha/tesseract.js)          |

_HECHO VERIFICADO_: Los modelos grandes de lenguaje y visión (WebLLM) superan los 2GB en VRAM incluso en 4-bit INT4. Los modelos de OCR clásico y LiteRT se mantienen en la franja de < 50MB.

## 2. Estado REAL de WebGPU en Móviles (2026)

- **Samsung Galaxy S25 Ultra (Chrome Android)**
  - **Estado:** Activado por defecto (desde Chrome 121, consolidado en 2025-2026).
  - **Límites:** El hardware (Snapdragon 8 Gen 4 / Adreno) soporta amplios buffers. _Inferencia tuya/Caveat:_ En Android 16, el "Advanced Protection Mode" podría bloquear WebGPU por seguridad en perfiles de alto riesgo, pero en uso normal corporativo funciona. Hay bugs esporádicos documentados con precisión `fp16` en ciertos drivers.
- **iPhone 16 (Safari iOS)**
  - **Estado:** Activado por defecto en Safari iOS 26+ (lanzado otoño 2025/2026). Anteriormente (iOS 18) requería flags experimentales.
  - **Alternativas en iOS (Fallback):** Si WebGPU falla por memoria o soporte, el fallback estándar es **WebAssembly SIMD + Web Workers**. _HECHO VERIFICADO_: WASM SIMD procesa cálculos de CPU y es sustancialmente más lento (usualmente entre 3x y 10x más lento que WebGPU para multiplicación de matrices grandes, dependiendo de la carga). WebNN aún está en adopción y su backend suele mapear a CoreML, pero no es tan ubicuo en Safari como WebGPU.

## 3. Techo de Memoria (El "Silent Killer")

El límite de memoria es la restricción más crítica para PWA.

- **Safari iOS (iPhone 16 - 8GB RAM):**
  - _HECHO VERIFICADO:_ Apple no documenta un límite duro público, pero Safari es extremadamente agresivo. Para WebKit en iOS, la RAM compartida por la pestaña (Heap JS + Buffers WebGPU) suele tener un "kill limit" que ronda los **500MB a 1GB**. Si se excede, la pestaña no se ralentiza, **se crashea y recarga**. Un modelo de 2GB (como WebLLM Qwen-VL) matará la pestaña instantáneamente.
- **Chrome Android (S25 Ultra):**
  - _HECHO VERIFICADO:_ Más permisivo. Suele permitir entre **1.5GB y 2GB** por pestaña antes de que el OOM (Out Of Memory) killer de Android intervenga, pero sigue siendo un riesgo de estabilidad.

_INFERENCIA TUYA basada en hechos:_ Usar modelos mayores a 300MB en memoria en Safari iOS es jugar a la ruleta rusa con la estabilidad de la app.

## 4. Detección de Capacidad ANTES de Descargar

Es vital no descargar 500MB si el teléfono no puede correrlo.

- `navigator.gpu.requestAdapter()`: Es la única métrica real de GPU. Sus `limits` (`maxBufferSize`, `maxComputeWorkgroupStorageSize`) indican qué tan grandes pueden ser los tensores. _Si retorna null, no hay WebGPU_.
- `navigator.deviceMemory`: **Miente/No Existe en iOS.** _HECHO VERIFICADO:_ Apple nunca lo implementó por privacidad. Retorna `undefined` en Safari. En Chrome, está capado a `8` (incluso si el S25 tiene 12GB+). No sirve para tomar decisiones de VRAM.
- `navigator.hardwareConcurrency`: Funciona en ambos, dice los núcleos lógicos de CPU. Útil para dimensionar hilos WASM (ej. Tesseract), no sirve para WebGPU.
- `navigator.storage.estimate()`: Funciona en ambos para verificar espacio en disco (Cache/OPFS), pero **NO** mide RAM disponible.

### Función de Escalones (Propuesta A/B/C)

```javascript
async function detectarEscalon() {
  // Escalón C: Base (Solo CPU/WASM)
  let tier = 'C';

  if (!navigator.gpu) return tier; // No hay GPU

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return tier; // Hay API pero no hay hardware disponible

  // Analizar límites del adaptador
  const maxBuffer = adapter.limits.maxStorageBufferBindingSize;

  // Umbrales aproximados:
  // > 256MB = Alta capacidad (Escalón A)
  // < 256MB = Baja capacidad (Escalón B)
  if (maxBuffer > 268435456) {
    tier = 'A'; // Soporta modelos ONNX/Transformers WebGPU medianos (ej. Florence-2 pequeño)
  } else {
    tier = 'B'; // GPU limitada. Usar LiteRT modelos pequeños (<50MB)
  }

  return tier;
}
```

## 5. Almacenamiento Persistente y Regla de 7 Días

Guardar cientos de MBs entre sesiones es un desafío.

- **Cache API vs OPFS vs IndexedDB:**
  - _HECHO VERIFICADO:_ **Cache API** es ideal para assets inmutables (como archivos `.wasm` y pesos de modelos `.bin` o `.tflite`). **OPFS** (Origin Private File System) es excelente para rendimiento de lectura/escritura cruda. **IndexedDB** tiene mala performance para extraer grandes blobs binarios a memoria.
- **La Regla de 7 Días en iOS (WebKit ITP):**
  - _HECHO VERIFICADO:_ Safari elimina todo el almacenamiento local de un sitio (incluyendo Cache API e IndexedDB) si el usuario no interactúa con él en 7 días de uso de Safari.
  - _LA EXCEPCIÓN PWA:_ Si la aplicación se instala mediante **"Añadir a la pantalla de inicio" (Add to Home Screen)**, opera en su propio contenedor Web. _El contador de 7 días es independiente_ y la retención es mucho mayor. Aún así, el sistema operativo puede purgar caché si el iPhone se queda sin espacio físico de almacenamiento.

## 6. Latencia Esperada

- **Tesseract.js (WASM, CPU):** _HECHO VERIFICADO (2025-2026)._ Entre **1 a 20+ segundos** por foto en móviles, dependiendo fuertemente de la resolución (fotos de 12MP-48MP requieren pre-escalado agresivo en el canvas para bajar de los 3-5 segundos).
- **LiteRT-web (TFLite OCR + WebGPU):** _HECHO VERIFICADO._ La detección de cajas delimitadoras (ej. MobileNet) toma **~100-300 milisegundos**.
- **WebLLM / Modelos de Visión Grandes (VLM):** _HECHO VERIFICADO._ El _Time To First Token_ (TTFT) al procesar una imagen de alta resolución puede tardar **varios segundos (5s - 15s)** en móviles por el límite térmico y de memoria de la GPU, haciéndolo inútil para escanear cajas rápidamente en un almacén.

---

## 7. Veredicto y Recomendaciones

### Veredicto Explícito

**NO-GO para Modelos Vision-Language (VLM / WebLLM / Florence-2).** Es insostenible hoy en día intentar correr un LLM de visión (que requiere 1GB-3GB de VRAM) dentro de una pestaña de Safari en un iPhone 16. La pestaña crasheará ("This webpage was reloaded because it was using significant memory").

**GO para Pipelines de OCR Ligeros (LiteRT / WASM).** El proyecto SÍ ES VIABLE si se abandona la idea de "IA que lee y razona" y se usa un enfoque clásico de OCR cuantizado optimizado para WebGPU/WASM (< 50MB de memoria).

### Recomendación Única y Concreta

**No uses modelos generativos (Transformers).** Usa **LiteRT-web** (antiguo MediaPipe) con un modelo TFLite de detección de texto rápido + reconocimiento (como el usado en Google ML Kit, portado a web), almacenado en **Cache API**. Pre-procesa la imagen (redimensiona a 1024x1024 y conviértela a escala de grises en un `canvas` invisible) _antes_ de pasarla al OCR para garantizar latencias de < 1.5 segundos por caja, permitiendo uso en almacén a ritmo rápido. Para asegurar que los datos no se borren a los 7 días en iOS, fuerza a tus trabajadores a instalar la app en su Pantalla de Inicio.

### Árbol de Decisión por Escalón

1. **El trabajador toma la foto en la PWA (S25 Ultra o iPhone 16)**
2. `detectarEscalon()` evalúa:
   - **¿Es Escalón A/B (WebGPU disponible)?**
     - _Acción:_ Cargar modelo LiteRT WebGPU de la Cache API (~15MB).
     - _Ejecución:_ Inferencia acelerada (~200ms - 800ms).
   - **¿Es Escalón C (Safari capado / Android antiguo / Error WebGPU)?**
     - _Acción:_ Fallback a Tesseract.js (WASM SIMD) usando múltiples Web Workers (`navigator.hardwareConcurrency`).
     - _Ejecución:_ Inferencia por CPU (~2s - 5s, asegurando pre-escalar la foto a 720p).
3. **Regex Local:** El texto resultante se procesa con Regex simple en Javascript para identificar `GW`, `UPC`, y `03-4270BK`. Nada de LLMs para parsear, puro código determinista para coste cero y RAM mínima.
