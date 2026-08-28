> **Superseded 2026-08-28 (idea-170):** el plan DS-pallet (pestaña Plan) fue borrado con la fase F4; el mapa medido en
> `src/features/warehouse-map/` lo reemplaza. Ver `docs/prds/warehouse-map-measured.md`.

# DS-Pallet — Estado y traspaso

**Actualizado:** 2026-07-29 · **Rama:** `main` (todo commiteado, **sin push**)

Documento de arranque en frío. Los otros dos son el qué y el cómo:

- `warehouse-ds-pallet-blocks.md` — PRD funcional, requerimientos numerados
- `warehouse-ds-pallet-uiux.md` — análisis UI/UX, inventario de componentes

---

## 1) Qué está hecho

| Fase                   | Qué                                                                                                                                                              | Commit    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **1 · Motor**          | `src/utils/dsPalletPlanner.ts` + 31 tests                                                                                                                        | `200744e` |
| **2 · Persistencia**   | Migración `20260728120000`: `warehouse_no_movers`, `warehouse_block_settings`, `plan_version`/`pull_first`/`block_id`, RPC `get_block_classification_candidates` | `ce95f2b` |
| **3a · Datos**         | `useNoMoverList.ts` + tipos de las 3 tablas en ambos archivos de tipos                                                                                           | `f6f1d45` |
| **3b · Plan**          | `useDsPalletPlan.ts` — planner ↔ tabla persistida, por bloque                                                                                                    | `5c08a61` |
| **3c · Clasificación** | `NoMoverClassification.tsx` — el tab nuevo                                                                                                                       | `0736a10` |
| **3d · Grid**          | `DsPalletCell`, `DsPalletGrid`, `DsPalletPlanView`; el tab Plan ya los usa                                                                                       | (último)  |

**Aplicado a producción** (`db push`, 2026-07-29): las 4 tablas existen, `warehouse_block_settings` tiene los 2 bloques sembrados, los 3 RPCs están.

## 2) Qué falta

| Fase   | Qué                                                                                                                                                                                                                                                                             | Notas                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **3e** | **Sección Pull First** bajo cada bloque, colapsable, con motivo por fila (`16u < 20u mínimo`) e incluida en el print                                                                                                                                                            | El dato ya se persiste en `warehouse_overstock_plans.pull_first`; falta solo la UI |
| **3f** | Migrar el tab **Live** al vocabulario DS-Pallet y borrar `overstockPutaway.ts`, `WarehouseMap.tsx`, `SkuCell.tsx`, `WarehouseGrid.tsx`, `WarehouseMapFilters.tsx`, `useOverstockLayoutPlan.ts`, `useWarehouseMapPersistedPlan.ts`, `useRankingWeights.ts`, `usePrioritySkus.ts` | Live todavía usa el modelo viejo; **no borrar nada antes de migrarlo**             |
| —      | `overstockPutaway.test.ts` (25 casos en lenguaje tower/lines)                                                                                                                                                                                                                   | Se elimina junto con el motor viejo                                                |

### ⚠️ Sin verificar visualmente

**El tab Plan nunca se abrió en el navegador.** Compila, typechequea y los tests pasan, pero el grid de DS-Pallets no se vio renderizado ni una vez. Lo primero de la próxima sesión es abrirlo y apretar Recalculate en cada bloque.

Al verificarlo, mirar en particular:

- Que los dos bloques quepan lado a lado sin scroll horizontal del body
- Que la rotación de 90° no descuadre los headers
- El print: deben salir 2 hojas, una por bloque (`print:break-after-page` ya está)
- Contraste — ver §4, es el error más fácil de repetir en este proyecto

## 3) Decisiones cerradas (no reabrir)

- **DS-Pallet**: 1 sublocación = 1 pallet mono-SKU, min 20 (editable) / max 25 (fijo, capacidad física)
- **Partición**: `floor(qty/25)`; resto ≥ mínimo → pallet extra; resto < mínimo → Pull First completo
- **Bloques**: A = ROW 31/32/33, B = ROW 28/29/30. Un SKU pertenece a uno solo
- **Criterio mover/no-mover**: **recencia de envío**, no conteo de órdenes. Validado contra una clasificación manual — el conteo no separa las clases, la fecha del último envío sí
- **Anclaje**: si el no-mover ya está dentro de su bloque conserva su celda; el mínimo gana sobre el anclaje
- **Movers**: se descartan por completo, sus celdas cuentan como libres. El piso los desaloja
- **Posiciones por row**: configuración (`warehouse_block_settings.positions_per_row`), no constante. El re-rotulado del piso es manual y aparte
- **Ruta**: `/warehouse-map` queda abierta, sin gating de admin
- **Consolidation**: no cambia; el solapamiento con bay 3 (ROW 20-38) se acepta

## 4) Trampas de este proyecto

**El root monta con `dark` en `<html>`.** Cualquier componente con fondo claro **tiene que fijar su color de texto**; si hereda, queda blanco sobre blanco. Ya pasó una vez en la pantalla de clasificación con el SKU, la cantidad y los dos inputs de criterios.

**`vite build` no typechequea.** Se acumularon 31 errores, se limpiaron, y al día siguiente había 15 más. Ahora el hook de pre-commit corre `tsc --noEmit` cuando hay `.ts`/`.tsx` en el stage (incremental: 11s en frío, <2s después). Se puede saltear con `--no-verify`.

**Mergear no aplica migraciones.** `git push` despliega el frontend a la DB compartida sin tocar el esquema. Pasó dos veces: `warehouse_overstock_plans` y `warehouse_menu_usage_stats` estuvieron rotas en prod desde el 27 hasta el 29 de julio. Checklist post-merge con archivos en `supabase/migrations/`: `migration list --linked` → `db push --linked` → verificar con un query.

**Nueva columna o tabla = 4 lugares.** Migración, schema Zod, **los dos** archivos de tipos (`src/integrations/supabase/types.ts` y `src/lib/database.types.ts`), y los selects explícitos. Si falta un tipo, PostgREST ignora la columna en silencio.

## 5) Entorno local

**Base de datos.** Usar `scripts/sync-local-db-chunked.sh` — trae ~1 MB por corrida contra los ~110 MB del dump completo, es reanudable y **no trunca al inicio**. `--status` muestra progreso, `--reset` empieza de cero. El `sync-local-db.sh` completo funciona pero quema egress: el plan Free son 5 GB al mes y se agotaron con unas 45 corridas.

**Login local.** Depende de qué sync corriste:

| Situación                              | Contraseña                             |
| -------------------------------------- | -------------------------------------- |
| Después de `sync-local-db.sh` completo | `1111` para todos los usuarios de prod |
| `admin@test.com` del seed              | `password123`                          |

Si el login devuelve 400 con la contraseña correcta, revisar que `auth.users` tenga `aud='authenticated'`, `role='authenticated'` e `instance_id='00000000-...'`. El bloque de usuarios del `seed.sql` no las incluye y GoTrue las exige.

**`VITE_SUPABASE_URL`.** Usar `http://127.0.0.1:54321`. Estuvo hardcodeada con la IP de la LAN y se rompió cuando el router rotó el lease — el síntoma es `Failed to fetch`, distinto del 400 de credenciales. Solo poner la IP de la LAN si hace falta probar desde un celular.

**Sesión vencida.** Si el token expiró y su refresh falla, la app se queda en el spinner para siempre en vez de caer al login. Se destraba borrando las claves `sb-*` de localStorage. **Es un bug abierto**, le pasa a cualquiera que vuelva después de varios días.

## 6) Datos de referencia

Medido el 2026-07-28 sobre ROW 28-33 (116 SKUs con stock):

|          | No-movers     | Movers        |
| -------- | ------------- | ------------- |
| Bloque A | 52 SKU · 175u | 5 SKU · 62u   |
| Bloque B | 21 SKU · 267u | 18 SKU · 348u |

**De los 85 no-movers, solo 7 alcanzan las 20 unidades** para formar un DS-Pallet. Conservar únicamente lo que ya está en los bloques llena 7 celdas: el grueso de la capacidad tiene que venir de no-movers traídos de otras rows.

**ROW 33 es un cajón de sastre:** unas 30 líneas son SKUs `01-xxxx`/`02-xxxx` de 1 unidad que nunca despacharon. Por eso la pantalla de clasificación tiene selección múltiple y los filtros "Only 1 unit" / "Never shipped".

Clasificación completa en `docs/qa-audits/movers-nonmovers-2026-07-28.md`.
Para reproducir contra prod sin sincronizar: `scripts/validate-block-classification.sql`.

## 7) Pendientes sueltos

- **Sin push.** `main` tiene todo commiteado pero no empujado, y `git push` despliega a producción (`pickd.pages.dev`).
- La lista de no-movers está sembrada **solo en local** (52 en A, 21 en B), a partir del RPC. Producción tiene la tabla vacía.
- `scripts/build-stock-movement-report.py` es el generador de reportes por SKU, reemplazado por `build-model-rotation-report.py` (por modelo). Sin trackear, se puede borrar.
- `reports/csv_stock/` tiene el CSV fuente del informe para la jefatura. Sin trackear.
- Los 15 errores de tipos que aparecieron el 29 salieron de commits de otra sesión, no del DS-Pallet. Ya están arreglados, pero muestran que el repo tiene varias sesiones escribiendo en paralelo.
