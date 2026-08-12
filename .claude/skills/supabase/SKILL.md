---
name: supabase
description: "Operaciones con Supabase en PickD: testing SQL local, migraciones, sync DB, reset, queries, debugging de RPCs, crear usuarios de prueba, operaciones en auth.*. Usa este skill cuando el agente necesite interactuar con Supabase de cualquier forma — ejecutar SQL, testear funciones, crear migraciones, sincronizar bases de datos, resolver errores de DB, crear/resetear usuarios, o cualquier operación que involucre la base de datos local o remota. Incluye gotchas de herramientas (MCP vs CLI, FK chains, migration repair). Triggers: 'test sql', 'run query', 'supabase', 'migration', 'db reset', 'sync db', 'check db', 'psql', 'rpc error', 'schema drift', 'test function', 'database', 'create users', 'auth users', 'seed users'."
---

# /supabase — Operaciones Supabase para PickD

## Instrucciones para el agente

Lee SOLO la sección que aplica a tu caso. Si ningún caso aplica, cierra este skill e intenta por tu cuenta.

---

## Reglas de acceso a la DB local

### Dos usuarios, dos propósitos

| Usuario          | Comando                                                                        | Acceso                                  |
| ---------------- | ------------------------------------------------------------------------------ | --------------------------------------- |
| `postgres`       | `docker exec supabase_db_pickd psql -U postgres -d postgres -c "SQL"`          | `public.*` (inventory, profiles, etc.)  |
| `supabase_admin` | `docker exec -e PGPASSWORD=postgres supabase_db_pickd psql -U supabase_admin -d postgres -c "SQL"` | `auth.*`, `public.*`, triggers, grants  |

### Lo que NO funciona (no intentar)

- `psql` directo en el host — **no está instalado**, solo existe dentro del container
- `npx supabase db exec` — **no existe** como subcomando
- `npx supabase db reset --db-url` — flag `--db-url` **no existe** en `db reset`
- `-U postgres` para tablas de `auth.*` — necesita `supabase_admin`
- Leer `.env` para sacar connection strings y usar `psql` directo — usar `db query --linked` en su lugar

---

## Reglas de acceso a la DB de producción

### Método preferido: Supabase CLI

```bash
npx supabase db query --linked "SELECT * FROM inventory LIMIT 5;"
```

`--linked` usa el proyecto ya vinculado via `npx supabase link` (ya configurado para PickD). No necesitas connection strings, `.env`, ni `psql` instalado en el host.

**Para SQL multilínea:**

```bash
npx supabase db query --linked "$(cat <<'EOSQL'
SELECT ...
FROM ...
WHERE ...;
EOSQL
)"
```

**Regla:** Para queries contra **producción**, SIEMPRE usar `npx supabase db query --linked`. Para queries contra la **DB local**, usar Docker exec (ver abajo).

---

## CASO 1: Ejecutar SQL contra la DB local

**Cuándo:** Necesitas ejecutar queries, testear funciones, insertar datos de prueba, o verificar estado de tablas.

**Para tablas `public.*`:**

```bash
docker exec supabase_db_pickd psql -U postgres -d postgres -c "SELECT * FROM inventory LIMIT 5;"
```

**Para tablas `auth.*` (usuarios, identities, sessions):**

```bash
docker exec -e PGPASSWORD=postgres supabase_db_pickd psql -U supabase_admin -d postgres -c "SELECT email FROM auth.users;"
```

**Para SQL multilínea:**

```bash
docker exec -i supabase_db_pickd psql -U postgres -d postgres <<'EOSQL'
SELECT ...;
UPDATE ...;
EOSQL
```

**FK obligatoria:** Si insertas en `inventory`, primero inserta en `sku_metadata`:

```sql
INSERT INTO sku_metadata (sku) VALUES ('SKU') ON CONFLICT DO NOTHING;
```

---

## CASO 2: Aplicar migraciones / Reset de DB

**Cuándo:** Creaste un nuevo archivo en `supabase/migrations/` y necesitas aplicarlo, o la DB está corrupta.

**Comando:**

```bash
npx supabase db reset
```

### Gotchas del reset

1. **Error 502 al final** — es normal. El reset SÍ se completó. Solo es un timeout del health check durante el restart de containers. Espera ~10 segundos y verifica con un query.
2. **No hay `supabase/seed.sql`** — después del reset la DB queda VACÍA (sin usuarios, sin datos). Necesitas recrear los usuarios de prueba (ver Caso 8).
3. **Migraciones con NOTICE** — `NOTICE: ... does not exist, skipping` es normal en migraciones idempotentes. No es un error.

**Naming de migraciones:** `YYYYMMDDHHMMSS_descripcion.sql` (ejemplo: `20260310000001_adjust_distribution.sql`).

**No uses:** `npx supabase db push` para local — eso es solo para producción.

---

## CASO 3: Testear una función RPC

**Cuándo:** Necesitas verificar que una función SQL/RPC funciona correctamente.

**Pasos:**

1. **SIEMPRE** consultar la firma antes de llamar un RPC desconocido:
   ```sql
   SELECT pg_get_function_arguments(oid) FROM pg_proc WHERE proname = 'nombre_funcion';
   ```
2. Setup datos de prueba (ver Caso 1 para el comando)
3. Ejecutar la función: `SELECT public.nombre_funcion(params);`
4. Verificar resultado: `SELECT columnas FROM tabla WHERE condicion;`
5. Limpiar: `DELETE FROM tabla WHERE condicion;`

**Para tests que necesitan un user_id válido:** Usa los usuarios de E2E (Caso 8) o envuelve en `BEGIN; ... ROLLBACK;` para no ensuciar la DB.

### RPCs frecuentes — firmas reales

**`move_inventory_stock`** (mover stock entre locations):

```sql
SELECT move_inventory_stock(
  '03-XXXXXX',        -- p_sku text
  'LUDLOW',           -- p_from_warehouse text (siempre LUDLOW en PickD)
  'ROW N',            -- p_from_location text
  'LUDLOW',           -- p_to_warehouse text (siempre LUDLOW en PickD)
  'ROW M',            -- p_to_location text
  4,                  -- p_qty integer
  'Performed by name', -- p_performed_by text
  'uuid'::uuid,       -- p_user_id uuid (optional)
  'staff',            -- p_user_role text (optional, default 'staff')
  NULL,               -- p_internal_note text (optional)
  NULL                -- p_sublocation text[] (optional)
);
```

> **IMPORTANTE:** El warehouse de PickD es **`LUDLOW`**, NO `MAIN`. Usar `MAIN` causa `Source item not found or inactive`.

---

## CASO 4: Ver estructura de una tabla o función

**Cuándo:** Necesitas ver columnas, tipos, constraints, o el body de una función.

**Tabla:**

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns WHERE table_name = 'TABLA' ORDER BY ordinal_position;
```

**Función (ver código completo):**

```sql
SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'NOMBRE_FUNCION';
```

**Triggers de una tabla:**

```sql
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers WHERE event_object_table = 'TABLA';
```

**Constraints:**

```sql
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.TABLA'::regclass;
```

---

## CASO 5: Sincronización DB local <-> producción

**Cuándo:** El usuario dice "sync db", "check db", "estoy sincronizado", "schema drift", "sync prod→local", "sync local→prod", "sincroniza", "jala la data".

### PRIMERO: Clasificar qué pide el usuario

| Palabra clave                                                                  | Tipo       |
| ------------------------------------------------------------------------------ | ---------- |
| "sincroniza", "jala datos", "sync data", "data de prod", genérico sin contexto | **DATA**   |
| "schema drift", "migraciones", "estructura", "sync schema"                     | **SCHEMA** |

**Default = DATA** (es lo más común).

### Sync DATA: prod -> local

**Un solo comando. No pienses, no diagnostiques, solo ejecuta:**

```bash
bash scripts/sync-local-db.sh
```

El script hace todo automáticamente: dump de prod (auth + public en paralelo), trunca local, importa en orden correcto como superuser, verifica conteos, y limpia temps.

**Requisitos:** Docker corriendo + `npx supabase start` + `PROD_DB_URL` en `.env`.

Si el script falla por columnas/tablas faltantes, ejecutar sync de SCHEMA primero y después DATA.

### Sync SCHEMA: prod -> local

```bash
npx supabase db pull
npx supabase db reset
```

**Importante:** Después del reset, recrear usuarios de prueba (Caso 8).

### Sync SCHEMA: local -> prod

1. `node scripts/compare-schemas.js` — identifica diffs
2. Frontend check — verifica qué usa el frontend antes de tocar algo:
   ```bash
   grep -r "\.rpc(" src/ --include="*.ts" --include="*.tsx" -h | grep -oP "(?<=\.rpc\()['\"][^'\"]+['\"]" | sort -u
   grep -r "\.from(" src/ --include="*.ts" --include="*.tsx" -h | grep -oP "(?<=\.from\()['\"][^'\"]+['\"]" | sort -u
   ```
3. Lee `scripts/db-health-map.json` si existe — revisa si el drift actual ya ocurrió antes y cómo se resolvió
4. Clasifica cambios: ADD COLUMN/CREATE FUNCTION = seguro. DROP/RENAME = peligroso (pedir confirmación)
5. `npx supabase migration new [nombre]` + escribe SQL
6. `npx supabase db push`
7. Verifica con `npx supabase migration list`
8. Actualiza `scripts/db-health-map.json`

### Modo revisión (solo diagnóstico)

```bash
node scripts/compare-schemas.js
npx supabase migration list
```

**Reglas:**

- **NUNCA** ejecutes `db push`, `migration repair`, o cualquier comando que modifique producción sin que el usuario lo pida EXPLÍCITAMENTE
- Nunca DROP sin confirmación explícita
- Si `compare-schemas.js` requiere `PROD_DB_URL` en `.env`, avisa al usuario
- Si una RPC del frontend grep no existe en el schema destino, bloquea y advierte
- Ante la duda entre modificar prod o preguntar al usuario, SIEMPRE pregunta

---

## CASO 6: Debugging de errores de DB

**Cuándo:** Una operación falla con error de Supabase/Postgres.

**Errores comunes:**

| Error                                                                 | Causa                                    | Fix                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------- |
| `violates foreign key constraint "inventory_sku_fkey"`                | Falta entry en `sku_metadata`            | `INSERT INTO sku_metadata (sku) VALUES ('X') ON CONFLICT DO NOTHING;`      |
| `violates foreign key constraint "profiles_id_fkey"`                  | Intentaste crear profile sin auth.user   | Crear auth.users PRIMERO, luego profiles (Caso 8)                          |
| `must be owner of table users`                                        | Usaste `-U postgres` para `auth.*`       | Usar `-U supabase_admin` con `-e PGPASSWORD=postgres`                      |
| `there is no unique or exclusion constraint matching the ON CONFLICT` | ON CONFLICT mal escrito                  | Verifica el constraint real con Caso 4                                     |
| `function X does not exist`                                           | Migración no aplicada                    | `npx supabase db reset` + recrear usuarios (Caso 8)                        |
| `permission denied`                                                   | Falta GRANT                              | `GRANT EXECUTE ON FUNCTION public.X TO anon, authenticated, service_role;` |
| `column X does not exist`                                             | Schema drift                             | Verifica con Caso 4, aplica migración si falta                             |
| `Invalid login credentials` en E2E tests                              | Usuarios de prueba no existen            | Ejecutar Caso 8                                                            |
| `Error status 502` después de `db reset`                              | Normal — container reiniciando           | Esperar 10s y verificar con un query                                       |
| `converting NULL to string` en GoTrue                                 | Campos string en auth.users son NULL     | Todos los campos string deben ser `''` no NULL                             |

---

## CASO 7: Crear una nueva migración

**Cuándo:** Necesitas agregar/modificar tablas, columnas, funciones, o RPCs.

**Pasos:**

1. Crea el archivo: `supabase/migrations/YYYYMMDDHHMMSS_descripcion.sql`
2. Usa `CREATE OR REPLACE FUNCTION` para funciones (idempotente)
3. Usa `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` para columnas
4. Incluye `GRANT` al final para `anon`, `authenticated`, `service_role`
5. Aplica: `npx supabase db reset`
6. Recrear usuarios de prueba (Caso 8) si necesitas testear
7. Testea (Caso 3)

**Template para función:**

```sql
CREATE OR REPLACE FUNCTION public.mi_funcion(p_param1 text, p_param2 integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSONB;
BEGIN
  -- lógica
  RETURN v_result;
END;
$$;

ALTER FUNCTION public.mi_funcion(text, integer) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.mi_funcion(text, integer) TO anon, authenticated, service_role;
```

---

## CASO 8: Crear usuarios para desarrollo local + E2E tests

**Cuándo:** Después de un `db reset`, o cuando los E2E tests fallan con `Invalid login credentials`, o cuando `auth.users` está vacío.

**Comando (un solo script que hace todo):**

```bash
docker exec -e PGPASSWORD=postgres -i supabase_db_pickd psql -U supabase_admin -d postgres < supabase/create_users.sql
```

El script `supabase/create_users.sql` hace:
1. Elimina constraint `users_phone_key` (causa duplicados con `''`)
2. Crea auth.users + identities para cada perfil de producción existente (password: `1111`)
3. Repara NULLs en campos string de auth.users (GoTrue crashea con NULLs)
4. Crea/actualiza usuarios E2E (admin@test.com / password123, staff@test.com / password123)
5. Activa todos los perfiles para desarrollo local

**Nota:** `bash scripts/sync-local-db.sh` ya ejecuta este paso automáticamente (paso 6b). Solo necesitas el comando standalone después de `npx supabase db reset`.

**Credenciales resultantes:**

| Role           | Email            | Password      | UUID                                   |
| -------------- | ---------------- | ------------- | -------------------------------------- |
| E2E admin      | admin@test.com   | password123   | 00000000-0000-0000-0000-000000000001   |
| E2E staff      | staff@test.com   | password123   | 00000000-0000-0000-0000-000000000002   |
| Prod users     | (from profiles)  | 1111          | (original UUIDs)                       |

**Reglas de auth.users:**
- **Orden FK:** `auth.users` primero, `public.profiles` después (`profiles.id -> auth.users.id`)
- **Campos string:** TODOS deben ser `''` (vacío), NUNCA `NULL` — GoTrue crashea con `converting NULL to string`
- **Identities:** Necesarias para que el login funcione — sin ellas, GoTrue no reconoce al usuario

---

## CASO 9: Gotchas de herramientas y entorno

**Cuándo:** Siempre. Lee esto antes de ejecutar comandos contra Supabase en PickD.

### Supabase MCP vs CLI

- El **Supabase MCP** (tools `mcp__claude_ai_Supabase__*`) **NO tiene acceso** al proyecto Pickd. Solo ve "Drivly". No pierdas tiempo intentando usarlo.
- **Siempre usar CLI:** `npx supabase db query --linked "SQL"` para prod, `npx supabase db query "SQL"` para local.

### Project ref

El project ref de Pickd (`xexkttehzpxtviebglei`) no está en `.env`. Está hardcodeado en `scripts/compare-schemas.js`. No lo necesitas porque `--linked` ya lo resuelve.

### Queries con `db query`

- **NO acepta múltiples statements** separados por `;`. Cada query debe ser un comando separado.
- Correcto: `npx supabase db query --linked "SELECT 1;"` → luego → `npx supabase db query --linked "SELECT 2;"`
- Incorrecto: `npx supabase db query --linked "SELECT 1; SELECT 2;"`

### `db push` falla por migraciones remote-only

Si prod tiene migraciones que no existen en local (aplicadas directo o desde otra máquina), `db push` se rehúsa. Fix:

```bash
npx supabase migration repair --status reverted XXXXXXXX --linked
```

Ejecutar una vez por cada migración remote-only listada en el error.

### FK chain para datos de test

Al insertar datos de test en local, respetar este orden de FKs:

```
sku_metadata → locations → inventory
auth.users → user_presence → picking_lists
auth.users → profiles
```

- `inventory` requiere `sku_metadata(sku)` y `locations(id)`
- `picking_lists` requiere `user_presence(user_id)`, no solo `auth.users`
- `picking_lists.id` es UUID, no string
- Después de `db reset` la DB queda vacía — recrear con Caso 8

---

## CASO 10: Ledger drift — migración fantasma (remote-only) o `db push` bloqueado

**Cuándo:** `db push` falla con `Remote migration versions not found in local migrations directory`, o dice "up to date" cuando esperabas pendientes, o `migration list --linked` muestra filas solo-locales/solo-remotas, o una función en el repo está más vieja que la de prod.

**Causa:** DDL aplicado **fuera del flujo de migraciones** — MCP `apply_migration`, SQL editor del dashboard, o `migrations.py` del watchdog. El ledger (`supabase_migrations.schema_migrations`) y el repo derivan en silencio.

### REGLA DE ORO

Todo DDL aplicado out-of-band se commitea al repo **EN EL MOMENTO**, como archivo en `supabase/migrations/` con el mismo version stamp. Si no, el repo queda con versiones viejas de funciones vivas y el ledger bloquea futuros `db push`.

### ⚠️ NUNCA hacer

`migration repair --status reverted <X>` **sin antes rescatar el SQL**: la fila del ledger contiene la ÚNICA copia del SQL aplicado (columna `statements`). El repair la borra. (Casi pasó el 2026-06-12 con un fix de inventario.)

### Solución (el orden importa)

1. **Diagnóstico:**
   ```bash
   npx supabase migration list --linked
   ```
   Identifica solo-locales (pendientes de push) y solo-remotas (fantasmas).
2. **Identificar la fantasma:**
   ```bash
   npx supabase db query --linked "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = 'X';"
   ```
3. **Rescatar su SQL** (antes que cualquier repair):
   ```bash
   npx supabase db query --linked "SELECT array_length(statements, 1) FROM supabase_migrations.schema_migrations WHERE version = 'X';"
   npx supabase db query --linked "SELECT array_to_string(statements, E'\n\n') FROM supabase_migrations.schema_migrations WHERE version = 'X';"
   ```
   Confirmar que `array_length` coincide con lo extraído.
4. **Crear el archivo** `supabase/migrations/X_nombre.sql` con el SQL verbatim (+ nota de procedencia), commitear y mergear. Con el archivo presente, el error remote-only **desaparece sin repair**.
5. **Push.** Si quedan locales con timestamp ANTERIOR a la última remota, el CLI pide:
   ```bash
   npx supabase db push --linked --include-all
   ```
   Antes de confirmar, verificar que las que se van a re-aplicar (a) son idempotentes (`CREATE OR REPLACE` / `IF NOT EXISTS`) y (b) son la versión MÁS RECIENTE de esas funciones en el repo (que ninguna migración posterior ni fantasma las haya tocado) — si no, re-aplicarlas regresiona prod.
6. **Verificar:** `npx supabase migration list --linked` → todo sincronizado, sin filas a medias.

### Gotcha: carpetas duplicadas / proyecto equivocado

Con varias carpetas `pickd` en la máquina, cada una puede estar linkeada a un proyecto distinto y un push "exitoso" puede ir a un proyecto viejo. Verificar SIEMPRE antes de aplicar a prod:

```bash
grep -c xexkttehzpxtviebglei supabase/.temp/pooler-url
```

`1` = conecta al prod real; `0` = otro proyecto (no apliques nada ahí). El archivo `project-ref` puede mentir si el `.temp` está viejo — el `pooler-url` es el que manda. Verificación independiente de que un remoto ES prod: debe tener el schema que la app viva usa (ej. `SELECT column_name FROM information_schema.columns WHERE table_name='picking_lists' AND column_name='source_order_date';`).

**Caso real resuelto (2026-06-12):** fantasma `20260603180000_fix_compensate_trigger_duplicate_matching` (fix de sobre-deducción de inventario aplicado via MCP, archivo nunca commiteado) — rescatada del ledger, commiteada (pickd #139), ledger reconciliado con `--include-all`. El primer intento de aplicar el waiting guard había ido a un proyecto viejo por el gotcha de carpetas.

---

## Referencia rápida del entorno

| Dato                                  | Valor                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Container DB                          | `supabase_db_pickd`                                                                    |
| Puerto local                          | `54322`                                                                                |
| Usuario `public.*`                    | `postgres`                                                                             |
| **Usuario `auth.*` + superuser**      | `supabase_admin` con `-e PGPASSWORD=postgres`                                          |
| DB                                    | `postgres`                                                                             |
| psql / pg_dump                        | Solo dentro del container — **NO están en el host**                                    |
| supabase CLI                          | `npx supabase`                                                                         |
| Migraciones dir                       | `supabase/migrations/`                                                                 |
| Seed file                             | **No existe** (`supabase/seed.sql`) — db reset deja DB vacía                           |
| Scripts                               | `scripts/compare-schemas.js`, `scripts/sync-local-db.sh`, `scripts/db-health-map.json` |
| E2E admin                             | `admin@test.com` / `password123`                                                       |
| E2E staff                             | `staff@test.com` / `password123`                                                       |
