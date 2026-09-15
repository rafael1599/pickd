# Reconocimiento de etiquetas de caja — lo aprendido a mano

> Sesión del 15 sep 2026: Rafael fotografía cajas en el piso y Claude las lee, las cruza con PickD
> y el AS400, y las registra. **13 cajas, 15 fotos.** Este documento es el punto de partida del
> motor de reconocimiento: qué hay en una etiqueta, qué reglas decidieron cada caso, y dónde un
> modelo de visión como Claude acierta y un OCR clásico probablemente no. La investigación de
> motores existentes vive en `02-investigacion.md`.
>
> Las fotos están fuera del repo (`~/.claude/uploads/607e3175-…/`). No se copian: una trae una
> etiqueta de FedEx con el nombre de una persona. La tabla de §6 es su verdad de terreno.

---

## 1. El problema, en una frase

De la foto de una caja → **qué SKU es, qué dice la etiqueta que PickD no sabe, y qué gesto proponer**
(reponer, dar de alta, corregir un dato), dejando a la persona sólo lo que el piso sabe: **dónde va y
si la caja es nueva**.

## 2. Tipos de etiqueta encontrados

| Tipo                              | Cómo se reconoce                                                                            | Campos                                                                                                                                                 | Ejemplos                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| **A · Fábrica «Taiwan»**          | `DESTINATION: U.S.A.`, `ITEM:` con barras, cajas negras de SKU y MODEL, tres códigos arriba | SKU · UPC NO · MODEL · SIZE (`700C x 54cm`, `650Bx21"`) · COLOR · QTY · FRAME NO · CARTON NO · N.W. · G.W. (kg enteros) · PO                           | 03-4270BK, 03-4149BR, 09-4807CL, 09-4796CL, 03-3845BL, 03-3850BK          |
| **B · Fábrica «MK NO / GTIN»**    | `JAMIS` + caja negra de modelo arriba, `GTIN:` bajo el SKU                                  | MODEL · `SIZE:700C*23"` · COLOR · UPC · SKU (a veces `03-4000-BL`) · GTIN-14 · P/O · MK NO · C/NO · SERIAL NO · N.W./G.W. **con dos decimales** · PORT | 03-4000BL, 06-4638BK, 03-3970BL; variante con SERIAL impreso: 03-3868BL   |
| **C · Fábrica «ORD/LOT»**         | `ORD NO.`, `LOT NO.`, `ITEM. BUS…`                                                          | SKU (con barras) · P/O · ORD · LOT · C/NO · código `44GZXC-19-30028` · ITEM · SERIAL (barras) · N.W./G.W. dos decimales                                | 03-3925BK                                                                 |
| **D · Interna «RETURN TO STOCK»** | Etiqueta blanca grande del almacén, texto centrado                                          | [SKU] · MODELO · TALLA+COLOR · SERIE · `RETURN TO STOCK`. **A veces sin SKU.** Sin UPC ni peso                                                         | 03-3925BK, 03-3850BK, 03-3934MN, 03-3970BL (sin SKU), 07-3680PD (sin SKU) |
| **E · Etiqueta de PickD**         | Impresa por la app: modelo, caja negra de SKU, UPC, QR                                      | La propia app                                                                                                                                          | captura del 03-4149BR                                                     |
| **F · FedEx «Return To Shipper»** | Etiqueta de envío con remitente 151 Ludlow Ave                                              | Dice _por qué_ está la caja aquí: una devolución                                                                                                       | 03-3970BL                                                                 |

**Casos mixtos que aparecieron:**

- **Etiquetas apiladas:** una D pegada sobre una A o C (03-3925BK, 03-3850BK). Una A reetiquetada tapando
  otra más vieja que asoma («19"… CK», 03-3868BL).
- **Dos caras dañadas de la misma caja** (03-4149BR): ninguna se lee entera, pero juntas sí. El frame y
  el carton coinciden, y eso prueba que es una sola caja.
- **Etiqueta de fábrica arrancada**, sólo queda la D (03-3934MN).
- **Anotaciones a mano** sobre la caja («10 JAN», «7/8», 03-3970BL).

## 3. Campos y la regla que valida cada uno

Todo lo que se puede comprobar sin mirar la foto otra vez **debe** comprobarse. Así se atrapó cada
lectura dudosa de la sesión.

| Campo                 | Forma                                                              | Validación determinista                                                                                                     | Caso real                                                                |
| --------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **SKU**               | `DD-NNNN[CCC]` (AS400)                                             | `canonical_sku()`; quitar guiones de más (`03-4000-BL` → `03-4000BL`), aceptar `SKU:033774BK`                               | 4 formas distintas en 13 cajas                                           |
| **UPC-A**             | 12 dígitos, prefijo **845436** (Jamis)                             | **Dígito de control**; prefijo                                                                                              | 03-4149BR: la foto sugería `02459`, el control lo descartó; `09159` pasa |
| **GTIN-14**           | `00` + UPC                                                         | Igual al UPC con dos ceros → **segunda lectura gratis**                                                                     | 03-3868BL, 03-4000BL, 06-4638BK, 03-3970BL                               |
| **Serie de hermanas** | SKU, UPC y talla avanzan juntos                                    | 4149–4153 ↔ 09159–09163 ↔ 48/51/54/56/58; 3996–4001 alterna color y talla                                                   | Confirmó un dígito tapado del SKU (03-4149BR)                            |
| **Código de fábrica** | `0023JC-7RA1-G541`                                                 | `7RA1` = Renegade A1, `7RS2` = S2, `5SEQS3` = Sequel S3; `G541` = talla 54; `00` bici / `01` framekit                       | Segunda lectura de modelo y talla                                        |
| **Peso**              | N.W. (bici) · **G.W. (caja)**, kg                                  | G.W. es el peso de PickD; `kgToLbs` ×2,20462262185 a la décima; **G.W. − N.W. es constante por fábrica** (3,90 kg en las B) | `20.?0` borroso → 16,40 + 3,90 = **20,30** (03-4000BL)                   |
| **Talla**             | `700C x 54cm`, `700C*23"`, `650Bx21"`, `26"*21`, `ST 16"`, `12"`   | Se guarda desnuda (`54`, `23`, `L16`); la unidad se pone al pintar                                                          | `ST 16"` = `L16` (03-3934MN)                                             |
| **Color**             | Nombre de Jamis                                                    | El del AS400 manda; corregir erratas (`VANILA` → `VANILLA MINT`); nunca el cubo genérico                                    | 03-3934MN tenía `MINT`                                                   |
| **Modelo**            | Nombre de caja o abreviatura del AS400                             | `expandModelAbbreviation`: `EC3` ↔ `EARTH CRUISER 3`, `BC7`, `BCCB`; `FRAMEKIT`/`FRAME` ⇒ **parte, `category = 'frame'`**   | El AS400 marca los cuadros como `B` (bug-037)                            |
| **Frame / serie**     | `WRDH01637`, `WMEI00094`, `U226U03952`, `Y22G002832`, `M21I014353` | No identifica modelo (`WMEI` sale en S2 **y** S1). La letra/año sugiere época (`M21` ≈ 2021)                                | Hizo dudar de la X.24                                                    |
| **PO**                | `PO2023-34`, `2022-06`                                             | Año del pedido, no el del modelo                                                                                            | 2022 en casi todo el lote                                                |

## 4. Del texto a la decisión (reglas de negocio)

1. **Búsqueda, en orden:** SKU impreso → UPC (hoy sólo ~10 SKUs lo tienen: cada foto rellena uno) →
   modelo + talla + color → serie de hermanas.
2. **Cinco salidas:**
   - **Existe con stock:** preguntar si la caja es nueva o una de ésas. El destino propuesto es su fila,
     con su letra.
   - **Existe sin stock:** reponer. El destino lo dice la persona (ese día fue ROW 37 F/G).
   - **No existe:** alta con `register_sku_from_as400` y la descripción vacía; el escáner la lee en
     minutos. Después, nombre y talla del AS400.
   - **Es cuadro:** parte, `category = 'frame'`.
   - **Identidad dudosa** (X.24 sin talla en el AS400): no escribir hasta que alguien confirme.
3. **Escritura:** ADD +1 en `RETURN TO STOCK` → MOVE a la fila. Al mover a una fila que ya existe se pasa
   su `sublocation` (si no, se borra), y se devuelve la `internal_note` que tenía (bug de idea-211). Sin
   nota por defecto. UPC sólo si estaba vacío; G.W. sellado sólo si cambia.
4. **Lo que la foto destapa sin buscarlo:** conteos PickD ≠ AS400 (ROW 1 D, ROW 4 I), reparto ≠ cantidad,
   colores en cubo, nombres rotos (`CODA S2 116…`, vacíos), un SKU registrado con el número de frame
   (`WMEI00132`), stock escondido en un contenedor (03-3970BL en 6436N).

**Lo que siempre necesitó a una persona:** el destino (13/13), «¿es nueva?» cuando había stock (3/13) y
una identidad (1/13). **Nunca** hizo falta para leer un campo que se pudiera validar.

## 5. Visión (Claude) contra OCR clásico

### Lo que un modelo de visión multimodal resolvió sin esfuerzo

- **Asociar clave y valor por disposición**, no por orden de lectura: dos columnas (`ORD NO.` | `LOT NO.`),
  valores corridos una fila respecto a su etiqueta (03-3850BK: `13 KGS` impreso _encima_ de `N.W.`).
- **Saber qué número es cuál** entre ocho o diez: SKU, UPC, GTIN, frame, carton, PO, MK, lote, códigos de
  fábrica. Un OCR devuelve todos como texto sin nombre.
- **Leer a través del daño:** cinta con brillo, film plástico, rayones, etiqueta arrancada, tinta corrida,
  dígitos a medias. Y **juntar dos caras** de la misma caja.
- **Etiquetas apiladas:** quedarse con la de encima, notar la de debajo y darle sentido («la reetiquetaron»).
- **Tipografías que no son de documento:** impresión térmica gastada, fuentes condensadas, texto sobre
  cartón curvo, en perspectiva, con poca luz.
- **Normalizar con conocimiento del dominio:** `03-4000-BL`, `VANILA MINT`, `700C*23"` → 23, `ST 16"` → L16,
  `X.24` → JUV X.24 DISC, `Black Pearl` → BLACK PEARL.
- **Contexto que no es texto:** una etiqueta de FedEx de devolución, «RETURN TO STOCK», letras a mano.
- **Razonar la duda:** «20.?0 → la resta da 3,90 como en la otra fábrica», «la serie de hermanas cuadra».

### Lo que un OCR clásico (Tesseract, OCR de documentos) probablemente no

- **Orden de lectura** en etiquetas de dos columnas y cajas negras invertidas (texto blanco sobre negro).
- **Confusiones de glifo** justo donde duele: `0/O`, `1/I/L`, `5/S`, `8/B`, `3/8` (20.30 vs 20.80), `M21I`
  (¿I o 1?), `WMEI` / `WMCJ`.
- **Imagen de foto, no de escáner:** brillo del film, perspectiva, cartón curvo, desenfoque. Sin buen
  preproceso (enderezar, quitar reflejos) la precisión cae mucho.
- **Semántica:** no sabe que `G.W.` es el peso a guardar, ni que `GTIN` repite el UPC.
- **Texto dañado:** donde falta tinta devuelve basura o nada; no «completa» con evidencia.

### Donde el OCR/código **gana** a la IA, y hay que usarlo

- **Códigos de barras:** UPC, Code 128 del SKU, serie y frame vienen **también como barras**. Un lector de
  barras (ZXing, ML Kit, `BarcodeDetector`) los decodifica **exactos** cuando la barra está sana, sin
  alucinar. Una IA _lee los dígitos impresos debajo_, no la barra.
- **Todo lo verificable:** dígito de control, forma canónica del SKU, kg→lb, rangos de peso. Es código,
  no juicio.
- **El riesgo propio de la IA: inventar un dígito verosímil** en un campo tapado. Por eso cada campo con
  checksum o catálogo se valida, y la duda se muestra, no se esconde.

## 6. Verdad de terreno (las 13 cajas)

| #   | Tipo                  | SKU final | Leído de la etiqueta                                                            | Resultado                                          |
| --- | --------------------- | --------- | ------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1   | A                     | 03-4270BK | RENEGADE A1 LTD · 54 cm · Black Pearl · UPC 845436092959 · GW 17                | Existía, 0 stock → ROW 37 G                        |
| 2   | B (+ vieja debajo)    | 03-3868BL | DXT A3 · 15" · Blue Smoke · UPC 845436086774 · GTIN · SERIAL G220307348 · GW 18 | Existía con 10 → ROW 1 D (11)                      |
| 3   | A ×2 caras dañadas    | 03-4149BR | RENEGADE S2 · 48 cm · Copper Tone · UPC 845436091594 · GW 16                    | **Alta** → ROW 37 G                                |
| 4   | A (parte)             | 09-4807CL | RENEGADE S1 FRAMEKIT · 54 cm · Charcoal · PART NO 845436091679 · GW 7           | **Alta como frame** → CAGE 3                       |
| 5   | A (parte)             | 09-4796CL | RENEGADE S1 FRAMEKIT · 56 cm · Charcoal · UPC 845436089485 · GW 15              | **Alta como frame** → CAGE 3                       |
| 6   | B                     | 03-4000BL | CITIZEN 1 · 700C\*23" · Deep Blue · UPC 845436088099 · GW 20.30 (borroso)       | **Alta** → ROW 37 F                                |
| 7   | A                     | 03-3845BL | SEQUEL S2 · 650Bx21" · Riptide · UPC 845436086545 · GW 18                       | Existía con 3 → ROW 38 C (4)                       |
| 8   | B                     | 06-4638BK | EARTH CRUISER 3 · 26"\*21 · Gloss Black · UPC 845436089331 · GW 17.80           | Existía con 27 → ROW 4 I (28)                      |
| 9   | D sobre C             | 03-3925BK | CODA S2 · 19" · Gloss Black · serie U226U03952 · GW 15.23                       | Existía, 0 → ROW 37 F                              |
| 10  | D sobre A             | 03-3850BK | SEQUEL S3 · 21" · Gloss Black · frame WAKCA0252 · GW 18 (desplazado)            | **Alta** → ROW 37 F                                |
| 11  | D sola                | 03-3934MN | CODA S2 ST · 16" · «Vanila» Mint · serie U226U02808                             | Existía, 0 → ROW 37 F; nombre y color corregidos   |
| 12  | D sin SKU + B + FedEx | 03-3970BL | CITIZEN 3 ST · 14" · Navy Pearl · GTIN 00845436087757 · GW 19.60                | Por modelo+talla+color; tenía 1 escondida en 6436N |
| 13  | D sin SKU             | 07-3680PD | X.24 · 12" · Palladium · serie M21I014353                                       | Identidad confirmada por Rafael                    |

## 7. Lo que esto pide al motor

1. **Captura:** varias fotos por caja (todas las caras), con guía de encuadre.
2. **Barras primero:** decodificar todos los códigos visibles y usarlos como verdad cuando validan.
3. **Lectura estructurada:** la foto → JSON con un esquema fijo por campo (§3), con **confianza y evidencia
   por campo**, y `null` antes que un dígito inventado.
4. **Validación determinista** (§3) y **cruce con catálogo/AS400** (§4), fuera del modelo.
5. **Propuesta de acción** con lo decidido y la pregunta mínima (destino, «¿es nueva?»).
6. **Evaluación:** estas 13 cajas como primer set de prueba, midiendo el acierto por campo, no por caja.
