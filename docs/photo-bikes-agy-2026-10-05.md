# Estudio de Identidad de Bicis: Photo Bikes y Stock

## 1. El hallazgo clave sobre el AS400

Antes de diseñar, la pregunta 7.1 de `photo-bikes.md` debía responderse: ¿el AS400 cuenta las 26 unidades `03-`/`07-` de PHOTO dentro de su SKU normal?
**Respuesta: NO.**
_Evidencia_: Consultando `v_inventory_vs_as400` el 5 oct a las 13:10 para los 6 SKUs con stock normal en PHOTO (ej. `03-4229BL`, `03-3919GN`), la `diferencia` es exactamente `1` a favor de PickD. Para los que solo están en PHOTO (ej. `03-3300BL`), el AS400 reporta `as400_nj = 0`, mientras PickD tiene `1`.
_Conclusión_: PickD está sumando la bici de PHOTO al balance normal, pero el AS400 ya la descontó o la movió a un SKU `02-` (`PHTO`). Cualquier solución en PickD que saque a esta unidad de su SKU normal va a **arreglar** el descuadre con el AS400, no a crearlo.

---

A continuación, dos opciones fundamentales para manejar las Photo Bikes y cualquier bici "única" (como S/D).

## Opción A: El modelo de Sufijos (Bifurcación de SKU)

**1. El modelo en una frase:** La identidad de una bici excepcional se representa bifurcando su SKU base, creándole un sufijo (`-PH`, `-SD`) que genera un registro nuevo en `sku_metadata` heredando los atributos pero viviendo separado.

**2. Tablas y columnas concretas:**

- `sku_metadata` gana un campo `base_sku` (texto, FK a `sku_metadata.sku`) para saber de qué modelo deriva.
- `sku_metadata` gana `is_photo` (boolean) para disparar la lógica de UI.

**3. Cómo resuelve los casos de hoy:**

- **Una PH `02-` (`02-3054TL`):** Su SKU ya es único. Solo se le marca `is_photo = true`.
- **Una PH compartida (`03-4229BL`):** Se crea el SKU `03-4229BL-PH` (`base_sku = 03-4229BL`). Se mueve la unidad a este SKU con la RPC `adjust_inventory_quantity`. Su foto y nombre quedan aislados.
- **S/D con SKU normal:** Siguen compartiendo SKU. Si a futuro se quiere separar una, se crea `03-XXXXX-SD1`.
- **S/D con serial:** Se quedan con el serial como SKU, pero se beneficiarían de llenar el nuevo `base_sku` para saber qué modelo son.
- **PH sin serial:** No importa, el identificador de la unidad es simplemente el `-PH`.

**4. Qué pasa con AS400, watchdog, picking, fotos y filtros:**

- **AS400:** Como vimos, el AS400 no cuenta la PH en el normal. Al moverla a `03-4229BL-PH`, `v_inventory_vs_as400` dejará de sumarla al `03-4229BL`, arreglando los `+1` falsos que tenemos hoy.
- **Picking:** Hay que tocar `src/utils/pickLocation.ts` (`byPickPreference`) o `generatePickingPath` (`supabase/functions/`) para excluir filas cuyo `sku` termine en `-PH` o tenga `is_photo = true`, a menos que la línea de la orden diga explícitamente PH.
- **Watchdog / Etiquetas:** `canonical_sku()` (`supabase/migrations/`) ya está programado para dejar intacto el `-PH`, por lo que el Watchdog la buscará correctamente si el PDF pide un `-PH`. Para las etiquetas, el motor (`src/lib/recognition/`) leerá el SKU normal `03-`, por lo que en el Double Check habrá que proponer `03-4229BL-PH` si detectamos que es la caja física en `PHOTO`.
- **Fotos:** Independiente al ser un SKU distinto en R2 (`photos/{sku}.webp`).
- **Filtros:** Se añade `is_photo` a `src/features/stock/api/stockFacets.ts` (`cond`).

**5. Cómo se migra sin parar (aditivo):**

1. Agregar `base_sku` y `is_photo` a `sku_metadata`.
2. Actualizar el trigger `tr_sku_metadata_sd_item_name` para que añada ` PH` cuando `is_photo = true`.
3. Ejecutar un UPDATE local que clone las filas de `sku_metadata` para las 25 bicis `03-`/`07-` añadiendo `-PH`, y actualice el `sku` en `inventory` para la ubicación `PHOTO`.

**6. Qué la rompería (riesgo realista):**
Si entran dos PH del mismo SKU (ej. dos `03-4229BL`), ambas compartirían el SKU `03-4229BL-PH`. Si luego le tomas foto a una porque tiene un manillar distinto, afectarías a ambas. El modelo de sufijos no escala bien cuando necesitas individualizar _muchas_ unidades del mismo tipo.

---

## Opción B: El modelo de Instanciación Física (El Serial como SKU)

**1. El modelo en una frase:** Las bicicletas en caja se agrupan por SKU de catálogo, pero en el momento en que una unidad necesita ser "única" (PH o S/D específica), se extrae del grupo y **su número de serie se convierte en su SKU** en `sku_metadata`.

_Nota:_ Esto oficializa y da estructura a lo que ya pasó por accidente: verificado en prod el 5 oct, existen **42 bicis S/D** cuyo SKU (en `sku_metadata`) es su número de serie, pero están "huérfanas" porque no sabemos de qué modelo vienen.

**2. Tablas y columnas concretas:**

- `sku_metadata` gana un campo `base_model_sku` (para vincular el serial con su catálogo original).
- `sku_metadata` gana `is_photo` (boolean).
- El campo `sku` pasa a representar el identificador de la instancia (`Y21I001153`) en lugar de la familia.

**3. Cómo resuelve los casos de hoy:**

- **Una PH compartida (`03-4229BL`):** El operario escanea su serial. Su SKU pasa a ser su serial (ej. `WBD12345L`). Se inserta en `sku_metadata` copiando datos de `03-4229BL`, y se fija `base_model_sku = 03-4229BL`, `is_photo = true`.
- **Una PH `02-`:** Igual. Si la bici tiene serial, su SKU es el serial. `base_model_sku = 02-3054TL`.
- **S/D con serial:** Se arreglan retroactivamente llenando su `base_model_sku` (se averigua por sus notas).
- **S/D con SKU normal:** A largo plazo (idea-244), el piso debería ir escaneando y pasando todas las S/D a este modelo.
- **PH sin serial legible:** Se genera un ID único desde frontend (ej. `PH-03-4229-1`) y se usa como SKU.

**4. Qué pasa con AS400, watchdog, picking, fotos y filtros:**

- **AS400:** Mismo beneficio. Al sacarla del SKU `03-`, arregla el descuadre (+1) en `v_inventory_vs_as400`. La vista ignorará los SKUs-seriales, lo cual es correcto porque el AS400 ya las maneja aparte (bajo un `02-`) o las dio de baja.
- **Picking:** **Se resuelve gratis**. Cuando el watchdog pide `03-4229BL`, el motor (`generatePickingPath`) va a buscar `03-4229BL`. Como la Photo Bike tiene SKU `WBD12345L`, el plan NUNCA la va a ver. No hay que cambiar reglas complejas en `src/utils/pickLocation.ts`.
- **Watchdog / Etiquetas:** Si la orden del AS400 pide un `02-`, el watchdog lo inyecta como `02-`. Al momento de hacer pick, PickD deberá tener una UI para mapear ese `02-` al serial físico, o bien el usuario escanea el serial directamente. El lector de etiquetas en el dispositivo (`src/lib/recognition/`) leerá el código normal, por lo que la UI de Double Check debe aceptar el escaneo del serial para hacer match con el `base_model_sku`.
- **Fotos:** Soporte total, la foto viaja al R2 bajo la llave de su serial.
- **Filtros:** Pestaña de UI que agrupe `where is_photo = true` o se muestre junto a S/D en `stockFacets.ts`.

**5. Cómo se migra sin parar (aditivo):**

1. Crear columna `base_model_sku` y `is_photo` en `sku_metadata`.
2. Actualizar `src/integrations/supabase/types.ts` y Zod schemas en `src/schemas/`.
3. El piso va a la ubicación PHOTO, escanea los seriales de las 26 unidades problemáticas y usa una UI (o script temporal de `src/features/`) que las migra: clona la metadata, usa el serial como SKU y ajusta el inventario.

**6. Qué la rompería (riesgo realista):**
Que el escáner lea mal el serial (O por 0) y cree duplicados fantasma al registrar la bici única. Se requeriría validación similar a la que ya ocurre en la recolección de `sku_serials` (donde el lector a veces confunde letras).

---

## Comparación y Recomendación

| Característica                     | Opción A (Sufijos `-PH`)                                      | Opción B (Serial como SKU)                                                   |
| :--------------------------------- | :------------------------------------------------------------ | :--------------------------------------------------------------------------- |
| **Separación de datos**            | Sí, a nivel de grupo (todas las PH de un SKU juntas)          | **Total** (cada unidad es independiente)                                     |
| **Protección en Picking**          | Requiere modificar el código de ruteo                         | **Automática** (distinto SKU = invisible al plan normal)                     |
| **Soporte S/D actual**             | No resuelve el desorden actual de las 42 S/D                  | Formaliza y arregla el caso de las 42 S/D con serial                         |
| **Esfuerzo de migración de datos** | Generado desde el sistema, automático                         | Requiere que un operario vaya al piso a escanear los seriales                |
| **Escalabilidad a futuro**         | Baja (falla si hay 2 PH del mismo SKU con defectos distintos) | **Alta** (prepara el terreno para tracking por unidad con pistola, idea-244) |

**Recomendación: Opción B (Serial como SKU).**
Aunque la Opción A es más rápida de programar hoy al no requerir escaneo manual en el piso, la Opción B toma el comportamiento "rebelde" que el almacén ya adoptó por necesidad (las 42 S/D registradas por serial documentadas hoy) y lo convierte en el diseño oficial para toda unidad única. Cumple con la idea original de hacer obligatorio el serial, arregla el problema del picking de manera elegante sin ensuciar la lógica de ruteo (`generatePickingPath`), aísla completamente los cambios de foto/nombre, y sienta las bases de manera limpia para el escaneo con pistola (idea-244) sin requerir un rediseño mayor del esquema `inventory`.

**Lo que queda por averiguar (siguiente paso):**

- Para la Opción B: ¿Cómo dice el PDF de las órdenes (el que lee el watchdog) que quiere extraer una Photo Bike? (Pregunta 7.3 original). Si la orden viene con el número `02-`, el watchdog lo pedirá como `02-`. PickD necesitará saber qué `base_model_sku` corresponde a cada `02-` para sugerirle al operario qué serial recoger.
