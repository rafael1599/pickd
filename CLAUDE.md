# Instrucciones para Claude — PickD

PWA de gestión de inventario y warehouse operations. Multi-usuario con sync en tiempo real.

> **Credenciales**: este proyecto usa su propia cuenta de Supabase. El token lo carga `.envrc`
> vía `secret_get supabase-pickd` al entrar en el directorio. **No ejecutar `supabase login`**:
> cambiaría el estado global y rompería `mecanica/erick` y `drivly`. Ver `~/dev/CLAUDE.md`.

## Tech Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS
- **State:** TanStack Query v5 + Supabase Realtime
- **DB:** PostgreSQL via Supabase (RLS habilitado)
- **Auth:** Supabase Auth
- **AI:** Gemini 2.5 Flash (primary) + GPT-4o (fallback)
- **Package manager:** pnpm

## Estructura clave

- `src/features/` — Feature-Sliced Design (cada feature tiene `hooks/`, `components/`, `api/`)
- `src/lib/` — Clientes core (supabase, query-client, mutationRegistry)
- `src/schemas/` — Validación Zod (deben coincidir con columnas de DB)
- `supabase/migrations/` — Migraciones PostgreSQL
- `supabase/functions/` — Edge functions (snapshots, reportes, auto-cancel)
- `.agent/management/BACKLOG.md` — Source of truth del backlog
- `public/warehouse/` — Planos del almacén: HTML autónomos, sin build ni routing, se
  sirven en `/warehouse/index.html`. Miden el edificio real; **no** son la vista in-app
  (esa es `src/features/warehouse-management/`). Ver `docs/warehouse-floor-plans.md`.
  **CRÍTICO:** Todos los layouts deben cumplir estrictamente las reglas en `public/warehouse/WAREHOUSE-UI-RULES.md` (ej. inputs de pallet dimensions `60x62` globales) y guiarse por `public/warehouse/WAREHOUSE-MEASUREMENTS.md`.
- `.claude/agents/` y `.claude/skills/` — Versionados en el repo desde el 11 ago 2026.
  Los skills eran symlinks a un repo central y se rompieron al moverse. Ver
  `docs/claude-agents-and-skills.md`

## Convenciones

- **No imports cross-feature.** Compartir via context o utils.
- **Optimistic updates** en todas las mutaciones (rollback automático si falla el RPC).
- **TypeScript strict mode.** No usar `any`.
- **Antes de refactors o migraciones grandes:** preguntar si quiero análisis profundo primero.
- **Git:** ejecutar `git add`, `git commit`, `git push` como comandos separados (compatibilidad PowerShell).
- **Formatting:** NUNCA ejecutar `prettier --write .` ni formatear todo el proyecto. Solo formatear archivos que se van a commitear: `prettier --write <archivo>`. Las migraciones SQL, scripts, y reports están protegidos en `.prettierignore`.
- **Scripts temporales:** no agregar scripts one-time al proyecto. Usar `/tmp` o guardarlos en la skill correspondiente (`.claude/skills/`).
- **PostgREST selects:** Al cambiar un `.select()` de `table(*)` a columnas explícitas `table(col1, col2)`, verificar que TODAS las columnas existan en la tabla real de producción. PostgREST retorna HTTP 400 si se referencia una columna inexistente, rompiendo el query completo. Los schemas Zod (`src/schemas/`) pueden tener campos que no existen en DB (nullish/optional) — la fuente de verdad son las migraciones en `supabase/migrations/`.
- **Nuevas columnas DB:** Al agregar una columna a una tabla, actualizar **4 lugares**: (1) migración SQL, (2) schema Zod en `src/schemas/`, (3) tipos Supabase en `src/integrations/supabase/types.ts` y `src/lib/database.types.ts`, (4) queries con select explícito (ej. `inventoryApi.ts`). Si falta alguno, PostgREST ignora silenciosamente la columna en reads/writes.
- **Tests:** Correr `pnpm vitest run` antes de cada deploy. Los tests corren local sin necesidad de DB (mocks de Supabase). **El CI es local (26 ago 2026):** el hook `pre-push` de husky corre `tsc --noEmit` + `vitest run` antes de cualquier push (`pnpm check` para lanzarlo a mano — **no `pnpm ci`**: pnpm reserva ese nombre para su propio comando, imprime `CI_NOT_IMPLEMENTED` y sale con 0 sin correr nada, un gate que aprueba siempre; `git push --no-verify` solo en emergencia). El workflow de GitHub `ci-tests.yml` **no** es la compuerta y no debe extenderse a `main`.
- **Modals/Sheets:** SIEMPRE usar el Modal Manager (`useModal()` + `ModalProvider` en LayoutMain). Ningún modal crítico debe vivir dentro del componente que lo abre. Ver `docs/modal-pattern.md`. Excepciones: tooltips, dropdowns, popovers efímeros.

## Picking workflow

```
idle (UI) → active (DB — via generatePickingPath)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — manual o auto-cancel)
completed → reopened (via Reopen Order — requires reason)
  → completed (re-complete with inventory delta) | cancelled (cancel reopen — restores snapshot)
```

7 estados DB: `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`, `reopened`. Órdenes completadas tienen triple protección contra reversión. Órdenes `reopened` tienen snapshot para delta calculation y auto-cancel a 2h si se abandonan.

`building` mode fue eliminado (idea-032). `OrderBuilderMode.tsx`, `PickingSessionView.tsx`, y `returnToBuilding()` fueron eliminados. Edit Order mode (CorrectionModeView) reemplaza sus funciones. InventoryCards muestran +/- inline en picking mode.

**Correcciones con razón (idea-043):** Todas las acciones de corrección (remove, swap, adjust_qty, add) requieren una razón via `ReasonPicker`. Las notas se generan con formato rico: "Removed SKU: Out of stock" en vez de genérico. `CorrectionAction` tiene campo `reason?: string`. Si el item tiene `insufficient_stock`, la razón "Out of stock" se pre-selecciona.

**Órdenes stuck en reopened:** Si una orden queda en `reopened` (browser cerrado, sesión perdida), OrderSidebar muestra "Continue Editing" (mismo usuario) o "Take Over & Edit" (otro usuario). `resumeReopenedOrder` carga sin llamar al RPC reopen de nuevo.

**Long-Waiting Orders (idea-053):** Órdenes que esperan inventario (días, semanas, meses) viven en `needs_correction` con `is_waiting_inventory = true`. Admin marca/desmarca via RPCs `mark_picking_list_waiting` / `unmark_picking_list_waiting`. Verification queue las oculta por defecto (toggle "Waiting for Inventory"). Cross-customer SKU conflicts se detectan al abrir DoubleCheckView (`useWaitingConflicts`) y se resuelven via `take_over_sku_from_waiting` RPC o editando la orden. La rama `auto_cancel_stale_orders` verification 24h fue **eliminada** (era conceptualmente equivocada, bug-017). El cómputo de reservas client-side (`usePickingActions.ts`) ya itera `needs_correction`, así que waiting orders son respetadas automáticamente.

**Progreso de verificación (`verified_item_keys`, 25 ago 2026):** el Set `checkedItems` vive en
`PickingCartDrawer` y se persiste con debounce en `picking_lists.verified_item_keys`. **Solo se escriben
los cambios hechos en este dispositivo** (`dirtyListIdRef`): una hidratación desde la DB entra en el
mismo Set, y espejarla de vuelta era el bug — al reabrir, el Set vacío previo a hidratar se agendaba
para escribir, el cleanup del efecto lo flusheaba en cuanto volvía la primera lectura, la segunda
lectura (tras `lockForCheck`) leía ese `[]` como verdad y una orden parkeada volvía sin ningún check.
Dos cosas siguen siendo a propósito y no son este bug: la **X** (`parkOrder`) conserva las llaves, y
**Ready to DC** (`releaseCheck` → `ready_to_double_check`) las **vacía** — es un flujo posterior al
recogido que no toca inventario ni la barra de avance.

**Pulsación larga en DoubleCheckView = "¿dónde está de verdad?"**: abre `sku-locations` (Modal Manager,
`SkuLocationsModal`) con **todas** las filas de inventario del SKU, la dirección de la orden primero y
marcada, y un botón Editar por fila que abre `item-detail` sobre esa fila concreta. Antes abría el
detalle de la fila con más stock: con `03-4066BK` en ROW 6 A (4) y ROW 41 F (78) la tarjeta decía ROW 6
y el detalle ROW 41, y el picker leía que la tarjeta mentía. Ver no lleva a un formulario; editar es un
segundo toque deliberado. **Si el SKU no existe, el mismo modal pregunta Bici o Parte** y elegir ya es
registrar: `buildNewSkuPrefill` (`src/features/inventory/utils/newSkuPrefill.ts`) abre `item-detail` con
nombre, modelo/talla/color partidos de la descripción AS400 (`parseBikeName`, sin el año — el catálogo
nombra "Modelo Talla Color"), tipo y los defaults de peso y caja; al operador le quedan ubicación y
cantidad. Un nombre de bici que no parte no va a `model` (sería la basura legacy de `bug-018`).

**`sku_not_found` es derivada, no almacenada (`20260826180000`, bug-020).** Significa una sola cosa,
la misma que ya usan `process_picking_list` y `compensate_picking_list_changes`: _no hay fila en
`sku_metadata` con ese sku exacto_. La deriva `a_stamp_item_sku_metadata` en cada write de `items`
(**siempre sobrescribe** — es un hecho del catálogo, no un input; a diferencia de `is_bike` y `kind`,
que solo rellenan NULL) y `zz_touch_open_orders_for_sku` re-sella las órdenes no terminales cuando
un SKU entra al catálogo, así que registrar desde Double Check cura la orden sin que nadie la abra.
El cliente toma la bandera del row por realtime/polling (`mergeDerivedItemFlags`, solo esa bandera,
nunca `items` entero) y `DoubleCheckView` la pinta en vivo desde las filas que ya carga
`fetchDistributions` (`registeredStock`). Una grafía distinta (`010530` vs `01-0530`) sigue siendo
_not found_ a propósito: eso es idea-154. Consecuencia visible: un ítem añadido a mano con un SKU
sin registrar ahora sale `UNREG` en vez de decir `false` y hacer que `process_picking_list` busque
una fila que no existe. **El alta desde el formulario escribe inventario primero y metadata
después** (`ItemDetailView.executeSave`, modo `add`): el orden inverso, sin esperar, dejó 96 filas
de `sku_metadata` sin inventario, y con la bandera derivada una fantasma "registra" el SKU para
todas las órdenes abiertas.

**Huérfanas de `sku_metadata` (`20260826200000`):** una fila de catálogo sin fila de inventario. La
historia (`inventory_logs`, `daily_inventory_snapshots`, `asset_tags`, conteos, returns) es texto
denormalizado sin FK al catálogo, así que **borrar una fila de catálogo nunca toca la historia**; lo
que sí la rompería es borrar logs o renombrar sin reescribir el texto (como hizo `20260814020000`).
La regla vive en la vista **`v_sku_metadata_orphans`** (`has_history`, `in_open_order`,
`has_image`): con historial se queda (es la memoria de un nombre que tuvo stock — `Y22B010415 →
01-288`, `128338BK → 12-8338BK` — y idea-154 los fusiona a mano); sin nada, es ruido y se borra; una
foto se mueve al hermano canónico si no tiene y, si no hay hermano, la fila se queda
(`TEKTR0R-340`). El 26 ago se borraron 81 y quedaron 15. Ya nadie las fabrica: el alta escribe
inventario primero, y Ship/PartsWeightEditor hacen `update` de peso, nunca `upsert` (un upsert bajo
el sku de un ítem sin registrar era un INSERT). `zz_touch_open_orders_for_sku` también corre en
DELETE y en rename, así que quitar un nombre del catálogo devuelve a `UNREG` las órdenes abiertas
que lo nombran. Si `select count(*) from v_sku_metadata_orphans where not has_history` deja de ser
~1, algo volvió a abrir el grifo.

**LOW STOCK / UNREG se diagnostican y resuelven en Double Check, no en Edit Order (26 ago 2026):**
`diagnoseStockIssue` (`src/features/picking/utils/stockIssue.ts`, puro, con tests) convierte lo que
la vista ya carga (filas de inventario del SKU, reservas de otras órdenes abiertas, la familia de
hermanos de variante, el SKU parecido) en **un caso con nombre**: `auto_swap` (el hermano cubre la
línea → se intercambia solo, toast + **Undo**, misma regla que tenía el tier 1 de Edit Order),
`unregistered`, `no_stock`, `reserved` (dice qué órdenes lo tienen) y `partial` (dice cuánto hay y
dónde). `StockIssuePanel` lo pinta bajo la tarjeta con la frase exacta y **solo las acciones que
tienen sentido para ese caso y esa línea**: Take N, Use X, Register (misma modal que el long-press),
Replace (abre Edit Order ya en el buscador de esa línea, `initialPanel`) y Remove. Todo pasa por
`onCorrectItem` con razón (`ReasonPicker` inline, idea-043), así que las notas quedan igual que
desde Edit Order; el panel para eventos para que la tarjeta no marque el check. El tier 1 de
`CorrectionModeView` sigue existiendo por si alguien entra directo, pero ya no debería encontrar
nada. `fetchDistributions` guarda ahora `location`/`warehouse` por fila, que es lo que alimenta el
diagnóstico sin otra consulta.

**Verification Board (idea-055):** La Verification Queue es un overlay full-screen con zonas: Priority (auto-populated por status), FedEx/Regular lanes (drag-reclasificar `shipping_type`), In Progress Projects (read-only), Recently Completed (drag=reopen), Waiting (colapsable). Auto-clasificación: item >50 lbs o ≥5 BIKES (prefijo 03-) → Regular, else → FedEx; las partes nunca fuerzan Regular (50 partes = FedEx). Regla duplicada en DB (`classify_picking_list_fedex`) — mantener ambas en sync. La regla de bikes depende de `sku_metadata.is_bike`, que el item no trae por sí solo: el trigger `a_stamp_item_sku_metadata` (migración `20260820150000`) lo sella dentro de cada elemento de `picking_lists.items` en cada write, así que **todo consumidor lee la misma verdad sin buscarla**. Antes cada pantalla traía su propio lookup y pasarlo era opcional — DoubleCheckView no lo pasaba y pintaba de FedEx órdenes de 13 bicis. El parámetro `bikeSkus` de `autoClassifyShippingType`/`isFedexOrder` es ahora **obligatorio** (pasar un Set vacío para renunciar a él a propósito): cubre el ítem que aún no se ha escrito y el SKU cuyo `is_bike` cambió después del sellado. `shipping_type` columna en `picking_lists` (NULL = auto). DnD usa `@dnd-kit/sortable` con `useBoardDnD` hook. Componentes en `src/features/picking/components/board/`.

**Activity Report layout:** Editor panel on the left (desktop) with: selectable greeting toggle ("Hi Carine!"), Win of the Day, PickD Updates (collapsible dropdown, closed by default), On the Floor routine checklist (editable items via gear icon, persisted in localStorage), and Notes (multiline textarea, one per line). Preview on the right updates with green highlight flash on each edit. "Save & Copy Report" button at bottom saves + copies to clipboard in one action. Report section order: Win → PickD Updates → Done Today → On the Floor → In Progress → Coming Up Next → Inventory Accuracy → Waiting. Footer shows date only (no timestamp). `/pickd-report` public route shows the HTML daily report for the current date with date navigation.

## Export de dimensiones a FedEx Ship Manager

Botón en Settings → Exports (`FedexDimensionsExportCard`, gate por `isAdmin`). Genera la tabla
Dimensions que FSM v3313 importa en `Databases → File Maintenance → Import`, template
`DIMENTIONS1`, modo **Replace current data**. Lógica pura en
`src/features/reports/utils/fedexDimensions.ts` (con tests); la query y el log viven en
`useFedexDimensionsExport.ts`.

**Replace vacía la tabla antes de cargar**, y de ahí salen casi todas las decisiones:

- **Siempre el catálogo completo, nunca un delta** — lo que falte en el CSV queda borrado en FedEx.
- **La lectura pagina explícitamente** en vez de confiar en el tope de filas de PostgREST: una query
  truncada en silencio no falla, borra los cartones que faltaron.
- **Solo filas con `dimensions_verified`**, o se pisa una medida real con una que nadie tomó.
- **Se registra cada corrida** en `fedex_dimension_exports` (append-only, sin políticas de UPDATE ni
  DELETE, RLS por `is_admin()`). Se guardan los conteos y no el archivo, porque el conteo es lo que
  después identifica un catálogo parcial.

**Los ejes NO son los mismos de los dos lados.** Pickd guarda length/width/height como
longest/thinnest/middle — las hojas de piso se escriben L × H × W, por eso `20260814120000` mete la
tercera lectura en `width_in`. FSM quiere Length, Width, Height como longest, middle, thinnest. O sea
**Width sale de `height_in` y Height de `width_in`**. Al revés el archivo importa limpio y cotiza mal
todos los envíos.

**Las tres reglas que no se ven en la salida:**

- **Un cartón por model+size, máximo por eje.** Colores de la misma talla se miden aparte y redondean
  distinto (8.25 y 8.00 → 9 y 8); declarar un cartón más chico de lo real es lo que FedEx re-factura.
- **Los lados tienen que ordenar longest ≥ middle ≥ thinnest.** Es lo que atrapa un decimal perdido:
  `03-4046MN` tenía `width_in` en 875 por 8.75, y 875 son tres caracteres, así que el chequeo de
  ancho de campo lo deja pasar tal cual a FedEx. No usa umbrales, así que los cartones legítimamente
  chicos siguen entrando (un Hot Rod en 30/17/8, un framekit en 48/24/8).
- **El rango de tallas solo si son de la misma forma.** `L14''-L16''` sobre L14, 15 y L16 esconde el
  15 plano que hay en medio; un grupo mezclado se lista entero (`L14''/15''/L16''`).

**Formato, estricto:** orden `Description, ID, Height, Length, Width`; cada campo entre comillas
dobles; **sin fila de encabezado**; CRLF; ASCII sin BOM; ningún `"` dentro de los datos (se usa `''`
para las pulgadas); Description ≤140, ID ≤30 alfanumérico en mayúscula, cada dimensión 1-3 dígitos.
Nombre: `DIMENSIONS_FEDEX_YYYYMMDD.csv`. El ID se genera al vuelo de forma determinista (no está
persistido — decisión abierta); si truncar a 30 provocara choque, desempata un hash FNV-1a de la
propia clave, no un contador, para que no se mueva cuando aparece otro registro.

**Redondeo de una lectura de cinta:** `.5` y por debajo baja a la pulgada entera menor, de `.6`
para arriba sube. Es lo que aplica la propia hoja de piso (55.5 → 55, 57.5 → 57, 53.5 → 53) y va en
la **columna**, no en el export: `buildFedexDimensions` siempre hace `ceil`, así que un cartón nunca
se declara más chico de lo que dice el dato guardado.

**Al 2026-08-21:** 703 filas leídas → 122 registros, 530 excepciones (529 sin medir, 1 sin modelo).
`20260821120000` corrigió 24 cartones re-medidos en piso y añadió SEQUEL S3 15''; casi todas las
correcciones bajan, que es la dirección que se paga en silencio (un `8.25` viejo en un solo color
declaraba cartón de 9 para toda la talla). Cuatro tallas se fusionaron con su vecina al caer en el
mismo cartón y RENEGADE S1 56 dejó de viajar en el de 58. Verificado en prod contra el propio
`buildFedexDimensions`. **Nadie lo ha importado todavía en FSM** — ese es el único criterio de
aceptación sin comprobar.

**Clientes ↔ FSM (idea-153, 24 ago 2026):** el Recipient ID numérico de FSM es la cuenta AS400 +
sufijo ship-to (`0010495 00` → `1049500`); Pickd todavía no la persiste. Análisis en
`docs/fedex-recipients-analysis.md`, diseño y fases en `docs/fedex-customer-id-integration.md`.

## Manuales de procedimiento

Biblioteca de **solo lectura**: `/manuals` (lista, buscador, filtro por categoría) y `/manuals/:slug`
(documento). Son SOPs para el personal — cómo etiquetar una e-bike para FedEx, cómo pasar las medidas
a Ship Manager —, **no** manuales de usuario de las bicis: esos tienen otra audiencia y colgarían de
un SKU.

**Son contenido estático, no filas.** Viven en `src/content/manuals/`, fuera de `features/`, porque
los leen dos consumidores que no deben importarse entre sí: la vista (`src/features/manuals/`) y los
botones "ver el procedimiento" de otras pantallas. Cada manual es un módulo TypeScript; `index.ts`
tiene el registro (`MANUALS`), el tipo `ManualSlug`, `getManualBySlug`, `manualRoute` y
`manualTitleFor`.

Estuvieron un día en una tabla `manuals`. Esa tabla tenía **una fila, ninguna política de escritura y
una migración como único escritor** — un archivo estático disfrazado de base de datos. Todo lo que
había que defender ahí (un jsonb malformado llegando al renderer, contenido y código desplegándose
desincronizados, un valor cambiado en Studio sin diff que revisar) deja de existir cuando es un
módulo: `git push` lleva el manual y la pantalla que lo pinta en el mismo commit, y el compilador
comprueba la forma.

**Decisión cerrada del operador (21 ago 2026): los manuales no vuelven a la base de datos, nunca.**
No es "estático por ahora": una tabla `manuals` no es el plan B de ningún requisito, incluido que
alguien quiera editarlos desde la app. Está **verificado, no solo escrito aquí** — cualquier
migración que mencione una tabla `manuals` rompe la suite de tests
(`src/content/manuals/__tests__/manuals.test.ts`). Se documentó dos veces y se escribió la migración
igual, así que la regla dejó de vivir solo en prosa.

**`ManualSlug` es la razón de que los enlaces no se rompan en silencio.** Es el union de los slugs que
existen, así que un `ManualLinkButton` que apunte a un manual inexistente **no compila**. La versión
anterior emparejaba por título contra una lista de grafías aceptadas y, al fallar, dejaba al operador
en el índice sin decir nada. El slug es el contrato; el título se puede reescribir libremente.

**Donde un paso tiene figura, la figura es la instrucción.** Ninguna tabla de campos repite lo que la
ventana ya enseña, y cada regla se dice **una sola vez**, en el paso donde equivocarse cuesta algo. Un
borrador anterior decía "siempre Replace" cinco veces —en los avisos, en los campos, en la marca, en
el paso y en la referencia—: un procedimiento que nadie termina de leer no es más seguro.

**Un campo dice qué va en la casilla**, así que su `value` es o el texto literal (`CHEMTREC`,
`UN 3481`) o su descripción (`the weight of this bike`). Hubo un `kind: 'exact' | 'example'` para
marcar los valores de muestra, porque la hoja de papel imprime el `61 lbs` de un envío concreto con la
misma tipografía que las constantes de al lado. Etiquetar cada uno como "varies" llenaba la página de
esa palabra y **seguía dejando un número ahí para copiarlo**. Describir el valor resuelve las dos
cosas: nadie teclea "the weight of this bike" literalmente.

**Un paso puede llevar una `figure`: una reproducción simplificada de la ventana del otro sistema**,
con sus controles y las llamadas naranjas numeradas (`ManualFigure.tsx`). No son capturas — son datos
validados por el mismo esquema, así que buscan, escalan en móvil y no envejecen como un PNG. El
control marcado se **rodea**, no solo se describe, porque quien compara el papel con la pantalla busca
la forma, no el nombre del campo. Es el único sitio de la app con superficie clara sobre root `dark`,
así que **todo texto ahí lleva color explícito** (regla 10 de `ui-rules`); heredar es blanco sobre
blanco. Los colores son los de FSM a propósito: es una foto del software ajeno, y se ve igual en modo
oscuro porque el software se ve igual.

Código de color, explicado en la leyenda del propio documento: **verde** = teclear exacto,
**punteado** = varía, **azul** = clic, **rojo** = aviso.

**La compuerta del contenido son los tests**, ahora que no hay migración entre escribir un manual y
publicarlo: `src/content/manuals/__tests__/manuals.test.ts` valida cada manual contra
`manualContentSchema`, exige slugs únicos y url-safe, y rechaza un paso sin cuerpo ni campos ni
acción — un paso que solo tiene título no le dice nada a nadie.

**Los dos manuales actuales** se transcribieron de hojas impresas del ship station. Las capturas del
FedEx Ship Manager **no** se reproducen: son fotos de una impresión arrugada, ilegibles en un móvil, y
cada valor que contienen está como campo. Dos huecos conocidos, ambos anotados en el propio contenido:
el paso 6 del manual de Hazmat remite a **dos vídeos que no están en PickD** (se mantiene, con aviso,
porque quitarlo renumeraría un procedimiento que la gente ya se sabe), y el de dimensiones manda usar
**Firefox en la máquina de FedEx sin motivo registrado** — si resulta ser "el otro navegador bloquea
la descarga", eso pertenece al paso 2, porque una regla con motivo es la que la gente sigue.

## Base de datos

pickd es dueño único de toda la DB de Supabase. Existió un consumidor externo (**pickd-2d**,
dashboard de visualizacion 2D/3D) que leía `inventory`, `sku_metadata` y `locations`; el repo se
eliminó (confirmado 2026-08-14, ya no existe en disco) y con él el contrato `JAMIS/SHARED-DB-CONTRACT.md`.
Ya no hay que coordinar cambios de schema con nadie más.

- **`sku_metadata` columns (prod):** `sku`, `length_in`, `width_in`, `height_in`, `length_ft`, `weight_lbs`, `image_url`, `is_bike`, `upc`, `created_at`, `dimensions_verified`, más las de Scratch & Dent (`20260417100000`): `is_scratch_dent`, `model`, `size`, `color`, `category`, `serial_number`, `condition`, `condition_description`, `sd_category`, `msrp`, `standard_price`, `sd_price`, `pdf_link`, y `sku_key` (`20260826220000`, generada: `upper(sku)` sin nada que no sea A-Z0-9, **índice único**, solo lectura) — NO tiene columna `name`
- **`model` y `size` ya no son solo de Scratch & Dent.** Nacieron ahí, y hasta `20260717200000` (`register_new_sku` estructurado) nada más los llenaba, así que el catálogo viejo guardaba el item_name entero en `model` (`"DXT A3 19 BLUE"`) con `size` en NULL. `20260820160000` los separó para los 171 SKUs de bike con medida real. **Son la llave de agrupación del export a FedEx**, así que basura ahí sale del almacén — ver `bug-018`, que mete texto de notas de picking dentro de `model`. Los 531 SKUs sobre defaults siguen sin separar a propósito: no vale la pena partir un nombre cuyo número no es real.
- **`inventory.sublocation`** (idea-024): posición dentro de un ROW (A-F). CHECK constraints: `^[A-Z]{1,3}$` y solo para `location ILIKE 'ROW%'`. Se auto-limpia a NULL al mover a non-ROW. UI: chips en ItemDetailView/MovementModal, badge en InventoryCard/DoubleCheckView.
- **Invariante qty=0 → is_active=false:** `adjust_inventory_quantity` y `undo_inventory_action` mantienen `is_active = (quantity > 0)` bidireccionalmente. **Excepción:** `register_new_sku` crea placeholders con `qty=0, is_active=true` para onboarding de bikes nuevos — NO modificar este comportamiento. Ghost trail en búsqueda usa `includeInactive: true` para seguir mostrando items sin stock con su último movimiento.

### `picking_list_notes`: no toda nota la escribió una persona

Un cuarto de la tabla (95 de 389 filas al 20 ago 2026) nunca fue prosa: son datos estructurados
metidos en texto libre con un prefijo entre corchetes — `[Waiting]: …` (44), `[AUTO] Stale pick
location: …` (20), `[Parked]: 14D` (20), `[Resumed from waiting]` (11), más `[Cancelled from
waiting]` y `[Daylight]: …`. Cinco escritores habían inventado cinco formatos (`[AUTO]` se salta
los dos puntos que usan los demás) y cada lector se hacía su propio parser.

**`20260820190000` cerró eso.** `kind` (text) y `metadata` (jsonb) los rellena el trigger
`tr_picking_list_notes_set_kind` desde el mensaje, vía `classify_picking_note(text)`. Igual que
`tr_sku_metadata_set_is_bike`: **solo rellena lo que viene NULL, así que un valor explícito siempre
gana**. `kind IS NULL` ⇒ lo escribió una persona.

- **El trigger clasifica, no los RPCs.** Las cuatro funciones SQL que escriben notas
  (`mark_picking_list_waiting`, `unmark_picking_list_waiting`, `add_parked_location_note` y las de
  quick-group) quedaron **sin tocar** a propósito: sus cuerpos no pueden divergir de la regla si no
  la contienen. Añadir un séptimo tag es una rama en `classify_picking_note` y una línea en
  `SYSTEM_NOTE_TAGS`, en ningún otro sitio.
- **El cliente inserta solo `message`.** Nunca nombra `kind` ni `metadata` en un write, y por eso el
  frontend puede desplegarse antes o después de la migración sin la ventana de 400 que describe el
  checklist post-merge de más abajo. Los reads usan `select('*')`, que tolera columnas ausentes.
- **Espejo en TS: `src/utils/systemNotes.ts`.** La DB es la autoridad; el TS existe para que la UI
  ramifique sin round-trip y para clasificar la nota optimista antes de que vuelva del servidor.
  **Mantener ambos en sync**, igual que `skuDefaults.ts` y `classify_picking_list_fedex`.
- **Los lectores preguntan `isSystemNote()` / `noteKind()` / `noteMetadata*()` — nunca hacen match
  de prefijos a mano.** `noteKind` lee la columna y cae al prefijo solo para filas anteriores a la
  migración. Si te encuentras escribiendo `.ilike('message', '[Algo]:%')` o `startsWith('[…')`, es
  el bug que esta sección existe para evitar.
- **Regla del preview de una línea (`OrderNotesInline`):** gana la nota **humana** más reciente. Lo
  que escribió PickD vive en el historial. Antes ganaba la más reciente a secas, así que un pedido
  con `DO NOT SHIP BEFORE 8/25` podía previsualizarse como `[Waiting]: waiting for james`. Ese
  componente es compartido con el Live Board (`SortableOrderCard`).
- **`usePickingNotes` es TanStack Query**, una entrada de caché por `list_id`, y el realtime es
  **una sola** suscripción montada en `LayoutMain` (`usePickingNotesRealtime`). Antes abría un canal
  **por instancia** — y el hook se monta por card, así que un board lleno abría un canal por card,
  cada uno sin filtro server-side, recibiendo todos los inserts del sistema. No añadas
  `supabase.channel` para esta tabla.
- **`isFetched`, no `!isLoading`.** Quien no pueda actuar sobre "no hay notas" antes de saberlo (el
  dedup de `[AUTO]`, el aviso de Daylight) tiene que usar `isFetched`: `isLoading` también es
  `false` en el frame anterior a que arranque el fetch.

### `locations`: el nombre no es único, y no toda ubicación es almacenamiento

Una ubicación se identifica por **(warehouse, location)**, nunca por el nombre solo — sigue siendo la regla para código (`toPickingOrderMap`) y SQL, cualquier `UPDATE locations` o rename tiene que filtrar por warehouse.

**ATS está muerto operativamente desde 2026-04-15** (0 inventario activo, sus 28 filas quedaron en `qty=0, is_active=false` en una sola desactivación masiva, ninguna desde entonces) pero sus 132 `locations` siguen existiendo — no se pueden borrar (mismo motivo que las de staging: FKs `ON DELETE NO ACTION` en `inventory_logs`/`daily_inventory_snapshots`/`asset_tags` las usan de ancla histórica). 15 de esas 132 compartían nombre bare con una location LUDLOW viva (`E1-E7`, `D1-D6`, `H3`, `H6`, `ROW 1`), cada una con su propio `max_capacity`/`picking_order` — el ejemplo real que motivaba la regla de arriba.

**Migración `20260814020000`:** las 132 se renombraron con prefijo `ATS-` (`E1` → `ATS-E1`, etc.), reescribiendo el mismo texto denormalizado en las 5 tablas (igual que `20260731180000`). Elimina la colisión de nombres de forma permanente sin tocar la columna `warehouse` ni sus 33 funciones RPC — esa dimensión del schema se queda igual, solo dejó de ser una trampa al leer `locations` por nombre.

**Renames aplicados** (`20260731180000`): LUDLOW `42 BURIED` → `ROW 42 BURIED` y `PALLETIZED` → `ROW X EP`. Son filas de bikes y el nombre ahora lo dice. `location` es texto denormalizado en 5 tablas (`locations`, `inventory`, `inventory_logs` ×2, `daily_inventory_snapshots`, `asset_tags`), así que renombrar es migración de datos, no cambio de etiqueta — y hay que reescribir el historial o el ghost trail queda apuntando a un nombre inexistente. El `PALLETIZED` de ATS quedó intacto. Efecto secundario buscado: al empezar con `ROW`, ahora admiten sublocation (el CHECK es `location ILIKE 'ROW%'`), entran al mapa y a la auditoría — y también se vuelven elegibles para sugerencias de put-away, donde su `picking_order` 9999/9995 es lo único que las mantiene al final.

- **`counts_as_storage`** (boolean, default `true`): si la capacidad de la ubicación es espacio real de warehouse. `false` = existe para dar seguimiento pero su `max_capacity` NO entra en el espacio disponible — shipping (`FDX*`, `SD`), staging (`INCOMING`, `BAY*`, `22F`, `FLORIDA`, `UNASSIGNED`), containers (`^\d{4}N$`, el nombre temporal que se le pone a un load), jaulas (`CAGE*`), medias filas fantasma (`ROW n.5`) y pruebas (`TEST-*`). Lo consume `get_inventory_stats`; reemplazó a un `NOT ILIKE 'CAGE%'` hardcodeado. **Nunca borrar estas ubicaciones:** cuatro FKs (`inventory`, `inventory_logs` ×2, `daily_inventory_snapshots`) son `ON DELETE NO ACTION`, así que Postgres rechaza el DELETE, y el nombre del container _es_ el registro de staging. Editable desde LocationEditorModal; badge `NO STORAGE` en LocationList.
- **`picking_order >= 9000` = último recurso** (`LAST_RESORT_PICKING_ORDER` en `src/utils/pickingOrder.ts`): el picker va ahí solo cuando ningún estante normal tiene el SKU (pallets enterrados, overflow palletizado). El recorrido real llega hasta 999, y **999 es el centinela de "sin ranking"** que usa la UI al crear una ubicación — por eso la banda arranca en 9000. `NULL` = sin ranking, tratado como normal: media bodega no tiene `picking_order` y degradarlas movería casi todos los picks. Badge `LAST RESORT` en LocationList.
- **`get_inventory_stats` cuenta la capacidad de una ubicación solo mientras tenga algo del tipo consultado** (el `EXISTS`). O sea: "disponible" = hueco en las filas que ya se están usando, no espacio en el edificio — una ROW vacía aporta 0. Es intencional pero discutible; cambiarlo cambia el significado del número.
- **`counts_as_storage` vs `is_shipping_area`** — son dos preguntas distintas, no dupliques: `is_shipping_area` = "¿el put-away debería sugerir este lugar?" (la leen `suggest_locations_for_sku` y la promoción de consolidación); `counts_as_storage` = "¿su capacidad es espacio de warehouse?". Se solapan pero no coinciden: una jaula no es área de envío, y una `ROW 2.5` fantasma tampoco.
- **Dato malo conocido:** `LUDLOW / ROW 17` tiene `max_capacity = 0` con ~129 bikes dentro, así que aporta −129 al disponible. Falta la capacidad real.
- **Bug conocido sin resolver:** `is_shipping_area` está en `false` en las 330 filas — nunca se pobló — así que los filtros construidos sobre ella no filtran nada y el put-away hoy puede sugerir `FDX STATION`. Poblarla cambia el comportamiento de sugerencias; decisión aparte.

### `sku_metadata.is_bike`: quién lo decide, y por qué la ubicación no sirve de regla

`is_bike` nunca está en NULL, lo que lo hace parecer confiable. Se rellena solo, y hay **tres reglas distintas** en el sistema para la misma pregunta:

1. **La regla viva** — trigger `tr_sku_metadata_set_is_bike` en `sku_metadata`, función `set_is_bike_on_insert`: `LEFT(sku,2) IN ('01','02','03','06','07')`. Solo aplica cuando `is_bike IS NULL`, así que **un valor explícito siempre gana**.
2. **El fallback del front** — `inferBikeSkusByPrefix` en `src/utils/bikeDetection.ts`: solo `03-`. Discrepa con la DB en **343 de 2.227 SKUs (15%)**.
3. **`set_sku_metadata_is_bike`** — función más elaborada (incluye prefijo `05`, exige guion). **No está enganchada a ninguna tabla**: código muerto que discrepa con las otras dos en 215 SKUs.

Además hay **86 SKUs cuyo `is_bike` contradice la regla viva** — corregidos a mano en algún momento. Unificar las tres reglas es la deuda más barata de pagar aquí.

**⚠️ La ubicación NO determina si algo es bike.** Suena razonable ("si no está en un ROW no es bike") y es falso en las dos direcciones — verificado contra prod:

- **Bikes legítimas fuera de un ROW numerado:** `ROW X EP` (03-4085BK ×41), `ROW 42 BURIED` (03-3931BK ×39) y las jaulas `CAGE*` (03-3666Bl, 03-3667BL, 03-3668BL, 03-3669BL, 09-48xx — bikes bajo llave). Reclasificarlas por ubicación rompería el cálculo de pallets, labels y la clasificación FedEx.
- **⚠️ Un `item_name` que nombra un modelo de bici NO significa que el ítem sea una bici.** En este almacén las partes se nombran por la bici a la que pertenecen. `E47` tenía 5 SKUs marcados bike llamados "LASER 1.6 2017", "TAXI 2020 GLOSS BLACK", "CUSTOM COMMUTER 2020 BLUE" — y son **pedales**. Ninguna señal del registro los contradecía: `weight_lbs 45` / `length_in 55` son los defaults de registro, no medidas. Corregido en `20260731170000` (`is_bike = false` + prefijo `PEDAL ` en el nombre, para que no vuelva a pasar). **Esta confusión es exactamente lo que motiva pedir el tipo obligatoriamente al registrar.**
- **`01-` y `02-` son prefijos de bike legítimos:** 139 y 20 SKUs, de los cuales 107 y 13 estuvieron en un ROW. Sacarlos del trigger misclasificaría ~120 bikes.
- **Los tracking numbers de FedEx son `is_bike = true` a propósito** (`useFedExReturns.ts`): "returns are always bikes (per ops policy)", y se fuerza para que el placeholder aparezca en el carril de bikes donde el operador lo procesa. Son 34 SKUs / 34 unidades. Físicamente son bikes, pero inflan `total_skus` con números de tracking que no son modelos.

Usar "no está en un ROW" como **detector** de sospechosos es útil; usarlo como **regla de clasificación** corrompe datos.

**Registros basura conocidos, sin resolver:** `01-$&;%` ("Bike example", qty 0, en FDX), `00-0000` ("Faultline A1 Frame" — un cuadro, no una bike, en CAGE), `01-0513/0518/0525/0526/0528` (antes `01-513`…; sin `item_name`, `length_in = 5`, qty 1 en SD — marcados bike, sin nombre no se puede decidir qué son). `03-3666Bl` con la L minúscula lo corrigió la pasada canónica (`03-3666BL`). Todos entraron por el mismo agujero: registro sin elegir el tipo.

**Defaults de peso y dimensiones** (`20260731190000`): los pone el **trigger** `tr_sku_metadata_set_is_bike` según el tipo resuelto — bike 45 lbs / 55×8.5×30.5", part **1 lb** / 0×0×0. Solo rellena lo que viene NULL, así que un valor explícito siempre gana (verificado: un SKU con prefijo `03-` registrado explícitamente como part sale con 1 lb).

- **Espejo en TS:** `src/utils/skuDefaults.ts`. La DB es la autoridad; el TS existe para prellenar formularios sin round-trip. **Mantener ambos en sync**, igual que `classify_picking_list_fedex`.
- **Por qué existía el problema:** la columna tenía `DEFAULT 45` — el peso de una bici en caja — así que 1.376 de 1.387 parts pesaban 45 lbs y los totales del Ship screen sumaban una bici por cada pedal. Además había **tres respuestas distintas** para "cuánto pesa una parte": 0 en `ItemDetailView`, 0.1 en `ShipScreen`, 45 en `inventory.service` y la columna. Ahora hay una.
- **`length_in` y `width_in` tenían `DEFAULT 5` y `6`** (ni bici ni nada), lo que además hacía inalcanzable la lógica de dimensiones del trigger. Los tres defaults de columna fueron eliminados para que el NULL llegue al trigger.
- **`inventory.service.ts` ya no manda dimensiones** al crear el shell de un SKU no registrado: mandaba las de bici y pisaba el default que la DB habría acertado.
- Sin efecto en shipping: `classify_picking_list_fedex` rutea a Regular con `weight_lbs > 50`, y tanto 45 como 1 están por debajo.
- **Pendiente:** 144 SKUs (55 parts, 89 bikes) conservan las dimensiones basura `5×6`. El backfill de peso no las tocó porque algunas podrían estar medidas.

**`dimensions_verified`** (`20260820170000`): distingue una caja medida de una que rellenó el trigger. Existe porque **hay cuatro defaults, no uno** — `55×8.5×30.5` (el del trigger vivo, 144 SKUs), `54×8×30` (uno legacy, 474), `5×6` (los de columna ya muertos, 63) y `0×0×0` (el de parts, en 3 bikes) — y comparar por valor falla en la dirección cara: una caja que mide justo `54×8×30` es indistinguible de una que nadie tocó.

- Lo pone solo: trigger `tr_sku_metadata_dimensions_verified` (BEFORE UPDATE) lo marca `true` cuando **cambia el valor** de una dimensión, y `set_is_bike_on_insert` hace lo mismo en INSERT cuando el caller mandó las tres. Nunca lo pone en `false`.
- **El formulario de alta no manda las dimensiones si siguen siendo las del tipo** (`ItemDetailView.executeSave`, modo `add`, desde el 25 ago 2026): mandarlas hacía que cada SKU registrado a mano saliera `verified` en `55×8.5×30.5` sin que nadie midiera (los del 21 ago están así), y el export a FedEx los declara como cartón real. En NULL el trigger rellena los mismos números y la bandera se queda en `false`.
- **Por qué no un centinela** (guardar `55.0001` para reconocer el default): `ItemDetailView.executeSave` reescribe la fila entera de metadata en cada guardado, incluidas dimensiones que nadie tocó, y el form carga el valor guardado. O el operador ve `55.0001` en el campo, o se redondea al mostrar y el siguiente guardado por cualquier motivo — un cambio de cantidad, una nota — escribe `55` de vuelta y asciende en silencio un SKU sin medir. `PublicTagView` y `StockCountScreen` además interpolan el número crudo.
- **Al 2026-08-21:** 175 verificados, 529 bikes non-S&D sobre defaults.

**Detector, no regla:** "está fuera de un ROW" sirve para _encontrar_ sospechosos — así apareció E47 —, pero nunca para clasificar. `01-` y `02-` son prefijos de bike legítimos (139 y 20 SKUs, con 107 y 13 que vivieron en un ROW), así que sacarlos del trigger para atrapar cinco pedales misclasificaría ~120 bikes reales. La decisión la tiene que tomar una persona en el registro, no un patrón.

### Forma canónica del SKU: `DD-NNNN[CCC]`, impuesta al escribir (`20260826220000`, idea-154)

**Decisión de Rafael (26 ago 2026): la grafía canónica es la de AS400** — departamento de 2
dígitos, guion, número de **4 dígitos con ceros**, 0-3 letras de color en mayúscula. AS400 no tiene
otra: `01-0288` es "S/D EXPLORER A1…" allí y `01-288` no encuentra nada. Lo que no encaje en esa
forma (`PKD-…`, UPC de 12 dígitos, seriales `Y22B010415`, tracking, `23-00146A` con número de 5
dígitos) se guarda `upper(trim)` y no se toca.

**Una sola regla, tres espejos:** `canonical_sku(text)` en SQL es la autoridad —la aplican los
triggers `a_canonical_sku` en `sku_metadata`, `inventory`, `inventory_logs` y `cycle_count_items`
(solo en INSERT o cuando cambia `sku`: editar cantidad nunca mueve una fila de nombre), y la usan
`register_new_sku`, `lookup_canonical_sku`, `search_inventory_with_metadata` (un término completo
en cualquier grafía encuentra la fila; `03-37` sigue siendo búsqueda por prefijo) y
`_container_base_sku` (Excel pierde el cero de `0077`). `normalizeSkuOnRegister` (TS) y
`parser.canonical_sku` (watchdog) son espejos; **la misma tabla de casos** vive en
`skuNormalize.test.ts`, `tests/test_canonical_sku.py` y en el validador de la migración — cambiar
uno es cambiar los tres. En la app se aplica **al guardar**, no por tecla (rellenar `01-5` a
`01-0005` mientras alguien escribe no es ayuda).

**La pasada de datos** renombró 108 nombres (72 cortos `31-75`, 33 sin guion `700106BK`, 3
raros), 22 de ellos fusionados en un nombre que ya existía y 2 sumados en el mismo bin
(`36-305`+`36-0305` en D26, `66-377SL`+`66-0377SL` en E47), reescribiendo `inventory`,
`inventory_logs` (×2), `daily_inventory_snapshots`, `asset_tags`, `cycle_count_items`,
`fedex_return_items` y `picking_lists.items` de **todas** las órdenes (el papel de AS400 decía 4
dígitos de todas formas) con los triggers de actividad y compensación apagados. Stock y snapshots
idénticos antes y después; cada rename/fusión quedó en **`sku_canonical_renames`** (append-only,
lectura admin) con un log `EDIT` por fila (`performed_by = 'system: canonical-sku'`,
`previous_sku` = nombre viejo). **Las 22 fusiones son la lista para el conteo físico**: en varias
los dos nombres tenían descripciones distintas (`31-0075` "WHITE CABLE" / `31-75` "BRAKE CABLE
INNER/OUTER FRONT") y ninguno aparece en ningún PDF; si en piso resultan ser partes distintas, el
que no es AS400 se registra con un nombre propio.

**`sku_key` único cierra la puerta:** un INSERT con una segunda grafía se rechaza; un `upsert ON
CONFLICT (sku)` cae en la fila existente porque el trigger canoniza antes de comprobar el conflicto.
**No añadir más lectores tolerantes** (`inventorySkuCandidates`, `lookup_canonical_sku` y el search
ya existen y son suficientes): si un SKU no se encuentra, la respuesta es la grafía, no otra capa.
Para fusionar nombres a mano (p. ej. una familia `BL`/`BLD` cuando la caja lo diga) existe
`rename_sku_everywhere(old, new)` — `service_role` solamente, escribe la auditoría — nunca el
rename del formulario, que deja al nombre viejo como huérfana con historial.

### Hermanos de variante: `03-3768BL` y `03-3768BLD` son la misma bici

Un SKU de bici puede llevar **una letra extra de acabado** detrás del color de dos letras (`03 3768
BLD` en el PDF de AS400). No es otro modelo: `03-3768BL`/`03-3768BLD` y `03-3769BL`/`03-3769BLD`
tienen el mismo modelo, talla y color, y las cajas son las mismas. El catálogo mantiene **los dos
nombres vivos** porque el operador renombra la fila de inventario entre ellos (tres veces en 2026, la
última el 25 ago) y la fila vieja de `sku_metadata` no se puede borrar (FK desde filas con qty 0).
Así que "qué nombre tiene el stock" es un hecho de este mes, no del SKU.

**Regla (26 ago 2026): entre hermanos de variante gana el que tiene stock, en las dos direcciones.**
Vive en dos sitios que hay que mantener alineados:

- **Watchdog, al resolver la línea** (`_to_cart_items` → `_pick_by_stock`, `supabase_client.py`):
  candidatos = grafía del PDF, canónico de dos letras y el resto de la familia; elige el que cubre
  la cantidad, si no el que más tiene, si no la grafía del PDF (queda marcado bajo el nombre que
  dijo el papel). Antes elegía **el primero que existiera en el catálogo**, que era el muerto: la
  orden 881288 nació `LOW STOCK` con 145 unidades en ROW 43.
- **App, tier 1 de Edit Order** (`CorrectionModeView` → `pickVariantSiblingRow`;
  `variantSiblingBase`/`isVariantSibling` en `src/utils/skuNormalize.ts`): un ítem sin stock cuyo
  hermano cubre la cantidad se intercambia solo, con Undo, igual que un sustituto de mano.

`SKU_SUBSTITUTES` **quedó vacío** y es solo para productos distintos de verdad (otro año de modelo):
tenía `03-3768BL → BLD` y amaneció al revés tras el rename. Una entrada ahí además hacía que el tier
2 saltara el ítem, así que un mapa caducado dejaba la bandera **sin ninguna sugerencia**; hay un test
que prohíbe listar hermanos en él. La familia es estricta: misma base `dd-dddd` + color de dos letras
y **una** letra más. `BK`/`BL` no son hermanos (eso es `AS400_SKU_ALIASES`), ni un part number con
sufijo. **La caja dice `BL` (Rafael, 26 ago tarde):** la tercera letra que imprime AS400 (`BLD`,
`RDD`) es un sufijo de acabado, no otra bici. `20260826231500` fusionó las tres familias que tenían
los dos nombres (`03-3768BLD→BL`, `03-3769BLD→BL`, `03-3779RDD→RD`) y el watchdog (`7d3ac91`)
escribe las líneas no encontradas con el color de **dos letras** (`03-3768BL`, `01-0530`) — lo que
registra el formulario y lo que la orden encuentra por igualdad exacta; `raw_sku` conserva lo que
dijo el papel. Los tres SKUs de tres letras sin gemelo (`01-8791SPT`, `06-4294MVC`, `06-4627LDV`) no
son sufijo D y se quedan. La regla de hermanos por stock sigue como red por si reaparece un par.

## Branching & Deployment

- **`main` = producción** (`pickd.pages.dev`, Cloudflare Pages). **Se despliega empujando directo a
  `main`** (desde el 18 ago 2026): sin PRs ni `develop` — esa rama sigue en el remoto pero no se usa ni
  se despliega como staging. La sección anterior describía el flujo por PRs; quedó obsoleta.
- **La compuerta es local, no GitHub (operador, 26 ago 2026):** `.husky/pre-commit` (lint-staged +
  `tsc` cuando hay TS staged) y `.husky/pre-push` (`tsc --noEmit` + `vitest run`, ~15 s). `pnpm check` lo
  lanza a mano; `git push --no-verify` solo en emergencia. El workflow `ci-tests.yml` no dispara en
  `main` y **no debe extenderse a `main`**.
- **Solo lo propio a `main`:** si un archivo tiene hunks ajenos sin commitear, el staged se construye
  como HEAD + reemplazos exactos — nunca "bloque hasta ancla", que el 26 ago duplicó párrafos de este
  archivo tres veces.
- **Regla de migraciones:** la DB es una sola, así que los cambios de esquema deben ser **aditivos**
  (agregar columnas/funciones OK; renombrar/eliminar solo cuando ningún frontend vivo lo use).
- **⚠️ Aplicar migraciones a prod después del push:** `git push` NO aplica migraciones. Empujar
  archivos en `supabase/migrations/` solo despliega el frontend — si el código llama a una RPC/columna
  nueva antes de aplicar la migración, prod tira `404 Not Found` o `column does not exist`. Checklist:
  1. `npx supabase migration list --linked` — confirma cuáles están pending (columna Remote vacía) y
     que **el número de versión no exista ya en remoto**: el 26 ago dos sesiones eligieron
     `20260826230000` y la segunda hizo rollback. Nombrar con la hora real (`date -u +%Y%m%d%H%M%S`).
  2. `npx supabase db push --linked --yes` — aplica todas las pending.
  3. Verifica con una query directa (`PROD_DB_URL` + `postgres`, o `npx supabase db query --linked`).
  4. Refrescar la app en prod (Ctrl+R) — los 404 desaparecen.
- **Validar antes de aplicar:** correr el cuerpo de la migración dentro de una transacción con rollback
  contra prod (`sql.begin` + `throw`) y leer el estado resultante; es como se validaron las de idea-154.
- **Banner de staging:** `StagingBanner.tsx` muestra un banner amarillo "STAGING" automáticamente cuando el hostname no es producción ni localhost.
- **Reports prebuild:** `pnpm prebuild` copies `reports/daily/*.html` to `public/reports/daily/` for static serving. Runs automatically before `pnpm build`. The `/pickd-report` route serves these via iframe.

## Desarrollo local (Supabase + OrbStack)

El stack local de Supabase corre como contenedores Docker dentro de **OrbStack** (`project_id = "pickd"` en `supabase/config.toml`, nombra los contenedores `supabase_*_pickd`).

- **`npx supabase stop` ELIMINA los contenedores** (no los pausa) — por eso desaparecen de la lista de OrbStack. Los datos sobreviven en un volumen Docker aparte (mensaje "Local data are backed up to docker volume" al parar). `npx supabase start` los recrea desde cero usando ese volumen — no se pierde nada, pero si las imágenes no están cacheadas puede tardar.
- **Si `supabase start` se cuelga descargando `imgproxy`:** esta app nunca usa las transformaciones de imagen de Supabase Storage (las fotos van directo a R2, ver sección de Fotos abajo), así que ese servicio no hace falta. Arrancar con `npx supabase start --exclude imgproxy` lo salta por completo — más rápido y evita depender de que `public.ecr.aws` esté disponible. `supabase/config.toml` tiene `[storage.image_transformation] enabled = false`, pero eso solo desactiva la feature — el flag `--exclude` es lo que evita el pull.
- **Migraciones pendientes en local:** `npx supabase start` no aplica migraciones nuevas si el volumen es de una sesión vieja. Verificar con `npx supabase migration list --local` (columna `remote` vacía = pendiente) y aplicar con `npx supabase migration up --include-all`.
- **Mismatch de historial de migraciones** (mismo síntoma que en prod — versión `20260717` sin match): `npx supabase migration repair --local --status reverted 20260717` y despues `npx supabase migration up --include-all`.
- **Nunca exportar `SUPABASE_PROJECT_ID`.** El CLI la trata como override de `project_id` de `config.toml`, que es el identificador **local** con el que nombra los contenedores. Con esa variable puesta al ref remoto, `supabase start/status/stop` buscan `supabase_db_<ref>` mientras el stack real corre como `supabase_*_pickd`: no lo encuentran, intentan levantar uno nuevo y chocan con "port 54322 already allocated". Estuvo así en `.envrc` hasta el 14 ago 2026; ahora el ref remoto se exporta como `PICKD_SUPABASE_PROJECT_REF`, que el CLI ignora. El ref para `--linked` sale de `supabase/.temp/project-ref` (lo escribe `supabase link`, y está en gitignore — en un clone nuevo hay que re-linkear).
- **Límite de recursos de OrbStack:** configurado a 4 CPUs / 2GB RAM (`orbctl config show`) para no acaparar toda la Mac — antes estaba en 8 CPUs/4GB (el 100%/50% de una Mac de 8 cores/8GB). Cambios de `orbctl config set` requieren `orbctl stop` para aplicarse (mata cualquier contenedor vivo, incluidos MCP servers de sesiones activas — no correrlo con sesiones en curso).

## Servicios externos

- **watchdog-pickd** — Daemon Python que monitorea PDFs y auto-crea órdenes. Corre en la **MacBook de Bay 2** (no en esta máquina) como servicio launchd (`com.antigravity.watchdog-pickd`). Usa `service_role` key (bypasses RLS). Repo: `~/Documents/Projects/JAMIS/watchdog-pickd/`. Para reinstalar: `python watcher.py --install`.

## Fotos (R2 + Edge Functions)

Las fotos del proyecto (SKU inventory + gallery de proyectos) viven en **Cloudflare R2** y se suben via el edge function `upload-photo`.

- **Storage:** Cloudflare R2 bucket `inventory-jamisbikes`, public domain `https://pub-1a61139939fa4f3ba21ee7909510985c.r2.dev/`
- **Paths:** SKU photos → `photos/{sku}.webp`, gallery photos → `photos/gallery/{uuid}.webp` (+ `/thumbs/` para ambos)
- **Compresión client-side:** `compressImage()` en `src/services/photoUpload.service.ts` (max 1200px, 80% WebP + 200px thumbnail)
- **Upload service:** SIEMPRE usar `supabase.functions.invoke()` para llamar al edge function, NUNCA `fetch()` raw. El cliente refresca el JWT automáticamente; raw fetch no.

### ⚠️ JWT verification debe estar DESACTIVADO en `upload-photo`

El edge function valida el JWT internamente con `supabase.auth.getUser(token)`. Si el gateway de Supabase también lo verifica, la request muere con 401 antes de llegar al código.

- **Configuración persistente:** `supabase/config.toml` → `[functions.upload-photo] verify_jwt = false`
- **Deploy manual con flag:** `npx supabase functions deploy upload-photo --no-verify-jwt`
- **NUNCA hacer:** `npx supabase functions deploy upload-photo` sin el flag — sobrescribe la config y rompe los uploads en prod
- **Síntomas si falla:** todas las fotos de gallery se guardan con `blob:https://...` URLs (fallback de dev) en vez de URLs públicas de R2. Las fotos solo se ven en el dispositivo que las tomó.

### Fallback dev vs prod

`useUploadGalleryPhoto` tiene fallback a blob URLs **solo en localhost**. En producción/staging, si el edge function falla, lanza el error al usuario en vez de guardar URLs inservibles. Ver `src/features/projects/hooks/useGalleryPhotos.ts`.

## Skills y agentes

**Viven en este repo, versionados** (`.claude/skills/`, `.claude/agents/`). Un clone
recién hecho los tiene todos; no dependen de que exista otro directorio en la máquina.
Ver `docs/claude-agents-and-skills.md`.

Eran symlinks al repo central `rafael1599/skills` y se rompieron los once de golpe el
día que ese repo se movió de sitio en disco — en silencio, porque un symlink muerto se
ve igual que un skill ausente. Por eso ahora son copias reales (11 ago 2026).

- **Actualizar un skill global:** copiarlo otra vez desde el repo central. No hay
  automatización a propósito: la automatización es lo que falló.
- **Claude Code web:** el hook SessionStart `.claude/hooks/link-skills.sh` sigue ahí,
  pero solo rellena huecos — si el destino ya es un directorio real, lo respeta.
- **Formato:** `.claude/skills/` está en `.prettierignore`. Formatearlos los haría
  divergir de su origen.

### Skills en el repo

Project: `catalog-images`, `daily-report`, `supabase`, `ui-rules`.
Global: `commit-craft`, `compact-backlog`, `fabrica-de-skills`, `image-cors-cache-bust`,
`prod-data`, `project-setup`, `report-gen`, `web-scraper`.
External: `supabase-postgres-best-practices`.

Son trece, heredados de lo que había enlazado localmente. La lista curada del hook son
seis, con la nota de que **cada descripción de skill ocupa contexto en cada sesión**.
Si alguno no se usa, borrarlo.

### Agentes

- `qa-auditor` — pasadas de QA sobre la app
- `warehouse-report-writer` — escribe el daily, el What's new y el weekly; cada corrección
  de Rafael se vuelve regla en `docs/weekly-report/LESSONS.md` y los flujos viven en
  `docs/warehouse-user-flows.md` (creado 27 ago 2026: "no quiero volver a corregir una y otra vez")
- `warehouse-space-planner` — distribuye pallets en una zona libre. Ver
  `docs/warehouse-floor-plans.md`
- `warehouse-sku-placement` — decide qué va en cada hueco. Borrador: sus reglas siguen
  siendo preguntas abiertas
