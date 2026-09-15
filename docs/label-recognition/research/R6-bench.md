# R6 · Banco empírico: motores abiertos de barras y OCR sobre las 13 cajas

> 15 sep 2026. Verdad de terreno: §6 de `docs/label-recognition/01-lo-aprendido.md` (13 cajas, 14 fotos,
> la caja 3 tiene dos caras). Todo corrió en local, en venvs aislados dentro del scratchpad. No se instaló
> nada global y ninguna foto salió de la máquina: por red solo bajaron wheels de pip y pesos de modelos.
> Scripts, salidas crudas y tablas automáticas están en `scratchpad/bench/` (índice en §10).

---

## 0. Resumen

**Aciertos exactos por campo.** El denominador es el número de fotos donde el campo está impreso. Entre
paréntesis van las lecturas `near` (a ≤2 ediciones): casi aciertan, pero sin corregirlas no sirven.

| Motor                          | SKU        | UPC (o GTIN)  | GTIN-14      | G.W. por posición            | G.W. por orden de lectura | Serie/frame §6 | ms/foto |
| ------------------------------ | ---------- | ------------- | ------------ | ---------------------------- | ------------------------- | -------------- | ------- |
| **zxing-cpp**, 1 llamada       | 5/12       | 7/10          | 4/4          | — (ningún código lleva peso) | —                         | 3/6            | **173** |
| **zxing-cpp**, 15 variantes    | 5/12       | 8/10          | 4/4          | —                            | —                         | 3/6            | 2 203   |
| RapidOCR PP-OCRv4 mobile @2000 | 9/12 (+2)  | 4/10 (+4)     | 2/4 (+2)     | 10/12                        | 8/12                      | 5/6 (+1)       | 1 510   |
| RapidOCR PP-OCRv4 mobile @4000 | 9/12 (+2)  | 4/10 (+4)     | 1/4 (+3)     | 10/12                        | 7/12                      | 5/6 (+1)       | 5 100   |
| RapidOCR PP-OCRv5 mobile       | 10/12 (+2) | 4/10 (+4)     | 1/4 (+2)     | **11/12**                    | 8/12                      | 5/6 (+1)       | 1 707   |
| **RapidOCR PP-OCRv6 small**    | 10/12 (+1) | 5/10 (+4)     | 2/4 (+2)     | 10/12                        | 9/12                      | **6/6**        | 1 985   |
| **RapidOCR PP-OCRv6 medium**   | 10/12 (+1) | **7/10** (+2) | **3/4** (+1) | 10/12                        | 8/12                      | **6/6**        | 6 303   |
| EasyOCR en (canvas 1280)       | 10/12      | 2/10 (+4)     | 1/4 (+1)     | 9/12                         | 5/12                      | 5/6 (+1)       | 14 119  |

**Por caja, sumando barras y un OCR** (el campo cuenta si cualquiera de los dos lo da exacto):

| Combinación                               | SKU (11 cajas) | UPC/GTIN (9)              | G.W. (11)                     | Serie/frame (6) |
| ----------------------------------------- | -------------- | ------------------------- | ----------------------------- | --------------- |
| zxing (variantes) solo                    | 5/11           | 8/9                       | 0/11                          | 3/6             |
| PP-OCRv6 small solo                       | 10/11          | 5/9                       | 9/11                          | 6/6             |
| **zxing + PP-OCRv6 small**                | **11/11**      | **8/9** (falla la caja 3) | **9/11** (fallan la 6 y la 8) | **6/6**         |
| zxing + PP-OCRv6 medium + PP-OCRv5 mobile | 11/11          | 8/9                       | 10/11 (falla la 6)            | 6/6             |

**Cinco hallazgos:**

1. **Las barras no se equivocaron ni una vez.** Hubo 0 lecturas válidas con un valor distinto de la verdad.
   Por dentro, zxing produjo 7 lecturas de UPC/GTIN erróneas (`845436092950`, `845436188099`,
   `00845436089346`…), y el dígito de control las descartó todas. Cuando el símbolo está sano, lo leyó
   siempre: SKU 5/6, UPC/GTIN 8/10 (los 2 fallos son los códigos tachados de la caja 3) y serie 3/3.
   El techo lo pone la etiqueta, no el lector: el tipo B no trae barra de SKU, y la D no trae ninguna.
2. **Con OCR, el UPC de la etiqueta tipo A no se reconstruye.** Los dígitos se imprimen partidos alrededor de
   las barras de guarda (`8 45436 09295 9`), y el OCR devuelve `45436109295`: pierde el 8 y el 9 y lee una
   guarda como `1`. En los tipos A la barra es la única vía. Donde el UPC va impreso seguido (tipo B), el OCR sí lo lee.
3. **El texto blanco sobre negro no es un problema para PP-OCR.** Leyó los modelos en caja negra 7–8 de 9
   veces y los SKU en caja negra 7–8 de 10. Los fallos coinciden con daño físico (3a, 3b), no con la inversión.
4. **Las confusiones de glifo aparecen donde §5 las predijo:** `I→1` (10 veces: `M21I014353→M211014353`,
   `WMEI→WME1`), `8→9` en el GTIN de la 12 y `3→2` en el G.W. de la 6 (`20.30→20.20`, en todos los
   motores que lo leyeron). El dígito de control atrapa las de UPC/GTIN. Las de peso y serie no tienen
   checksum: pasan como verosímiles.
5. **Ante el daño, el OCR no calla: inventa con forma válida.** En la 3a, un trazo de rotulador sobre el
   `9` hizo que los cinco motores PP-OCR devolvieran `03-4143BR` o `03-4143FR` con confianza. Es un SKU
   con forma correcta y equivocado. En la misma foto, el Code 39 decía `03-4149BR`. Es el mismo riesgo que
   §5 atribuye a la IA, pero en OCR clásico.

---

## 1. Entorno e instalación

|             |                                                                                                          |
| ----------- | -------------------------------------------------------------------------------------------------------- |
| Máquina     | Mac arm64, 8 núcleos, **8 GB de RAM**, macOS 26.6.2. Durante la prueba había **6,1 GB de swap en uso**   |
| Python      | 3.9.6 del sistema, el único disponible (sin brew, uv ni pyenv)                                           |
| Aislamiento | `bench/.venv` (zxing + RapidOCR) y `bench/.venv-easy` (EasyOCR + torch). Los modelos, en `bench/models/` |

| Paquete                | Versión | Instalación              | Tamaño en disco                               | Notas                                                                                      |
| ---------------------- | ------- | ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `zxing-cpp`            | 2.3.0   | wheel `universal2`, <5 s | 2,9 MB                                        | 3.1.1 no trae wheel cp39: intenta compilar y falla. Se fijó 2.3.0                          |
| `rapidocr-onnxruntime` | 1.4.4   | 11 s                     | onnxruntime 60 MB + opencv 119 MB + lib 16 MB | Modelos PP-OCRv4 mobile incluidos (15 MB)                                                  |
| `rapidocr`             | 3.9.2   | 5 s                      | 31 MB                                         | Baja los pesos de ModelScope por preset: v6 small 31 MB, v5 mobile 21 MB, v6 medium 139 MB |
| `easyocr`              | 1.7.2   | 25 s                     | venv 702 MB (torch 2.8.0) + 94 MB de modelos  | Unos 800 MB en total: dentro del tope de 1 GB                                              |
| `pyzbar`               | —       | no se probó              | —                                             | Necesita `libzbar` del sistema (brew): fuera de las reglas                                 |
| `doctr`                | —       | no se probó              | —                                             | Misma familia de dependencias que EasyOCR (torch), y EasyOCR ya salió lento                |

**Tiempos:** son de CPU, con la máquina bajo presión de memoria. Sirven para comparar motores entre sí,
no para predecir un teléfono. Hubo dos tropiezos que conviene recordar:

- **EasyOCR con el canvas por defecto (2560) no terminó** la primera foto en más de 8 minutos, con swap.
  Se midió con canvas 1280, que tardó 10–20 s por foto.
- **macOS baja la prioridad de un proceso lanzado en segundo plano:** EasyOCR tardó 242 s por foto en
  background y 13 s en primer plano. Todas las cifras de la tabla se tomaron en primer plano.

## 2. Método

- **Verdad** (`bench/gt.json`): la tabla §6 más lo que dijo el encargo. Se agregaron los GTIN de las fotos 6
  y 8, que están impresos (`00`+UPC). Se agregaron también dos marcas hechas a ojo, sin que entren en la
  puntuación principal:
  - `barcode_present`: si el símbolo de ese campo está físicamente en la foto.
  - `frame_A`: el frame impreso en las etiquetas tipo A. La tabla §6 no lo trae, así que se puntúa aparte.
- **Barras** (`bench_barcodes.py`): se prueban `S0`, una llamada `read_barcodes` por defecto, y 15 variantes
  por foto: escala 0,5/0,35/0,25, binarizador global, rotación ±15/±30/45°, CLAHE y mosaicos 2×2 y 3×3 a
  resolución completa. Todo con `return_errors=True`, para ver lo que el checksum descarta.
  - SKU: el texto normalizado (`A-Z0-9`) es igual al de la verdad.
  - UPC: el valor, `0`+UPC o `00`+UPC.
  - Serie: está contenida en el código (el QR del tipo A es una lista separada por comas).
- **OCR** (`run_rapidocr.py`, `run_rapidocr3.py`, `run_easyocr.py`): una pasada sobre la foto entera, ya
  enderezada por EXIF, sin preproceso. Se guarda cada caja con su polígono, texto y score.
- **Aciertos en OCR** (`score.py`):
  - `box`: el valor normalizado aparece dentro de una caja.
  - `line`: aparece al unir las cajas de una misma línea.
  - `near`: a ≤2 ediciones. Se guarda el fragmento leído, para catalogar la confusión.
  - SKU con guiones normalizados: `03-4000-BL` cuenta como `034000BL`.
- **G.W.:** el número con contexto `KG` tiene que quedar **ligado** a la etiqueta `G.W`. Se midieron dos
  asociaciones ingenuas:
  - **por posición:** el número con KG más cercano a la derecha, a ±1,5 alturas de línea;
  - **por orden de lectura:** el primer número con KG que sigue a `G.W` en el texto aplanado.

  Si el número aparece pero la regla de posición no lo liga, cuenta como fallo (`value`).

- **Extracción ciega:** es lo que haría un parser sin conocer la respuesta.
  - SKU: regex `DD-NNNN[CC]` dentro de cada caja.
  - UPC: ristras de dígitos con prefijo 845436 y dígito de control válido, o GTIN-14 `00845436…` con control.

## 3. Barras en detalle

|                                 | SKU                            | UPC/GTIN | Serie/frame §6            | Frame tipo A (aparte) |
| ------------------------------- | ------------------------------ | -------- | ------------------------- | --------------------- |
| Símbolos presentes en las fotos | 6 (tipo A: 1, 3a, 3b, 4, 5, 7) | 10       | 3 (2, 9 y el QR de la 10) | 6                     |
| Leídos, 1 llamada               | 5                              | 7        | 3                         | 5                     |
| Leídos, variantes               | 5                              | 8        | 3                         | 5                     |

- **Qué variante encontró cada cosa.** Hubo 26 decodificaciones útiles contra la verdad.
  - `S0` sacó 22.
  - **Los mosaicos 2×2+3×3 (13 llamadas, ~500 ms por foto) sacaron las 26.** Rescataron el UPC de la 7, el
    Code 39 del frame de la 4, el QR de la 5 y el Code 128 del UPC suelto de la 2.
  - Las rotaciones finas (~1 s) no aportaron nada que no saliera por otra vía.

  Escalera recomendada: `S0` → mosaicos. Cuesta ~0,7 s por foto de 12 MP y da lo mismo que las 15 variantes.

- **Lo que no se leyó y por qué:**
  - 3a y 3b: el UPC tiene un trazo de rotulador o rayones encima.
  - 3b: la barra del SKU está rayada.
  - 3a: no se leyó ni el frame ni el QR.
  - 7: el QR no se leyó.
  - 2, 6 y 8: el tipo B no imprime la barra del SKU.
  - 9 y 10: la etiqueta D tapa la barra del SKU.
  - 11, 12 y 13: la etiqueta D no tiene barras.
- **El QR del tipo A es una mina que §3 ya intuía:** `0023JC-7RA1-G541,WRDH01637,1,SET,A129,A23JC-744,0003`
  trae juntos el código de fábrica (modelo y talla), el frame, el carton y los códigos de la cabecera. En la 3b, con el UPC y el
  SKU rayados, el QR dio `WMEI00065` y `R14`, que coinciden con la 3a: **es la prueba mecánica de que las dos
  caras son la misma caja.**
- Errores de checksum descartados (lista completa en `results.md` §7): `845436092950` (1), `00845400486774` (2),
  `845470101679` (4), `845436089475` (5), `845436188099` (6), `845436479331` y `00845436089346` (8).

## 4. OCR en detalle: los fallos que importan

| Foto · campo           | Verdad           | Qué devolvió el OCR                           | Causa                                                                                                                   |
| ---------------------- | ---------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1, 5, 7 · UPC (tipo A) | `845436092959`   | `45436109295`, `4543608654`…                  | Dígitos partidos por las guardas; el dígito extremo va aparte y pequeño. v6 medium rescata el 5 y el 7 uniendo la línea |
| 3a · SKU               | `03-4149BR`      | `03-4143BR` (v4), `03-4143FR` (v5, v6s, v6m)  | Trazo de rotulador sobre el 9. **Valor con forma válida y equivocado**; el Code 39 de la misma foto lo corrige          |
| 3b · SKU/UPC           | `03-4149BR`      | `W9BR`, `M49BR`; `24501`, `02459`             | Rayones: nada recuperable. `02459` es justo la lectura que §3 descartó por checksum                                     |
| 6 · SKU                | `03-4000-BL`     | `03-4000-B` (v4)                              | La L final queda al borde de la caja negra. v5, v6 y EasyOCR lo leen bien                                               |
| 6 · GTIN               | `00845436088099` | `0084543608809` / `00845436088059`            | Tinta gastada en el último dígito; el control descarta `…059`                                                           |
| 6 · G.W.               | `20.30`          | `20.20` (v4 ×2, v6m); nada (EasyOCR, v5, v6s) | Confusión `3→2` en impresión gastada. N.W. salió `16.40` (v4, v6m, EasyOCR) o `16.10` (v5, v6s)                         |
| 8 · G.W.               | `17.80`          | `17.80` sin etiqueta (5 de 6 motores)         | Film con suciedad encima de `N.W.`/`G.W.`: el número está, pero no se sabe de quién es. v5 leyó `G.W:` y lo ligó        |
| 12 · GTIN              | `00845436087757` | `00845436097757` (v4 ×2)                      | `8→9`; el control lo descarta. v6 small y medium lo leen exacto                                                         |
| 13 · serie             | `M21I014353`     | `M211014353` (v4, v5)                         | `I` con serifa leída como `1`. v6 y EasyOCR aciertan. **Sin checksum: pasaría**                                         |
| 9 · serie              | `U226U03952`     | `U226003952` (EasyOCR)                        | `U→0`                                                                                                                   |

- **Resolución:** subir PP-OCRv4 de 2000 a 4000 px (resolución completa) **no mejoró nada** y tardó 3,4×
  más. Los números de las etiquetas ya son grandes a 2000 px.
- **Generación del modelo:** PP-OCRv6 small es tan rápido como v4 (2,0 s contra 1,5 s), y junto con v6 medium
  son los únicos que aciertan las 6 series. v6 medium es el mejor en dígitos: UPC 7/10, GTIN 3/4, frame 6/6.
- **EasyOCR** es el peor en dígitos (UPC 2/10) y el más lento (14 s con un canvas reducido). No compensa
  frente a PP-OCR vía ONNX.
- **Extracción ciega:**
  - Con prefijo y dígito de control, **ningún UPC erróneo pasó** en 6 corridas × 14 fotos. El control
    rechazó `845436097757`, `845436088059`, `845436109295` y `845436108654`.
  - El regex de SKU dio 1 valor **equivocado** por motor, siempre en la 3a.
  - Aplicado a líneas unidas en vez de cajas sueltas, el regex fabricaba SKUs con el código de fábrica
    (`81-0122JC`, `32-0022JC`, `29-0022JC`), así que se limitó a cajas.

## 5. Contraste con §5 de `01-lo-aprendido.md`

| Predicción de §5 (OCR clásico)                                 | Resultado empírico                                                                                                                                                                                                                                                    | Veredicto                                                                        |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Orden de lectura** en etiquetas de dos columnas              | Para ligar el G.W., el orden de lectura acierta 5–9 de 12 y la posición del recuadro 9–11 de 12. En la foto 1 el orden de lectura falla en **los 6 motores**: la perspectiva deja `17 KGS` en la línea de `N.W.`. En la 10, con los valores corridos, falla en 5 de 6 | **Confirmado**, pero la geometría lo rescata casi todo: el OCR sí da coordenadas |
| **Texto blanco sobre negro**                                   | Con PP-OCR, modelos 7–8/9 y SKU 7–8/10, y los fallos se deben a daño físico. EasyOCR: modelos 4/9                                                                                                                                                                     | **Refutado para PP-OCR**; vale para EasyOCR                                      |
| **Confusiones de glifo** `0/O`, `1/I/L`, `3/8`, `M21I`, `WMEI` | `I→1` ×10 (`M21I`, `WMEI`), `0→O`, `W→V`, `U→0`, `8→9`, y `3→2` en `20.30`                                                                                                                                                                                            | **Confirmado, casi letra por letra.** No apareció `3/8`, sino `3/2`              |
| **Foto, no escáner**: film, perspectiva, curva                 | Con film (3a, 3b, 8), el G.W. salió 2–3/3. Lo que muere son las etiquetas pequeñas (`N.W.`/`G.W.` en la 8), no los valores grandes. Perspectiva: ver orden de lectura                                                                                                 | **Matizado**: afecta más a la asociación que a la lectura                        |
| **Semántica**: no sabe qué número es cuál                      | 5–46 cajas sin nombre por foto. Hizo falta regex por caja, reglas de posición y checksum. El `17.80` de la 8 queda huérfano                                                                                                                                           | **Confirmado**                                                                   |
| **Texto dañado**: basura o nada                                | En la 3b sí, basura. En la 3a, **un valor verosímil y erróneo** (`03-4143BR`)                                                                                                                                                                                         | **Matizado:** el OCR también «inventa» cuando el daño parece un glifo            |
| **Barras exactas cuando están sanas**                          | 100 % de los símbolos sanos, 0 lecturas válidas erróneas, 7 errores internos descartados por checksum                                                                                                                                                                 | **Confirmado**                                                                   |
| **Validación determinista** atrapa la duda                     | El checksum atrapó los 4 UPC/GTIN mal leídos por OCR. G.W.−N.W.: en la 6 marca `20.20−16.40=3,80≠3,90`; en la 8, `17.80−13.90=3,90` confirma                                                                                                                          | **Confirmado.** Ojo: en la 6 dice «algo no cuadra», no cuál de los dos está mal  |

## 6. Qué implica para el motor

1. **Barras primero:** zxing-cpp con una llamada y luego mosaicos (~0,7 s en esta Mac; en el teléfono,
   ML Kit o `BarcodeDetector`). Da **exactos y sin alucinar** el UPC/GTIN en 8 de 9 cajas, el SKU en
   los tipo A sanos y el frame, la carton y el código de fábrica vía QR. Si una barra válida contradice al OCR, gana la barra (caso 3a).
2. **OCR abierto de base: PP-OCRv6 small vía ONNX** (31 MB de modelos, ~2 s por foto en CPU). Aporta lo
   que no tiene barra: el SKU de las etiquetas B y D (10/11 cajas), la serie de la D (6/6) y el G.W. (9/11).
   v6 medium solo si corre en servidor.
3. **La asociación clave-valor, por coordenadas y no por texto:** con la regla de posición, el G.W. pasa de 9/12 a 10/12.
   Los regex, por caja. Checksum, forma canónica y G.W.−N.W. fuera del modelo, como pide §7.
4. **El residuo es exactamente lo que §5 reservaba a la visión o a una persona:**
   - el UPC de la caja 3, que ni barras ni OCR sacan;
   - el `20.30` gastado, que todos leen `20.20`;
   - el G.W. sin etiqueta bajo el film;
   - la serie `M21I` sin checksum, que según el motor sale `M211`;
   - el SKU tachado de la 3a, donde el OCR miente con forma válida.

   Barras + PP-OCRv6 + reglas dejan el 90 % de los campos resueltos (34 de 37 campo-caja de la tabla del §0), y cada uno de los 3 fallos es identificable.

## 7. Limitaciones

- 14 fotos de un solo teléfono (Galaxy S25 Ultra, 12 MP) y un solo día. Las proporciones son orientativas.
- La regla de posición del G.W. se escribió viendo estas salidas. Es simple (el número con KG más cercano a
  la derecha) y no tiene ajuste por foto, pero no está validada en fotos nuevas.
- `near` usa distancia de subcadena y es permisivo: sirve para catalogar confusiones, no como acierto.
- No hubo preproceso (enderezar, recortar la etiqueta, quitar brillos) ni pasadas por región. Cualquiera
  de las dos cosas puede subir el OCR; esto mide el suelo.
- Los tiempos son de una Mac de 8 GB con swap, no de un móvil.
- EasyOCR se midió con el canvas a 1280, no con su default.

## 8. Reproducir

```bash
cd scratchpad/bench
.venv/bin/python bench_barcodes.py                     # raw/barcodes.json
.venv/bin/python run_rapidocr.py 2000                  # y 4000
OC_DISABLE_DOT_ACCESS_WARNING=1 .venv/bin/python -W ignore run_rapidocr3.py v6small 2000   # v5mobile, v6medium
.venv-easy/bin/python run_easyocr.py 1280              # en PRIMER PLANO
.venv/bin/python score.py && .venv/bin/python extra_checks.py
```

## 9. Aviso sobre datos personales

`raw/*/12.txt|json` contiene fragmentos de la etiqueta FedEx de la foto 12 (nombre y dirección del
remitente). Igual que las fotos, **no se copian al repo**. Este informe no los cita.

## 10. Archivos (`scratchpad/bench/`)

| Archivo                                                                  | Qué es                                                                                                 |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `gt.json`                                                                | Verdad por foto, con `barcode_present` y `frame_A`                                                     |
| `bench_barcodes.py` → `raw/barcodes.json`                                | Todas las decodificaciones por variante, con tiempos y errores de control                              |
| `ocr_common.py`, `run_rapidocr.py`, `run_rapidocr3.py`, `run_easyocr.py` | Runners de OCR                                                                                         |
| `raw/<motor>/<foto>.json` y `.txt`                                       | Salida cruda: cajas con polígono, texto y score, y el texto por líneas                                 |
| `score.py` → `results.md`, `results.json`                                | Tablas por campo, barras sobre símbolos presentes, caja 3, fusión, detalle por foto y extracción ciega |
| `extra_checks.py` → `extra.md`                                           | Blanco sobre negro, catálogo de confusiones, film, G.W.−N.W.                                           |
| `logs/`                                                                  | Instalación y tiempos de cada corrida                                                                  |
| `preview/`                                                               | Miniaturas de 1400 px usadas para marcar a ojo la presencia de símbolos                                |
| `raw_partial/easyocr_en_2560/`                                           | La única foto que terminó EasyOCR con el canvas por defecto (480 s)                                    |
| `.venv`, `.venv-easy`, `models/`                                         | Entornos y pesos (~1,3 GB en total; se pueden borrar)                                                  |
