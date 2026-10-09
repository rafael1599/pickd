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
- **AI:** ninguna API de pago. El lector de etiquetas corre en el dispositivo (`src/lib/recognition/`, `docs/label-recognition/`); la línea «Gemini 2.5 Flash + GPT-4o» que hubo aquí no tenía código detrás (15 sep 2026)
- **Package manager:** pnpm

## Estructura clave

- `src/features/` — Feature-Sliced Design (cada feature tiene `hooks/`, `components/`, `api/`)
- `src/lib/` — Clientes core (supabase, query-client, mutationRegistry)
- `src/schemas/` — Validación Zod (deben coincidir con columnas de DB)
- `supabase/migrations/` — Migraciones PostgreSQL
- `supabase/functions/` — Edge functions (snapshots, reportes, auto-cancel)
- `.agent/management/BACKLOG.md` — Source of truth del backlog
- `src/features/warehouse-map/` — **El mapa del almacén** (`/warehouse-map`). Todo su detalle
  (engine, PLAN/LIVE, 30 u por cuadro y 45 de tope, MAS, letras por cuadro) vive en
  `.claude/rules/warehouse-map.md`. **CRÍTICO:** todo layout cumple `docs/warehouse-ui-rules.md`.
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
- **Tests:** Correr `pnpm vitest run` antes de cada deploy. Los tests corren local sin necesidad de DB (mocks de Supabase). **El CI es local (26 ago 2026):** el hook `pre-push` de husky corre `tsc --noEmit` + `vitest run` antes de cualquier push (`pnpm check` para lanzarlo a mano — **no `pnpm ci`**: pnpm reserva ese nombre para su propio comando, imprime `CI_NOT_IMPLEMENTED` y sale con 0 sin correr nada, un gate que aprueba siempre; `git push --no-verify` solo en emergencia). No hay CI en GitHub: `ci-tests.yml` se borró el 22 sep 2026 y no debe volver como compuerta de `main`.
- **Modals/Sheets:** SIEMPRE usar el Modal Manager (`useModal()` + `ModalProvider` en LayoutMain). Ningún modal crítico debe vivir dentro del componente que lo abre. Ver `docs/modal-pattern.md`. Excepciones: tooltips, dropdowns, popovers efímeros.

## Reglas por área (`.claude/rules/`)

**Este archivo es el índice, no el libro (2 oct 2026).** Llegó a 149k caracteres y Claude Code
avisa pasados 150k entre todos los archivos de instrucciones. El detalle de cada área vive en
`.claude/rules/<área>.md`, movido tal cual: Claude Code lo carga solo al tocar las rutas de su
cabecera `paths:`, y los demás agentes (que leen `AGENTS.md` → este archivo) lo abren desde aquí.
**Lo nuevo de un área se escribe en su archivo**; aquí sólo cambia la línea del índice si cambia la
regla que la resume. **Antes de una migración**, leer el archivo del área que toca: `paths:` cubre
`supabase/**` sólo para `database.md`.

- **`picking.md`** — Cancelar (una completada vuelve al `CANCELLED PALLET`, una sin completar a su ubicación), combinadas que se cancelan enteras, el plan de pick al tomar la orden, `verified_item_keys` es del **grupo**, `group_is_held`, Double Check escribe fila por fila, Edit Order con pestañas, Verification Board (≥5 bicis → Regular, el peso no decide; espejo en `classify_picking_list_fedex`), nada se cancela ni se revierte por reloj.
- **`ship.md`** — Los cuatro números (pallets, bikes, parts, weight), e-bike en cartón aparte, `planPallets` es el **único** motor de tarimas, `layoutPallet` la única medida, etiquetas. `shipments` manda desde el 27 sep: combinar/separar sólo con `combine_into_shipment` / `split_from_shipment`.
- **`notes.md`** — `picking_list_notes`: `kind`/`metadata` los pone el trigger; leer con `isSystemNote()`/`noteKind()`, **nunca** prefijos a mano; una sola suscripción realtime; el letrero LED.
- **`catalog.md`** — SKU canónico `DD-NNNN[CCC]` (`canonical_sku`, tres espejos con la misma tabla de casos), `is_bike` (la ubicación y el nombre **no** deciden), hermanos `BL`/`BLD`, color y talla en una grafía, `sku_not_found` derivada, huérfanas de catálogo, abreviaturas de modelo.
- **`scratch-dent.md`** — El nombre de una S/D termina en `S/D`, etiquetas 6×4 con `#n`, una S/D un SKU, ROW 12, el Sheet espejo, filtros de Stock, y **For sale** (`sd_for_sale`: `Yes` / `Not yet` / `No`, sólo aviso; una S/D nueva nace en `Not yet`).
- **`as400.md`** — Puerta del AS400 y holds, `register_sku_from_as400` en `UNKNOWN` (nunca cantidad ni peso), `reconcile-from-as400.mjs` (señala, nunca escribe cantidades: el AS400 no reconcilia, 9 oct 2026), mapa de partes, `v_inventory_vs_as400` (LUDLOW = columna NJ).
- **`recognition.md`** — Lote por fotos (`/batch`) y la sombra del lector en Double Check: Worker, nunca el hilo principal; tocar el motor es cambiar de motor (`engineConfig.test.ts`).
- **`containers.md`** — Registrar no es llegar; una orden no saca unidades de un container.
- **`reports.md`** — Export de dimensiones a FedEx (Replace vacía la tabla; **Width sale de `height_in`**), cola de Measure, `dimensions_verified`/`weight_verified`, Activity Report.
- **`manuals.md`** — Manuales estáticos en `src/content/manuals/`; **nunca** vuelven a la base (un test lo impide).
- **`database.md`** — Columnas de `sku_metadata`, `inventory.sublocation`, invariante `qty=0 → is_active=false` (salvo placeholders de `register_new_sku`), `locations` por (warehouse, location), `counts_as_storage`, `pick_priority`.
- **`warehouse-map.md`** — El mapa: engine, PLAN/LIVE, 30 u por cuadro y 45 de tope, MAS, `hand` vs `auto`.

## Picking workflow

```
idle (UI) → active (DB — via generatePickingPath)
  → ready_to_double_check → double_checking
    → completed (terminal) | needs_correction → active (loop)
  → cancelled (terminal — siempre manual; nada se cancela por reloj desde el 8 oct 2026)
completed → reopened (via Reopen Order — requires reason)
  → completed (re-complete with inventory delta) | cancelled (cancel reopen — restores snapshot)
```

7 estados DB: `active`, `ready_to_double_check`, `double_checking`, `needs_correction`, `completed`, `cancelled`, `reopened`. Órdenes completadas tienen triple protección contra reversión. Órdenes `reopened` tienen snapshot para delta calculation y se resuelven a mano (Continue Editing / Take Over & Edit; nada se cancela ni se revierte por reloj desde el 8 oct 2026).

Todo lo demás del flujo (cancelar, combinar, verificar, Edit Order, el board) vive en
`.claude/rules/picking.md`.

## Branching & Deployment

- **`main` = producción** (`pickd.pages.dev`, Cloudflare Pages). **Se despliega empujando directo a
  `main`** (desde el 18 ago 2026): sin PRs y sin staging. **`develop` se borró el 22 sep 2026**, con
  las otras 24 ramas del remoto y el workflow `ci-tests.yml`, que sólo disparaba en PR y en push a
  esa rama y no corría desde el 27 de agosto.
- **Leer `origin/main` sin `git fetch` antes es leer una foto vieja (22 sep 2026).**
  `origin/main` es una copia local que sólo se mueve cuando la traes, así que
  `git rev-list --left-right --count origin/main...HEAD` devuelve `0 0` tanto si estás al día como
  si llevas días sin mirar: **«al día» y «no he mirado» se leen igual**. Ese día una sesión analizó
  «el estado actual» sobre ese `0 0` y escribió «todo desplegado»; el checkout iba **70 commits por
  detrás** —reconocimiento de etiquetas, `/live-check`, `sku_serials` y tres migraciones que ya
  estaban aplicadas en prod—. **Cualquier frase sobre qué está desplegado empieza con `git fetch`.**
  Y como esto ya se sabía y se falló igual, dejó de vivir sólo en prosa: el hook **`SessionStart`**
  (`.claude/hooks/session-start.sh`, declarado en `.claude/settings.json`) trae el remoto al abrir
  cada sesión y dice cuántos commits faltan, cuántos hay sin empujar y cuántos archivos hay sin
  commitear — que en un checkout compartido por varias sesiones puede que no sean tuyos.
- **El `pre-push` no corre desde un worktree (22 sep 2026).** `core.hooksPath` apunta a `.husky/_`,
  que husky **genera** y no está versionado, así que un `git worktree add` nace sin él y el push sale
  **sin compuerta, sin avisar**. Si hace falta empujar desde un árbol limpio —porque el principal
  tiene trabajo ajeno sin commitear que no compila—, hay que copiar `.husky/_` al worktree y tener
  las dependencias instaladas, o decir explícitamente que la compuerta no corrió.
- **La compuerta es local, no GitHub (operador, 26 ago 2026):** `.husky/pre-commit` (lint-staged +
  `tsc` cuando hay TS staged) y `.husky/pre-push` (`tsc --noEmit` + `vitest run`, ~15 s). `pnpm check` lo
  lanza a mano; `git push --no-verify` solo en emergencia. `ci-tests.yml` ya no existe (22 sep 2026) y
  **no debe volver como compuerta de `main`**.
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
- **Una página abierta sigue con el build que cargó (11 sep 2026).** Nada le avisaba de uno nuevo: un
  arreglo llegó a prod a las 16:15 y un teléfono siguió perdiendo las marcas a las 16:17 porque corría
  el anterior. Cada build publica `version.json` (`vite.config.ts`: commit de Cloudflare
  `CF_PAGES_COMMIT_SHA` + hora) y `useAppUpdate` (montado en `LayoutMain`) lo compara al minuto, cada
  5 min y cada vez que la página vuelve a la pantalla. **Lo dice el chequecito de status, no un
  toast** (Rafael, 22 sep 2026: «no quiero que vuelva a aparecer… en vez de eso hacer amarillo ámbar
  el chequecito de status»): el pill de `SyncStatusIndicator` pasa de verde `READY` a ámbar `UPDATE`
  y un toque recarga —en una PWA instalada no hay barra de direcciones desde la que hacerlo—. Va
  **debajo** de error, offline, mensaje y syncing: esos cuatro hablan de este segundo, éste lleva
  cierto toda la mañana. **Nunca recarga solo** (alguien puede estar escribiendo). El menú de usuario
  enseña el commit que corre (`STABLE · 37BD187`): es lo primero que preguntar cuando un arreglo «no
  funciona» en un dispositivo.
- **`vite.config.js` no existe a propósito.** Vite carga un `vite.config.js` antes que el `.ts`, y uno
  compilado por un `tsc -b` y commiteado en julio **sustituía la config real en silencio**: todo cambio
  a `vite.config.ts` se ignoraba, en local y en Cloudflare. `tsconfig.node.json` emite ahora en
  `node_modules/.tmp` y `.gitignore` lo prohíbe.
- **Validar antes de aplicar:** correr el cuerpo de la migración dentro de una transacción con rollback
  contra prod (`sql.begin` + `throw`) y leer el estado resultante; es como se validaron las de idea-154.
- **Banner de staging:** `StagingBanner.tsx` muestra un banner amarillo "STAGING" automáticamente cuando el hostname no es producción ni localhost.
- **Reports prebuild:** `pnpm prebuild` copies `reports/daily/*.html` to `public/reports/daily/` for static serving. Runs automatically before `pnpm build`. The `/pickd-report` route serves these via iframe.
- **What's new (27 ago 2026, idea-166):** `reports/warehouse-updates/YYYY-MM-DD.html` (+ `img/`, PDF
  por Chrome headless) → `pnpm prebuild` los copia a `public/reports/warehouse-updates/` y escribe
  `index.json`; la ruta `/whats-new` (menú → What's new) los muestra con navegación por fecha e
  imprime. Los escribe el agente `warehouse-report-writer`; las reglas viven en
  `docs/weekly-report/LESSONS.md` (historia de dolor por mejora, cifras, vocabulario, nada técnico).

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
- **`image_url` lleva versión (`?v=<ms>`, 1 oct 2026).** La foto de un SKU siempre cae en la misma
  llave y R2 no manda `Cache-Control`, así que sin versión una foto nueva seguía viéndose vieja en
  todo navegador y en la caché persistida (7 días) que ya la había cargado: la Hudson `01-0357`
  enseñaba la Xenith. `upload-photo` guarda la URL con `?v=` y `withPhotoVersion` cubre una
  respuesta sin ella. Quien derive la miniatura (`.replace('/photos/', '/photos/thumbs/')`) conserva
  la versión; no quitarla nunca con un `split('?')`.
- **Girar una foto desde el visor (6 oct 2026):** el ↻ de `PhotoLightbox` la gira 90° y la vuelve a
  subir a la misma llave (`photoRotate.service.ts`), así queda derecha en todas partes; la URL nueva
  lleva `?v=` y `replace_photo_url` la pone en los seis sitios que guardan URLs de fotos. Las de
  `catalog/` (compartidas por muchos SKUs) no se giran.
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

**Agentes:** `.claude/agents/`, versionados, siempre lo fueron.

**Skills de proyecto** (`catalog-images`, `daily-report`, `supabase`, `ui-rules`): versionadas en
`.claude/skills/`, su único hogar (desde el 29 ago 2026 ya no están en el repo central; una skill de
proyecto cambia con el código). `.claude/skills/` está en `.prettierignore`.

**Skills globales:** vienen del plugin `globals@rafael-skills` (marketplace `rafael1599/skills`),
declarado en `.claude/settings.json` junto con `external@rafael-skills`: Claude Code los instala solo
al abrir el proyecto, también en Claude Code web y en otra máquina. Se invocan como `/globals:<skill>`
(p. ej. `/globals:commit-craft`, `/globals:layout-lab`). Tras un push al repo de skills:
`claude plugin marketplace update rafael-skills && claude plugin update globals@rafael-skills`.
Inventario y costo de contexto: `claude plugin details globals@rafael-skills`.

Historia: eran symlinks al repo central y se rompieron los once de golpe cuando ese repo se movió de
sitio (11 ago 2026 → copias vendorizadas). El 29 ago 2026 las copias de globales se retiraron a favor
del plugin, que resuelve lo mismo (un clone funciona en cualquier máquina) sin dos hogares que
divergen; el hook `link-skills.sh` se eliminó. Ver `docs/claude-agents-and-skills.md`.

### Agentes

- `qa-auditor` — pasadas de QA sobre la app
- `warehouse-report-writer` — escribe el daily, el What's new y el weekly; cada corrección
  de Rafael se vuelve regla en `docs/weekly-report/LESSONS.md` y los flujos viven en
  `docs/warehouse-user-flows.md` (creado 27 ago 2026: "no quiero volver a corregir una y otra vez")
- `warehouse-space-planner` — distribuye pallets en una zona libre. Ver
  `docs/warehouse-floor-plans.md`
- `warehouse-sku-placement` — decide qué va en cada hueco. Borrador: sus reglas siguen
  siendo preguntas abiertas
- `pickd-product-designer` — diseña pantallas, flujos y funcionalidad **como estudio antes de
  código** (PRD con ❓ y default, un gesto / un switch / un botón, cifras no frases, revisado a
  430 px); cada corrección de Rafael se vuelve regla en `docs/design/LESSONS.md`. Creado el 28 ago
  2026 a petición suya ("designa un agente específico o créalo… para diseño de interfaz, flujo y
  funcionalidad de PickD"). Primer estudio: `docs/prds/warehouse-map-plan-and-live.md`.
