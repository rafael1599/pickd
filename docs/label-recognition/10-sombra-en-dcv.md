# La sombra del lector en Double Check

> 25 sep 2026. Etapa 8 de `09-plan-de-evaluacion.md` (y su enmienda E4): cada foto de pallet que se
> toma en DCV se guarda también a resolución original en un bucket privado y el motor la lee en
> segundo plano, dejando su resultado en `dcv_shadow_runs`. **El picker no ve nada.** Es la fuente
> de las ~300 cajas que el banco histórico no tiene y de la medida de cómo rinde el motor con fotos
> reales. Nace **apagada** (`app_flags.dcv_shadow`).

## Lo que había, medido antes de diseñar

- **DCV no corría el motor.** `18bfddb` (23 sep) sacó `PalletScanSheet`; la foto sale de
  `CameraCaptureSheet`, que es un **cuadro del video** (`getUserMedia`, ideal 3840×2160, JPEG 0,92),
  no una foto fija de 4032 px. Qué negocia el teléfono de verdad lo dice ahora
  `photo_width`/`photo_height` de cada fila (`v_dcv_shadow_by_device.pixels_p50`).
- **Ritmo:** 170–400 fotos de pallet al mes (abr 172 · may 320 · jun 318 · jul 404 · ago 234 ·
  sep 340 al 25), 70–86 % de las órdenes con una sola foto; 429 de 964 órdenes con foto desde junio
  están en un grupo. A ~2,5 MB por original es ~1 GB al mes: **la retención es por las guías de
  FedEx, no por dinero** (R2 regala 10 GB).
- **`order_groups` se borra al cancelar** y `picking_lists.group_id` es `ON DELETE SET NULL`: por
  eso `dcv_shadow_runs` no tiene FK y guarda `group_members`.

## Cómo corre

```
uploadPalletPhoto ─ marcador optimista (destraba completar, como siempre)
                 ├─ foto pública 1200 px ─ append_pallet_photo      (igual que antes, ahora atómico)
                 └─ runDcvShadow (si el flag está encendido; nunca lanza, nadie la espera)
                      ├─ URL firmada 120 s → PUT full/AAAA/MM/<photo_id>.jpg
                      │    └─ si salió en la muestra → el servidor copia a sample/ (no expira)
                      ├─ readPalletInBackground → multiBox.worker (motor, catalog: false)
                      │    └─ y la copia de 2000 px, en el mismo Worker
                      ├─ URL firmada nueva → PUT r2000/…   (se pide después: la lectura puede
                      │                                     esperar en cola más de 120 s)
                      └─ INSERT dcv_shadow_runs … ON CONFLICT (id) DO NOTHING
```

- **`photo_id`** es el mismo en la foto pública y en el original privado: enlaza las dos (y es lo
  que idea-227 usa para los recortes de etiqueta).
- **Nunca el hilo principal.** Sin `Worker` u `OffscreenCanvas` → `unsupported`. Más de
  `timeout_ms` → se termina el Worker (con el de barras y la memoria del OCR) → `timeout`. Más de
  `queue_max` esperando → `dropped`. Falla → `error`. Todo se anota; nada se reintenta. El Worker es
  propio (no el del lote) y se termina a los 60 s ocioso.
- **El Worker no lleva Supabase.** El motor ya no importa `lookupCatalogSku`: el catálogo es una
  opción **obligatoria** (`catalog: lookupCatalogSku` o `catalog: false`), así que renunciar es a
  propósito. Lo puro (`compareField`) se mudó a `catalogCompare.ts`. Comprobado en el build: el
  chunk `multiBox.worker-*.js` (465 KB) no contiene `supabase`.
- **Medido en headless con fotos del banco:** 1,8–2,6 s por foto de 1200 px, y el cuadro más
  largo de la página mientras leía fue de 18 ms: la pantalla no se entera.

## Qué se guarda por caja (y qué no)

`sku`, `source` (la procedencia del motor tal cual) y `channel` (`barcode`/`qr`/`ocr`/`none`),
`confidence` (media del OCR en la etiqueta), `bbox` **en píxeles de la foto original** (deshecho el
giro de la cascada, `unmapBoxFromRotation`), modelo/talla/color, UPC/GTIN, número de barras.
**Nunca el texto crudo del OCR**: en una foto con guía de FedEx trae nombre y dirección del
cliente (lo prueba `dcvShadow.test.ts`).

## La huella del motor

`engineConfigHash()` (`src/lib/recognition/engineConfig.ts`) = 16 hex del SHA-256 de
`ENGINE_CONFIG`, que incluye opciones, versiones de onnxruntime / ppu-paddle-ocr / zxing, el
SHA-256 de cada modelo **y el del código fuente del motor**. No hay que acordarse de subir nada:
`engineConfig.test.ts` recalcula las tres huellas y falla, diciendo el valor nuevo, en cuanto una
cambia. El banco importa la misma función y corre con `ENGINE_CONFIG` → mismo hash, misma ventana.

## La muestra que se adjudica

`sample_rate` es una tirada **por foto** (E4). La elegida se copia a `sample/` en el servidor
(`copyObject`, sin volver a gastar datos del teléfono), que no tiene regla de expiración: se borra a
mano después de adjudicar. `full/` 30 días, `r2000/` 180 días (reglas de ciclo de vida de R2 por
prefijo, sin cron ni procesamiento en servidor).

## Las consultas

| Vista                    | Qué contesta                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `v_dcv_shadow_daily`     | fotos por día, **cobertura** = `ok` / todas (dropped, unsupported, timeout, error cuentan como no leídas) con Wilson 95 %, p50/p95                                 |
| `v_dcv_shadow_by_device` | lo mismo por dispositivo (`SM-S938U` por client hints), y los píxeles que negocia                                                                                  |
| `v_dcv_shadow_vs_group`  | por corrida `ok` y `sku_key` (sobre `canonical_sku`): leídas vs pedidas **en cantidades**; `extra_known` = candidato a verde falso, `extra_unknown` = UNIDENTIFIED |

**«missing» no es recall**: una foto casi nunca muestra todas las cajas. El recall sale de la
muestra adjudicada. Las tres son `security_invoker`: sólo un admin ve filas.

## La foto del pallet, sin carreras

Desde `ec612bb` el modo vista también fotografía, así que dos personas pueden disparar sobre la
misma orden. DCV leía `pallet_photos`, añadía y reescribía: la segunda escritura borraba la primera
foto. `append_pallet_photo` / `remove_pallet_photo` lo hacen en una sentencia (y no repiten una URL
que ya está). Son `SECURITY INVOKER`: las mismas políticas y triggers que el UPDATE de antes.

## Encenderlo

1. Bucket, CORS, ciclo de vida y token (`label-bench/sombra-dcv/06-pasos-bucket.md`).
2. `supabase functions deploy dcv-original-url --no-verify-jwt`.
3. `update app_flags set enabled = true, config = config || '{"only_users": ["<uuid>"]}' where key = 'dcv_shadow'` — primero un solo usuario (`only_users`; vacía es nadie)
   mirando `v_dcv_shadow_by_device`, después para todos. Apagar es la misma línea con `false`.
