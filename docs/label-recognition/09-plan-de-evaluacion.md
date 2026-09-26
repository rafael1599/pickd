# Plan de evaluación del lector en fotos de pallet — pre-registro

> 24 sep 2026. Antes de conectar `PalletScanSheet` con la orden en Double Check (fase 2 de
> `06-pallet-en-double-check.md`) se mide el motor contra fotos reales de órdenes pasadas. Este
> documento fija **antes de correr nada** qué se mide, con qué muestra y qué número decide cada
> etapa. Lo que se cambie después de ver resultados se anota abajo como enmienda, con fecha y motivo.
>
> Marco: CRISP-DM; _Rules of ML_ (Zinkevich) y _The ML Test Score_ (Breck et al., 2017) para
> despliegue y reproducibilidad; _Machine Learning Yearning_ (Ng) para métricas y análisis de
> errores; _Datasheets for Datasets_ (Gebru et al.) para la ficha del banco.

## 1. La decisión

Si la fase 2 de DCV entra en **sombra**, pasa a **ayuda** o llega a **requisito**. Nada más.

## 2. Métricas

| Tipo                    | Métrica                                                                                   | Unidad      |
| ----------------------- | ----------------------------------------------------------------------------------------- | ----------- |
| **Guardia**             | Verde falso: caja que el motor da con un SKU distinto al de la verdad de terreno          | caja        |
| **A optimizar**         | Recall: cajas legibles de la verdad de terreno que el motor identifica con su SKU exacto  | caja        |
| Se reportan, no deciden | Cantidad por SKU, «coincide / falta / sobra» contra el grupo de la orden, tiempo por foto | foto, orden |

Toda proporción va con su **intervalo de Wilson al 95 %**. Con 0 errores en _n_ cajas el techo es
**3/n** (regla de tres).

## 3. Umbrales

| Etapa     | Verde falso (techo del IC 95 %) | Recall por caja, fotos de cerca | Cajas mínimas |
| --------- | ------------------------------- | ------------------------------- | ------------- |
| Sombra    | < 3 %                           | —                               | ~100          |
| Ayuda     | < 3 %                           | ≥ 70 %                          | ~100          |
| Requisito | < 1 %                           | ≥ 70 %, y confirmado en sombra  | ~300          |

La salida manual y el conteo cámara contra mano (`08-lo-que-dejo-el-escaner-en-vivo.md` §3.1–3.2)
son obligatorios desde la etapa de ayuda.

## 4. Muestra

- **Universo:** órdenes `completed` con `pallet_photos`. El paso 0 dice cuántas son, cuántas fotos
  y cajas traen, y de ahí sale el número de órdenes.
- **Estratos:** orden sencilla o combinada (se compara contra el **grupo**), sólo bicis o con partes,
  una caja o pallet.
- **Única exclusión: fotos tomadas de muy lejos** (Rafael, 24 sep 2026). Regla fija: una foto es
  «de lejos» si **ninguna etiqueta es legible a ojo** en ella — se ve el pallet, no se lee el texto
  de ninguna caja. La clasifica la doble lectura del paso 3 y la confirma Rafael **antes** de correr
  el motor local, para que ningún fallo del motor se excluya después de visto. Se cuentan las
  excluidas.
- Las fotos con guía de FedEx **no** se excluyen (Rafael, 24 sep 2026). Viven fuera del repo.
- **División:** 70 % dev / 30 % test, **por grupo de orden** (dos fotos del mismo pallet nunca a
  los dos lados) y test = las órdenes más recientes. Test se mira **una vez**, al final.

## 5. Verdad de terreno

- Dos lecturas independientes con agy, **a ciegas de la orden**, por caja: `sku`, `legible`
  (sí / parcial / no), recuadro en %, texto donde se leyó; más cuántas etiquetas se ven sin leerse.
- Adjudica Rafael: toda discrepancia entre lecturas, toda discrepancia con el grupo de la orden, y
  una muestra al azar del ~10 % donde todo coincide.
- Se reporta la concordancia entre lecturas (kappa de Cohen). **Si agy acierta poco, se para aquí.**

## 6. Procedimiento

| #   | Paso                                                | Se para si…                       |
| --- | --------------------------------------------------- | --------------------------------- |
| 0   | Medir el universo (prod, sólo lectura)              | no hay fotos suficientes de cerca |
| 1   | Este pre-registro                                   | —                                 |
| 2   | Muestra congelada: manifiesto con hash, división    | —                                 |
| 3   | Doble lectura + adjudicación                        | la concordancia es baja           |
| 4   | Línea base del motor actual (Playwright, headless)  | —                                 |
| 5   | Análisis de errores en dev: 50–100 fallos por causa | —                                 |
| 6   | Mejoras de a una en dev (P1–P4 del doc 07)          | —                                 |
| 7   | Test, una vez                                       | no pasa los umbrales de §3        |
| 8   | DCV: sombra → ayuda → requisito, detrás de un flag  | la sombra contradice al test      |

Cada corrida guarda el hash del manifiesto, el commit, la configuración del motor y los resultados.
La tabla de telemetría de la sombra existe **antes** de encenderla.

## 7. Enmiendas

**E1 · 24 sep 2026 — el banco son las fotos históricas que mejor se ven.** El paso 0 midió 1.336
órdenes con foto (1.782 fotos, 8.541 unidades), pero `compressImage` las guarda a **1200 px**,
mientras el motor en DCV lee el `File` original (~0,43–0,50 de 4032 px contra 0,30). Rafael decide
trabajar con el histórico, eligiendo las fotos que mejor se ven entre las malas. Consecuencias,
escritas antes de ver un solo resultado:

- **Filtro de calidad fijo, a ciegas del motor.** Una foto entra si tiene **al menos una etiqueta
  con el SKU legible a ojo** y no está movida. La clasifica agy con la rúbrica del paso 2b y la
  confirma Rafael; el motor local no se corre hasta que la selección esté cerrada.
- **Alcance de la afirmación.** Los números valen para «fotos de DCV a 1200 px que un humano puede
  leer», no para toda foto. Se reporta qué fracción del pool pasó el filtro.
- **Sesgo conocido:** a 1200 px el motor rinde menos que en producción, sobre todo en barras. El
  resultado es una **cota pesimista**; los umbrales de §3 se aplican igual.
- Guardar las fotos en alta resolución (y degradarlas con el tiempo) queda para otra sesión.
- Estratos bici/parte se cruzan por `sku_key` (`regexp_replace(upper(sku), '[^A-Z0-9]', '', 'g')`),
  no por `sku` crudo como hizo el paso 0. La unidad de muestreo es el **grupo** (219 fotos se repiten
  entre órdenes del mismo grupo).

**E2 · 25 sep 2026 — la selección, cerrada antes de correr el motor.** Pool de 240 unidades y 325
fotos (`label-bench/pallet-v1/manifest.json`, sha256 `b8ee8225…`, semilla `0.20260924`). agy marcó
258 fotos como «entra»; Rafael revisó la hoja y **sacó 89** (64 de distancia media, 25 de cerca y las
6 dudosas de lejos) y no metió ninguna: quedan **169 fotos, 138 unidades (90 dev / 48 test)**
(`seleccion.json`, sha256 `f9fb460f…`). Dos consecuencias:

- **agy sobreestima la legibilidad**: uno de cada tres «legibles» no lo era para una persona. En el
  paso 3 su lectura no se acepta sin adjudicación, y la muestra al azar de §5 sube del 10 % al 20 %.
- Test trae ~224 etiquetas según agy, menos en realidad: basta para sombra y ayuda (§3), **no** para
  requisito (~300). Esas cajas vendrán de la sombra en DCV con fotos a resolución completa.

**E3 · 25 sep 2026 — corrige E1: DCV no corre el motor.** `18bfddb` (23 sep) sacó `PalletScanSheet`
de Double Check («foto y completar, sin el lector de etiquetas en medio»); `06-pallet-en-double-check.md`
describe lo anterior. Hoy la foto sale de `CameraCaptureSheet`: un **cuadro del video** de
`getUserMedia` (pide 3840×2160 como ideal) guardado como JPEG 0,92, y después `compressImage` lo
baja a 1200 px para `pallet_photos`. La comparación de E1 queda así: la entrada «de producción» de
la sombra es ese cuadro, **hasta ~8 MP**, no una foto fija de 4032 px. Como el motor la recorta por
dentro a 1920 (detector) y 2000 (recortes), un cuadro de 3840 px da casi la misma escala que la foto
fija para el OCR; la diferencia pesa en las barras. **Si el teléfono negocia menos** (p. ej.
1920×1080), la distancia con el banco de 1200 px se achica y el banco representa mejor a
producción. Lo que el S25 Ultra entrega de verdad lo mide la sesión de la sombra; nada del banco
cambia.

**E4 · 25 sep 2026 — el banco y la sombra corren el mismo motor.** La sombra de DCV corre el motor
en un Worker con `catalog: false` (el lookup de catálogo usa la sesión de Supabase y no entra en un
Worker) y decide «lo confirma el catálogo» fuera, por `sku_key`. El banco corre **igual**, y cada
corrida —del banco o de la sombra— guarda el mismo hash de configuración. Además:

- **La vista contra el grupo no es recall**: una foto casi nunca muestra todas las cajas de la
  orden. Para las cajas de requisito (§3) se toma una **muestra al azar** de corridas de la sombra y
  pasa por el mismo protocolo de §5, cada semana, dentro de los 30 días de `full/`.
- **Dos métricas separadas**: cobertura (fotos `ok` sobre fotos tomadas; `dropped`, `unsupported`,
  `timeout` y `error` cuentan como no leídas) y precisión/recall sólo sobre las `ok`.
- **El verde falso incluye contar de más**: 6 cajas de un SKU que la orden pide 4 son 2 verdes falsos.
