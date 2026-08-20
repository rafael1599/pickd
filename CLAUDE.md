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
- **Tests:** Correr `pnpm vitest run` antes de cada deploy. Los tests corren local sin necesidad de DB (mocks de Supabase).
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

**Verification Board (idea-055):** La Verification Queue es un overlay full-screen con zonas: Priority (auto-populated por status), FedEx/Regular lanes (drag-reclasificar `shipping_type`), In Progress Projects (read-only), Recently Completed (drag=reopen), Waiting (colapsable). Auto-clasificación: item >50 lbs o ≥5 BIKES (prefijo 03-) → Regular, else → FedEx; las partes nunca fuerzan Regular (50 partes = FedEx). Regla duplicada en DB (`classify_picking_list_fedex`) — mantener ambas en sync. La regla de bikes depende de `sku_metadata.is_bike`, que el item no trae por sí solo: el trigger `a_stamp_item_sku_metadata` (migración `20260820150000`) lo sella dentro de cada elemento de `picking_lists.items` en cada write, así que **todo consumidor lee la misma verdad sin buscarla**. Antes cada pantalla traía su propio lookup y pasarlo era opcional — DoubleCheckView no lo pasaba y pintaba de FedEx órdenes de 13 bicis. El parámetro `bikeSkus` de `autoClassifyShippingType`/`isFedexOrder` es ahora **obligatorio** (pasar un Set vacío para renunciar a él a propósito): cubre el ítem que aún no se ha escrito y el SKU cuyo `is_bike` cambió después del sellado. `shipping_type` columna en `picking_lists` (NULL = auto). DnD usa `@dnd-kit/sortable` con `useBoardDnD` hook. Componentes en `src/features/picking/components/board/`.

**Activity Report layout:** Editor panel on the left (desktop) with: selectable greeting toggle ("Hi Carine!"), Win of the Day, PickD Updates (collapsible dropdown, closed by default), On the Floor routine checklist (editable items via gear icon, persisted in localStorage), and Notes (multiline textarea, one per line). Preview on the right updates with green highlight flash on each edit. "Save & Copy Report" button at bottom saves + copies to clipboard in one action. Report section order: Win → PickD Updates → Done Today → On the Floor → In Progress → Coming Up Next → Inventory Accuracy → Waiting. Footer shows date only (no timestamp). `/pickd-report` public route shows the HTML daily report for the current date with date navigation.

## Base de datos

pickd es dueño único de toda la DB de Supabase. Existió un consumidor externo (**pickd-2d**,
dashboard de visualizacion 2D/3D) que leía `inventory`, `sku_metadata` y `locations`; el repo se
eliminó (confirmado 2026-08-14, ya no existe en disco) y con él el contrato `JAMIS/SHARED-DB-CONTRACT.md`.
Ya no hay que coordinar cambios de schema con nadie más.

- **`sku_metadata` columns (prod):** `sku`, `length_in`, `width_in`, `height_in`, `length_ft`, `weight_lbs`, `image_url`, `is_bike`, `upc`, `created_at` — NO tiene columna `name`
- **`inventory.sublocation`** (idea-024): posición dentro de un ROW (A-F). CHECK constraints: `^[A-Z]{1,3}$` y solo para `location ILIKE 'ROW%'`. Se auto-limpia a NULL al mover a non-ROW. UI: chips en ItemDetailView/MovementModal, badge en InventoryCard/DoubleCheckView.
- **Invariante qty=0 → is_active=false:** `adjust_inventory_quantity` y `undo_inventory_action` mantienen `is_active = (quantity > 0)` bidireccionalmente. **Excepción:** `register_new_sku` crea placeholders con `qty=0, is_active=true` para onboarding de bikes nuevos — NO modificar este comportamiento. Ghost trail en búsqueda usa `includeInactive: true` para seguir mostrando items sin stock con su último movimiento.

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

**Registros basura conocidos, sin resolver:** `01-$&;%` ("Bike example", qty 0, en FDX), `00-0000` ("Faultline A1 Frame" — un cuadro, no una bike, en CAGE), `01-513/518/525/526/528` (sin `item_name`, `length_in = 5`, qty 1 en SD — marcados bike, sin nombre no se puede decidir qué son), y `03-3666Bl` con la L final en minúscula. Todos entraron por el mismo agujero: registro sin elegir el tipo.

**Defaults de peso y dimensiones** (`20260731190000`): los pone el **trigger** `tr_sku_metadata_set_is_bike` según el tipo resuelto — bike 45 lbs / 55×8.5×30.5", part **1 lb** / 0×0×0. Solo rellena lo que viene NULL, así que un valor explícito siempre gana (verificado: un SKU con prefijo `03-` registrado explícitamente como part sale con 1 lb).

- **Espejo en TS:** `src/utils/skuDefaults.ts`. La DB es la autoridad; el TS existe para prellenar formularios sin round-trip. **Mantener ambos en sync**, igual que `classify_picking_list_fedex`.
- **Por qué existía el problema:** la columna tenía `DEFAULT 45` — el peso de una bici en caja — así que 1.376 de 1.387 parts pesaban 45 lbs y los totales del Ship screen sumaban una bici por cada pedal. Además había **tres respuestas distintas** para "cuánto pesa una parte": 0 en `ItemDetailView`, 0.1 en `ShipScreen`, 45 en `inventory.service` y la columna. Ahora hay una.
- **`length_in` y `width_in` tenían `DEFAULT 5` y `6`** (ni bici ni nada), lo que además hacía inalcanzable la lógica de dimensiones del trigger. Los tres defaults de columna fueron eliminados para que el NULL llegue al trigger.
- **`inventory.service.ts` ya no manda dimensiones** al crear el shell de un SKU no registrado: mandaba las de bici y pisaba el default que la DB habría acertado.
- Sin efecto en shipping: `classify_picking_list_fedex` rutea a Regular con `weight_lbs > 50`, y tanto 45 como 1 están por debajo.
- **Pendiente:** 144 SKUs (55 parts, 89 bikes) conservan las dimensiones basura `5×6`. El backfill de peso no las tocó porque algunas podrían estar medidas.

**Detector, no regla:** "está fuera de un ROW" sirve para _encontrar_ sospechosos — así apareció E47 —, pero nunca para clasificar. `01-` y `02-` son prefijos de bike legítimos (139 y 20 SKUs, con 107 y 13 que vivieron en un ROW), así que sacarlos del trigger para atrapar cinco pedales misclasificaría ~120 bikes reales. La decisión la tiene que tomar una persona en el registro, no un patrón.

## Branching & Deployment

- **`main`** — Producción. Despliega automáticamente a `pickd.pages.dev` (Cloudflare Pages).
- **`develop`** — Staging/preview. Despliega automáticamente a una preview de Cloudflare Pages. Misma DB de producción (Supabase compartida).
- **Flujo:** feature branches → PR a `develop` → testing en staging → PR a `main` → producción.
- **Regla de migraciones:** Como staging y producción comparten la misma DB, los cambios de esquema deben ser **aditivos** (agregar columnas/funciones OK, renombrar/eliminar NO hasta que producción también se actualice).
- **⚠️ Aplicar migraciones a prod después del merge:** `git push` NO aplica migraciones a la DB compartida. Mergear un PR con archivos en `supabase/migrations/` solo despliega el frontend — si el código llama a una RPC/columna nueva antes de aplicar la migración, prod tira `404 Not Found` o `column does not exist`. Checklist post-merge para PRs con cambios de DB:
  1. `npx supabase migration list --linked` — confirma cuáles están pending (columna Remote vacía).
  2. `npx supabase db push --linked` — aplica todas las pending. Pide confirmación.
  3. Verifica con un query: `npx supabase db query --linked "SELECT ..."`.
  4. Refrescar la app en prod (Ctrl+R) — los 404 desaparecen.
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
- `warehouse-space-planner` — distribuye pallets en una zona libre. Ver
  `docs/warehouse-floor-plans.md`
- `warehouse-sku-placement` — decide qué va en cada hueco. Borrador: sus reglas siguen
  siendo preguntas abiertas
